/**
 * Hub orchestrator — one endpoint, one run (spec §5).
 *
 * Flow: validate → route (deterministic) → quota guard (before the
 * call) → execute (ensemble / pipeline / single / engine) → deposit
 * every contribution into the Shared Power Pool → synthesize →
 * verify (sandbox for code, compliance scan for text/doc) → ledger
 * (always, even on failure) → result.
 *
 * Honesty rules enforced here:
 * - Code is never ok:true unless the sandbox passed it. Sandbox
 *   "unavailable" or "failed" fails the run with a typed error.
 * - Compliance-rejected text is never shipped: the run fails with
 *   `compliance_rejected` and the ledger keeps the evidence.
 * - Quota is checked before each leg; an over-quota leg is paused and
 *   logged, never silently replaced by a different model.
 * - costUsd is always 0 on the free stack; a paid leg would have to
 *   report its cost here before it could claim ok:true.
 */
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { appendLedger } from "./ledger";
import { recordTrainingExample } from "./training-data";
import { deposit } from "./pool";
import { checkQuota } from "./quota";
import { ensembleLegs, routeTask, textTimeoutMs, legFor, buildModel, synthModel } from "./router";
import { callTextLeg, fanOut, synthesizeCode, synthesizeText, type TextCaller } from "./ensemble";
import { runPipeline } from "./pipeline";
import { runInSandbox } from "./sandbox";
import { runDocument, runEbook, runImage, runTemplatePack, runVideoPackage } from "./engines";
import {
  HUB_DELIVER_FORMATS,
  HUB_TASK_KINDS,
  HubError,
  newRunId,
  type Contribution,
  type DeliverFormat,
  type HubMode,
  type HubResult,
  type HubTaskKind,
  type HubVerification,
  type TextLeg,
} from "./types";

