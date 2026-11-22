/**
 * Digital brand-kit tests: logo + palette + typography + guidelines,
 * real PNG preview via ffmpeg/librsvg, manifest + zip.
 * Run: npx tsx scripts/test-digital-brandkit.ts
 */
import { existsSync, readFileSync } from "fs";
import { DigitalError } from "../src/lib/digital/ebook";
import { generateBrandKit } from "../src/lib/digital/brandkit";

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

const OUT = "/tmp/digital-brandkit-test";

async function main() {
  // Happy path — full kit.
  {
    const r = await generateBrandKit(
      {
        brandName: "Zaid Khan",
        tagline: "Seedhi baat, behtareen kaam.",
        niche: "digital marketing",
        brandColor: "#E85A24",
        handle: "@zaidkhan",
        theme: "onyx",
      },
      { outRoot: OUT }
    );
    check("brand name kept", r.brandName === "Zaid Khan");
    check("colors carry brandColor", r.colors.primary === "#E85A24");
    check("logo.svg exists", existsSync(`${r.dir}/logo.svg`));
    const logoSvg = readFileSync(`${r.dir}/logo.svg`, "utf-8");
    check("logo has monogram ZK", logoSvg.includes(">ZK<"));
    check("logo uses brand color", logoSvg.includes("#E85A24"));
    check("logo.png rendered", r.files.logoPng !== null && existsSync(`${r.dir}/logo.png`));
    if (r.files.logoPng) {
      const size = readFileSync(`${r.dir}/logo.png`).length;
      check("logo.png is a real file (>5KB)", size > 5000, String(size));
    }
    check("palette.svg exists", existsSync(`${r.dir}/palette.svg`));
    const palette = readFileSync(`${r.dir}/palette.svg`, "utf-8");
    check("palette shows brand hex", palette.includes("#E85A24"));
    check("palette lists all 5 colours", ["Primary", "Accent", "Background", "Text", "Muted"].every((n) => palette.includes(n)));
    check("typography.svg exists", existsSync(`${r.dir}/typography.svg`));
    const typo = readFileSync(`${r.dir}/typography.svg`, "utf-8");
    check("typography names Poppins", typo.includes("POPPINS"));
    check("typography shows brand name", typo.includes("Zaid Khan"));
    check("guidelines HTML exists", existsSync(`${r.dir}/brand-guidelines.html`));
    const guide = readFileSync(`${r.dir}/brand-guidelines.html`, "utf-8");
    check("guidelines have brand name + hex", guide.includes("Zaid Khan") && guide.includes("#E85A24"));
    check("guidelines have do/don't", guide.includes("Do / Don't") || guide.includes("Do:"));
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as {
      type: string;
      colors: { primary: string };
      fonts: string;
    };
    check("manifest type brand_kit", manifest.type === "brand_kit");
    check("manifest colors + fonts note", manifest.colors.primary === "#E85A24" && manifest.fonts.includes("OFL"));
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Invalid brand color rejected.
  {
    let caught: unknown = null;
    try {
      await generateBrandKit({ brandName: "Test", brandColor: "orange" }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "bad brandColor -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  // Short brand name rejected.
  {
    let caught: unknown = null;
    try {
      await generateBrandKit({ brandName: "X", brandColor: "#E85A24" }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "short brandName -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-BRANDKIT TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
