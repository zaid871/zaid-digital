/**
 * test-social-proof: honest review collector.
 * Run: npx tsx scripts/test-social-proof.ts
 */
process.env.REVIEWS_DIR = "/tmp/reviews-test";

import { rm } from "fs/promises";
import { recordReview, getReviews, reviewSummary } from "../src/lib/marketing/social-proof";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

async function main() {
  await rm("/tmp/reviews-test", { recursive: true, force: true });

  const r1 = await recordReview({ email: "buyer@example.com", product: "Nashta Guide", rating: 5, text: "Bahut kaam ki guide hai." });
  check("review recorded", r1.rating === 5 && r1.verified === false);
  check("unverified without evidence", r1.verified === false);

  const r2 = await recordReview(
    { email: "buyer@example.com", product: "Nashta Guide", rating: 4, text: "Achhi hai." },
    { verifiedEmail: "buyer@example.com" }
  );
  check("verified with evidence", r2.verified === true);

  const r3 = await recordReview(
    { email: "other@example.com", product: "Nashta Guide", rating: 5, text: "Best hai." },
    { verifiedEmail: "buyer@example.com" }
  );
  check("mismatched email not verified", r3.verified === false);

  // disallowed content rejected
  try {
    await recordReview({ email: "x@y.com", product: "P", rating: 5, text: "Sirf ₹499 me #1 best!" });
    check("bad content rejected", false);
  } catch (e) {
    check("bad content rejected", e instanceof DigitalError);
  }
  // bad rating rejected
  try {
    await recordReview({ email: "x@y.com", product: "P", rating: 9, text: "ok fine" });
    check("bad rating rejected", false);
  } catch (e) {
    check("bad rating rejected", e instanceof DigitalError && e.code === "validation_error");
  }

  const list = await getReviews("Nashta Guide");
  check("reviews listed", list.length === 3);
  const sum = await reviewSummary("Nashta Guide");
  check("summary computed", sum.count === 3 && sum.verifiedCount === 1 && sum.avgRating === 4.7, JSON.stringify(sum));
  const empty = await reviewSummary("Koi Product Nahi");
  check("empty summary honest", empty.count === 0 && empty.avgRating === null);

  await rm("/tmp/reviews-test", { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
