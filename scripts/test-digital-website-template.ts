/**
 * Digital website-template tests: 3 static pages + nav + manifest + zip,
 * plus the disable switch (off by default, on with the env flag).
 * No LLM calls — useAi: false with supplied copy.
 * Run: npx tsx scripts/test-digital-website-template.ts
 */
import { existsSync, readFileSync } from "fs";
import { DigitalError } from "../src/lib/digital/ebook";
import { generateWebsiteTemplate, isWebsiteTemplateEnabled } from "../src/lib/digital/website-template";

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

const OUT = "/tmp/digital-website-template-test";

async function main() {
  // Disable switch: off by default.
  {
    const saved = process.env.WEBSITE_TEMPLATES_ENABLED;
    delete process.env.WEBSITE_TEMPLATES_ENABLED;
    check("disabled by default (env unset)", isWebsiteTemplateEnabled() === false);
    process.env.WEBSITE_TEMPLATES_ENABLED = "true";
    check("enabled with env flag", isWebsiteTemplateEnabled() === true);
    process.env.WEBSITE_TEMPLATES_ENABLED = "false";
    check("env 'false' stays disabled", isWebsiteTemplateEnabled() === false);
    if (saved === undefined) delete process.env.WEBSITE_TEMPLATES_ENABLED;
    else process.env.WEBSITE_TEMPLATES_ENABLED = saved;
  }

  // Happy path — generator works (the switch gates the route, not the lib).
  {
    const r = await generateWebsiteTemplate(
      {
        businessName: "Zaid Digital",
        topic: "digital planners",
        tagline: "Seedhi baat, behtareen planners.",
        features: ["Daily pages", "Weekly review", "Habit tracker"],
        ctaText: "Shuru karein",
        theme: "dark",
        useAi: false,
      },
      { outRoot: OUT }
    );
    check("business name kept", r.businessName === "Zaid Digital");
    for (const page of ["index.html", "about.html", "contact.html"]) {
      check(`${page} exists`, existsSync(`${r.dir}/${page}`));
      const html = readFileSync(`${r.dir}/${page}`, "utf-8");
      check(`${page} has nav to all 3 pages`, html.includes("index.html") && html.includes("about.html") && html.includes("contact.html"));
      check(`${page} has business name`, html.includes("Zaid Digital"));
    }
    const index = readFileSync(`${r.dir}/index.html`, "utf-8");
    check("index has tagline + CTA", index.includes("Seedhi baat, behtareen planners.") && index.includes("Shuru karein"));
    const about = readFileSync(`${r.dir}/about.html`, "utf-8");
    check("about lists features", about.includes("Daily pages") && about.includes("Habit tracker"));
    const contact = readFileSync(`${r.dir}/contact.html`, "utf-8");
    check("contact has a form", contact.includes("<form") && contact.includes('name="email"'));
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as { type: string; pages: string[] };
    check("manifest type website_template", manifest.type === "website_template");
    check("manifest lists 3 pages", manifest.pages.length === 3);
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Short business name rejected.
  {
    let caught: unknown = null;
    try {
      await generateWebsiteTemplate({ businessName: "X" }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "short businessName -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-WEBSITE-TEMPLATE TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
