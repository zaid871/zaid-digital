/**
 * Digital template-pack tests: deterministic SVG designs, real PNG
 * previews via ffmpeg/librsvg, AI-copy + fallback paths, packaging.
 * Run: npx tsx scripts/test-digital-templates.ts
 */
import { existsSync, readFileSync } from "fs";
import { buildSvg, generateTemplatePack, TEMPLATE_THEMES } from "../src/lib/digital/templates";
import type { TextGen } from "../src/lib/digital/ebook";

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

const OUT = "/tmp/digital-templates-test";

async function main() {
  // SVG builder: escaping + structure.
  {
    const svg = buildSvg(
      { kind: "quote", headline: "Tom & Jerry <3", body: "seedhi baat" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("SVG escapes XML specials", svg.includes("Tom &amp; Jerry &lt;3"));
    check("SVG has portrait viewBox", svg.includes('viewBox="0 0 1080 1350"'));
    check("SVG carries kind label + footer", svg.includes("QUOTE") && svg.includes("@test"));
  }

  // Pack with built-in copy bank (no textGen).
  {
    const r = await generateTemplatePack(
      { niche: "fitness coaching", count: 6, size: "portrait" },
      { outRoot: OUT }
    );
    check("6 designs generated", r.designs.length === 6);
    check(
      "kinds cycle covers quote + tips + checklist",
      ["quote", "tips", "checklist"].every((k) => r.designs.some((d) => d.kind === k))
    );
    check("all SVG files on disk", r.designs.every((d) => existsSync(`${r.dir}/${d.svgFile}`)));
    const pngs = r.designs.filter((d) => d.pngFile && existsSync(`${r.dir}/${d.pngFile}`));
    check("PNG previews rendered (librsvg)", pngs.length === 6, `${pngs.length}/6`);
    if (pngs.length > 0) {
      const size = readFileSync(`${r.dir}/${pngs[0].pngFile}`).length;
      check("PNG preview is a real file (>5KB)", size > 5000, String(size));
    }
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as {
      type: string;
      deliveryNotes: string[];
    };
    check("manifest type template_pack", manifest.type === "template_pack");
    check(
      "delivery notes honestly mention Canva plan rules",
      manifest.deliveryNotes.some((n) => n.includes("Canva") && n.includes("plan rules"))
    );
    check("preview HTML exists", existsSync(r.files.previewHtml));
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Premium expansion: 8 kinds cycle + forest/wine themes + footer rule.
  {
    const r = await generateTemplatePack(
      { niche: "study tips", count: 8, size: "portrait", theme: "forest", handle: "@test" },
      { outRoot: OUT }
    );
    check(
      "8 kinds cycle covers sale + event + testimonial",
      ["sale", "event", "testimonial"].every((k) => r.designs.some((d) => d.kind === k)),
      r.designs.map((d) => d.kind).join(",")
    );
    check(
      "sale design carries SALE label",
      r.designs.some((d) => d.kind === "sale" && d.svg.includes("SALE"))
    );
    check(
      "forest theme accent in SVG",
      r.designs.every((d) => d.svg.includes("#E8B84B"))
    );
    check(
      "footer accent rule present",
      r.designs.every((d) => d.svg.includes('height="5"'))
    );
    const w = await generateTemplatePack(
      { niche: "study tips", count: 4, size: "square", theme: "wine" },
      { outRoot: OUT }
    );
    check(
      "wine theme accent in SVG",
      w.designs.every((d) => d.svg.includes("#E87A90"))
    );
  }

  // Canva elements expansion: chart + table kinds, shape motifs, frame.
  {
    const chartSvg = buildSvg(
      { kind: "chart", headline: "Progress", body: "Sample data" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test",
      { chartData: [{ label: "Jan", value: 40 }, { label: "Feb", value: 80 }] }
    );
    check("chart SVG has NUMBERS label", chartSvg.includes("NUMBERS"));
    check("chart SVG draws bars with values", chartSvg.includes(">80<") && chartSvg.includes("Jan") && chartSvg.includes("Feb"));
    const tableSvg = buildSvg(
      { kind: "table", headline: "Plan", body: "Sample rows" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test",
      { tableData: [{ label: "Morning", value: "Revision" }] }
    );
    check("table SVG has PLAN label", tableSvg.includes("PLAN"));
    check("table SVG draws label + value rows", tableSvg.includes("Morning") && tableSvg.includes("Revision"));
    const star = buildSvg({ kind: "testimonial", headline: "Review", body: "Great" }, "portrait", TEMPLATE_THEMES.dark, "@test");
    check("testimonial motif is a star polygon", star.includes("<polygon"));
    const checkSvg = buildSvg({ kind: "checklist", headline: "List", body: "Do it" }, "portrait", TEMPLATE_THEMES.dark, "@test");
    check("checklist motif is a check polyline", checkSvg.includes("<polyline"));
    const framed = buildSvg({ kind: "quote", headline: "Hi", body: "Hello" }, "portrait", TEMPLATE_THEMES.dark, "@test", { frame: true });
    check("frame draws white inset border", framed.includes('stroke="#FFFFFF"'));
    // 10 kinds cycle: chart + table appear in a count-10 pack.
    const r10 = await generateTemplatePack({ niche: "study tips", count: 10 }, { outRoot: OUT });
    check(
      "10 kinds cycle covers chart + table",
      ["chart", "table"].every((k) => r10.designs.some((d) => d.kind === k)),
      r10.designs.map((d) => d.kind).join(",")
    );
  }

  // Photo background (stub image — no network): embedded in SVG + PNG preview.
  {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const r = await generateTemplatePack(
      { niche: "travel", count: 4, size: "square", photoBackground: true, frame: true },
      { outRoot: OUT, imageGen: async () => tinyPng }
    );
    check(
      "photo SVG embeds data URI",
      r.designs.every((d) => d.svg.includes("data:image/png;base64,"))
    );
    check("background file saved in pack", existsSync(`${r.dir}/background.png`));
    const pngs = r.designs.filter((d) => d.pngFile && existsSync(`${r.dir}/${d.pngFile}`));
    check("photo PNG previews rendered", pngs.length === 4, `${pngs.length}/4`);
    check("no photo failure warning with stub image", !r.warnings.some((w) => w.includes("photo_background_failed")));
  }

  // AI copy path: headlines come from the model output.
  {
    const kindsOrder = ["quote", "tips", "announcement", "checklist"];
    const aiGen: TextGen = async () =>
      JSON.stringify(
        kindsOrder.map((kind) => ({ kind, headline: `AI headline ${kind}`, body: "AI body line hai ye" }))
      );
    const r = await generateTemplatePack(
      { niche: "study tips", count: 4 },
      { outRoot: OUT, textGen: aiGen }
    );
    check(
      "AI headlines used",
      r.designs.every((d) => d.headline.startsWith("AI headline")),
      r.designs.map((d) => d.headline).join(" | ")
    );
    check("no fallback warning when AI works", !r.warnings.some((w) => w.includes("ai_copy_fallback")));
  }

  // Broken AI -> bank fallback + warning.
  {
    const badGen: TextGen = async () => "bilkul garbage, JSON nahi";
    const r = await generateTemplatePack(
      { niche: "study tips", count: 4 },
      { outRoot: OUT, textGen: badGen }
    );
    check("broken AI falls back to bank copy", r.designs.length === 4 && r.designs[0].headline.length > 0);
    check("fallback warning recorded", r.warnings.some((w) => w.includes("ai_copy_fallback")));
  }

  // Premium typography: Poppins (OFL) first, DejaVu fallback.
  {
    const svg = buildSvg(
      { kind: "quote", headline: "Test headline", body: "Body line" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("SVG uses Poppins with DejaVu fallback", svg.includes('font-family="Poppins, DejaVu Sans, sans-serif"'));
  }

  // Logo kind: centered monogram + wordmark, any size.
  {
    const svg = buildSvg(
      { kind: "logo", headline: "Fit Zaid", body: "Aapki pehchan, ek nishan." },
      "square",
      TEMPLATE_THEMES.dark,
      "@fitzaid"
    );
    check("logo has monogram FZ", svg.includes(">FZ<"));
    check("logo is centered (text-anchor middle)", svg.includes('text-anchor="middle"'));
    check("logo carries brand name", svg.includes("Fit Zaid"));
    const cardLogo = buildSvg(
      { kind: "logo", headline: "Fit Zaid", body: "Tagline here" },
      "card",
      TEMPLATE_THEMES.dark,
      "@fitzaid"
    );
    check("logo works at card size", cardLogo.includes('viewBox="0 0 1050 600"') && cardLogo.includes(">FZ<"));
  }

  // Business-card size: 1050x600, compact layout, chart/table rotate out.
  {
    const svg = buildSvg(
      { kind: "quote", headline: "Short headline here", body: "Body line here" },
      "card",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("card size viewBox 1050x600", svg.includes('viewBox="0 0 1050 600"'));
    const r = await generateTemplatePack(
      { niche: "fitness coaching", count: 11, size: "card" },
      { outRoot: OUT }
    );
    check("card pack has 11 designs", r.designs.length === 11, `got ${r.designs.length}`);
    check("card pack has no chart/table/planner_page/resume/onboarding", r.designs.every((d) => d.kind !== "chart" && d.kind !== "table" && d.kind !== "planner_page" && d.kind !== "resume" && d.kind !== "onboarding"));
    check("card pack has a logo design", r.designs.some((d) => d.kind === "logo"));
    check("card PNG previews exist", r.designs.every((d) => d.pngFile !== null), r.designs.map((d) => d.pngFile).join(","));
  }

  // Chart/table at card size stay valid when called directly (clamped).
  {
    const chartSvg = buildSvg(
      { kind: "chart", headline: "Numbers", body: "Sample" },
      "card",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("chart@card has no negative heights", !/height="-\d/.test(chartSvg) && !/y="-\d/.test(chartSvg));
    const tableSvg = buildSvg(
      { kind: "table", headline: "Plan", body: "Sample" },
      "card",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("table@card has no negative heights", !/height="-\d/.test(tableSvg) && !/y="-\d/.test(tableSvg));
  }

  // New kinds (2026-11-12): wedding_invite, planner_page, svg_cut.
  {
    const inviteSvg = buildSvg(
      { kind: "wedding_invite", headline: "Aisha & Rohan", body: "Shaadi ki tareekh aur jagah yahan likho" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("wedding_invite SVG has SHADI label", inviteSvg.includes("SHADI"));
    check(
      "wedding_invite motif is two rings",
      (inviteSvg.match(/r="16"/g) ?? []).length >= 2
    );
    const plannerSvg = buildSvg(
      { kind: "planner_page", headline: "Hafte ka plan", body: "Sample time-blocks" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test",
      { tableData: [{ label: "Morning", value: "Revision" }] }
    );
    check("planner_page SVG has PLANNER label", plannerSvg.includes("PLANNER"));
    check("planner_page draws time-block rows", plannerSvg.includes("Morning") && plannerSvg.includes("Revision"));
    const cutSvg = buildSvg(
      { kind: "svg_cut", headline: "Cut-ready design", body: "SVG + PNG" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("svg_cut SVG has SVG CUT label", cutSvg.includes("SVG CUT"));
    check(
      "svg_cut motif has scissors circles",
      (cutSvg.match(/r="7"/g) ?? []).length >= 2
    );
    // kinds filter: a wedding-only pack is all wedding invites.
    const w = await generateTemplatePack(
      { niche: "wedding", count: 4, kinds: ["wedding_invite"] },
      { outRoot: OUT }
    );
    check("kinds filter: wedding-only pack", w.designs.length === 4 && w.designs.every((d) => d.kind === "wedding_invite"));
    // kinds filter + card size: chart-only at card falls back, never empty.
    const c = await generateTemplatePack(
      { niche: "study tips", count: 4, size: "card", kinds: ["chart"] },
      { outRoot: OUT }
    );
    check("kinds filter at card falls back (no chart)", c.designs.length === 4 && c.designs.every((d) => d.kind !== "chart"));
    // 14-kind rotation covers all three new kinds.
    const r14 = await generateTemplatePack({ niche: "wedding", count: 14 }, { outRoot: OUT });
    check(
      "14-kind cycle covers wedding_invite + planner_page + svg_cut",
      ["wedding_invite", "planner_page", "svg_cut"].every((k) => r14.designs.some((d) => d.kind === k)),
      r14.designs.map((d) => d.kind).join(",")
    );
    // planner_page at card size stays valid when called directly (clamped).
    const plannerCard = buildSvg(
      { kind: "planner_page", headline: "Plan", body: "Sample" },
      "card",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("planner_page@card has no negative heights", !/height="-\d/.test(plannerCard) && !/y="-\d/.test(plannerCard));
  }

  // New kinds (2026-11-12 night): resume, onboarding, wall_art + poster size.
  {
    const resumeSvg = buildSvg(
      { kind: "resume", headline: "Ayesha Khan", body: "Digital Marketer" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test",
      {
        resumeData: {
          name: "Ayesha Khan",
          title: "Digital Marketer",
          contact: "a@test.com",
          sections: [{ heading: "Experience", lines: ["Senior Marketer, Bright Agency"] }],
        },
      }
    );
    check("resume SVG has RESUME label", resumeSvg.includes("RESUME"));
    check("resume SVG has name + section", resumeSvg.includes("Ayesha Khan") && resumeSvg.includes("EXPERIENCE"));
    check("resume SVG has contact line", resumeSvg.includes("a@test.com"));
    const resumeCard = buildSvg(
      { kind: "resume", headline: "Ayesha Khan", body: "Digital Marketer" },
      "card",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("resume@card has no negative heights", !/height="-\d/.test(resumeCard) && !/y="-\d/.test(resumeCard));
    const onSvg = buildSvg(
      { kind: "onboarding", headline: "Client onboarding", body: "5 steps" },
      "portrait",
      TEMPLATE_THEMES.dark,
      "@test",
      { steps: ["Inquiry", "Discovery call", "Proposal"] }
    );
    check("onboarding SVG has ONBOARDING label", onSvg.includes("ONBOARDING"));
    check(
      "onboarding SVG numbers 3 steps",
      onSvg.includes(">1<") && onSvg.includes(">2<") && onSvg.includes(">3<") && onSvg.includes("Discovery call")
    );
    const wallSvg = buildSvg(
      { kind: "wall_art", headline: "Shanti", body: "Art print" },
      "poster",
      TEMPLATE_THEMES.dark,
      "@test"
    );
    check("wall_art poster viewBox 2400x3000", wallSvg.includes('viewBox="0 0 2400 3000"'));
    check("wall_art SVG has caption", wallSvg.includes("Shanti"));
    // 17-kind rotation covers all three new kinds.
    const r17 = await generateTemplatePack({ niche: "business", count: 17 }, { outRoot: OUT });
    check(
      "17-kind cycle covers resume + onboarding + wall_art",
      ["resume", "onboarding", "wall_art"].every((k) => r17.designs.some((d) => d.kind === k)),
      r17.designs.map((d) => d.kind).join(",")
    );
    // Poster size forces wall_art (print resolution, 2400x3000 PNG).
    const p = await generateTemplatePack({ niche: "home decor", count: 4, size: "poster" }, { outRoot: OUT });
    check("poster pack is all wall_art", p.designs.length === 4 && p.designs.every((d) => d.kind === "wall_art"));
    const posterPng = p.designs.find((d) => d.pngFile && existsSync(`${p.dir}/${d.pngFile}`));
    check("poster PNG preview rendered", posterPng !== undefined);
    if (posterPng?.pngFile) {
      const buf = readFileSync(`${p.dir}/${posterPng.pngFile}`);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      check("poster PNG is 2400x3000 (300dpi @8x10in)", w === 2400 && h === 3000, `${w}x${h}`);
    }
    // kinds filter: resume-only pack.
    const res = await generateTemplatePack(
      { niche: "career", count: 4, kinds: ["resume"] },
      { outRoot: OUT }
    );
    check("kinds filter: resume-only pack", res.designs.length === 4 && res.designs.every((d) => d.kind === "resume"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-TEMPLATE TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
