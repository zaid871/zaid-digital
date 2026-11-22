/**
 * test-problem-miner-fixmyitch: Fix My Itch source (mocked fetch).
 * Run: npx tsx scripts/test-problem-miner-fixmyitch.ts
 */
import {
  parseFixMyItchHtml,
  scanFixMyItch,
  classifyDigitalFit,
  scoreProblems,
  mineProblems,
  FIX_MY_ITCH_SEED,
} from "../src/lib/discovery/problem-miner";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const SAMPLE_HTML = `
<html><head><title>Fix My Itch</title></head><body>
<h2>TOP 10 PROBLEMS</h2>
<div>Why do freelancers ghost projects after partial payments without accountability systems?</div>
<div>76</div><div>B2B Services</div>
<div>Why can't SMEs negotiate favorable payment terms with large buyers?</div>
<div>82.8</div><div>B2B Services</div>
<div>Why do STEM students face education loan anxiety from unclear costs in 2026?</div>
<div>Career</div>
<div>Why is connecting specialized hardware to laptops still unreliable and frustrating?</div>
<div>Hardware</div>
</body></html>`;

function mockFetch(html: string, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => html,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

async function main() {
  // --- parse ---
  const parsed = parseFixMyItchHtml(SAMPLE_HTML);
  check("parse finds 4 problems", parsed.length === 4, `got ${parsed.length}`);
  check("score parsed", parsed[0].itchScore === 76 && parsed[1].itchScore === 82.8);
  check("category parsed", parsed[0].category === "B2B Services" && parsed[3].category === "Hardware");
  check("no-score problem ok", parsed[2].itchScore === null && parsed[2].category === "Career");

  // --- live scan ---
  const live = await scanFixMyItch(mockFetch(SAMPLE_HTML));
  check("live source label", live.length === 4 && live.every((h) => h.source === "fix-my-itch"));
  check("live itchScore carried", live[1].itchScore === 82.8);

  // --- seed fallback on fetch failure ---
  const seedOnFail = await scanFixMyItch(async () => { throw new Error("network down"); });
  check("seed fallback on failure", seedOnFail.length === FIX_MY_ITCH_SEED.length
    && seedOnFail.every((h) => h.source === "fix-my-itch-seed"), `got ${seedOnFail.length}`);

  // --- seed fallback on empty parse ---
  const seedOnEmpty = await scanFixMyItch(mockFetch("<html><body>no problems here</body></html>"));
  check("seed fallback on empty parse", seedOnEmpty.length === FIX_MY_ITCH_SEED.length
    && seedOnEmpty[0].source === "fix-my-itch-seed");

  // --- digital fit ---
  check("fit template", classifyDigitalFit("Why do freelancers ghost projects after partial payments?") === "template");
  check("fit ebook", classifyDigitalFit("Why do STEM students face education loan anxiety?") === "ebook");
  check("fit both", classifyDigitalFit("Why do freelancers struggle with tax savings and invoice tracking?") === "both");
  check("fit none", classifyDigitalFit("Why can't first time used car buyers verify car histories?") === "none");

  // --- scoring: itch bonus ---
  const cards = scoreProblems([
    { text: "Why can't SMEs negotiate favorable payment terms with large buyers?", niche: "general", source: "fix-my-itch", evidence: "u", engagement: 82.8, comments: 0, itchScore: 82.8 },
    { text: "Why is connecting hardware to laptops unreliable?", niche: "general", source: "fix-my-itch", evidence: "u", engagement: 0, comments: 0 },
  ]);
  check("itch bonus ranks higher", cards[0].itchScore === 82.8 && cards[0].score > cards[1].score, JSON.stringify(cards.map((c) => c.score)));
  check("digitalFit on cards", cards[0].digitalFit === "template" && cards[1].digitalFit === "none");

  // --- mineProblems integration (reddit/suggest mocked empty) ---
  const emptyFetch = (async (url: string) => {
    if (String(url).includes("fix-my-itch")) return { ok: true, status: 200, text: async () => SAMPLE_HTML, json: async () => ({}) };
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: { children: [] } }) };
  }) as unknown as typeof fetch;
  const mined = await mineProblems({ niches: ["freelancing"], includeFixMyItch: true }, emptyFetch);
  check("mine includes itch problems", mined.problems.some((p) => p.source === "fix-my-itch"));
  const minedOff = await mineProblems({ niches: ["freelancing"], includeFixMyItch: false }, emptyFetch);
  check("includeFixMyItch=false excludes", minedOff.problems.every((p) => p.source !== "fix-my-itch"));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
