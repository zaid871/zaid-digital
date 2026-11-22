/**
 * Standalone QC check — the affiliate technique ported to digital.
 *
 * Affiliate side: `affiliate/quality-control` runs a checklist on the
 * rendered job (fetch-result -> run-checks -> route-verdict) and only
 * QC_APPROVED products reach the website + IG/FB. Digital had the
 * backend render QA (16 checks) and the NEEDS_REVIEW park, but no
 * publish-time gate on the final caption + link. This is that gate,
 * called by the digital ads-marketing workflow after the job completes
 * and before any IG/FB trigger.
 *
 * Verdicts: fail = job not COMPLETED / no final video / banned claim
 * (never publish); review = price-like text in the caption or the
 * product link unreachable (park for a human); pass = everything clean.
 */
import { db } from "@/lib/db";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { checkLink, type FetchFn } from "./validate-link";

export type QcVerdict = "pass" | "review" | "fail";

export interface QcCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface QcResult {
  verdict: QcVerdict;
  checks: QcCheck[];
}

export async function runQcCheck(deps: {
  jobId: string;
  caption?: string;
  productLink?: string;
  fetchFn?: FetchFn;
  /** Overrides (tests inject; undefined = read the DB). */
  job?: { status: string } | null;
  hasVideo?: boolean;
}): Promise<QcResult> {
  const checks: QcCheck[] = [];
  const job =
    deps.job !== undefined
      ? deps.job
      : await db.job.findUnique({ where: { id: deps.jobId }, select: { status: true } });
  if (!job) {
    checks.push({ name: "job-exists", ok: false, detail: `Job ${deps.jobId} nahi mila` });
    return { verdict: "fail", checks };
  }
  const completed = job.status === "COMPLETED";
  checks.push({
    name: "job-completed",
    ok: completed,
    detail: completed ? "Job COMPLETED hai" : `Job status ${job.status} hai, COMPLETED nahi`,
  });
  const hasVideo =
    deps.hasVideo !== undefined
      ? deps.hasVideo
      : !!(await db.finalVideo.findUnique({ where: { jobId: deps.jobId }, select: { id: true } }));
  checks.push({
    name: "video-exists",
    ok: hasVideo,
    detail: hasVideo ? "Final video maujood hai" : "Final video nahi mili",
  });
  const caption = deps.caption ?? "";
  const priceHit = caption ? PRICE_PATTERN.test(caption) : false;
  const bannedHit = caption ? BANNED_CLAIM_PATTERN.test(caption) : false;
  checks.push({
    name: "caption-price",
    ok: !priceHit,
    detail: priceHit ? "Caption me price/discount jaisa text hai" : "Caption me price nahi hai",
  });
  checks.push({
    name: "caption-claims",
    ok: !bannedHit,
    detail: bannedHit ? "Caption me banned claim hai (review/fake claim)" : "Caption me banned claim nahi hai",
  });
  if (deps.productLink) {
    const link = await checkLink(deps.productLink, deps.fetchFn);
    checks.push({
      name: "link-reachable",
      ok: link.reachable,
      detail: link.note + (link.status != null ? ` (HTTP ${link.status})` : ""),
    });
  }
  const linkCheck = checks.find((c) => c.name === "link-reachable");
  let verdict: QcVerdict = "pass";
  if (!completed || !hasVideo || bannedHit) verdict = "fail";
  else if (priceHit || (linkCheck && !linkCheck.ok)) verdict = "review";
  return { verdict, checks };
}
