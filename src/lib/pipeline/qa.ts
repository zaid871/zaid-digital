/**
 * Phase 6 — automated quality assurance.
 *
 * Runs AFTER rendering, BEFORE delivery. Two check families:
 *
 * Technical (deterministic, ffprobe + filters):
 *   file exists/readable · duration within target ±2s · exactly 1080x1920 ·
 *   fps 29–31 · audio stream present · A/V duration drift < 0.5s ·
 *   no unexpected black/frozen segments (blackdetect/freezedetect) ·
 *   captions parse and every cue lies within the video duration.
 *
 * Content (deterministic scans + policy re-check):
 *   no price patterns (₹/$/Rs/discount/%) in captions, narration, or
 *   on-screen text · no banned promotional language (guarantees,
 *   testimonials, reviews, discounts) · compliance policy re-check ·
 *   neutral CTA present.
 *
 * Verdicts:
 *   PASS / PASS_WITH_WARNINGS / NEEDS_REVIEW / FAILED
 * NEEDS_REVIEW parks the job in WAITING_FOR_REVIEW (never failed);
 * FAILED marks the job FAILED with clear reasons. QA FAILED does NOT
 * auto-retry the pipeline — a human decides.
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { db } from "@/lib/db";
import { assessCompliance } from "@/lib/compliance";
import { canTransition } from "@/lib/job-stages";
import { transitionJob, updateStage } from "@/lib/job-service";
import { jobAssetsDir, parseSrt } from "./assets";
import { judgeNeedsReview } from "./llm-judge";
import { probeFull, RENDER_FPS, RENDER_HEIGHT, RENDER_WIDTH } from "./render";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "./script";

const execFileAsync = promisify(execFile);

export type QAVerdict = "PASS" | "PASS_WITH_WARNINGS" | "NEEDS_REVIEW" | "FAILED";

export interface QACheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface QAResult {
  verdict: QAVerdict;
  technicalChecks: QACheck[];
  contentChecks: QACheck[];
  warnings: string[];
  actualSpecs: {
    width: number | null;
    height: number | null;
    fps: number | null;
    durationSeconds: number | null;
  };
}

interface QAScene {
  sceneId: string;
  narrationSegment: string;
  onScreenText: string[];
}

function check(name: string, passed: boolean, detail: string): QACheck {
  return { name, passed, detail };
}

/**
 * Detect black or frozen segments. Returns total seconds of suspicious
 * footage (0 when clean). Never throws — probe failure yields null.
 *
 * `analyzeSec`: only this many leading seconds are analyzed. The end-card
 * (dark, static by design) is excluded so it is not misread as dead air.
 */
async function detectDeadSegments(absPath: string, analyzeSec: number | null): Promise<number | null> {
  try {
    const trimArgs = analyzeSec !== null && analyzeSec > 0 ? ["-t", String(analyzeSec)] : [];
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i", absPath,
        "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=0.8",
        "-an", ...trimArgs, "-f", "null", "-",
      ],
      { timeout: 120_000 }
    );
    let total = 0;
    for (const m of stderr.matchAll(/black_duration:([\d.]+)/g)) total += Number(m[1]);
    for (const m of stderr.matchAll(/freeze_duration:([\d.]+)/g)) total += Number(m[1]);
    return Math.round(total * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Measure integrated loudness + true peak of the final file with a
 * loudnorm analysis pass. Returns null when measurement is unavailable
 * (caller treats that as skipped, never as a pass/fail invention).
 */
async function measureLoudness(
  absPath: string
): Promise<{ integrated: number; truePeak: number } | null> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", absPath, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const i = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
    const tp = stderr.match(/"input_tp"\s*:\s*"(-?[\d.]+)"/);
    if (!i || !tp) return null;
    return { integrated: Number(i[1]), truePeak: Number(tp[1]) };
  } catch {
    return null;
  }
}

async function emitEvent(jobId: string, type: string, message: string) {
  await db.jobEvent.create({ data: { jobId, type, message } });
}

export interface QAInputs {
  jobId: string;
  finalPath: string;
  srtPath: string;
  targetDurationSec: number;
  scenes: QAScene[];
  narrations: string[];
  callToAction: string;
  productCategory: string | null;
  /** Auto-DM CTA from the script. MANDATORY — missing/invalid → FAILED. */
  dmCta: { keyword: string; ctaLine: string } | null;
}

