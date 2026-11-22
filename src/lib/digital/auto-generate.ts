/**
 * Auto-generate tick — the fully-automatic weekly product cycle.
 *
 * Schedule (all IST): Problem Miner Mon 07:00 → Idea Briefs Mon 07:30 →
 * this tick Mon 08:00 (workflow digital-auto-generate.json, cron
 * "30 2 * * 1" UTC). The tick reads the briefs queue, picks the top 3
 * ungenerated briefs by demandScore, and fires their generation webhooks
 * (fire-and-forget, 30s timeout each, all in parallel). Each brief also
 * gets a marketing toolkit + a thumbnail as companions. Then the weekly
 * supporting rotation fires from the top brief's niche: 1 POD design,
 * 1 prompt library, 1 landing page, 1 docs guide, 1 niche spreadsheet
 * tracker, 1 brand kit, 1 typography kit.
 *
 * Dedup (ledger `storage/digital/auto-generate/ledger.json`):
 * - a brief is generated ONCE ever (briefId + productType);
 * - supporting items fire ONCE per ISO week (week key + type).
 * Nothing is ever faked: no briefs file → "no_briefs"; n8n env missing →
 * "webhook_unavailable"; a failed fire is recorded as failed, never as
 * triggered. The generation workflows still run their own demand check,
 * so a brief with no miner match comes back needs_validation instead of
 * generating.
 *
 * Website templates are NOT in this tick (disabled by user decision —
 * enable separately with WEBSITE_TEMPLATES_ENABLED=true).
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { digitalRoot } from "./package";
import type { Brief } from "./briefs";
import { activeSeasons, rankWithSeason } from "./seasons";

export type FetchFn = typeof fetch;

/** How many top briefs each weekly tick generates. */
export const AUTO_GENERATE_TOP_N = 3;

export interface AutoGenerateLedgerEntry {
  briefId: string;
  week: string;
  kind: "product" | "companion" | "supporting";
  productType: string;
  webhook: string;
  status: "triggered" | "failed";
  at: string;
  /** Season that matched the brief (if any) + the combined season score. */
  season?: string;
  score?: number;
  note?: string;
}

export interface AutoGenerateLedger {
  entries: AutoGenerateLedgerEntry[];
}

export interface AutoGenerateTickResult {
  ok: boolean;
  reason?: string;
  week: string;
  /** Active season ids on this tick (empty outside every season). */
  seasons: string[];
  briefs: string[];
  triggered: number;
  failed: number;
  skipped: number;
  fires: AutoGenerateLedgerEntry[];
  warnings: string[];
}

/** ISO week key, e.g. "2026-W46" — supporting items dedup on this. */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function briefsPath(outRoot?: string): string {
  return join(outRoot ?? digitalRoot(), "briefs", "latest.json");
}

export function ledgerPath(outRoot?: string): string {
  return join(outRoot ?? digitalRoot(), "auto-generate", "ledger.json");
}

export async function readBriefsQueue(outRoot?: string): Promise<Brief[]> {
  try {
    const raw = await readFile(briefsPath(outRoot), "utf-8");
    const parsed = JSON.parse(raw) as { briefs?: Brief[] };
    if (!Array.isArray(parsed.briefs)) return [];
    return parsed.briefs.filter((b) => b && typeof b.id === "string" && typeof b.niche === "string");
  } catch {
    return [];
  }
}

