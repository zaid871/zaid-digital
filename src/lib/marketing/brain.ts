/**
 * Marketing Brain — the analyzer that decides WHEN to promote WHICH
 * product, instead of triggers alone.
 *
 * User's setting (2026-11-13):
 * - Affiliate: 1 reel/day on IG, guaranteed.
 * - Digital: every product promoted at least once a week.
 * - A reel is NOT mandatory per digital product: if its marketing is
 *   already happening on another channel, IG gets a carousel instead.
 * - The brain must PREDICT (almost right), not just fire on a trigger.
 *
 * How prediction works (honest version): a transparent weighted score
 * from visible signals — demand, season (+25, seasons.ts), trend,
 * past performance (goal-loop history vs the median), freshness, and
 * coverage urgency (unpromoted >= 7 days gets +30, so the weekly rule
 * is enforced BY the score). Every pick carries its reasons, so the
 * decision is auditable. Accuracy is MEASURED, not claimed: the plan
 * stores its predictions, and calibrate() compares them with real
 * views from the goal loop (top-pick accuracy). Cold start = neutral
 * performance signal (1.0) and no accuracy yet — the brain gets
 * better as real data accrues; it never pretends to know more than
 * the data supports.
 *
 * What the brain does NOT do: it never overrides the anti-spam gap
 * (campaigns still wait 24h between posts), never fakes a trigger
 * (no ready affiliate video -> no reel, honest reason), and never
 * touches the affiliate workflows (it only FIRES the existing
 * affiliate/instagram webhook with a ready video).
 */
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { db } from "../db";
import { getStorage } from "../storage";
import { GoalStore } from "./goal-loop";
import { activeSeasons, matchSeason, SEASON_BOOST } from "../digital/seasons";
import { digitalRoot } from "../digital/package";
import { fitCategoryFor, listCampaignsWithProgress, type Campaign } from "./campaigns";
import { fitFor } from "../publishing/platform-fit";
import type { PromoteType } from "./promote";

export type FetchFn = typeof fetch;

export const BRAIN_SLOTS = ["07:30", "08:30", "19:30", "20:30"] as const;
const COVERAGE_URGENT_DAYS = 7;
const COVERAGE_SOON_DAYS = 4;
const COVERAGE_URGENT_BOOST = 30;
const COVERAGE_SOON_BOOST = 15;
const FIRST_PUSH_BOOST = 15;
const FRESH_BOOST = 5;
const FRESH_DAYS = 7;
const TREND_MULT: Record<string, number> = { rising: 1.15, stable: 1.0, falling: 0.85, unknown: 1.0 };

export interface ScoreInput {
  demandScore: number;
  text: string;
  trend?: "rising" | "stable" | "falling" | "unknown";
  createdAt?: string;
  lastPromotedAt?: string | null;
  pastViews?: number | null;
  medianViews?: number | null;
}

export interface BrainScore {
  total: number;
  base: number;
  season: number;
  seasonId: string | null;
  trendMult: number;
  perfMult: number;
  fresh: number;
  coverage: number;
  reasons: string[];
}

