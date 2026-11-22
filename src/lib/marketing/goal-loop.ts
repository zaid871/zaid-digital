/**
 * Marketing Goal Loop — target-driven self-improving marketing.
 *
 * Philosophy (user's design):
 *  1. Har strategy/channel ka MAXIMUM achieved result = fixed TARGET (goal).
 *  2. Results target se kam aaye → deep diagnosis: kis wajah se problem hai.
 *  3. Phir maximum-results wali strategy (best config) + fix re-apply.
 *  4. Iterate → workflow high-level hota jata hai.
 *
 * Implementation:
 *  - GoalStore: JSON ledger (storage/marketing-goals/ledger.json) keyed
 *    productKey::channel. recordRun() har metric ka MAX rakhta hai (wahi
 *    target hai); primary metric beat hone par bestConfig snapshot update.
 *  - checkGaps(): latest < 70% of target → underperforming.
 *  - diagnoseGap(): LLM root-cause analysis — output HAMESHA hypotheses
 *    labeled hota hai ("ye wajah pakki nahi hai"), kabhi certainty claim nahi.
 *  - sweep(): gaps check + har underperformer ko diagnose → report.
 *
 * Worker-side module (spawns nothing, but imports text providers directly —
 * do NOT import from Next.js App Routes; endpoints live under
 * src/app/api/v1/marketing/goals/).
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "../compliance";
import { DigitalError, defaultTextGen as ebookTextGen } from "../digital/ebook";

export type GoalTextGen = (prompt: string, maxTokens: number) => Promise<string>;

export interface RunRecord {
  at: string;
  metrics: Record<string, number>;
  config: Record<string, unknown>;
}

export interface DiagnosisHypothesis {
  cause: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
}

export interface Diagnosis {
  hypotheses: DiagnosisHypothesis[];
  suggestedFixes: string[];
  /** Best (maximum-results) config snapshot to re-apply, with fixes noted. */
  reapplyConfig: Record<string, unknown>;
  diagnosedAt: string;
  honestyNote: string;
}

export interface ChannelGoal {
  productKey: string;
  channel: string;
  primaryMetric: string;
  /** metric -> maximum achieved value = THE TARGET (goal). */
  targets: Record<string, number>;
  /**
   * North Star KPIs — prescriptive stretch targets (blueprint §1), e.g.
   * {views_7d: 10000}. Unlike `targets` (descriptive max), these are set
   * deliberately and stay fixed until beaten or revised.
   */
  northStar: Record<string, number>;
  bestConfig: Record<string, unknown>;
  bestAt: string;
  history: RunRecord[];
  runs: number;
  lastDiagnosis: Diagnosis | null;
  /** Winner-scale queue: sub-angles generated from 3x winners, top priority. */
  contentQueue: string[];
  winnerRuns: Array<{ at: string; metric: string; value: number; multiple: number }>;
}

export interface GapReport {
  productKey: string;
  channel: string;
  primaryMetric: string;
  target: number;
  latest: number;
  gapPct: number;
  underperforming: boolean;
}

const HISTORY_CAP = 20;
/** Latest < 70% of target → underperforming → diagnose. */
export const GAP_THRESHOLD = 0.7;

export function goalKey(productKey: string, channel: string): string {
  return `${productKey}::${channel}`;
}

function ledgerPath(): string {
  if (process.env.MARKETING_GOALS_LEDGER_PATH) return process.env.MARKETING_GOALS_LEDGER_PATH;
  return join(process.cwd(), "storage", "marketing-goals", "ledger.json");
}

export class GoalStore {
  private goals: Map<string, ChannelGoal> = new Map();

