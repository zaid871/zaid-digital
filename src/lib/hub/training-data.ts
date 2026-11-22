/**
 * Training-data collector for the hub — the prerequisite the "train your
 * own model" videos skip entirely.
 *
 * Video verdict (TECH GPT, "I Tried Building My OWN ChatGPT Using
 * Fable 5.2!", 2026-11-13): there is NO training method in it to copy.
 * The creator says it himself, twice: "I haven't trained any of these
 * selected models from scratch" and the project's own About page states
 * "Thrones is not a fully trained model". What actually happens: Qwen
 * 3.5 open weights (2B/4B/9B) are downloaded, a ChatGPT-style UI is
 * built, and the promised "Fable 5.2 will train it" collapses when
 * Fable's credits run out mid-video — training is then handed off in
 * words ("I'll get the model training done by Extra") and never shown.
 * The build is a local chat UI on an RTX 5060 Ti 16GB PC, not a trained
 * model. There is nothing here to "train kro" from.
 *
 * What real fine-tuning needs, and where we stand:
 * 1. DATA — labelled examples: prompt + good output (approved) vs bad
 *    output (rejected, with the reason). We have ZERO production
 *    examples yet (store total 0; first real batch is the Mon 2026-11-23
 *    chain). No data = nothing to train on, whatever the method.
 *    THIS FILE is step 1: every hub text/code run is recorded as a
 *    labelled SFT example (instruction / output / verdict) the moment
 *    it happens, so the dataset exists when training is picked.
 * 2. GPU — LoRA on a 4B model needs a GPU. The Oracle VM is CPU-only.
 *    Free-ish routes exist in the Tool Registry as CANDIDATES only
 *    (Kaggle 30 GPU-h/week, Modal ~$30 credit, Paperspace) — no keys,
 *    no adapters, never picked. Training itself is not free-first.
 * 3. A HOST for the trained weights — Groq/Gemini will not serve custom
 *    weights, and their free tiers offer no fine-tuning. A fine-tuned
 *    model needs its own serving (vLLM/Modal/HF Space), which is the
 *    part that breaks the free, fast, $0 setup. Serving is the real
 *    blocker, not training.
 * 4. The compliance scanner stays mandatory regardless — a trained
 *    model still gets scanned, because training reduces violations, it
 *    does not guarantee zero.
 *
 * This collector never breaks a run: recording is best-effort and
 * swallows its own errors. A failed write is a lost example, never a
 * failed job.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { hubDir } from "./quota";

export const TRAINING_DATA_MAX_CHARS = 8000;

export type TrainingVerdict = "approved" | "rejected" | "failed";

export interface TrainingExample {
  runId: string;
  createdAt: string;
  /** Hub task kind, e.g. "chat", "code", "caption". */
  kind: string;
  /** Hub mode that produced the output. */
  mode: string;
  /** The prompt that was run (the instruction). */
  instruction: string;
  /** The output text (capped at TRAINING_DATA_MAX_CHARS). */
  output: string;
  /** approved = shipped; rejected = compliance scan failed; failed = error/sandbox. */
  verdict: TrainingVerdict;
  /** Why, when rejected/failed (error code or scan reason). */
  reason?: string;
  /** Models that contributed. */
  models: string[];
}

export function trainingDataPath(): string {
  return join(hubDir(), "training-data.jsonl");
}

function truncate(text: string): string {
  return text.length > TRAINING_DATA_MAX_CHARS
    ? text.slice(0, TRAINING_DATA_MAX_CHARS)
    : text;
}

/** Append one labelled example. Returns false (never throws) on failure. */
export function recordTrainingExample(ex: TrainingExample): boolean {
  try {
    mkdirSync(hubDir(), { recursive: true });
    appendFileSync(
      trainingDataPath(),
      JSON.stringify({ ...ex, output: truncate(ex.output) }) + "\n"
    );
    return true;
  } catch {
    return false;
  }
}

/** Read the newest N examples (newest first). Malformed lines are skipped. */
export function readTrainingData(limit = 100): TrainingExample[] {
  const path = trainingDataPath();
  if (!existsSync(path)) return [];
  const rows: TrainingExample[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as TrainingExample;
      if (row.runId && typeof row.output === "string") rows.push(row);
    } catch {
      // Skip a corrupt line; the rest of the dataset stays usable.
    }
  }
  return rows.slice(-limit).reverse();
}

export interface TrainingDataStats {
  total: number;
  approved: number;
  rejected: number;
  failed: number;
  byKind: Record<string, number>;
}

/** Counts over the whole file. Used by the measure-first plan. */
export function trainingDataStats(): TrainingDataStats {
  const stats: TrainingDataStats = {
    total: 0,
    approved: 0,
    rejected: 0,
    failed: 0,
    byKind: {},
  };
  for (const ex of readTrainingData(Number.MAX_SAFE_INTEGER)) {
    stats.total++;
    stats[ex.verdict]++;
    stats.byKind[ex.kind] = (stats.byKind[ex.kind] ?? 0) + 1;
  }
  return stats;
}