/** Transparent weighted score. Every component is reported, nothing hidden. */
export function scoreProduct(input: ScoreInput, now: Date): BrainScore {
  const base = Math.max(0, Math.min(100, input.demandScore));
  const season = matchSeason(input.text, now);
  const seasonBoost = season ? SEASON_BOOST : 0;
  const trendMult = TREND_MULT[input.trend ?? "unknown"] ?? 1.0;
  const perfMult =
    input.pastViews != null && input.medianViews != null && input.medianViews > 0
      ? Math.max(0.7, Math.min(1.3, input.pastViews / input.medianViews))
      : 1.0;
  const createdMs = input.createdAt ? new Date(input.createdAt).getTime() : NaN;
  const fresh = !Number.isNaN(createdMs) && now.getTime() - createdMs <= FRESH_DAYS * 86400000 ? FRESH_BOOST : 0;
  let coverage = 0;
  if (input.lastPromotedAt == null) {
    coverage = FIRST_PUSH_BOOST;
  } else {
    const days = (now.getTime() - new Date(input.lastPromotedAt).getTime()) / 86400000;
    if (days >= COVERAGE_URGENT_DAYS) coverage = COVERAGE_URGENT_BOOST;
    else if (days >= COVERAGE_SOON_DAYS) coverage = COVERAGE_SOON_BOOST;
  }
  const total = Math.max(0, Math.min(100, Math.round((base + seasonBoost + fresh + coverage) * trendMult * perfMult)));
  const reasons: string[] = [`demand ${base}`];
  if (season) reasons.push(`season ${season.label} +${seasonBoost}`);
  if (trendMult !== 1.0) reasons.push(`trend ${input.trend} x${trendMult}`);
  if (perfMult !== 1.0) reasons.push(`past performance x${perfMult.toFixed(2)}`);
  if (fresh) reasons.push(`fresh +${fresh}`);
  if (coverage) reasons.push(`coverage +${coverage}`);
  return { total, base, season: seasonBoost, seasonId: season?.id ?? null, trendMult, perfMult, fresh, coverage, reasons };
}

/** Reel vs carousel: if the product is already marketed on another channel
 * in the last 7 days, IG gets a carousel; otherwise a reel. */
export function formatFor(marketedElsewhere7d: boolean): "reel" | "carousel" {
  return marketedElsewhere7d ? "carousel" : "reel";
}

function channelEvidence(store: GoalStore, productKey: string, channel: string): string {
  const h = store.get(productKey, channel)?.history ?? [];
  const last = h[h.length - 1];
  if (!last) return "";
  const views = last.metrics.views;
  const posts = last.metrics.posts;
  if (typeof views === "number" && views > 0) return ` — pichle views: ${views}`;
  if (typeof posts === "number" && posts > 0) return ` — pichle posts: ${posts}`;
  return "";
}

/**
 * Demand-based placements for a digital campaign: IG is the anchor, never
 * the only channel. Facebook gets reel picks (FB reels mirror IG); a
 * carousel pick skips FB (no FB carousel path — stated, not hidden).
 * Pinterest/LinkedIn/Threads/X come from platform-fit (high/medium only, low
 * skipped) with past per-channel demand as evidence. X is always a draft
 * (paid API — manual posting is free). Threads posts via its free API.
 * Reddit is deliberately NOT placed
 * here: the subreddit is a per-post human decision (each subreddit has its
 * own self-promotion rules) and the brain doesn't pick one — Reddit posts
 * go through explicit multi-publish calls (route body subreddit or
 * REDDIT_SUBREDDIT env). Quora is deliberately NOT placed here either:
 * an answer is a per-question human decision (each question needs a
 * genuine answer) — Quora drafts go through explicit multi-publish calls
 * (route body question).
 */
export function placementsForCampaign(
  c: { title: string; productType: PromoteType; productKey: string },
  format: "reel" | "carousel",
  store: GoalStore
): Placement[] {
  const out: Placement[] = [];
  out.push({
    channel: "instagram",
    format,
    reason: format === "carousel" ? "dusre channel par marketing ho rahi hai — IG par carousel" : "IG par reel",
  });
  if (format === "reel") {
    out.push({ channel: "facebook", format: "reel", reason: "FB reels — IG ke saath" });
  }
  const fits = fitFor({ name: c.title, category: fitCategoryFor(c.productType) });
  for (const f of fits) {
    if (f.fit === "low") continue;
    const evidence = channelEvidence(store, c.productKey, f.platform);
    if (f.platform === "pinterest") {
      out.push({ channel: "pinterest", format: "pin", reason: `${f.reasons[0] ?? "Pinterest fit"}${evidence}` });
    } else if (f.platform === "linkedin") {
      out.push({ channel: "linkedin", format: "post", reason: `${f.reasons[0] ?? "LinkedIn fit"}${evidence}` });
    } else if (f.platform === "threads") {
      // API lane (free Threads API) — never let a Threads fit fall through
      // to the X-draft branch below.
      out.push({ channel: "threads", format: "post", reason: `${f.reasons[0] ?? "Threads fit"}${evidence}` });
    } else if (f.platform === "reddit") {
      // Not a brain placement (see the doc comment above) — never let a
      // Reddit fit fall through to the X-draft branch below.
      continue;
    } else if (f.platform === "quora") {
      // Not a brain placement either (see above) — never let a Quora fit
      // fall through to the X-draft branch below.
      continue;
    } else {
      out.push({ channel: "x", format: "draft", reason: `X manual — copy tayyar, human post karega${evidence}` });
    }
  }
  return out;
}