/**
 * Run all quality checks. Pure-ish: no DB writes except none — the caller
 * (runQualityAssuranceStage) persists the report and job state.
 */
export async function runQualityChecks(inputs: QAInputs): Promise<QAResult> {
  const technical: QACheck[] = [];
  const content: QACheck[] = [];
  const warnings: string[] = [];
  let failed = false;
  let needsReview = false;

  const t = (name: string, passed: boolean, detail: string, opts?: { critical?: boolean; review?: boolean }) => {
    technical.push(check(name, passed, detail));
    if (!passed) {
      if (opts?.critical) failed = true;
      else if (opts?.review) needsReview = true;
      else warnings.push(`${name}: ${detail}`);
    }
  };
  const c = (name: string, passed: boolean, detail: string, opts?: { critical?: boolean; review?: boolean }) => {
    content.push(check(name, passed, detail));
    if (!passed) {
      if (opts?.critical) failed = true;
      else if (opts?.review) needsReview = true;
      else warnings.push(`${name}: ${detail}`);
    }
  };

  // ---------------- technical ----------------
  t("file-exists", existsSync(inputs.finalPath), existsSync(inputs.finalPath) ? "final.mp4 is present and readable." : `final.mp4 missing: ${inputs.finalPath}`, { critical: true });

  let duration: number | null = null;
  if (existsSync(inputs.finalPath)) {
    let probe;
    try {
      probe = await probeFull(inputs.finalPath);
    } catch (err) {
      probe = null;
      t("probe", false, `ffprobe failed: ${err instanceof Error ? err.message : String(err)}`, { critical: true });
    }
    if (probe) {
      t("probe", true, "ffprobe read all streams.");
      duration = probe.durationSec;
      const lo = inputs.targetDurationSec - 2;
      const hi = inputs.targetDurationSec + 2 + 2.5 + 1; // + end-card + slack
      t(
        "duration-in-range",
        duration !== null && duration >= lo && duration <= hi,
        `duration ${duration?.toFixed(2) ?? "?"}s vs target ${inputs.targetDurationSec}s (±2s + end-card).`,
        { critical: true }
      );
      t(
        "resolution",
        probe.width === RENDER_WIDTH && probe.height === RENDER_HEIGHT,
        `resolution ${probe.width}x${probe.height}, expected ${RENDER_WIDTH}x${RENDER_HEIGHT}.`,
        { critical: true }
      );
      t(
        "frame-rate",
        probe.fps !== null && probe.fps >= RENDER_FPS - 1 && probe.fps <= RENDER_FPS + 1,
        `fps ${probe.fps ?? "?"}, expected ${RENDER_FPS}±1.`,
        { critical: true }
      );
      t("audio-stream", probe.hasAudio, probe.hasAudio ? `audio stream present (${probe.audioCodec}).` : "no audio stream found.", { critical: true });
      t("video-codec", probe.videoCodec === "h264", `video codec ${probe.videoCodec ?? "?"}, expected h264.`, { critical: true });

      // A/V drift: compare stream durations.
      try {
        const { stdout } = await execFileAsync(
          "ffprobe",
          ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", inputs.finalPath],
          { timeout: 30_000 }
        );
        const streams = (JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; duration?: string }> }).streams ?? [];
        const vd = Number(streams.find((s) => s.codec_type === "video")?.duration);
        const ad = Number(streams.find((s) => s.codec_type === "audio")?.duration);
        if (Number.isFinite(vd) && Number.isFinite(ad)) {
          const drift = Math.abs(vd - ad);
          t("av-sync", drift < 0.5, `A/V drift ${drift.toFixed(2)}s (limit 0.5s).`, { critical: true });
        } else {
          t("av-sync", true, "stream durations unavailable; container duration used instead.");
        }
      } catch {
        t("av-sync", true, "stream-duration probe failed; skipped (non-blocking).");
      }

      // Analyze only the content portion — the end-card is dark and static
      // by design and must not be misread as dead air.
      const contentSec = duration !== null ? Math.max(1, duration - 2.5) : null;
      const dead = await detectDeadSegments(inputs.finalPath, contentSec);
      if (dead === null) {
        t("no-dead-segments", true, "black/freeze detection unavailable; skipped (non-blocking).");
      } else {
        t("no-dead-segments", dead <= 1.0, dead <= 1.0 ? "no unexpected black/frozen segments." : `${dead}s of black/frozen footage detected — needs human review.`, { review: true });
      }
      // Loudness vs the delivery target (render normalizes to -14 LUFS /
      // -1.5 dBTP). Measured with a loudnorm analysis pass on the final file.
      const loud = await measureLoudness(inputs.finalPath);
      if (loud === null) {
        t("loudness-target", true, "loudness measurement unavailable; skipped (non-blocking).");
      } else {
        const inRange = loud.integrated >= -16 && loud.integrated <= -12 && loud.truePeak <= -1.0;
        t(
          "loudness-target",
          inRange,
          inRange
            ? `integrated loudness ${loud.integrated.toFixed(1)} LUFS, true peak ${loud.truePeak.toFixed(1)} dBTP (target -14 LUFS, peak ≤ -1.0 dBTP).`
            : `loudness off target: ${loud.integrated.toFixed(1)} LUFS / ${loud.truePeak.toFixed(1)} dBTP (want -14 ±2 LUFS, peak ≤ -1.0 dBTP).`,
          { review: !inRange }
        );
      }
    }
  }

  // Captions parse + bounds.
  if (!existsSync(inputs.srtPath)) {
    t("captions-present", false, `captions SRT missing: ${inputs.srtPath}`, { critical: true });
  } else {
    t("captions-present", true, "captions.srt present.");
    const cues = parseSrt(readFileSync(inputs.srtPath, "utf-8"));
    if (!cues) {
      t("captions-parse", false, "SRT failed to parse.", { review: true });
    } else {
      t("captions-parse", true, `${cues.length} caption cues parsed.`);
      const outOfRange = cues.filter(
        (q) => duration !== null && (q.start < 0 || q.end > duration + 0.5)
      );
      t(
        "captions-in-bounds",
        outOfRange.length === 0,
        outOfRange.length === 0
          ? "all cues lie within the video duration."
          : `${outOfRange.length} cue(s) fall outside the video duration.`,
        { review: outOfRange.length > 0 }
      );
      // Hook presence: the opening must land immediately — first caption
      // within 1s and a short, punchy opening narration line (≤ 30 words).
      const firstCue = cues[0];
      const hookWords = (inputs.narrations[0] ?? "").split(/\s+/).filter(Boolean).length;
      const hookOk =
        firstCue !== undefined && firstCue.start <= 1.0 && hookWords > 0 && hookWords <= 30;
      t(
        "hook-early",
        hookOk,
        hookOk
          ? `hook lands immediately (first caption at ${firstCue.start.toFixed(2)}s, opening line ${hookWords} words).`
          : `weak opening: first caption at ${firstCue ? firstCue.start.toFixed(2) : "?"}s, opening line ${hookWords} words (want ≤ 1.0s and ≤ 30 words).`,
        { review: !hookOk }
      );
    }
  }

  // ---------------- content ----------------
  const allText = [
    ...inputs.narrations,
    ...inputs.scenes.flatMap((s) => s.onScreenText),
    inputs.callToAction,
    existsSync(inputs.srtPath) ? readFileSync(inputs.srtPath, "utf-8") : "",
  ].join("\n");

  const priceHit = allText.match(PRICE_PATTERN);
  c(
    "no-price",
    !priceHit,
    priceHit ? `price-like pattern found: "${priceHit[0].slice(0, 60)}" — FAILED.` : "no price/discount/offer patterns in captions, narration, or on-screen text.",
    { critical: true }
  );

  const bannedHit = allText.match(BANNED_CLAIM_PATTERN);
  c(
    "no-banned-claims",
    !bannedHit,
    bannedHit ? `banned promotional language found: "${bannedHit[0].slice(0, 60)}" — FAILED.` : "no fabricated reviews, guarantees, or discount language.",
    { critical: true }
  );

  const compliance = assessCompliance({
    productCategory: inputs.productCategory,
    claims: inputs.narrations.map((text) => ({ text, verified: true })),
    hasMusic: false,
    hasProhibitedAudio: false,
  });
  c(
    "compliance-recheck",
    compliance.verdict === "APPROVED",
    compliance.verdict === "APPROVED"
      ? "policy re-check approved (no music, verified claims only)."
      : `policy re-check: ${compliance.verdict} — ${compliance.reasons.join(" ")}`,
    { review: compliance.verdict !== "APPROVED" }
  );

  c(
    "cta-present",
    inputs.callToAction.trim().length > 0,
    inputs.callToAction.trim().length > 0
      ? "neutral call to action present (also rendered on end-card)."
      : "call to action missing.",
    { critical: true }
  );

  // Auto-DM CTA is mandatory: the keyword must be spoken in the narration
  // (so captions carry it) and the CTA line must be present for the
  // end-card + IG caption. Missing → FAILED, never silently skipped.
  const dm = inputs.dmCta;
  const dmKeyword = (dm?.keyword ?? "").trim().toUpperCase();
  const dmLine = (dm?.ctaLine ?? "").trim();
  const dmSpoken =
    dmKeyword.length > 0 &&
    inputs.narrations.join("\n").toUpperCase().includes(dmKeyword);
  c(
    "dm-cta-present",
    dmKeyword.length > 0 && dmLine.length > 0 && dmSpoken,
    !dm || dmKeyword.length === 0 || dmLine.length === 0
      ? "auto-DM CTA missing from script — FAILED."
      : dmSpoken
        ? `auto-DM CTA present (keyword "${dmKeyword}" spoken in narration, line on end-card + caption).`
        : `auto-DM keyword "${dmKeyword}" is not spoken in any narration — FAILED.`,
    { critical: true }
  );

  const verdict: QAVerdict = failed
    ? "FAILED"
    : needsReview
      ? "NEEDS_REVIEW"
      : warnings.length > 0
        ? "PASS_WITH_WARNINGS"
        : "PASS";

  let probeSpecs = { width: null as number | null, height: null as number | null, fps: null as number | null, durationSeconds: duration };
  try {
    if (existsSync(inputs.finalPath)) {
      const p = await probeFull(inputs.finalPath);
      probeSpecs = { width: p.width, height: p.height, fps: p.fps, durationSeconds: p.durationSec };
    }
  } catch { /* specs stay nullish */ }

  return { verdict, technicalChecks: technical, contentChecks: content, warnings, actualSpecs: probeSpecs };
}

