/**
 * Hub router — task-aware, deterministic (spec §4 + §11).
 *
 * One request, one decision: the router reads `task.kind`, never a model
 * name. Model IDs come from env (HUB_*_MODEL) with live-verified
 * defaults; the retired Llama/DeepSeek IDs are never defaults here.
 * The Groq adapter's own default (llama-3.3-70b-versatile, retired) is
 * never used by the hub — every hub call passes an explicit model.
 */
import {
  envInt,
  envOr,
  HubError,
  LIVE_GEMINI_FLASH,
  LIVE_GROQ_120B,
  LIVE_GROQ_20B,
  LIVE_GROQ_QWEN,
  type DeliverFormat,
  type HubLane,
  type HubMode,
  type HubTaskKind,
  type TextLeg,
} from "./types";

export interface RoutePlan {
  mode: HubMode;
  lanes: HubLane[];
  /** Text legs, in fan-out order. Empty for engine mode. */
  legs: TextLeg[];
  /** Synthesis leg (text modes). */
  synth: TextLeg;
  /** Engine lane (engine mode only). */
  engineFormat?: DeliverFormat;
}

export function planModel(): string {
  return envOr("HUB_PLAN_MODEL", LIVE_GROQ_120B);
}
export function buildModel(): string {
  return envOr("HUB_BUILD_MODEL", LIVE_GROQ_QWEN);
}
export function criticModel(): string {
  return envOr("HUB_CRITIC_MODEL", LIVE_GROQ_120B);
}
export function synthModel(): string {
  return envOr("HUB_SYNTH_MODEL", LIVE_GROQ_120B);
}
export function fastModel(): string {
  return envOr("HUB_FAST_MODEL", LIVE_GROQ_20B);
}
export function geminiModel(): string {
  return envOr("HUB_GEMINI_MODEL", LIVE_GEMINI_FLASH);
}
export function ensembleMax(): number {
  return envInt("HUB_ENSEMBLE_MAX", 4);
}
export function textTimeoutMs(): number {
  return envInt("HUB_TEXT_TIMEOUT_MS", 8000);
}

/** Provider follows the model id: gemini-* runs on Gemini, everything else on Groq. */
export function legFor(id: string, model: string): TextLeg {
  return { id, provider: model.startsWith("gemini") ? "gemini" : "groq", model };
}

/** All live text legs, in fan-out order, capped by HUB_ENSEMBLE_MAX (budget rule, not preference). */
export function ensembleLegs(): TextLeg[] {
  const all: TextLeg[] = [
    legFor("groq-120b", planModel()),
    legFor("groq-qwen", buildModel()),
    legFor("groq-20b", fastModel()),
    legFor("gemini-flash", geminiModel()),
  ];
  const seen = new Set<string>();
  const deduped = all.filter((l) => {
    if (seen.has(l.model)) return false;
    seen.add(l.model);
    return true;
  });
  return deduped.slice(0, Math.max(1, ensembleMax()));
}

const ENGINE_KINDS: Record<string, DeliverFormat> = {
  image: "image",
  video: "video",
  ebook: "ebook-pdf",
  template: "template-pack",
  spreadsheet: "xlsx",
};

const DOCUMENT_FORMATS: DeliverFormat[] = ["docx", "pptx", "epub"];

/**
 * Route one task. Throws HubError (validation_error / format_mismatch /
 * not_built) for requests the hub cannot honestly serve — never a silent
 * wrong-lane fallback.
 */
export function routeTask(
  kind: HubTaskKind,
  requestedMode?: HubMode,
  format?: DeliverFormat
): RoutePlan {
  const synth = legFor("synth", synthModel());

  // pdf-report has no engine yet: ebook-pdf and docx cover real reports.
  if (format === "pdf-report") {
    throw new HubError(
      "not_built",
      "deliver.format 'pdf-report' is not built yet — use 'ebook-pdf' or 'docx' instead."
    );
  }

  // Engine kinds: the deliver format must belong to that engine's family.
  if (kind in ENGINE_KINDS) {
    const expected = ENGINE_KINDS[kind];
    if (format !== expected) {
      throw new HubError(
        "format_mismatch",
        `task.kind '${kind}' needs deliver.format '${expected}', not '${format ?? "missing"}'.`
      );
    }
    const lanes: HubLane[] = kind === "image" ? ["visual"] : kind === "video" ? ["video"] : ["doc"];
    return { mode: "engine", lanes, legs: [], synth, engineFormat: expected };
  }
  if (kind === "document") {
    if (!format || !DOCUMENT_FORMATS.includes(format)) {
      throw new HubError(
        "format_mismatch",
        "task.kind 'document' needs deliver.format 'docx', 'pptx' or 'epub'."
      );
    }
    return { mode: "engine", lanes: ["doc"], legs: [], synth, engineFormat: format };
  }

  // Text kinds only accept text/code delivery.
  if (format && format !== "text" && format !== "code") {
    throw new HubError(
      "format_mismatch",
      `task.kind '${kind}' produces text/code, not '${format}'. Use the matching engine kind (image/video/ebook/template/document/spreadsheet).`
    );
  }

  switch (kind) {
    case "code":
    case "automation":
    case "n8n-json":
    case "reasoning":
    case "math":
    case "planning": {
      const mode = requestedMode ?? "ensemble";
      if (mode === "engine") {
        throw new HubError("format_mismatch", `task.kind '${kind}' cannot run in mode 'engine'.`);
      }
      if (mode === "single") {
        return { mode, lanes: ["text", "code"], legs: [legFor("groq-20b", fastModel())], synth };
      }
      if (mode === "pipeline") {
        return {
          mode,
          lanes: ["text", "code"],
          legs: [
            legFor("plan", planModel()),
            legFor("build", buildModel()),
            legFor("critic", criticModel()),
          ],
          synth,
        };
      }
      return { mode: "ensemble", lanes: ["text", "code"], legs: ensembleLegs(), synth };
    }
    case "long-doc":
    case "research": {
      // Context beats reasoning here: Gemini plans, Groq polishes.
      const mode = requestedMode ?? "pipeline";
      if (mode === "single") {
        return { mode, lanes: ["text"], legs: [legFor("gemini-flash", geminiModel())], synth };
      }
      return {
        mode: "pipeline",
        lanes: ["text"],
        legs: [
          legFor("plan", geminiModel()),
          legFor("build", planModel()),
          legFor("critic", criticModel()),
        ],
        synth,
      };
    }
    case "chat":
    case "summary":
    case "caption": {
      const mode = requestedMode ?? "single";
      if (mode === "single") {
        return { mode, lanes: ["text"], legs: [legFor("groq-20b", fastModel())], synth };
      }
      return { mode, lanes: ["text"], legs: ensembleLegs(), synth };
    }
    default:
      throw new HubError("validation_error", `Unknown task.kind '${kind}'.`);
  }
}
