/**
 * Manual promote — the on-demand entry into the digital ads-marketing
 * workflow. The user pastes any website/product URL on the dashboard,
 * picks a type and whether to publish, and this module forwards it to
 * the ads-marketing webhook (POST /webhook/digital-ads-marketing, the
 * same webhook ads-daily fires) with the x-n8n-secret header.
 *
 * The webhook is long-running (it polls the video job, ~40 min
 * server-side), so the forward is fire-and-forget with a 30s timeout —
 * the endpoint returns "started" as soon as n8n accepted the call, and
 * the workflow reports its own outcome. When n8n is unreachable or the
 * env (N8N_BASE_URL / N8N_WEBHOOK_SECRET) is missing, the promotion is
 * saved to the queue file with status "queued" and the caller is told
 * plainly — nothing is silently dropped, and nothing is faked as
 * started.
 *
 * URL validation is a first gate only (public http(s) host, no
 * localhost/private addresses): the job creation's own SSRF checks run
 * again when the workflow creates the video job.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";

export type FetchFn = typeof fetch;

export const PROMOTE_TYPES = ["ebook", "template_pack", "pod", "website"] as const;
export type PromoteType = (typeof PROMOTE_TYPES)[number];

export const promoteBodySchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().min(3).max(200).optional(),
  productType: z.enum(PROMOTE_TYPES).optional(),
  description: z.string().max(1000).optional(),
  durationSeconds: z.number().int().min(15).max(180).optional(),
  publish: z.boolean().optional(),
  platforms: z.array(z.enum(["pinterest", "linkedin", "x", "reddit", "quora", "threads"])).max(6).optional(),
  subreddit: z.string().min(1).max(100).optional(),
  question: z.string().max(500).optional(),
});

export type PromoteInput = z.infer<typeof promoteBodySchema>;

export interface Promotion {
  id: string;
  at: string;
  url: string;
  title: string;
  productType: PromoteType;
  publish: boolean;
  platforms?: string[];
  subreddit?: string;
  question?: string;
  status: "started" | "queued";
  note: string;
}

const HISTORY_CAP = 50;

function promotionsPath(): string {
  if (process.env.MARKETING_PROMOTIONS_PATH) return process.env.MARKETING_PROMOTIONS_PATH;
  return join(process.cwd(), "storage", "marketing", "promotions.json");
}

export async function listPromotions(): Promise<Promotion[]> {
  try {
    const raw = await readFile(promotionsPath(), "utf-8");
    const data = JSON.parse(raw) as Promotion[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function recordPromotion(p: Promotion): Promise<void> {
  const path = promotionsPath();
  await mkdir(dirname(path), { recursive: true });
  const prev = await listPromotions();
  const next = [p, ...prev].slice(0, HISTORY_CAP);
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await import("fs/promises").then((m) => m.rename(tmp, path));
}

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h.startsWith("fc") || h.startsWith("fd") || h === "::") return true;
  return false;
}

/** First-gate URL check: public http(s) URL, no private/local host. */
export function validatePromoteUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "URL samajh nahi aayi — poori http(s) link do (https://...)" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Sirf http(s) links promote hote hain" };
  }
  if (!u.hostname || isPrivateHostname(u.hostname)) {
    return { ok: false, error: "Local/private address promote nahi hota — public website ka link do" };
  }
  return { ok: true, url: u.toString() };
}

/** Map the manual form to the ads-marketing webhook payload. */
export function buildWebhookPayload(input: PromoteInput & { url: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    productType: input.productType ?? "website",
    productName: (input.title ?? input.url).trim().slice(0, 200),
    productLink: input.url,
    durationSeconds: Math.min(180, Math.max(15, input.durationSeconds ?? 45)),
    publish: input.publish !== false,
  };
  if (input.description?.trim()) out.productDescription = input.description.trim().slice(0, 1000);
  if (input.platforms?.length) out.platforms = input.platforms;
  if (input.subreddit?.trim()) out.subreddit = input.subreddit.trim().slice(0, 100);
  if (input.question?.trim()) out.question = input.question.trim().slice(0, 500);
  return out;
}

export interface PromoteResult {
  promotion: Promotion;
  forwarded: boolean;
}

/**
 * Validate -> forward to the ads-marketing webhook (fire-and-forget) ->
 * record. Never throws on a forward failure: the promotion is queued
 * and the caller gets the plain truth.
 */
export async function promote(
  input: PromoteInput,
  deps?: { fetchFn?: FetchFn }
): Promise<PromoteResult> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const checked = validatePromoteUrl(input.url);
  if (!checked.ok) throw new Error(checked.error);
  const payload = buildWebhookPayload({ ...input, url: checked.url });
  const id = `promo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";

  let forwarded = false;
  let note = "";
  if (!base || !secret) {
    note = "n8n tak forward nahi hua — N8N_BASE_URL ya N8N_WEBHOOK_SECRET .env mein nahi hai. Queue mein save hai; env set karke dobara promote karo.";
  } else {
    try {
      const res = await fetchFn(`${base}/webhook/digital-ads-marketing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-n8n-secret": secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        forwarded = true;
        note = "Marketing workflow shuru ho gaya — video banega, phir publish hoga (publish on hai to).";
      } else {
        note = `n8n ne mana kar diya (HTTP ${res.status}) — queue mein save hai; n8n check karke dobara promote karo.`;
      }
    } catch (err) {
      note = `n8n tak pahuncha nahi (${err instanceof Error ? err.message.slice(0, 100) : String(err)}) — queue mein save hai; n8n up hote hi dobara promote karo.`;
    }
  }

  const promotion: Promotion = {
    id,
    at: new Date().toISOString(),
    url: checked.url,
    title: String(payload.productName),
    productType: payload.productType as PromoteType,
    publish: payload.publish as boolean,
    ...(payload.platforms ? { platforms: payload.platforms as string[] } : {}),
    ...(payload.subreddit ? { subreddit: payload.subreddit as string } : {}),
    ...(payload.question ? { question: payload.question as string } : {}),
    status: forwarded ? "started" : "queued",
    note,
  };
  await recordPromotion(promotion);
  return { promotion, forwarded };
}