export async function readLedger(outRoot?: string): Promise<AutoGenerateLedger> {
  try {
    const raw = await readFile(ledgerPath(outRoot), "utf-8");
    const parsed = JSON.parse(raw) as AutoGenerateLedger;
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

async function writeLedger(ledger: AutoGenerateLedger, outRoot?: string): Promise<void> {
  const path = ledgerPath(outRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2), "utf-8");
}

/** Spreadsheet bank for a niche (budget default; fitness → workout; client work → onboarding). */
export function spreadsheetKindForNiche(niche: string): string {
  const n = niche.toLowerCase();
  if (/workout|fitness|health|diet|gym/i.test(n)) return "workout";
  if (/client|business|freelanc|onboard/i.test(n)) return "onboarding";
  return "budget";
}

/** Generation webhook path for a brief product type. */
export function webhookForBriefType(productType: Brief["productType"]): string {
  switch (productType) {
    case "template":
      return "digital-template-generation";
    case "ebook":
      return "digital-ebook-generation";
    case "planner":
      return "digital-planners-generation";
    case "spreadsheet":
      return "digital-spreadsheets-generation";
  }
}

/** Payload for a brief's product webhook. */
export function bodyForBrief(brief: Brief): Record<string, unknown> {
  switch (brief.productType) {
    case "template":
      return {
        niche: brief.niche,
        ...(brief.kinds ? { kinds: brief.kinds } : {}),
        ...(brief.theme ? { theme: brief.theme } : {}),
      };
    case "ebook":
      return { topic: brief.niche, title: brief.title };
    case "planner":
      return { title: brief.title, count: 4 };
    case "spreadsheet":
      return { title: brief.title, kind: spreadsheetKindForNiche(brief.niche) };
  }
}

/** Marketing-toolkit productType for a brief product type. */
function toolkitTypeForBrief(productType: Brief["productType"]): "ebook" | "template_pack" {
  return productType === "ebook" ? "ebook" : "template_pack";
}

async function fireWebhook(
  fetchFn: FetchFn,
  base: string,
  secret: string,
  webhook: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetchFn(`${base}/webhook/${webhook}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-n8n-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Run one auto-generate tick: pick top briefs, fire product + companion
 * + supporting webhooks, record the ledger. Returns the summary; never
 * throws for missing briefs or missing n8n env (reports the reason).
 */
export async function runAutoGenerateTick(deps?: {
  fetchFn?: FetchFn;
  outRoot?: string;
  now?: Date;
}): Promise<AutoGenerateTickResult> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const now = deps?.now ?? new Date();
  const week = isoWeekKey(now);
  const at = now.toISOString();
  const warnings: string[] = [];

  const briefs = await readBriefsQueue(deps?.outRoot);
  const seasons = activeSeasons(now).map((s) => s.id);
  if (briefs.length === 0) {
    return { ok: false, reason: "no_briefs", week, seasons, briefs: [], triggered: 0, failed: 0, skipped: 0, fires: [], warnings: ["Briefs queue khaali hai — pehle Problem Miner (Mon 07:00) + Idea Briefs (Mon 07:30) chalne do."] };
  }
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
  if (!base || !secret) {
    return { ok: false, reason: "webhook_unavailable", week, seasons, briefs: [], triggered: 0, failed: 0, skipped: 0, fires: [], warnings: ["N8N_BASE_URL ya N8N_WEBHOOK_SECRET .env mein nahi hai — tick ne kuch trigger nahi kiya."] };
  }

  const ledger = await readLedger(deps?.outRoot);
  const doneBrief = new Set(
    ledger.entries.filter((e) => e.kind === "product" && e.status === "triggered").map((e) => `${e.briefId}:${e.productType}`)
  );
  const doneSupporting = new Set(
    ledger.entries
      .filter((e) => e.kind === "supporting" && e.week === week && e.status === "triggered")
      .map((e) => e.productType)
  );

  // Season mode: rank by demand + season boost (never a filter — a
  // non-seasonal brief with higher demand still outranks a seasonal one).
  const ranked = rankWithSeason(
    [...briefs]
      .filter((b) => b.status === "queued")
      .map((b) => ({ ...b, text: `${b.title} ${b.niche}` })),
    now
  );
  const picked = ranked.filter((b) => !doneBrief.has(`${b.id}:${b.productType}`)).slice(0, AUTO_GENERATE_TOP_N);
  const skipped = ranked.length - picked.length;

  type Fire = { briefId: string; kind: AutoGenerateLedgerEntry["kind"]; productType: string; webhook: string; body: Record<string, unknown>; season?: string; score?: number };
  const fires: Fire[] = [];
  for (const b of picked) {
    const webhook = webhookForBriefType(b.productType);
    const season = b.season?.id;
    const score = b.seasonScore;
    fires.push({ briefId: b.id, kind: "product", productType: b.productType, webhook, body: bodyForBrief(b), season, score });
    fires.push({
      briefId: b.id,
      kind: "companion",
      productType: "marketing_toolkit",
      webhook: "digital-marketing-toolkit-generation",
      body: { productName: b.title, productType: toolkitTypeForBrief(b.productType), niche: b.niche },
      season,
      score,
    });
    fires.push({
      briefId: b.id,
      kind: "companion",
      productType: "thumbnails",
      webhook: "digital-thumbnails-generation",
      body: { title: b.title, subtitle: b.niche },
      season,
      score,
    });
  }

  // Weekly supporting rotation from the top brief's niche (once per ISO week).
  const top = picked[0] ?? ranked[0];
  if (top) {
    const niche = top.niche;
    const title = top.title;
    const supporting: Array<{ productType: string; webhook: string; body: Record<string, unknown> }> = [
      { productType: "pod", webhook: "digital-pod-generation", body: { niche, title } },
      { productType: "prompts", webhook: "digital-prompts-generation", body: { topic: niche } },
      { productType: "landing", webhook: "digital-landing-generation", body: { businessName: title, topic: niche } },
      { productType: "docs", webhook: "digital-docs-generation", body: { title: `${title} Guide` } },
      { productType: "spreadsheets", webhook: "digital-spreadsheets-generation", body: { title: `${title} Tracker`, kind: spreadsheetKindForNiche(niche) } },
      { productType: "brand_kit", webhook: "digital-brand-kit-generation", body: { brandName: title, niche } },
      { productType: "typography_kit", webhook: "digital-typography-kit-generation", body: { kitName: `${niche} Typography Kit` } },
    ];
    for (const s of supporting) {
      if (doneSupporting.has(s.productType)) continue;
      fires.push({ briefId: `${top.id}:supporting`, kind: "supporting", productType: s.productType, webhook: s.webhook, body: s.body, season: top.season?.id, score: top.seasonScore });
    }
  }

  const results = await Promise.allSettled(
    fires.map((f) => fireWebhook(fetchFn, base, secret, f.webhook, f.body))
  );
  const entries: AutoGenerateLedgerEntry[] = fires.map((f, i) => {
    const r = results[i];
    const ok = r.status === "fulfilled" && r.value.ok;
    return {
      briefId: f.briefId,
      week,
      kind: f.kind,
      productType: f.productType,
      webhook: f.webhook,
      status: ok ? "triggered" : "failed",
      at,
      score: f.score,
      ...(f.season ? { season: f.season } : {}),
      ...(!ok ? { note: r.status === "fulfilled" ? `n8n ne mana kar diya (HTTP ${r.value.status})` : "n8n tak pahuncha nahi" } : {}),
    };
  });
  ledger.entries.push(...entries);
  await writeLedger(ledger, deps?.outRoot);

  const triggered = entries.filter((e) => e.status === "triggered").length;
  const failed = entries.filter((e) => e.status === "failed").length;
  if (failed > 0) warnings.push(`${failed} webhook fire fail hue — ledger me failed likha hai, agle tick me dobara try hoga.`);
  return { ok: true, week, seasons, briefs: picked.map((b) => b.id), triggered, failed, skipped, fires: entries, warnings };
}

/** Latest tick summary (ledger tail) for the status endpoint. */
export async function latestAutoGenerate(outRoot?: string): Promise<{ week: string | null; entries: AutoGenerateLedgerEntry[] }> {
  const ledger = await readLedger(outRoot);
  const last = ledger.entries[ledger.entries.length - 1];
  return { week: last?.week ?? null, entries: ledger.entries.slice(-50) };
}
