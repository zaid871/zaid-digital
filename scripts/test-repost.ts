/**
 * Repost-loop analysis tests: baselines, verdicts, hypothesis labels,
 * and eligibility limits. Run: npx tsx scripts/test-repost.ts
 */
import {
  buildHypotheses,
  computeBaseline,
  engagementRate,
  evaluateCandidate,
  median,
  type RepostCandidateInput,
  type RepostMetrics,
} from "../src/lib/publishing/repost";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

const m = (views: number | null, reach: number | null, likes: number | null, comments: number | null): RepostMetrics =>
  ({ views, reach, likes, comments });

// Baseline: 5 posts, median views 1000, median reach 5000
const BASE_POSTS = [
  m(1000, 5000, 100, 10),
  m(1200, 6000, 120, 12),
  m(900, 4500, 90, 9),
  m(1100, 5500, 110, 11),
  m(1000, 5000, 100, 10),
];

const input = (metrics: RepostMetrics, publishedHoursAgo = 50, variantCount = 0, isVariant = false): RepostCandidateInput => ({
  publishRecordId: "rec-1",
  platformMediaId: "media-1",
  publishedAt: new Date(Date.now() - publishedHoursAgo * 3_600_000).toISOString(),
  variantCount,
  isVariant,
  metrics,
});

async function main() {
  check("median odd", median([3, 1, 2]) === 2);
  check("median even", median([4, 1, 3, 2]) === 2.5);
  check("median empty -> null", median([]) === null);

  check("engagement rate", engagementRate(m(null, 1000, 100, 20)) === 0.12);
  check("engagement rate null on missing reach", engagementRate(m(100, null, 10, 2)) === null);
  check("engagement rate null on zero reach", engagementRate(m(100, 0, 10, 2)) === null);

  const baseline = computeBaseline(BASE_POSTS);
  check("baseline medians", baseline.medianViews === 1000 && baseline.medianReach === 5000 && baseline.sampleSize === 5,
    JSON.stringify(baseline));

  // Underperforming: 300 views < 40% of 1000
  {
    const r = evaluateCandidate(input(m(300, 5000, 100, 10)), baseline);
    check("clear underperformer flagged", r.verdict === "underperforming");
    check("underperformer eligible (50h old, no variants)", r.eligible, r.ineligibilityReasons.join(";"));
    check("hypotheses all labeled hypothesis", r.hypotheses.length > 0 && r.hypotheses.every((h) => h.kind === "hypothesis"));
    check("honesty footer present", r.hypotheses.some((h) => h.text.includes("pakki nahi")));
  }
  // OK: 950 views
  {
    const r = evaluateCandidate(input(m(950, 4800, 95, 9)), baseline);
    check("normal post -> ok, no hypotheses", r.verdict === "ok" && r.hypotheses.length === 0 && !r.eligible);
  }
  // No data -> insufficient_data, never flagged
  {
    const r = evaluateCandidate(input(m(null, null, null, null)), baseline);
    check("null metrics -> insufficient_data", r.verdict === "insufficient_data" && !r.eligible);
  }
  // Thin baseline -> insufficient_data
  {
    const thin = computeBaseline(BASE_POSTS.slice(0, 2));
    const r = evaluateCandidate(input(m(10, 100, 1, 0)), thin);
    check("baseline of 2 -> insufficient_data", r.verdict === "insufficient_data", `sample=${thin.sampleSize}`);
  }
  // Hypothesis rules
  {
    const hyps = buildHypotheses(m(300, 1000, 90, 9), baseline); // reach 20% of median, ER normal
    check("low reach + ok engagement -> timing hypothesis", hyps.some((h) => h.text.includes("timing")));
  }
  {
    const hyps = buildHypotheses(m(800, 5000, 10, 1), baseline); // ER ~0.2% vs median ~2.2%
    check("low engagement -> content hypothesis", hyps.some((h) => h.text.includes("caption")));
  }
  {
    const hyps = buildHypotheses(m(200, 4000, 80, 8), baseline); // views 20% of median
    check("very low views -> hook hypothesis", hyps.some((h) => h.text.includes("hook")));
  }
  // Eligibility limits
  {
    const r = evaluateCandidate(input(m(300, 5000, 100, 10), 50, 1), baseline);
    check("existing variant -> ineligible", !r.eligible && r.verdict === "underperforming" &&
      r.ineligibilityReasons.some((x) => x.includes("pehle ban chuka")));
  }
  {
    const r = evaluateCandidate(input(m(300, 5000, 100, 10), 10), baseline);
    check("10h old -> ineligible (48h wait)", !r.eligible &&
      r.ineligibilityReasons.some((x) => x.includes("48 ghante")));
  }
  {
    const r = evaluateCandidate(input(m(300, 5000, 100, 10), 50, 0, true), baseline);
    check("variant itself -> ineligible", !r.eligible &&
      r.ineligibilityReasons.some((x) => x.includes("dobara variant nahi")));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL REPOST TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