export const hubRequestSchema = z.object({
  task: z.object({
    kind: z.enum(HUB_TASK_KINDS),
    prompt: z.string().min(1).max(8000),
    mode: z.enum(["ensemble", "pipeline", "single", "engine"]).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  deliver: z.object({
    format: z.enum(HUB_DELIVER_FORMATS),
  }),
  limits: z
    .object({ maxRetries: z.number().int().min(0).max(2).default(2) })
    .optional(),
});

export type HubRunInput = z.infer<typeof hubRequestSchema>;

export interface RunHubDeps {
  /** Test seam: replaces real provider calls in ensemble/pipeline. */
  caller?: TextCaller;
}

/** Compliance scan for text/doc outputs (never code — see runHub). One hit fails the whole output, like the digital lib. */
export function scanCompliance(text: string): { status: "approved" | "rejected"; reasons: string[] } {
  const price = text.match(PRICE_PATTERN);
  if (price) return { status: "rejected", reasons: [`price/offer pattern: "${price[0]}"`] };
  const banned = text.match(BANNED_CLAIM_PATTERN);
  if (banned) return { status: "rejected", reasons: [`banned claim pattern: "${banned[0]}"`] };
  return { status: "approved", reasons: [] };
}

function depositAll(runId: string, contributions: Contribution[], kind: "text" | "code" | "plan" | "critique"): number {
  let n = 0;
  for (const c of contributions) {
    if (!c.text) continue;
    const k = c.legId.endsWith("-plan") ? "plan" : c.legId.endsWith("-critique") ? "critique" : kind;
    deposit({
      runId,
      lane: c.lane,
      legId: c.legId,
      provider: c.provider,
      model: c.model,
      kind: k,
      text: c.text,
      score: c.score,
      createdAt: new Date().toISOString(),
    });
    n++;
  }
  return n;
}

function extractCodeBlock(text: string): { code: string; language: "javascript" | "python" } | null {
  const fenced = text.match(/```(python|js|javascript|ts|typescript)?\n([\s\S]*?)```/);
  if (fenced) {
    return { code: fenced[2].trim(), language: fenced[1] === "python" ? "python" : "javascript" };
  }
  return null;
}

function baseVerification(): HubVerification {
  return { sandbox: "skipped", compliance: "skipped", retriesUsed: 0 };
}

export async function runHub(input: HubRunInput, deps: RunHubDeps = {}): Promise<HubResult> {
  const started = Date.now();
  const runId = newRunId();
  const kind = input.task.kind as HubTaskKind;
  const format = input.deliver.format as DeliverFormat;
  const maxRetries = input.limits?.maxRetries ?? 2;
  const verification = baseVerification();
  let mode: HubMode = input.task.mode ?? "single";
  let ledgerId = "";
  let deposits = 0;

  const finish = (
    ok: boolean,
    output: HubResult["output"],
    usageModels: string[],
    calls: number,
    error?: { code: string; message: string },
    survivors = 0
  ): HubResult => {
    ledgerId = appendLedger({
      runId,
      taskKind: kind,
      mode,
      deliverFormat: format,
      models: [...new Set(usageModels)],
      calls,
      costUsd: 0,
      ok,
      errorCode: error?.code,
      verification,
      durationMs: Date.now() - started,
    });
    // Training data (see training-data.ts): every text/code run becomes
    // one labelled SFT example — approved (shipped) or rejected/failed
    // (with the reason). Engine runs have no text output, so they record
    // nothing. Best-effort: a failed write never fails the run.
    if (
      (output.kind === "text" || output.kind === "code") &&
      typeof output.text === "string" &&
      output.text.trim().length > 0
    ) {
      recordTrainingExample({
        runId,
        createdAt: new Date().toISOString(),
        kind,
        mode,
        instruction: input.task.prompt,
        output: output.text,
        verdict: ok
          ? "approved"
          : error?.code === "compliance_rejected"
            ? "rejected"
            : "failed",
        reason: error ? `${error.code}: ${error.message}` : undefined,
        models: [...new Set(usageModels)],
      });
    }
    return { ok, runId, ledgerId, mode, output, verification, usage: { models: [...new Set(usageModels)], calls, costUsd: 0 }, pool: { deposits, survivors }, error };
  };

  try {
    const plan = routeTask(kind, input.task.mode, format);
    mode = plan.mode;
    const prompt = input.task.prompt;

    // ---- Engine modes: reuse the built engines, no text legs. ----
    if (plan.mode === "engine") {
      if (format === "image") {
        const r = await runImage(prompt, runId);
        verification.engine = "pollinations-flux";
        return finish(true, { kind: "image", files: r.files, data: r.data }, ["pollinations-flux"], 1);
      }
      if (format === "video") {
        // Visual + text lanes in parallel (§11): keyframe + script at once.
        const legs = ensembleLegs();
        const [fan, keyframe] = await Promise.all([
          fanOut(legs, `Write a 15-second Hinglish product video script (hook, 3 beats, CTA, no prices, no fake claims) for: ${prompt}`, { timeoutMs: textTimeoutMs(), lane: "text", caller: deps.caller }),
          runImage(`Cinematic 9:16 vertical product key frame, dark premium style: ${prompt}`.slice(0, 1000), runId),
        ]);
        deposits += depositAll(runId, fan.contributions, "text");
        const synth = await synthesizeText(fan.survivors, prompt, legFor("synth", synthModel()), { caller: deps.caller });
        const script = synth.text || fan.survivors[0]?.text || "";
        const pkg = await runVideoPackage(prompt, runId, script, input.task.payload, keyframe.files);
        verification.engine = "video-pool";
        verification.video = "planned";
        return finish(true, { kind: "video-package", text: script, files: pkg.files, data: pkg.data }, ["pollinations-flux", ...fan.contributions.map((c) => c.model)], fan.contributions.length + 1, undefined, fan.survivors.length);
      }
      if (format === "ebook-pdf") {
        const r = await runEbook(input.task.payload);
        verification.engine = "digital-ebook";
        return finish(true, { kind: "ebook-pdf", files: r.files, data: r.data }, [], 0);
      }
      if (format === "template-pack") {
        const r = await runTemplatePack(input.task.payload);
        verification.engine = "digital-templates";
        return finish(true, { kind: "template-pack", files: r.files, data: r.data }, [], 0);
      }
      if (format === "docx" || format === "pptx" || format === "epub" || format === "xlsx") {
        const r = await runDocument(format, input.task.payload);
        verification.engine = "digital-docs";
        return finish(true, { kind: format, files: r.files, data: r.data }, [], 0);
      }
      throw new HubError("not_built", `No engine builds deliver.format '${format}' yet.`);
    }

    // ---- Text modes: quota guard first, then execute. ----
    const legs = plan.legs.filter((leg) => {
      const q = checkQuota(leg.model);
      return q.allowed;
    });
    const overQuota = plan.legs.filter((leg) => !checkQuota(leg.model).allowed);
    if (legs.length === 0) {
      return finish(
        false,
        { kind: format === "code" ? "code" : "text" },
        plan.legs.map((l) => l.model),
        0,
        { code: "quota_exceeded", message: `All text legs are over their daily quota (${overQuota.map((l) => l.model).join(", ")}). Try again tomorrow — nothing was called.` }
      );
    }

    const isCode = kind === "code" || kind === "automation" || kind === "n8n-json" || format === "code";
    const lane = isCode ? "code" : "text";

    if (plan.mode === "ensemble") {
      const fan = await fanOut(legs, prompt, { timeoutMs: textTimeoutMs(), lane, caller: deps.caller });
      deposits += depositAll(runId, fan.contributions, lane);
      const usedModels = fan.contributions.map((c) => c.model);
      if (fan.survivors.length === 0) {
        return finish(false, { kind: format === "code" ? "code" : "text" }, usedModels, fan.contributions.length, {
          code: "all_legs_paused",
          message: `Every text leg paused (${fan.contributions.map((c) => `${c.legId}:${c.pauseReason ?? "error"}`).join(", ")}). Check GROQ_API_KEY / GEMINI_API_KEY and the ledger.`,
        });
      }
      let text: string;
      let synthModelUsed: string | null = null;
      if (isCode) {
        text = synthesizeCode(fan.survivors).text;
      } else {
        const synth = await synthesizeText(fan.survivors, prompt, plan.synth, { caller: deps.caller });
        text = synth.text;
        synthModelUsed = synth.modelUsed;
      }
      if (synthModelUsed) usedModels.push(synthModelUsed);

      if (!isCode) {
        const scan = scanCompliance(text);
        verification.compliance = scan.status === "approved" ? "approved" : "rejected";
        verification.complianceReasons = scan.reasons;
        if (scan.status === "rejected") {
          return finish(false, { kind: "text", text }, usedModels, fan.contributions.length, {
            code: "compliance_rejected",
            message: `Output failed the compliance scan: ${scan.reasons.join("; ")}. Fix the prompt and try again.`,
          }, fan.survivors.length);
        }
        verification.compliance = "approved";
        return finish(true, { kind: "text", text }, usedModels, fan.contributions.length, undefined, fan.survivors.length);
      }

      // Code path: sandbox verifies; on failure, traceback goes back to
      // the builder once per retry budget (spec §5).
      let codeText = text;
      let attempts = 0;
      for (;;) {
        const block = extractCodeBlock(codeText);
        const code = block?.code ?? codeText;
        const language = block?.language ?? "javascript";
        const sb = await runInSandbox({ language, code });
        verification.sandbox = sb.status;
        verification.sandboxDetail = sb.detail;
        if (sb.status === "passed") {
          return finish(true, { kind: "code", text: codeText }, usedModels, fan.contributions.length, undefined, fan.survivors.length);
        }
        if (attempts >= maxRetries) {
          return finish(false, { kind: "code", text: codeText }, usedModels, fan.contributions.length, {
            code: sb.status === "unavailable" ? "sandbox_unavailable" : "sandbox_failed",
            message: `Code did not verify in the sandbox (${sb.status}): ${sb.detail} ${sb.stderr ? `Stderr: ${sb.stderr.slice(0, 300)}` : ""}`,
          }, fan.survivors.length);
        }
        attempts++;
        verification.retriesUsed = attempts;
        const fixLeg: TextLeg = legFor("build", buildModel());
        const fixed = deps.caller
          ? await deps.caller(fixLeg, `Fix this ${language} code so it runs without errors. Traceback:\n${sb.stderr || sb.detail}\n\nCODE:\n${code}`)
          : await callTextLeg(fixLeg, `Fix this ${language} code so it runs without errors. Traceback:\n${sb.stderr || sb.detail}\n\nCODE:\n${code}`, { maxTokens: 2048, temperature: 0.3 });
        if (!fixed) break;
        codeText = fixed.text;
        usedModels.push(fixLeg.model);
      }
      return finish(false, { kind: "code", text: codeText }, usedModels, fan.contributions.length, {
        code: "sandbox_failed",
        message: "Builder could not produce runnable code within the retry budget.",
      }, fan.survivors.length);
    }

    if (plan.mode === "pipeline") {
      const pipe = await runPipeline({
        planLeg: plan.legs[0],
        buildLeg: plan.legs[1] ?? plan.legs[0],
        criticLeg: plan.legs[2] ?? plan.legs[0],
        prompt,
        maxRetries,
        lane,
        caller: deps.caller,
      });
      deposits += depositAll(runId, pipe.contributions, lane);
      verification.retriesUsed = pipe.retriesUsed;
      const usedModels = pipe.contributions.map((c) => c.model);
      if (pipe.sandbox) {
        verification.sandbox = pipe.sandbox.status;
        verification.sandboxDetail = pipe.sandbox.detail;
      }
      if (isCode) {
        if (!pipe.sandbox || pipe.sandbox.status !== "passed") {
          return finish(false, { kind: "code", text: pipe.text }, usedModels, pipe.contributions.length, {
            code: pipe.sandbox?.status === "unavailable" ? "sandbox_unavailable" : "sandbox_failed",
            message: `Code did not verify in the sandbox (${pipe.sandbox?.status ?? "skipped"}): ${pipe.sandbox?.detail ?? "no sandbox result"}`,
          });
        }
        return finish(true, { kind: "code", text: pipe.text }, usedModels, pipe.contributions.length);
      }
      const scan = scanCompliance(pipe.text);
      verification.compliance = scan.status === "approved" ? "approved" : "rejected";
      verification.complianceReasons = scan.reasons;
      if (scan.status === "rejected") {
        return finish(false, { kind: "text", text: pipe.text }, usedModels, pipe.contributions.length, {
          code: "compliance_rejected",
          message: `Output failed the compliance scan: ${scan.reasons.join("; ")}.`,
        });
      }
      return finish(true, { kind: "text", text: pipe.text }, usedModels, pipe.contributions.length);
    }

    // Single: one fast leg.
    const leg = legs[0];
    const single = deps.caller
      ? await deps.caller(leg, prompt)
      : await callTextLeg(leg, prompt, { maxTokens: 1024, temperature: 0.7 });
    if (!single) {
      return finish(false, { kind: format === "code" ? "code" : "text" }, [leg.model], 1, {
        code: "not_configured",
        message: `Leg ${leg.id} (${leg.model}) returned nothing — check ${leg.provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"} and the ledger.`,
      });
    }
    deposits += depositAll(
      runId,
      [{ legId: leg.id, provider: leg.provider, model: leg.model, lane, text: single.text, status: "ok", durationMs: single.durationMs, score: 60 }],
      lane
    );
    if (isCode) {
      const block = extractCodeBlock(single.text);
      const sb = await runInSandbox({ language: block?.language ?? "javascript", code: block?.code ?? single.text });
      verification.sandbox = sb.status;
      verification.sandboxDetail = sb.detail;
      if (sb.status !== "passed") {
        return finish(false, { kind: "code", text: single.text }, [leg.model], 1, {
          code: sb.status === "unavailable" ? "sandbox_unavailable" : "sandbox_failed",
          message: `Code did not verify in the sandbox (${sb.status}): ${sb.detail}`,
        });
      }
      return finish(true, { kind: "code", text: single.text }, [leg.model], 1);
    }
    const scan = scanCompliance(single.text);
    verification.compliance = scan.status === "approved" ? "approved" : "rejected";
    verification.complianceReasons = scan.reasons;
    if (scan.status === "rejected") {
      return finish(false, { kind: "text", text: single.text }, [leg.model], 1, {
        code: "compliance_rejected",
        message: `Output failed the compliance scan: ${scan.reasons.join("; ")}.`,
      });
    }
    return finish(true, { kind: "text", text: single.text }, [leg.model], 1);
  } catch (err) {
    if (err instanceof HubError) {
      return finish(false, { kind: format === "code" ? "code" : "text" }, [], 0, { code: err.code, message: err.message });
    }
    return finish(false, { kind: format === "code" ? "code" : "text" }, [], 0, {
      code: "internal_error",
      message: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
  }
}