export interface AffiliateVideo {
  jobId: string;
  title: string;
  productUrl: string;
  downloadUrl: string;
  caption: string;
  renderedAt: string;
  /** ProductResearch.category — the affiliate niche (tech, gadgets, ...). */
  niche?: string;
}

export interface PackImages {
  dir: string;
  niche: string;
  packName: string;
  pngs: string[];
}

export interface Placement {
  channel: string;
  format: string;
  reason: string;
}

export interface BrainPick {
  slot: string | null;
  campaignId: string | null;
  jobId: string | null;
  title: string;
  format: "reel" | "carousel";
  channels: string[];
  /** Where this pick actually goes, per channel with its format + reason.
   * IG is never the only channel: fit + past demand decide the rest. */
  placements: Placement[];
  imageUrls: string[];
  /** Affiliate video download URL (reel picks only). */
  downloadUrl?: string;
  caption: string;
  /** Affiliate niche (tech, gadgets, ...) — routes the fire to the right affiliate account. */
  niche?: string;
  score: number;
  reasons: string[];
}

export interface BrainPlan {
  date: string;
  seasons: string[];
  affiliate: BrainPick | null;
  affiliateReason: string;
  dailyAd: { productType: string; productName: string; productLink: string; productDescription?: string } | null;
  slots: BrainPick[];
  coverage: { forcedIds: string[]; unpromoted7d: string[] };
  predictions: Array<{ id: string; kind: "affiliate-video" | "campaign"; score: number }>;
  generatedAt: string;
}

export interface BrainLedgerEntry {
  at: string;
  kind: "affiliate-reel" | "carousel" | "plan";
  id: string;
  format: string;
  score: number;
  note?: string;
}

export function brainDir(outRoot?: string): string {
  return join(outRoot ?? process.cwd(), "storage", "marketing", "brain");
}

export function planPath(outRoot?: string): string {
  return join(brainDir(outRoot), "latest.json");
}

export async function readLatestPlan(outRoot?: string): Promise<BrainPlan | null> {
  try {
    const raw = await readFile(planPath(outRoot), "utf-8");
    return JSON.parse(raw) as BrainPlan;
  } catch {
    return null;
  }
}

async function writePlan(plan: BrainPlan, outRoot?: string): Promise<void> {
  const dir = brainDir(outRoot);
  await mkdir(dir, { recursive: true });
  const text = JSON.stringify(plan, null, 2);
  await writeFile(join(dir, "latest.json"), text, "utf-8");
  await writeFile(join(dir, `plan-${plan.date}.json`), text, "utf-8");
}

