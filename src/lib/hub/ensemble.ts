/**
 * Hub ensemble — Parallel Ensemble v2 (spec §11).
 *
 * Every eligible model in every open lane fires in the SAME millisecond
 * (Promise.allSettled); nobody waits for anybody. A contribution is
 * paused out of the final merge when it times out (text lane cap 8s),
 * errors, hits rate-limit/quota, duplicates an earlier survivor, or is
 * too short to add anything. Every attempt — including paused ones — is
 * returned to the caller so the ledger can record it. Nothing is silent.
 *
 * Synthesis: text is merged by one synthesis call over survivors only.
 * Code is NEVER re-written: the best code contribution is picked
 * verbatim, because re-writing working code only adds bugs.
 */
import { generateText as groqText } from "../providers/groq";
import { generateText as geminiText } from "../providers/gemini";
import { checkQuota, recordUse } from "./quota";
import {
  QWEN_FALLBACK_MODEL,
  LIVE_GROQ_QWEN,
  type Contribution,
  type HubLane,
  type TextLeg,
} from "./types";

export type TextCaller = (
  leg: TextLeg,
  prompt: string
) => Promise<{ text: string; durationMs: number } | null>;

export interface FanOutOptions {
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  lane?: HubLane;
  /** Test seam: replaces the real provider call. */
  caller?: TextCaller;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u0900-\u097f]+/u)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Deterministic 0-100 score: length sanity + structure, no LLM judge. */
