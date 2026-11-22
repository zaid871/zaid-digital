/**
 * Hub pipeline — sequential Brain → Builder → Critic (spec §2, §4).
 *
 * This is the FALLBACK mode, not the default: Ensemble v2 fires models
 * in parallel; the pipeline runs only when a task needs a verified
 * chain rather than a vote (or when the caller explicitly asks for it).
 * Critic verdicts come back as one line (`VERDICT: OK` / `VERDICT:
 * REVISE`); on REVISE the builder retries once per retry budget
 * (max 2), with the critic's notes attached. Code is sandbox-verified
 * before it is returned as done.
 */
import { callTextLeg, type TextCaller } from "./ensemble";
import { runInSandbox, type SandboxResult } from "./sandbox";
import type { Contribution, HubLane, TextLeg } from "./types";

export interface PipelineInput {
  planLeg: TextLeg;
  buildLeg: TextLeg;
  criticLeg: TextLeg;
  prompt: string;
  maxRetries?: number;
  lane?: HubLane;
  /** Test seam: replaces the real provider call. */
  caller?: TextCaller;
}

export interface PipelineResult {
  text: string;
  contributions: Contribution[];
  retriesUsed: number;
  sandbox: SandboxResult | null;
  criticVerdict: "OK" | "REVISE" | "unknown";
}

function asContribution(
  leg: TextLeg,
  kind: "plan" | "text" | "code" | "critique",
  out: { text: string; durationMs: number } | null,
  lane: HubLane
): Contribution {
  return {
    legId: `${leg.id}-${kind}`,
    provider: leg.provider,
    model: leg.model,
    lane,
    text: out?.text ?? null,
    status: out ? "ok" : "paused",
    pauseReason: out ? undefined : "error",
    durationMs: out?.durationMs ?? 0,
    score: out && out.text.trim().length >= 20 ? 60 : 0,
  };
}

function detectLanguage(text: string): "javascript" | "python" | null {
  if (/```python/i.test(text)) return "python";
  if (/```(js|javascript|ts|typescript|json|node)/i.test(text)) return "javascript";
  if (/^\s*(def |import |from .* import )/m.test(text)) return "python";
  if (/^\s*(function |const |let |var |=>)/m.test(text)) return "javascript";
  return null;
}

function extractCode(text: string): string | null {
  const fenced = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return null;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const lane = input.lane ?? "text";
  const maxRetries = input.maxRetries ?? 2;
  const contributions: Contribution[] = [];
  const call = async (leg: TextLeg, prompt: string) =>
    input.caller ? input.caller(leg, prompt) : callTextLeg(leg, prompt, { maxTokens: 2048, temperature: 0.6 });

  // 1. Plan.
  const planOut = await call(input.planLeg, `Plan how to solve this, as short numbered steps. Do not write the final answer yet.\n\nTASK: ${input.prompt}`);
  contributions.push(asContribution(input.planLeg, "plan", planOut, lane));
  const planText = planOut?.text ?? "";

  // 2. Build (+ rebuild loop on REVISE).
  let built = "";
  let criticVerdict: "OK" | "REVISE" | "unknown" = "unknown";
  let retriesUsed = 0;
  let notes = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const buildPrompt = [
      lane === "code"
        ? "Write the complete working code for the task below. Reply with ONLY the code in one fenced block, no explanation."
        : "Write the complete final answer for the task below, following the plan.",
      "",
      `PLAN:\n${planText}`,
      notes ? `\nREVIEW NOTES FROM THE CRITIC (fix all of these):\n${notes}` : "",
      `\nTASK: ${input.prompt}`,
    ].join("\n");
    const buildOut = await call(input.buildLeg, buildPrompt);
    contributions.push(asContribution(input.buildLeg, lane === "code" ? "code" : "text", buildOut, lane));
    built = buildOut?.text ?? "";
    if (!built.trim()) break;

    // 3. Critic.
    const criticOut = await call(
      input.criticLeg,
      [
        "Review the draft below against the task. Reply with exactly one first line: `VERDICT: OK` or `VERDICT: REVISE`, then list every concrete issue (wrong logic, missing requirement, invented fact, price/claim violation) — or 'No issues.' if none.",
        "",
        `TASK: ${input.prompt}`,
        "",
        `DRAFT:\n${built}`,
      ].join("\n")
    );
    contributions.push(asContribution(input.criticLeg, "critique", criticOut, lane));
    const verdictText = criticOut?.text ?? "";
    if (/VERDICT:\s*REVISE/i.test(verdictText)) {
      criticVerdict = "REVISE";
      notes = verdictText.slice(0, 2000);
      if (attempt < maxRetries) {
        retriesUsed++;
        continue;
      }
    } else if (/VERDICT:\s*OK/i.test(verdictText)) {
      criticVerdict = "OK";
    }
    break;
  }

  // 4. Sandbox for code (never "done" unless it ran).
  let sandbox: SandboxResult | null = null;
  if (lane === "code") {
    const code = extractCode(built) ?? built;
    const language = detectLanguage(built);
    if (language && code.trim().length > 0) {
      sandbox = await runInSandbox({ language, code });
    } else {
      sandbox = {
        status: "skipped",
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: 0,
        detail: "No executable code block found in the build output — nothing to sandbox.",
      };
    }
  }

  return { text: built, contributions, retriesUsed, sandbox, criticVerdict };
}