async function readLedger(outRoot?: string): Promise<BrainLedgerEntry[]> {
  try {
    const raw = await readFile(join(brainDir(outRoot), "ledger.json"), "utf-8");
    const parsed = JSON.parse(raw) as { entries?: BrainLedgerEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function recordFire(entry: BrainLedgerEntry, outRoot?: string): Promise<void> {
  const dir = brainDir(outRoot);
  await mkdir(dir, { recursive: true });
  const entries = await readLedger(outRoot);
  entries.push(entry);
  await writeFile(join(dir, "ledger.json"), JSON.stringify({ entries: entries.slice(-500) }, null, 2), "utf-8");
}

/** Caption for an affiliate reel — same pattern as the ads-marketing
 * build-reels-payload node: name + description + top 3 features + link.
 * The affiliate IG workflow appends the disclosure itself. */
export function captionForAffiliate(
  productName: string,
  description: string | null | undefined,
  features: string[],
  productLink: string
): string {
  let caption = productName || "";
  if (description) caption += `\n\n${description}`;
  const feats = (features ?? []).slice(0, 3);
  if (feats.length) caption += `\n${feats.map((f) => `✓ ${f}`).join("\n")}`;
  caption += `\n\nDetails: ${productLink}`;
  return caption;
}

/** Scan template packs under the digital root for carousel images. */
export async function scanPacks(outRoot?: string): Promise<PackImages[]> {
  const root = outRoot ?? digitalRoot();
  const packs: PackImages[] = [];
  let dirs: string[] = [];
  try {
    dirs = await readdir(root, { withFileTypes: true }).then((es) => es.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return [];
  }
  for (const dir of dirs) {
    try {
      const raw = await readFile(join(root, dir, "manifest.json"), "utf-8");
      const manifest = JSON.parse(raw) as { type?: string; niche?: string; packName?: string; designs?: Array<{ png?: string }> };
      if (manifest.type !== "template_pack") continue;
      const pngs = (manifest.designs ?? []).map((d) => d.png).filter((p): p is string => typeof p === "string" && p.length > 0);
      if (pngs.length < 2) continue;
      packs.push({ dir, niche: String(manifest.niche ?? ""), packName: String(manifest.packName ?? dir), pngs });
    } catch {
      continue;
    }
  }
  return packs;
}

function wordsOverlap(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  for (const w of wa) if (wb.has(w)) return true;
  return false;
}

/** Public image URLs for a campaign's carousel pick (pack match by niche/title words). */
export function packImagesFor(
  campaign: { title: string; niche?: string },
  packs: PackImages[],
  origin: string
): string[] {
  const text = `${campaign.title} ${campaign.niche ?? ""}`;
  const pack = packs.find((p) => wordsOverlap(text, `${p.packName} ${p.niche}`));
  if (!pack) return [];
  return pack.pngs.map((png) => `${origin.replace(/\/$/, "")}/api/v1/digital/files/${pack.dir}/${png}`);
}

export interface PlanInputs {
  campaigns: Array<Campaign & { progress: number | null }>;
  affiliateVideos: AffiliateVideo[];
  store: GoalStore;
  packs: PackImages[];
  origin: string;
}

/** Pure planning: rank, assign slots, decide formats. No IO. */
export function planDay(inputs: PlanInputs, now: Date): BrainPlan {
  const date = now.toISOString().slice(0, 10);
  const seasons = activeSeasons(now).map((s) => s.id);
  const store = inputs.store;

  const medianViews = (() => {
    const views: number[] = [];
    for (const c of inputs.campaigns) {
      const h = store.get(c.productKey, "instagram")?.history ?? [];
      const last = h[h.length - 1]?.metrics.views;
      if (typeof last === "number") views.push(last);
    }
    // Affiliate videos too: their goal runs are keyed by jobId
    // (collectAnalytics records them there), so their past views
    // feed the same median the campaigns use.
    for (const v of inputs.affiliateVideos) {
      const h = store.get(v.jobId, "instagram")?.history ?? [];
      const last = h[h.length - 1]?.metrics.views;
      if (typeof last === "number") views.push(last);
    }
    views.sort((a, b) => a - b);
    return views.length ? views[Math.floor(views.length / 2)] : null;
  })();

  const marketedElsewhere7d = (productKey: string): boolean => {
    for (const ch of ["pinterest", "linkedin", "x", "facebook"]) {
      const h = store.get(productKey, ch)?.history ?? [];
      const last = h[h.length - 1];
      if (last && now.getTime() - new Date(last.at).getTime() <= 7 * 86400000) return true;
    }
    return false;
  };

  // Affiliate: top ready video by score (neutral demand 50 + season +
  // freshness + past performance from the goal loop, keyed by jobId).
  const scoredVideos = inputs.affiliateVideos.map((v) => {
    const h = store.get(v.jobId, "instagram")?.history ?? [];
    const lastViews = h[h.length - 1]?.metrics.views;
    return {
      video: v,
      score: scoreProduct(
        {
          demandScore: 50,
          text: `${v.title} ${v.productUrl}`,
          createdAt: v.renderedAt,
          pastViews: typeof lastViews === "number" ? lastViews : null,
          medianViews,
        },
        now
      ),
    };
  });
  scoredVideos.sort((a, b) => b.score.total - a.score.total);
  const topVideo = scoredVideos[0];
  const affiliate: BrainPick | null = topVideo
    ? {
        slot: null,
        campaignId: null,
        jobId: topVideo.video.jobId,
        title: topVideo.video.title,
        format: "reel",
        channels: ["instagram", "facebook"],
        placements: [
          { channel: "instagram", format: "reel", reason: "roz ki reel — top ready video" },
          { channel: "facebook", format: "reel", reason: "FB reels — IG ke saath" },
        ],
        imageUrls: [],
        downloadUrl: topVideo.video.downloadUrl,
        niche: topVideo.video.niche ?? undefined,
        caption: topVideo.video.caption,
        score: topVideo.score.total,
        reasons: topVideo.score.reasons,
      }
    : null;
  const affiliateReason = topVideo
    ? `Ready video picked: ${topVideo.video.title} (score ${topVideo.score.total})`
    : "Koi ready affiliate video nahi — aaj reel nahi banega (chain se video aane ka intezar).";

  // Digital: score every active campaign; coverage urgency forces the weekly rule.
  const scored = inputs.campaigns
    .filter((c) => c.status === "active")
    .map((c) => {
      const h = store.get(c.productKey, "instagram")?.history ?? [];
      const lastViews = h[h.length - 1]?.metrics.views;
      const elsewhere = marketedElsewhere7d(c.productKey);
      const score = scoreProduct(
        {
          demandScore: 50,
          text: `${c.title} ${c.niche ?? ""}`,
          trend: "unknown",
          createdAt: c.createdAt,
          lastPromotedAt: c.lastPostAt,
          pastViews: typeof lastViews === "number" ? lastViews : null,
          medianViews,
        },
        now
      );
      const imageUrls = elsewhere ? packImagesFor(c, inputs.packs, inputs.origin) : [];
      const format: "reel" | "carousel" = elsewhere && imageUrls.length >= 2 ? "carousel" : "reel";
      return { campaign: c, score, elsewhere, imageUrls, format };
    });
  scored.sort((a, b) => b.score.total - a.score.total);

  const unpromoted7d = scored
    .filter((s) => {
      if (!s.campaign.lastPostAt) return true;
      return now.getTime() - new Date(s.campaign.lastPostAt).getTime() >= 7 * 86400000;
    })
    .map((s) => s.campaign.id);
  const slots: BrainPick[] = scored.slice(0, BRAIN_SLOTS.length).map((s, i) => {
    const placements = placementsForCampaign(s.campaign, s.format, store);
    const reasons = [
      ...s.score.reasons,
      s.elsewhere ? "dusre channel par marketing ho rahi hai — IG par carousel" : "IG par reel",
      ...(s.format === "carousel" ? ["facebook: skip — FB par carousel nahi, sirf reels"] : []),
    ];
    return {
      slot: BRAIN_SLOTS[i],
      campaignId: s.campaign.id,
      jobId: null,
      title: s.campaign.title,
      format: s.format,
      channels: placements.map((p) => p.channel),
      placements,
      imageUrls: s.imageUrls,
      caption: `${s.campaign.title}${s.campaign.description ? `\n\n${s.campaign.description}` : ""}`,
      score: s.score.total,
      reasons,
    };
  });
  const forcedIds = slots.filter((p) => p.campaignId && unpromoted7d.includes(p.campaignId)).map((p) => p.campaignId as string);
  const topDigital = scored[0];
  const dailyAd = topDigital
    ? {
        productType: topDigital.campaign.productType,
        productName: topDigital.campaign.title,
        productLink: topDigital.campaign.url,
        ...(topDigital.campaign.description ? { productDescription: topDigital.campaign.description } : {}),
      }
    : null;

  const predictions: BrainPlan["predictions"] = [
    ...(affiliate ? [{ id: affiliate.jobId as string, kind: "affiliate-video" as const, score: affiliate.score }] : []),
    ...slots.map((p) => ({ id: p.campaignId as string, kind: "campaign" as const, score: p.score })),
  ];
  return {
    date,
    seasons,
    affiliate,
    affiliateReason,
    dailyAd,
    slots,
    coverage: { forcedIds, unpromoted7d },
    predictions,
    generatedAt: now.toISOString(),
  };
}

/** Measured accuracy: for each past plan day, did the top-scored pick
 * actually get the most views that day? Cold start -> null. */
export function calibrate(plans: BrainPlan[], store: GoalStore): { days: number; wins: number; accuracy: number | null } {
  let days = 0;
  let wins = 0;
  for (const plan of plans) {
    if (plan.predictions.length < 2) continue;
    const top = [...plan.predictions].sort((a, b) => b.score - a.score)[0];
    const actuals = plan.predictions.map((p) => {
      const h = store.get(p.id, "instagram")?.history ?? [];
      const dayViews = h
        .filter((e) => e.at.slice(0, 10) === plan.date)
        .reduce((sum, e) => sum + (typeof e.metrics.views === "number" ? e.metrics.views : 0), 0);
      return { id: p.id, views: dayViews };
    });
    const best = [...actuals].sort((a, b) => b.views - a.views)[0];
    if (!best || best.views === 0) continue;
    days += 1;
    if (best.id === top.id) wins += 1;
  }
  return { days, wins, accuracy: days > 0 ? wins / days : null };
}

export interface DailyPlanDeps {
  fetchFn?: FetchFn;
  outRoot?: string;
  now?: Date;
  origin?: string;
  campaigns?: Array<Campaign & { progress: number | null }>;
  readyVideos?: AffiliateVideo[];
  store?: GoalStore;
  packs?: PackImages[];
}

/** Real IO for the daily plan: campaigns, ready affiliate videos (DB),
 * published job ids (DB), goal history, template packs (disk). Every
 * source is overridable via deps (tests inject stubs, no live DB). */
export async function collectInputs(deps: DailyPlanDeps, now: Date): Promise<PlanInputs & { publishedToday: boolean }> {
  const store = deps.store ?? (await GoalStore.load());
  const campaigns = deps.campaigns ?? (await listCampaignsWithProgress());
  let readyVideos = deps.readyVideos;
  let publishedToday = false;
  if (readyVideos === undefined) {
    const videos = await db.finalVideo.findMany({ orderBy: { renderedAt: "desc" }, take: 30 });
    const jobIds = videos.map((v) => v.jobId);
    const [jobs, published, research] = await Promise.all([
      db.job.findMany({ where: { id: { in: jobIds }, status: "COMPLETED" }, select: { id: true, productUrl: true } }),
      db.publishRecord.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, publishedAt: true } }),
      db.productResearch.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, productName: true, description: true, features: true, category: true } }),
    ]);
    const publishedIds = new Set(published.map((p) => p.jobId));
    const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
    publishedToday = published.some((p) => p.publishedAt != null && new Date(p.publishedAt).getTime() >= todayStart);
    const base = (process.env.BACKEND_URL ?? "").replace(/\/$/, "");
    const storage = getStorage();
    readyVideos = [];
    for (const v of videos) {
      const job = jobs.find((j) => j.id === v.jobId);
      if (!job || publishedIds.has(v.jobId)) continue;
      const r = research.find((x) => x.jobId === v.jobId);
      const rel = await storage.signedUrl(v.jobId, v.storageKey).catch(() => null);
      if (!rel) continue;
      readyVideos.push({
        jobId: v.jobId,
        title: r?.productName ?? job.productUrl,
        productUrl: job.productUrl,
        downloadUrl: base ? base + rel : rel,
        caption: captionForAffiliate(r?.productName ?? job.productUrl, r?.description ?? null, r?.features ?? [], job.productUrl),
        renderedAt: v.renderedAt.toISOString(),
        niche: r?.category ?? undefined,
      });
    }
  } else {
    publishedToday = false;
  }
  const packs = deps.packs ?? (await scanPacks());
  return { campaigns, affiliateVideos: readyVideos, store, packs, origin: deps.origin ?? "", publishedToday };
}

