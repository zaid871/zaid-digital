/**
 * Marketing campaigns — the smart layer over the ads-marketing workflow.
 *
 * The user adds a digital product (URL + type) and optionally a target
 * ("itne din mein kam se kam itna"). The campaign then decides BY
 * ITSELF, every publish slot:
 *
 *   WHERE — the platform-fit analyzer ranks Pinterest / LinkedIn / X
 *   for the product; only high/medium-fit platforms get the
 *   multi-publish part (IG/FB Reels are the base channel of every ad).
 *   X is manual-only (paid API) — the campaign prepares the copy, a
 *   human posts it.
 *   WHEN — only inside the best-time peak windows (07:00-09:00 +
 *   19:00-22:00 IST), and never sooner than MIN_GAP after the last
 *   post on that platform. Outside a peak window, or too soon, the
 *   decision is WAIT — never "hamesha marketing".
 *   HOW HARD — pace math: expected = target x elapsed/deadline.
 *   On track (>= 0.7 of expected pace) -> normal: top fit platform.
 *   Behind (< 0.7) -> all fit platforms. Urgent (< 0.4 of pace, or
 *   < 25% time left and still behind) -> all platforms + shorter gap
 *   (12h) + the manual X draft. Ahead of target -> ease off.
 *
 * Progress is read from the goal-loop ledger (latest recorded metric
 * for the campaign's productKey across its channels). "posts" is
 * always measurable — the campaign counts its own posts and records
 * them as goal runs. "views"/"clicks" need metrics fed into the
 * ledger (POST /goals/record) — until then progress is "unknown" and
 * the campaign says so. "sales" cannot be measured at all without
 * the selling layer (parked) — the campaign accepts the target but
 * flags it and steers by views as a proxy.
 *
 * A "post" action fires the ads-marketing webhook through the same
 * promote() forward as the manual path (fresh video ad each time).
 * The tick never throws: one campaign's failure is recorded, the
 * others still run.
 *
 * Honest limit, stated everywhere this is surfaced: effort is what
 * the system controls (frequency, channels, timing, angles). The
 * outcome (views, clicks, sales) depends on the product and the
 * market — no target is promised, only pursued.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";
import { fitFor, autoPlatforms, manualPlatforms, type SocialPlatform } from "../publishing/platform-fit";
import { publishTiming } from "../publishing/best-time";
import { GoalStore } from "./goal-loop";
import { validatePromoteUrl, promote, type PromoteType } from "./promote";
import { matchSeason, pacePenaltyFor } from "../digital/seasons";
import { multiPublish } from "../publishing/multi-publish";
import type { BrainPlan } from "./brain";

export type FetchFn = typeof fetch;

export const CAMPAIGN_METRICS = ["views", "clicks", "posts", "sales"] as const;
export type CampaignMetric = (typeof CAMPAIGN_METRICS)[number];

export const campaignTargetSchema = z.object({
  metric: z.enum(CAMPAIGN_METRICS),
  value: z.number().int().positive().max(10_000_000),
  deadlineDays: z.number().int().min(1).max(90),
});

export const campaignBodySchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().min(3).max(200).optional(),
  productType: z.enum(["ebook", "template_pack", "pod", "website"]).optional(),
  description: z.string().max(1000).optional(),
  niche: z.string().max(120).optional(),
  target: campaignTargetSchema.optional(),
});

export type CampaignInput = z.infer<typeof campaignBodySchema>;

export type CampaignStatus = "active" | "paused" | "completed" | "missed";

export interface CampaignAction {
  at: string;
  kind: "post" | "wait" | "done" | "missed";
  level: 0 | 1 | 2;
  detail: string;
  reason: string;
}

export interface Campaign {
  id: string;
  createdAt: string;
  productKey: string;
  url: string;
  title: string;
  productType: PromoteType;
  description?: string;
  niche?: string;
  /** Fit analysis at creation time (deterministic rule table). */
  fit: { auto: SocialPlatform[]; manual: SocialPlatform[]; reasons: string[] };
  target?: { metric: CampaignMetric; value: number; deadlineDays: number; deadlineAt: string };
  status: CampaignStatus;
  posts: number;
  lastPostAt: string | null;
  actions: CampaignAction[];
  lastDecision: string | null;
}