export function scoreText(text: string, isCode: boolean): number {
  const len = text.trim().length;
  if (len < 20) return 5;
  let score = 50;
  if (len >= 100 && len <= 6000) score += 20;
  else if (len > 6000) score += 5;
  if (isCode) {
    if (/```/.test(text) || /function|def |class |=>|return /.test(text)) score += 15;
  } else if (/\n\s*[-*•\d.)]/.test(text) || text.split("\n").length >= 4) {
    score += 15;
  }
  return Math.min(100, score);
}

/**
 * One leg call with explicit model (never the adapter default) and the
 * Qwen Preview fallback: if qwen/qwen3.8-27b 404s, retry once with
 * gpt-oss-120b (spec §10).
 */
export async function callTextLeg(
  leg: TextLeg,
  prompt: string,
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<{ text: string; durationMs: number; modelUsed: string } | null> {
  const quota = checkQuota(leg.model);
  if (!quota.allowed) return null;
  const run = async (
    model: string
  ): Promise<
    | { failed: true; detail: string; durationMs: number }
    | { failed: false; text: string; durationMs: number }
  > => {
    const started = Date.now();
    const res =
      leg.provider === "groq"
        ? await groqText({ prompt, maxTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.7, model })
        : await geminiText({ prompt, maxTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.7, model });
    recordUse(model);
    if (!res.ok) return { failed: true, detail: res.error.message, durationMs: Date.now() - started };
    return { failed: false, text: res.data, durationMs: Date.now() - started };
  };
  const first = await run(leg.model);
  if (!first.failed) return { text: first.text, durationMs: first.durationMs, modelUsed: leg.model };
  if (leg.model === LIVE_GROQ_QWEN && first.detail.includes("http=404")) {
    const retry = await run(QWEN_FALLBACK_MODEL);
    if (!retry.failed) return { text: retry.text, durationMs: retry.durationMs, modelUsed: QWEN_FALLBACK_MODEL };
  }
  return null;
}

export interface FanOutResult {
  contributions: Contribution[];
  survivors: Contribution[];
}

export async function fanOut(
  legs: TextLeg[],
  prompt: string,
  opts: FanOutOptions = {}
): Promise<FanOutResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const lane = opts.lane ?? "text";
  const isCode = lane === "code";

  const raced = legs.map(async (leg): Promise<Contribution> => {
    const started = Date.now();
    const attempt: Promise<Contribution> = (async () => {
      try {
        const out = opts.caller
          ? await opts.caller(leg, prompt)
          : await callTextLeg(leg, prompt, { maxTokens: opts.maxTokens, temperature: opts.temperature });
        if (!out) {
          const quota = checkQuota(leg.model);
          return {
            legId: leg.id,
            provider: leg.provider,
            model: leg.model,
            lane,
            text: null,
            status: "paused",
            pauseReason: quota.allowed ? "error" : "quota_exceeded",
            durationMs: Date.now() - started,
            score: 0,
          } satisfies Contribution;
        }
        return {
          legId: leg.id,
          provider: leg.provider,
          model: leg.model,
          lane,
          text: out.text,
          status: "ok",
          durationMs: out.durationMs,
          score: 0,
        } satisfies Contribution;
      } catch {
        return {
          legId: leg.id,
          provider: leg.provider,
          model: leg.model,
          lane,
          text: null,
          status: "paused",
          pauseReason: "error",
          durationMs: Date.now() - started,
          score: 0,
        } satisfies Contribution;
      }
    })();
    // The 8s lane cap: the run does not wait for a slow leg. The
    // underlying provider call may still finish, but its result is
    // ignored (adapters take no abort signal) and logged as paused.
    const timer = new Promise<Contribution>((resolve) =>
      setTimeout(
        () =>
          resolve({
            legId: leg.id,
            provider: leg.provider,
            model: leg.model,
            lane,
            text: null,
            status: "paused",
            pauseReason: "timeout",
            durationMs: timeoutMs,
            score: 0,
          }),
        timeoutMs
      )
    );
    const won = await Promise.race([attempt, timer]);
    // A late attempt must never surface as an unhandled rejection.
    void attempt.catch(() => undefined);
    return won;
  });

  const contributions = await Promise.all(raced);

  // Score survivors; a contribution that adds nothing new vs an earlier
  // survivor is paused as a duplicate (attempt still in the ledger).
  const survivors: Contribution[] = [];
  for (const c of contributions) {
    if (c.status !== "ok" || !c.text) continue;
    const trimmed = c.text.trim();
    if (trimmed.length < 20) {
      c.status = "paused";
      c.pauseReason = "too_short";
      c.score = 0;
      continue;
    }
    c.score = scoreText(trimmed, isCode);
    const wordsNow = words(trimmed);
    const dup = survivors.some((s) => s.text && jaccard(wordsNow, words(s.text)) >= 0.85);
    if (dup) {
      c.status = "paused";
      c.pauseReason = "duplicate";
      c.score = 0;
      continue;
    }
    survivors.push(c);
  }
  return { contributions, survivors };
}

/** Merge surviving text contributions with one synthesis call. Falls back to the best survivor verbatim. */
export async function synthesizeText(
  survivors: Contribution[],
  prompt: string,
  synthLeg: TextLeg,
  opts: { caller?: TextCaller; timeoutMs?: number } = {}
): Promise<{ text: string; synthesis: "merged" | "verbatim" | "skipped"; modelUsed: string | null }> {
  if (survivors.length === 0) return { text: "", synthesis: "skipped", modelUsed: null };
  if (survivors.length === 1) {
    return { text: survivors[0].text ?? "", synthesis: "verbatim", modelUsed: null };
  }
  const best = [...survivors].sort((a, b) => b.score - a.score)[0];
  const mergePrompt = [
    "You are a careful editor. Merge the drafts below into ONE final answer to the user's request.",
    "Keep the best section from each draft, drop duplicates, resolve contradictions by the stronger version.",
    "Do not add facts, prices, discounts, guarantees, reviews, or claims that are not in the drafts.",
    "",
    `USER REQUEST: ${prompt}`,
    "",
    ...survivors.map((s, i) => `--- DRAFT ${i + 1} (from ${s.legId}, score ${s.score}) ---\n${s.text ?? ""}`),
    "",
    "FINAL ANSWER:",
  ].join("\n");
  try {
    const out = opts.caller
      ? await opts.caller(synthLeg, mergePrompt)
      : await callTextLeg(synthLeg, mergePrompt, { maxTokens: 2048, temperature: 0.5 });
    if (out && out.text.trim().length >= 20) {
      return { text: out.text.trim(), synthesis: "merged", modelUsed: synthLeg.model };
    }
  } catch {
    // Fall through to verbatim best.
  }
  return { text: best.text ?? "", synthesis: "verbatim", modelUsed: null };
}

/** Code synthesis = selection, never re-writing: pick the best code verbatim. */
export function synthesizeCode(survivors: Contribution[]): {
  text: string;
  synthesis: "verbatim" | "skipped";
  modelUsed: string | null;
} {
  if (survivors.length === 0) return { text: "", synthesis: "skipped", modelUsed: null };
  const best = [...survivors].sort((a, b) => b.score - a.score)[0];
  return { text: best.text ?? "", synthesis: "verbatim", modelUsed: null };
}
