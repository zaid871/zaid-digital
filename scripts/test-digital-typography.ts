/**
 * Digital typography-kit tests: specimen sheets + pairing guide + manifest.
 * No LLM calls — specimens are deterministic SVG.
 * Run: npx tsx scripts/test-digital-typography.ts
 */
import { existsSync, readFileSync } from "fs";
import { DigitalError } from "../src/lib/digital/ebook";
import { generateTypographyKit } from "../src/lib/digital/typography";

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

const OUT = "/tmp/digital-typography-test";

async function main() {
  // Happy path — all three pairings.
  {
    const r = await generateTypographyKit(
      { kitName: "Bold Display Kit", brandColor: "#E85A24", theme: "onyx" },
      { outRoot: OUT }
    );
    check("kit name kept", r.kitName === "Bold Display Kit");
    check("all 3 pairings included", r.pairings.length === 3);
    for (const id of ["anton_poppins", "fraunces_poppins", "poppins_poppins"]) {
      const file = `specimen-${id}.svg`;
      check(`specimen ${id} exists`, existsSync(`${r.dir}/${file}`));
      const svg = readFileSync(`${r.dir}/${file}`, "utf-8");
      check(`specimen ${id} has pairing name`, svg.includes("Anton") || svg.includes("Fraunces") || svg.includes("Poppins"));
      check(`specimen ${id} has size scale`, svg.includes("Display 96"));
    }
    const anton = readFileSync(`${r.dir}/specimen-anton_poppins.svg`, "utf-8");
    check("anton specimen uses real fontconfig family", anton.includes("CVE anton-400"));
    check("anton specimen has sample headline", anton.includes("BIG SALE"));
    const fraunces = readFileSync(`${r.dir}/specimen-fraunces_poppins.svg`, "utf-8");
    check("fraunces specimen uses real fontconfig family", fraunces.includes("CVE fraunces-700"));
    check("guide HTML exists", existsSync(`${r.dir}/pairing-guide.html`));
    const guide = readFileSync(`${r.dir}/pairing-guide.html`, "utf-8");
    check("guide lists all pairings", ["Anton + Poppins", "Fraunces + Poppins", "Poppins + Poppins"].every((n) => guide.includes(n)));
    check("guide has do/don't", guide.includes("Do / Don't"));
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as {
      type: string;
      fonts: string;
    };
    check("manifest type typography_kit", manifest.type === "typography_kit");
    check("manifest says font files NOT included", manifest.fonts.includes("NOT included") || manifest.fonts.includes("included NAHI"));
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Single-pairing kit.
  {
    const r = await generateTypographyKit(
      { kitName: "Serif Only", pairings: ["fraunces_poppins"] },
      { outRoot: OUT }
    );
    check("single pairing kit has 1 specimen", r.pairings.length === 1 && r.files.specimens.length === 1);
    check("single pairing is fraunces", r.pairings[0] === "fraunces_poppins");
  }

  // Short kit name rejected.
  {
    let caught: unknown = null;
    try {
      await generateTypographyKit({ kitName: "X" }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "short kitName -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-TYPOGRAPHY TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