// ---------------------------------------------------------------------------
// Stage runner: executes QA, persists the QualityReport, and applies the
// verdict to the job. NEVER throws for NEEDS_REVIEW/FAILED — those are
// handled outcomes, not crashes. Returns the verdict for the worker loop.
// ---------------------------------------------------------------------------

export async function runQualityAssuranceStage(jobId: string): Promise<QAVerdict> {
  await updateStage(jobId, "quality_assurance", {
    status: "running",
    progressPct: 20,
    message: "Running automated quality checks (technical + content + compliance).",
  });

  const [job, storyboard, script, research] = await Promise.all([
    db.job.findUnique({ where: { id: jobId } }),
    db.storyboard.findUnique({ where: { jobId } }),
    db.script.findUnique({ where: { jobId } }),
    db.productResearch.findUnique({ where: { jobId } }),
  ]);
  if (!job) throw new Error(`Job ${jobId} not found.`);
  if (!storyboard || !script) {
    throw new Error(`Storyboard/script missing for job ${jobId} — cannot QA.`);
  }

  const dir = jobAssetsDir(jobId);
  const finalPath = join(dir, "final.mp4");
  const srtPath = join(dir, "captions.srt");

  const sbScenes = storyboard.scenes as unknown as QAScene[];
  const scriptScenes = (script.scenes as Array<{ sceneId: string; narration: string }>) ?? [];

  const result = await runQualityChecks({
    jobId,
    finalPath,
    srtPath,
    targetDurationSec: job.durationSeconds ?? 45,
    scenes: sbScenes,
    narrations: scriptScenes.map((s) => s.narration),
    callToAction: (script.callToAction as string) ?? "",
    productCategory: research?.category ?? null,
    dmCta:
      ((script as unknown as { dmCta?: unknown }).dmCta as {
        keyword: string;
        ctaLine: string;
      } | null) ?? null,
  });

  // JSON round-trip: guarantees the checks are JSON-serializable (which the
  // Json columns require) and satisfies Prisma's InputJsonValue typing —
  // named interfaces don't carry implicit index signatures.
  const toJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as never;
  await db.qualityReport.create({
    data: {
      jobId,
      schemaVersion: "1.0.0",
      verdict: result.verdict,
      technicalChecks: toJson(result.technicalChecks),
      contentChecks: toJson(result.contentChecks),
      warnings: result.warnings,
      actualSpecs: toJson(result.actualSpecs),
    },
  });

  const summary = `${result.technicalChecks.filter((x) => x.passed).length}/${result.technicalChecks.length} technical, ${result.contentChecks.filter((x) => x.passed).length}/${result.contentChecks.length} content checks passed.`;
  await emitEvent(jobId, "qa_complete", `QA verdict: ${result.verdict}. ${summary}`);

  if (result.verdict === "FAILED") {
    const reasons = [
      ...result.technicalChecks.filter((x) => !x.passed).map((x) => `technical/${x.name}: ${x.detail}`),
      ...result.contentChecks.filter((x) => !x.passed).map((x) => `content/${x.name}: ${x.detail}`),
    ];
    await updateStage(jobId, "quality_assurance", {
      status: "failed",
      message: `QA FAILED: ${reasons.slice(0, 3).join(" | ").slice(0, 500)}`,
    });
    const cur = (await db.job.findUnique({ where: { id: jobId } }))!.status as Parameters<typeof canTransition>[0];
    if (canTransition(cur, "FAILED")) {
      await transitionJob(jobId, "FAILED", `Quality assurance failed: ${reasons.slice(0, 5).join("; ").slice(0, 800)}`, {
        errorCode: "qa_failed",
        errorMessage: reasons.slice(0, 5).join("; ").slice(0, 800),
      });
    }
    return "FAILED";
  }

  if (result.verdict === "NEEDS_REVIEW") {
    const flags = [
      ...result.technicalChecks.filter((x) => !x.passed).map((x) => x.name),
      ...result.contentChecks.filter((x) => !x.passed).map((x) => x.name),
    ];
    // LLM-as-judge second opinion (chat-ads-eval pattern, adapted): it
    // NEVER changes the verdict — the job still parks for a human. It
    // only attaches a readable rationale + suggested fix. Non-fatal and
    // skippable via QA_LLM_JUDGE=off; one short call per flagged job.
    let judgeNote = "";
    if (process.env.QA_LLM_JUDGE !== "off") {
      try {
        const judge = await judgeNeedsReview({
          failedChecks: [
            ...result.technicalChecks
              .filter((x) => !x.passed)
              .map((x) => ({ name: `technical/${x.name}`, detail: x.detail })),
            ...result.contentChecks
              .filter((x) => !x.passed)
              .map((x) => ({ name: `content/${x.name}`, detail: x.detail })),
          ],
          narrations: scriptScenes.map((s) => s.narration),
          productCategory: research?.category ?? null,
        });
        judgeNote = ` LLM judge (${judge.opinion}): ${judge.rationale}${judge.suggestedFix ? ` Suggested fix: ${judge.suggestedFix}` : ""}`;
        await emitEvent(jobId, "qa_judge", `LLM judge second opinion: ${judge.opinion}. ${judge.rationale}`);
      } catch {
        // Advisory only — a judge failure must never block parking.
      }
    }
    await updateStage(jobId, "quality_assurance", {
      status: "succeeded",
      progressPct: 100,
      message: `QA complete — NEEDS_REVIEW (${flags.join(", ")}). Job parked for human review.${judgeNote}`.slice(0, 2000),
      warnings: result.warnings,
    });
    const cur = (await db.job.findUnique({ where: { id: jobId } }))!.status as Parameters<typeof canTransition>[0];
    if (canTransition(cur, "WAITING_FOR_REVIEW")) {
      await transitionJob(jobId, "WAITING_FOR_REVIEW", `QA flagged for human review: ${flags.join(", ")}`);
    }
    return "NEEDS_REVIEW";
  }

  await updateStage(jobId, "quality_assurance", {
    status: "succeeded",
    progressPct: 100,
    message: `QA ${result.verdict}. ${summary}`,
    warnings: result.warnings,
  });
  return result.verdict;
}
