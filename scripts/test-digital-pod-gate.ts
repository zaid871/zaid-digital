/**
 * test-digital-pod-gate: design-check lever (lever 2) backend checks.
 *
 * Covers the parts that need no network:
 *  - assertSafeSlug: accepts safe slugs, rejects traversal/uppercase/empty.
 *  - publishPodDraftFromSlug: rejects bad slugs and unknown slugs with
 *    validation_error (never touches Printify).
 *
 * Run: npx tsx scripts/test-digital-pod-gate.ts
 */
import { assertSafeSlug, publishPodDraftFromSlug, DigitalError } from "../src/lib/digital/pod";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => unknown, expectThrow?: string) {
  return (async () => {
    try {
      await fn();
      if (expectThrow) {
        fail++;
        console.log(`FAIL ${name}: expected throw ${expectThrow}, got success`);
      } else {
        pass++;
        console.log(`ok   ${name}`);
      }
    } catch (e) {
      const code = e instanceof DigitalError ? e.code : `non-digital:${String(e).slice(0, 40)}`;
      if (expectThrow && code === expectThrow) {
        pass++;
        console.log(`ok   ${name} (threw ${code})`);
      } else {
        fail++;
        console.log(`FAIL ${name}: threw ${code}, expected ${expectThrow ?? "success"}`);
      }
    }
  })();
}

async function main() {
  const good = ["my-tee-123", "a", "x".repeat(120)];
  for (const s of good) await check(`safe slug ok: ${s.slice(0, 12)}`, () => assertSafeSlug(s));

  const bad = ["../etc", "..\\win", "AB", "", "a b", "a_b", "a/b", "x".repeat(121), ".hidden"];
  for (const s of bad) await check(`unsafe slug rejected: ${JSON.stringify(s).slice(0, 20)}`, () => assertSafeSlug(s), "validation_error");

  // publish path: bad slug -> validation_error (no network touched)
  await check("publish rejects traversal slug", () => publishPodDraftFromSlug("../../etc"), "validation_error");
  // unknown slug -> validation_error (manifest missing), no Printify call
  await check("publish rejects unknown slug", () => publishPodDraftFromSlug("no-such-design-zzz"), "validation_error");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