/** Build + save today's plan. */
export async function buildDailyPlan(deps: DailyPlanDeps = {}): Promise<BrainPlan> {
  const now = deps.now ?? new Date();
  const inputs = await collectInputs(deps, now);
  const plan = planDay(inputs, now);
  await writePlan(plan, deps.outRoot);
  await recordFire({ at: now.toISOString(), kind: "plan", id: plan.date, format: "plan", score: 0, note: `affiliate: ${plan.affiliate ? plan.affiliate.title : "none"}; slots: ${plan.slots.length}` }, deps.outRoot);
  return plan;
}

/** Fire today's affiliate reel (once per day): only if the plan picked a
 * video AND nothing was published today. Fires the EXISTING
 * affiliate/instagram AND affiliate/facebook webhooks — IG is never the
 * only channel; the workflows' own best-time gates decide the exact
 * minute. Never fakes: no video / already published / n8n down all
 * return fired:false with the reason. */
export async function fireAffiliateReel(
  plan: BrainPlan,
  deps: DailyPlanDeps & { publishedToday?: boolean } = {}
): Promise<{ fired: boolean; reason: string; fbFired: boolean; fbReason: string }> {
  const now = deps.now ?? new Date();
  if (!plan.affiliate || !plan.affiliate.jobId) {
    return { fired: false, reason: plan.affiliateReason, fbFired: false, fbReason: "—" };
  }
  let publishedToday = deps.publishedToday;
  if (publishedToday === undefined) {
    const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
    const rec = await db.publishRecord.findMany({
      where: { platform: "instagram_reels", publishedAt: { gte: new Date(todayStart) } },
      select: { id: true },
      take: 1,
    });
    publishedToday = rec.length > 0;
  }
  if (publishedToday) {
    return { fired: false, reason: "Aaj ki reel pehle hi publish ho chuki hai (chain ya brain se) — dobara nahi.", fbFired: false, fbReason: "—" };
  }
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
  if (!base || !secret) {
    return { fired: false, reason: "N8N_BASE_URL ya N8N_WEBHOOK_SECRET .env mein nahi hai — reel fire nahi hui.", fbFired: false, fbReason: "—" };
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const body = JSON.stringify({
    product: { productType: "affiliate", niche: plan.affiliate.niche ?? undefined, script: { caption: plan.affiliate.caption } },
    downloadUrl: plan.affiliate.downloadUrl ?? "",
  });
  try {
    const res = await fetchFn(`${base}/webhook/affiliate/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-n8n-secret": secret },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return { fired: false, reason: `n8n ne mana kar diya (HTTP ${res.status}) — reel fire nahi hui.`, fbFired: false, fbReason: "—" };
    }
    await recordFire(
      { at: now.toISOString(), kind: "affiliate-reel", id: plan.affiliate.jobId, format: "reel", score: plan.affiliate.score },
      deps.outRoot
    );
    let fbFired = false;
    let fbReason = "FB webhook fire nahi hua.";
    try {
      const fbRes = await fetchFn(`${base}/webhook/affiliate/facebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-n8n-secret": secret },
        body,
        signal: AbortSignal.timeout(30000),
      });
      fbFired = fbRes.ok;
      fbReason = fbRes.ok ? "FB reel bhi fire ho gayi." : `FB ne mana kar diya (HTTP ${fbRes.status}).`;
    } catch (err) {
      fbReason = `FB tak pahuncha nahi (${err instanceof Error ? err.message.slice(0, 100) : String(err)})`;
    }
    return { fired: true, reason: `Reel fire ho gayi: ${plan.affiliate.title} (workflow ka best-time gate exact minute tay karega).`, fbFired, fbReason };
  } catch (err) {
    return { fired: false, reason: `n8n tak pahuncha nahi (${err instanceof Error ? err.message.slice(0, 100) : String(err)})`, fbFired: false, fbReason: "—" };
  }
}