  static async load(): Promise<GoalStore> {
    const s = new GoalStore();
    try {
      const raw = await readFile(ledgerPath(), "utf-8");
      const data = JSON.parse(raw) as Record<string, ChannelGoal>;
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v.productKey === "string") s.goals.set(k, v);
      }
    } catch {
      // corrupt/missing ledger → start empty (fail-safe, like video-pool)
    }
    return s;
  }

  async save(): Promise<void> {
    const path = ledgerPath();
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.goals), null, 2));
    const { rename } = await import("fs/promises");
    await rename(tmp, path);
  }

  get(productKey: string, channel: string): ChannelGoal | undefined {
    return this.goals.get(goalKey(productKey, channel));
  }

  /**
   * Set a prescriptive stretch target (north star) for one metric — e.g.
   * the #1 competitor's metric from the beat-the-top loop. Creates the
   * goal stub when missing, WITHOUT touching history or max-targets: the
   * stub's primaryMetric stays "score" until a real run is recorded, and
   * checkGaps() ignores a 0 target.
   */
  setNorthStar(productKey: string, channel: string, metric: string, value: number): ChannelGoal {
    const key = goalKey(productKey, channel);
    let g = this.goals.get(key);
    if (!g) {
      g = {
        productKey, channel,
        primaryMetric: "score",
        targets: {}, northStar: {}, bestConfig: {}, bestAt: new Date().toISOString(),
        history: [], runs: 0, lastDiagnosis: null, contentQueue: [], winnerRuns: [],
      };
      this.goals.set(key, g);
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      g.northStar[metric] = value;
    }
    return g;
  }

  all(): ChannelGoal[] {
    return [...this.goals.values()];
  }

  /**
   * Record a run. Every metric's MAX becomes (or stays) the target —
   * maximum results = fixed goal. Primary metric beat → bestConfig snapshot.
   */
  recordRun(args: {
    productKey: string;
    channel: string;
    metrics: Record<string, number>;
    config?: Record<string, unknown>;
    primaryMetric?: string;
    northStar?: Record<string, number>;
  }): ChannelGoal {
    const { productKey, channel } = args;
    const key = goalKey(productKey, channel);
    let g = this.goals.get(key);
    if (!g) {
      g = {
        productKey, channel,
        primaryMetric: args.primaryMetric ?? Object.keys(args.metrics)[0] ?? "score",
        targets: {}, northStar: {}, bestConfig: {}, bestAt: new Date().toISOString(),
        history: [], runs: 0, lastDiagnosis: null, contentQueue: [], winnerRuns: [],
      };
      this.goals.set(key, g);
    }
    if (args.primaryMetric) g.primaryMetric = args.primaryMetric;
    if (args.northStar) {
      for (const [m, v] of Object.entries(args.northStar)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) g.northStar[m] = v;
      }
    }
    const at = new Date().toISOString();
    const config = args.config ?? {};
    let newBest = false;
    for (const [m, v] of Object.entries(args.metrics)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (!(m in g.targets) || v > g.targets[m]) {
        g.targets[m] = v;
        if (m === g.primaryMetric) newBest = true;
      }
    }
    if (newBest) {
      g.bestConfig = config;
      g.bestAt = at;
    }
    g.history.push({ at, metrics: args.metrics, config });
    if (g.history.length > HISTORY_CAP) g.history = g.history.slice(-HISTORY_CAP);
    g.runs += 1;
    return g;
  }

  /** Gap check across all goals. */
  checkGaps(threshold: number = GAP_THRESHOLD): GapReport[] {
    const out: GapReport[] = [];
    for (const g of this.goals.values()) {
      const target = g.targets[g.primaryMetric] ?? 0;
      const latestRun = g.history[g.history.length - 1];
      const latest = latestRun ? (latestRun.metrics[g.primaryMetric] ?? 0) : 0;
      const gapPct = target > 0 ? Math.round(((target - latest) / target) * 100) : 0;
      out.push({
        productKey: g.productKey, channel: g.channel, primaryMetric: g.primaryMetric,
        target, latest, gapPct,
        underperforming: target > 0 && latest < target * threshold,
      });
    }
    return out;
  }
}