export const MIN_GAP_MS = 24 * 60 * 60 * 1000;
export const MIN_GAP_URGENT_MS = 12 * 60 * 60 * 1000;
const HISTORY_CAP = 50;
const PACE_BEHIND = 0.7;
const PACE_URGENT = 0.4;

/** Product type -> platform-fit category (the analyzer's rule table). */
export function fitCategoryFor(productType: PromoteType): string {
  if (productType === "ebook" || productType === "template_pack") return "digital_products_templates";
  if (productType === "pod") return "useful_physical";
  return "other_permissible";
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "product";
}

function campaignsPath(): string {
  if (process.env.MARKETING_CAMPAIGNS_PATH) return process.env.MARKETING_CAMPAIGNS_PATH;
  return join(process.cwd(), "storage", "marketing", "campaigns.json");
}

export async function loadCampaigns(): Promise<Campaign[]> {
  try {
    const raw = await readFile(campaignsPath(), "utf-8");
    const data = JSON.parse(raw) as Campaign[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveCampaigns(list: Campaign[]): Promise<void> {
  const path = campaignsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(list, null, 2));
  await import("fs/promises").then((m) => m.rename(tmp, path));
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const checked = validatePromoteUrl(input.url);
  if (!checked.ok) throw new Error(checked.error);
  const title = (input.title ?? new URL(checked.url).hostname.replace(/^www\./, "")).trim().slice(0, 200);
  const productType = (input.productType ?? "website") as PromoteType;
  const fits = fitFor({ name: title, category: fitCategoryFor(productType) });
  const createdAt = new Date().toISOString();
  const campaign: Campaign = {
    id: `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt,
    productKey: slugify(title),
    url: checked.url,
    title,
    productType,
    ...(input.description ? { description: input.description } : {}),
    ...(input.niche ? { niche: input.niche } : {}),
    fit: {
      auto: autoPlatforms({ name: title, category: fitCategoryFor(productType) }),
      manual: manualPlatforms({ name: title, category: fitCategoryFor(productType) }),
      reasons: fits.filter((f) => f.fit !== "low").map((f) => `${f.platform}: ${f.reasons[0]}`),
    },
    ...(input.target
      ? {
          target: {
            ...input.target,
            deadlineAt: new Date(Date.now() + input.target.deadlineDays * 24 * 60 * 60 * 1000).toISOString(),
          },
        }
      : {}),
    status: "active",
    posts: 0,
    lastPostAt: null,
    actions: [],
    lastDecision: null,
  };
  const list = await loadCampaigns();
  list.unshift(campaign);
  await saveCampaigns(list.slice(0, HISTORY_CAP));
  return campaign;
}

export async function setCampaignStatus(id: string, status: "active" | "paused"): Promise<Campaign | null> {
  const list = await loadCampaigns();
  const c = list.find((x) => x.id === id);
  if (!c || c.status === "completed" || c.status === "missed") return null;
  c.status = status;
  await saveCampaigns(list);
  return c;
}

/**
 * Progress for the campaign's target metric, from the goal-loop ledger:
 * the latest recorded value per channel, summed across the campaign's
 * channels. null = no data recorded yet (never faked as zero).
 */
export async function readProgress(
  campaign: Campaign,
  store: GoalStore
): Promise<{ value: number | null; channels: string[] }> {
  if (!campaign.target) return { value: null, channels: [] };
  if (campaign.target.metric === "posts") return { value: campaign.posts, channels: [] };
  if (campaign.target.metric === "sales") return { value: null, channels: [] }; // selling layer parked
  const channels = ["instagram", "facebook", "pinterest", "linkedin", "x", "youtube"];
  let total = 0;
  let seen = false;
  for (const ch of channels) {
    const goal = store.get(campaign.productKey, ch);
    const latest = goal?.history[goal.history.length - 1];
    const v = latest?.metrics[campaign.target.metric];
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      seen = true;
    }
  }
  return { value: seen ? total : null, channels };
}

export interface Pace {
  /** Fraction of the deadline elapsed (0..1, >1 when overdue). */
  elapsedFrac: number;
  /** Target value expected at this point in time. */
  expected: number | null;
  /** progress / expected (null when progress or target is unknown). */
  ratio: number | null;
  level: 0 | 1 | 2;
  label: "on-track" | "behind" | "urgent" | "no-target" | "no-data";
}

export function paceFor(
  campaign: Campaign,
  progress: number | null,
  now: Date = new Date(),
  /** Season escalation: lowers the EFFECTIVE ratio (never the reported one),
   * so a seasonal campaign escalates to more platforms sooner. 0 = no season. */
  seasonBoost = 0
): Pace {
  if (!campaign.target) return { elapsedFrac: 0, expected: null, ratio: null, level: 0, label: "no-target" };
  const start = new Date(campaign.createdAt).getTime();
  const end = new Date(campaign.target.deadlineAt).getTime();
  const elapsedFrac = (now.getTime() - start) / Math.max(1, end - start);
  const expected = campaign.target.value * Math.min(1, Math.max(0, elapsedFrac));
  if (progress === null) return { elapsedFrac, expected, ratio: null, level: 0, label: "no-data" };
  if (progress >= campaign.target.value) return { elapsedFrac, expected, ratio: 1, level: 0, label: "on-track" };
  const ratio = expected > 0 ? progress / expected : progress > 0 ? 1 : 0;
  const effRatio = Math.max(0, ratio - seasonBoost);
  const urgent = effRatio < PACE_URGENT || (elapsedFrac >= 0.75 && effRatio < PACE_BEHIND);
  const level = urgent ? 2 : effRatio < PACE_BEHIND ? 1 : 0;
  return { elapsedFrac, expected, ratio, level, label: urgent ? "urgent" : effRatio < PACE_BEHIND ? "behind" : "on-track" };
}

export interface Decision {
  action: "post" | "wait" | "done" | "missed";
  level: 0 | 1 | 2;
  channels: SocialPlatform[];
  includeManualDraft: boolean;
  reason: string;
}

/**
 * The decision engine. Pure except for `now` — every rule is explicit
 * so the campaign can always say WHY it waited.
 */
export function decideNextAction(
  campaign: Campaign,
  progress: number | null,
  now: Date = new Date()
): Decision {
  if (campaign.target && progress !== null && progress >= campaign.target.value) {
    return { action: "done", level: 0, channels: [], includeManualDraft: false, reason: `Target poora ho gaya (${progress}/${campaign.target.value} ${campaign.target.metric}) — campaign band.` };
  }
  if (campaign.target && now.getTime() > new Date(campaign.target.deadlineAt).getTime()) {
    return { action: "missed", level: 0, channels: [], includeManualDraft: false, reason: `Deadline guzar gayi (${campaign.target.deadlineDays} din) aur target poora nahi hua — campaign band, dobara target set karo.` };
  }
  const timing = publishTiming(now);
  if (!timing.peakNow) {
    return { action: "wait", level: 0, channels: [], includeManualDraft: false, reason: `Peak time nahi hai — agla slot ${timing.nextSlotIstLabel} hai, tabhi post hoga.` };
  }
  // Season mode: a seasonal campaign escalates sooner (pace penalty).
  const seasonText = `${campaign.title} ${campaign.niche ?? ""}`;
  const season = matchSeason(seasonText, now);
  const seasonBoost = season ? pacePenaltyFor(seasonText, now) : 0;
  const pace = paceFor(campaign, progress, now, seasonBoost);
  const seasonNote = season && pace.level > 0 ? ` (season: ${season.label} — tez push)` : "";
  const gapMs = pace.level === 2 ? MIN_GAP_URGENT_MS : MIN_GAP_MS;
  if (campaign.lastPostAt) {
    const since = now.getTime() - new Date(campaign.lastPostAt).getTime();
    if (since < gapMs) {
      const hrs = Math.ceil((gapMs - since) / 3_600_000);
      return { action: "wait", level: pace.level, channels: [], includeManualDraft: false, reason: `Pichla post abhi ${Math.floor(since / 3_600_000)} ghante pehle hua — spam se bachne ke liye ${hrs} ghante aur intezar.` };
    }
  }
  const channels = pace.level === 0 ? campaign.fit.auto.slice(0, 1) : campaign.fit.auto;
  return {
    action: "post",
    level: pace.level,
    channels,
    includeManualDraft: pace.level === 2 && campaign.fit.manual.length > 0,
    reason:
      pace.label === "urgent"
        ? `Target se peeche aur deadline nazdeek — ji-jaan: saare fit platforms + X draft.${seasonNote}`
        : pace.label === "behind"
          ? `Pace se peeche (${Math.round((pace.ratio ?? 0) * 100)}% expected) — saare fit platforms par post.${seasonNote}`
          : pace.label === "no-data"
            ? `Abhi koi progress data nahi — pehla post fit platform par.`
            : `Pace theek hai — top fit platform par post.`,
  };
}

export interface TickResult {
  campaignId: string;
  title: string;
  decision: Decision;
  progress: number | null;
  status: CampaignStatus;
  note: string;
}

/**
 * Fire an IG carousel through the digital IG publishing workflow's
 * carousel branch (mediaType: "carousel"). Never throws; the caller
 * falls back to the video ad when this fails.
 */
async function fireCarouselWebhook(
  pick: { imageUrls: string[]; caption: string },
  productType: string | undefined,
  fetchFn?: FetchFn
): Promise<{ ok: boolean; status: number }> {
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
  if (!base || !secret) return { ok: false, status: 0 };
  try {
    const res = await (fetchFn ?? fetch)(`${base}/webhook/digital/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-n8n-secret": secret },
      body: JSON.stringify({ mediaType: "carousel", imageUrls: pick.imageUrls, caption: pick.caption, productType }),
      signal: AbortSignal.timeout(30000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * One decision cycle for a single campaign: decide, then act (post ->
 * fire the ads-marketing webhook via promote(); the post is recorded
 * as a goal run so the goal-loop can sweep it). Never throws.
 *
 * Brain plan: when the plan picked this campaign for this slot with
 * format "carousel", the tick fires the IG carousel instead of a video
 * ad (the user's rule: if other channels already market it, IG gets a
 * carousel). Carousel failure falls back to the video ad.
 */
export async function tickCampaign(
  campaign: Campaign,
  deps?: { now?: Date; fetchFn?: FetchFn; store?: GoalStore; plan?: BrainPlan }
): Promise<TickResult> {
  const now = deps?.now ?? new Date();
  try {
    const store = deps?.store ?? (await GoalStore.load());
    const { value: progress } = await readProgress(campaign, store);
    const decision = decideNextAction(campaign, progress, now);
    let note = decision.reason;
    if (decision.action === "post") {
      const pick = deps?.plan?.slots.find((s) => s.campaignId === campaign.id);
      // WHERE comes from the brain's placements (demand-based); pace only
      // decides WHETHER to post (post/wait) and the gap. Without a plan
      // pick, fall back to the pace channels (old behavior).
      const pickSocial: SocialPlatform[] = pick
        ? (pick.placements
            .filter((p) => p.channel === "pinterest" || p.channel === "linkedin" || p.channel === "threads" || p.channel === "x")
            .map((p) => p.channel) as SocialPlatform[])
        : [];
      const mpPlatforms: SocialPlatform[] | undefined =
        pickSocial.length ? pickSocial : decision.channels.length ? decision.channels : undefined;
      const recordPost = async (channels: string[]) => {
        for (const ch of channels) {
          store.recordRun({ productKey: campaign.productKey, channel: ch, metrics: { posts: 1 }, primaryMetric: "posts" });
        }
        await store.save();
      };
      const postVideoAd = async () => {
        const res = await promote(
          {
            url: campaign.url,
            title: campaign.title,
            productType: campaign.productType,
            ...(campaign.description ? { description: campaign.description } : {}),
            platforms: mpPlatforms,
          },
          { fetchFn: deps?.fetchFn }
        );
        campaign.posts += 1;
        campaign.lastPostAt = now.toISOString();
        if (res.forwarded) {
          await recordPost(["instagram", "facebook", ...(mpPlatforms ?? decision.channels)]);
          note = `${decision.reason} Workflow shuru ho gaya (promotion ${res.promotion.id}).`;
        } else {
          note = `${decision.reason} Lekin n8n tak forward nahi hua — promotion queue mein save hai (${res.promotion.id}).`;
        }
        return res;
      };
      if (pick?.format === "carousel" && (pick.imageUrls?.length ?? 0) >= 2) {
        const fired = await fireCarouselWebhook(pick, campaign.productType, deps?.fetchFn);
        campaign.posts += 1;
        campaign.lastPostAt = now.toISOString();
        if (fired.ok) {
          // IG is never the only channel: the carousel also goes to the
          // brain's other placements (Pinterest pin, LinkedIn post, X
          // draft) with the pack's first image. FB has no carousel
          // path (skip, stated in the plan).
          const mp = await multiPublish(
            {
              name: campaign.title,
              category: fitCategoryFor(campaign.productType),
              link: campaign.url,
              imageUrl: pick.imageUrls[0],
              ...(campaign.description ? { description: campaign.description } : {}),
            },
            mpPlatforms,
            { fetchFn: deps?.fetchFn }
          );
          const doneChannels = mp.results
            .filter((r) => r.status === "published" || r.status === "draft")
            .map((r) => r.platform);
          await recordPost(["instagram", ...doneChannels]);
          const mpSummary = mp.results.map((r) => `${r.platform}: ${r.status}${r.reason ? ` (${r.reason.slice(0, 80)})` : ""}`).join(", ");
          note = `${decision.reason} Carousel post ho gaya IG par (${pick.imageUrls.length} images). Dusre channels: ${mpSummary}.`;
        } else {
          const res = await postVideoAd();
          note = res.forwarded
            ? `${decision.reason} Carousel fail hua (HTTP ${fired.status}) — video ad se post kiya (promotion ${res.promotion.id}).`
            : `${decision.reason} Carousel bhi fail hua, video ad bhi forward nahi hua — promotion queue mein save hai (${res.promotion.id}).`;
        }
      } else {
        await postVideoAd();
      }
    } else if (decision.action === "done") {
      campaign.status = "completed";
    } else if (decision.action === "missed") {
      campaign.status = "missed";
    }
    const action: CampaignAction = {
      at: now.toISOString(),
      kind: decision.action === "post" ? "post" : decision.action,
      level: decision.level,
      detail: decision.action === "post" ? `Post: ${decision.channels.join(", ") || "reels"}` : decision.reason,
      reason: decision.reason,
    };
    campaign.actions = [action, ...campaign.actions].slice(0, HISTORY_CAP);
    campaign.lastDecision = decision.reason;
    const list = await loadCampaigns();
    const idx = list.findIndex((x) => x.id === campaign.id);
    if (idx >= 0) list[idx] = campaign;
    await saveCampaigns(list);
    return { campaignId: campaign.id, title: campaign.title, decision, progress, status: campaign.status, note };
  } catch (err) {
    return {
      campaignId: campaign.id,
      title: campaign.title,
      decision: { action: "wait", level: 0, channels: [], includeManualDraft: false, reason: "Tick mein error — agle slot par phir try hoga." },
      progress: null,
      status: campaign.status,
      note: `Tick fail: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
    };
  }
}

/** Run one decision cycle for every active campaign. When a brain plan is
 * passed, planned campaigns run first (slot order); the rest follow in
 * file order. */
export async function tickAllCampaigns(deps?: { now?: Date; fetchFn?: FetchFn; plan?: BrainPlan }): Promise<TickResult[]> {
  const list = await loadCampaigns();
  const store = await GoalStore.load();
  const active = list.filter((x) => x.status === "active");
  const order = new Map((deps?.plan?.slots ?? []).map((s, i) => [s.campaignId, i]));
  active.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const results: TickResult[] = [];
  for (const c of active) {
    results.push(await tickCampaign(c, { ...deps, store }));
  }
  return results;
}

/** Campaign list enriched with live progress + pace for the dashboard. */
export async function listCampaignsWithProgress(): Promise<Array<Campaign & { progress: number | null; pace: Pace; salesWarning: string | null; daysLeft: number | null }>> {
  const list = await loadCampaigns();
  const store = await GoalStore.load();
  const nowMs = Date.now();
  const out: Array<Campaign & { progress: number | null; pace: Pace; salesWarning: string | null; daysLeft: number | null }> = [];
  for (const c of list) {
    const { value } = await readProgress(c, store);
    out.push({
      ...c,
      progress: value,
      pace: paceFor(c, value),
      daysLeft: c.target
        ? Math.max(0, Math.ceil((new Date(c.target.deadlineAt).getTime() - nowMs) / 86400000))
        : null,
      salesWarning:
        c.target?.metric === "sales"
          ? "Sales ka hisaab selling layer ke bina nahi ho sakta (abhi parked hai) — views ko proxy maan kar chala rahe hain; sales target ke liye selling layer chahiye."
          : null,
    });
  }
  return out;
}
