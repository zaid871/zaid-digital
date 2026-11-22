/**
 * test-pinterest-volume: pin variations + volume publish (mocked).
 * Run: npx tsx scripts/test-pinterest-volume.ts
 */
import { buildPinVariations, publishVolume } from "../src/lib/publishing/pinterest-volume";
import { DigitalError } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const PRODUCT = {
  name: "Steel Tiffin", category: "kitchen",
  link: "https://example.com/tiffin", imageUrl: "https://example.com/img.jpg",
  features: ["leak-proof", "3 compartments"],
};

const MOCK_PINS = JSON.stringify({
  pins: [
    { angle: "outcome", title: "Lunch fresh har din", description: "Leak-proof tiffin jo khana fresh rakhe." },
    { angle: "how-to", title: "Meal prep kaise karein", description: "3 compartments se week plan aasaan." },
    { angle: "outcome", title: "Dusra outcome pin", description: "Duplicate angle — drop hona chahiye." },
    { angle: "price", title: "Sirf ₹499 me", description: "Price wali — drop honi chahiye." },
    { angle: "audience", title: "Office ke liye best", description: "Roz office le jao." },
  ],
});

async function main() {
  const { pins, warnings } = await buildPinVariations(PRODUCT, 5, async () => MOCK_PINS);
  check("distinct angles kept", pins.length === 3, `got ${pins.length}`);
  check("duplicate angle dropped", !pins.some((p) => p.title === "Dusra outcome pin"));
  check("price pin dropped", !pins.some((p) => p.angle === "price"));
  check("warnings recorded", warnings.length === 2, JSON.stringify(warnings));

  // count clamping
  const { pins: many } = await buildPinVariations(PRODUCT, 50, async () => JSON.stringify({ pins: [] }));
  check("count clamps gracefully", many.length === 0);

  // garbage → hard error
  try {
    await buildPinVariations(PRODUCT, 5, async () => "not json");
    check("garbage hard-errors", false);
  } catch (e) {
    check("garbage hard-errors", e instanceof DigitalError && e.code === "generation_failed");
  }

  // publishVolume with mocked createImagePin via fetchFn — needs token; use missing-token path
  delete process.env.PINTEREST_ACCESS_TOKEN;
  const results = await publishVolume(PRODUCT, pins.slice(0, 2), { boardId: "b1" });
  check("per-pin results, never throws", results.length === 2 && results.every((r) => r.status === "failed"));
  check("failure reason surfaced", !!results[0].error);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