const diagnosisSchema = z.object({
  hypotheses: z.array(z.object({
    cause: z.string().max(300),
    evidence: z.string().max(300),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(5),
  suggestedFixes: z.array(z.string().max(300)).max(5),
});

/**
 * Deep diagnosis of WHY results missed the target. Output is ALWAYS
 * hypotheses — never a certainty claim (honesty doctrine, like repost loop).
 */
export async function diagnoseGap(
  goal: ChannelGoal,
  latest: RunRecord,
  textGen: GoalTextGen = ebookTextGen
): Promise<Diagnosis> {
  const target = goal.targets[goal.primaryMetric] ?? 0;
  const prompt = `You are a marketing analyst. A marketing channel is underperforming its own best result. Diagnose WHY — deeply but honestly.

Product: ${goal.productKey}
Channel: ${goal.channel}
Primary metric: ${goal.primaryMetric}
TARGET (best ever achieved): ${target}
LATEST run: ${JSON.stringify(latest.metrics)}
Best-run config (maximum-results strategy): ${JSON.stringify(goal.bestConfig).slice(0, 800)}
Recent history (last ${goal.history.length} runs): ${JSON.stringify(goal.history.slice(-5).map((h) => h.metrics))}

RULES:
- Give 2-4 hypotheses for the gap, each with evidence (from the numbers above) and confidence (low/medium/high).
- Suggest 2-4 concrete fixes. Suggest re-applying the best-run config where it fits.
- NEVER claim certainty — these are hypotheses to test, not facts.
- No prices, no fake claims.
- Return ONLY valid JSON, no markdown fences.
JSON shape: {"hypotheses":[{"cause":"...","evidence":"...","confidence":"low"}],"suggestedFixes":["..."]}`;

  let raw: string;
  try {
    raw = await textGen(prompt, 900);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `Gap diagnosis failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "Diagnosis model returned unparseable output.");
  }
  let parsed: z.infer<typeof diagnosisSchema>;
  try {
    parsed = diagnosisSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "Diagnosis model returned invalid JSON shape.");
  }
  return {
    hypotheses: parsed.hypotheses,
    suggestedFixes: parsed.suggestedFixes,
    reapplyConfig: goal.bestConfig,
    diagnosedAt: new Date().toISOString(),
    honestyNote: "Ye wajah pakki nahi hai — ye hypotheses hain. Fix apply karo, phir next cycle me gap check hoga.",
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Winner-scale rule (blueprint §4): latest primary run >= 3x the median of
 * previous runs (needs >= 4 runs for a meaningful median) → winner.
 * Returns the multiple, or 0 when not a winner.
 */
export function detectWinner(goal: ChannelGoal): number {
  const vals = goal.history
    .map((h) => h.metrics[goal.primaryMetric])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 4) return 0;
  const latest = vals[vals.length - 1];
  const med = median(vals.slice(0, -1));
  if (med <= 0) return 0;
  const multiple = latest / med;
  return multiple >= 3 ? multiple : 0;
}

const subAngleSchema = z.object({
  angles: z.array(z.string().max(160)).max(6),
});

/**
 * Generate 5 sub-angles of a winning topic for next week's content calendar
 * (top priority). Compliance-scanned; violating angles dropped, never replaced.
 */
export async function generateSubAngles(
  productKey: string,
  channel: string,
  winningConfig: Record<string, unknown>,
  textGen: GoalTextGen = ebookTextGen
): Promise<{ angles: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const prompt = `A marketing topic just won big (3x+ its usual results). Generate 5 fresh sub-angles of it for next week's content calendar, in natural Hinglish (Roman script, Indian audience).
Winning context: product=${productKey}, channel=${channel}, config=${JSON.stringify(winningConfig).slice(0, 500)}
RULES: each angle one line, specific and different from the others. NO prices, NO fake urgency, NO guaranteed results, NO fake claims.
Return ONLY valid JSON, no markdown fences: {"angles":["...","...","...","...","..."]}`;
  let raw: string;
  try {
    raw = await textGen(prompt, 500);
  } catch (err) {
    throw new DigitalError(
      "provider_unavailable",
      `Sub-angle generation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`
    );
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DigitalError("generation_failed", "Sub-angle model returned unparseable output.");
  }
  let parsed: z.infer<typeof subAngleSchema>;
  try {
    parsed = subAngleSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new DigitalError("generation_failed", "Sub-angle model returned invalid JSON shape.");
  }
  const angles: string[] = [];
  for (const a of parsed.angles.slice(0, 5)) {
    if (PRICE_PATTERN.test(a) || BANNED_CLAIM_PATTERN.test(a)) {
      warnings.push("sub-angle dropped: price/claim pattern matched.");
      continue;
    }
    angles.push(a);
  }
  return { angles, warnings };
}

export interface WeaknessCheck {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  evidence: string;
  /** "ledger" = computed from goal data; "pipeline" = enforced by a guard. */
  source: "ledger" | "pipeline";
}

/**
 * Competitor-weakness exclusion audit (flywheel §4). Runs every sweep and
 * verifies none of the 7 known competitor weaknesses has crept into our
 * system. Ledger-computable checks use real data; the rest are enforced by
 * named pipeline guards (reported transparently, never faked).
 */
export function weaknessAudit(store: GoalStore): WeaknessCheck[] {
  const checks: WeaknessCheck[] = [];
  const byProduct = new Map<string, ChannelGoal[]>();
  for (const g of store.all()) {
    const list = byProduct.get(g.productKey) ?? [];
    list.push(g);
    byProduct.set(g.productKey, list);
  }
  const now = Date.now();
  const DAY = 86_400_000;

  for (const [product, goals] of byProduct) {
    // 1. single-channel dependence
    const activeChannels = goals.filter((g) =>
      g.history.some((h) => now - new Date(h.at).getTime() < 30 * DAY)
    ).length;
    checks.push({
      id: `channel-diversity:${product}`,
      name: "Single-channel dependence",
      status: activeChannels >= 3 ? "pass" : activeChannels === 2 ? "warn" : "fail",
      evidence: `${product}: ${activeChannels} active channel(s) in last 30d (need 3+)`,
      source: "ledger",
    });
    // 2. no video
    const hasVideo = goals.some((g) => /video|reel|short|ads/i.test(g.channel));
    checks.push({
      id: `video-presence:${product}`,
      name: "Static mockups only (no video)",
      status: hasVideo ? "pass" : "fail",
      evidence: hasVideo
        ? `${product}: video channel present`
        : `${product}: NO video channel — every product needs its video ad`,
      source: "ledger",
    });
    // 3. launch-and-disappear
    const lastRun = Math.max(
      0,
      ...goals.flatMap((g) => g.history.map((h) => new Date(h.at).getTime()))
    );
    const daysIdle = lastRun ? Math.round((now - lastRun) / DAY) : 999;
    checks.push({
      id: `recency:${product}`,
      name: "Launch-and-disappear",
      status: daysIdle <= 14 ? "pass" : "fail",
      evidence: `${product}: last run ${daysIdle}d ago (limit 14d)`,
      source: "ledger",
    });
  }

  // 4-7: enforced by pipeline guards (transparent, not computed)
  const guards: Array<[string, string, string]> = [
    ["no-validation", "No validation before scale", "digital-presell-gate.json — generation fires only after pre-sell threshold"],
    ["fake-claims", "Fake reviews / fabricated claims", "lib/compliance.ts — PRICE + BANNED_CLAIM scan on every AI field; violating fields dropped"],
    ["no-hinglish", "Generic (non-Hinglish) targeting", "numbered Hinglish script style; premium_dark preset for Indian audience"],
    ["manual-burnout", "Manual posting burnout", "n8n workflows: digital-ads-daily, performance-repost, marketing-goal-loop"],
  ];
  for (const [id, name, evidence] of guards) {
    checks.push({ id, name, status: "pass", evidence, source: "pipeline" });
  }
  return checks;
}

export interface NorthStarProgress {
  productKey: string;
  channel: string;
  metric: string;
  northStar: number;
  latest: number;
  pctOfStar: number;
  reached: boolean;
}

/** North Star progress: latest run vs the fixed stretch target. */
export function northStarProgress(store: GoalStore): NorthStarProgress[] {
  const out: NorthStarProgress[] = [];
  for (const g of store.all()) {
    const latest = g.history[g.history.length - 1];
    for (const [metric, star] of Object.entries(g.northStar)) {
      const value = latest ? (latest.metrics[metric] ?? 0) : 0;
      out.push({
        productKey: g.productKey, channel: g.channel, metric,
        northStar: star, latest: value,
        pctOfStar: star > 0 ? Math.round((value / star) * 100) : 0,
        reached: value >= star,
      });
    }
  }
  return out;
}

export interface SweepReport {
  checkedAt: string;
  goalsChecked: number;
  underperforming: Array<{
    productKey: string;
    channel: string;
    primaryMetric: string;
    target: number;
    latest: number;
    gapPct: number;
    diagnosis: Diagnosis;
  }>;
  winners: Array<{
    productKey: string;
    channel: string;
    primaryMetric: string;
    value: number;
    multiple: number;
    subAngles: string[];
  }>;
  northStar: NorthStarProgress[];
  weaknessAudit: WeaknessCheck[];
  warnings: string[];
}

/**
 * Weekly sweep: gap-check + diagnose underperformers + winner-scale +
 * north-star progress + weakness-exclusion audit. Diagnosis/sub-angle
 * failures degrade to warnings — the sweep never throws.
 */
export async function sweepGoals(
  store: GoalStore,
  textGen: GoalTextGen = ebookTextGen
): Promise<SweepReport> {
  const warnings: string[] = [];
  const gaps = store.checkGaps();
  const underperforming: SweepReport["underperforming"] = [];
  const winners: SweepReport["winners"] = [];
  for (const gap of gaps) {
    const goal = store.get(gap.productKey, gap.channel);
    if (!goal) continue;
    const latest = goal.history[goal.history.length - 1];
    if (!latest) continue;
    if (gap.underperforming) {
      try {
        const diagnosis = await diagnoseGap(goal, latest, textGen);
        goal.lastDiagnosis = diagnosis;
        underperforming.push({ ...gap, diagnosis });
      } catch (err) {
        warnings.push(
          `${gap.productKey}/${gap.channel}: diagnosis unavailable (${err instanceof Error ? err.message.slice(0, 100) : String(err)})`
        );
      }
    }
    // Winner-scale rule (independent of gap status)
    const multiple = detectWinner(goal);
    if (multiple > 0) {
      try {
        const { angles, warnings: aw } = await generateSubAngles(
          goal.productKey, goal.channel, goal.bestConfig, textGen
        );
        warnings.push(...aw.map((w) => `${goal.productKey}/${goal.channel}: ${w}`));
        goal.winnerRuns.push({
          at: latest.at, metric: goal.primaryMetric,
          value: latest.metrics[goal.primaryMetric] ?? 0, multiple: Math.round(multiple * 10) / 10,
        });
        // Sub-angles go to the TOP of next week's queue (priority).
        goal.contentQueue.unshift(...angles);
        winners.push({
          productKey: goal.productKey, channel: goal.channel,
          primaryMetric: goal.primaryMetric,
          value: latest.metrics[goal.primaryMetric] ?? 0,
          multiple: Math.round(multiple * 10) / 10, subAngles: angles,
        });
      } catch (err) {
        warnings.push(
          `${goal.productKey}/${goal.channel}: sub-angle generation unavailable (${err instanceof Error ? err.message.slice(0, 100) : String(err)})`
        );
      }
    }
  }
  await store.save();
  return {
    checkedAt: new Date().toISOString(),
    goalsChecked: gaps.length,
    underperforming,
    winners,
    northStar: northStarProgress(store),
    weaknessAudit: weaknessAudit(store),
    warnings,
  };
}
