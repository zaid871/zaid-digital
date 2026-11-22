/**
 * Digital ebook tests: mocked text chain -> real HTML/PDF/manifest/zip.
 * PDF assertions run the real fpdf2 bridge (scripts/pdf_bridge.py).
 * Run: npx tsx scripts/test-digital-ebook.ts
 */
import { existsSync, readFileSync } from "fs";
import { DigitalError, generateEbook, type TextGen } from "../src/lib/digital/ebook";

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

const OUT = "/tmp/digital-ebook-test";

const cleanChapter =
  "Pehla kadam hamesha chhota hota hai, aur yahi is chapter ka asal point hai. Jab aap roz thoda waqt dete hain, to natija dheere dheere saaf dikhne lagta hai aur confidence banta hai.\n\n" +
  "Dusri baat, apne kaam ko note karna seekhein. Jo cheez likhi hoti hai, usi ko behtar banaya ja sakta hai. Har hafte apni progress dekho aur ek chhoti galti sudhaaro.";

function makeFake(opts?: { badChapter?: boolean; badOutline?: boolean }): { fn: TextGen; chapterCalls: () => number } {
  let chapters = 0;
  const fn: TextGen = async (prompt: string) => {
    if (prompt.includes("Reply with ONLY a JSON object")) {
      if (opts?.badOutline) return "ye koi JSON nahi hai";
      return JSON.stringify({
        title: "Instagram Ke Pehle 30 Din",
        subtitle: "Naye creators ke liye seedhi saadi guide",
        chapters: [
          { heading: "Shuruaat Kaise Karein", brief: "profile aur pehla setup" },
          { heading: "Content Ka Plan", brief: "roz ka content kaise sochna hai" },
          { heading: "Pehli Reels", brief: "pehli videos banane ka tareeqa" },
          { heading: "Aadat Banana", brief: "lagataar rehne ka system" },
        ],
      });
    }
    chapters++;
    if (opts?.badChapter) return "Ye khaas offer sirf ₹499 me milega, jaldi karo!\n\nDusra paragraph bhi yahi keh raha hai, sirf ₹499 me sab kuch seekh lo.";
    return cleanChapter;
  };
  return { fn, chapterCalls: () => chapters };
}

async function main() {
  // Happy path — full pipeline with the real PDF bridge.
  {
    const fake = makeFake();
    const r = await generateEbook(
      { topic: "Instagram growth basics", chapters: 4, wordsPerChapter: 300 },
      { textGen: fake.fn, outRoot: OUT }
    );
    check("title from outline", r.title === "Instagram Ke Pehle 30 Din");
    check("4 chapters written", r.chapters.length === 4);
    check("word count sane", r.wordCount > 80, String(r.wordCount));
    check("HTML exists", existsSync(r.files.html));
    const html = readFileSync(r.files.html, "utf-8");
    check("HTML carries title + chapter", html.includes("Instagram Ke Pehle 30 Din") && html.includes("Pehli Reels"));
    check("PDF produced by the real bridge", r.files.pdf !== null && existsSync(r.files.pdf));
    if (r.files.pdf) {
      const head = readFileSync(r.files.pdf).subarray(0, 5).toString("latin1");
      check("PDF header is %PDF", head === "%PDF-");
    }
    check("PDF pages >= cover+toc+4 chapters", (r.pdfPages ?? 0) >= 6, String(r.pdfPages));
    check("manifest exists", existsSync(r.files.manifest));
    const manifest = JSON.parse(readFileSync(r.files.manifest, "utf-8")) as { type: string; compliance: string };
    check("manifest type + compliance note", manifest.type === "ebook" && manifest.compliance.includes("passed"));
    check("zip produced", r.files.zip !== null && existsSync(r.files.zip));
  }

  // Compliance: a price-peddling chapter is rejected after one rewrite.
  {
    const fake = makeFake({ badChapter: true });
    let caught: unknown = null;
    try {
      await generateEbook({ topic: "kuch bhi", chapters: 3 }, { textGen: fake.fn, outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "price chapter -> DigitalError compliance_rejected",
      caught instanceof DigitalError && caught.code === "compliance_rejected",
      String(caught)
    );
    check("chapter was retried once before failing", fake.chapterCalls() === 2, String(fake.chapterCalls()));
  }

  // Outline garbage -> typed outline failure.
  {
    const fake = makeFake({ badOutline: true });
    let caught: unknown = null;
    try {
      await generateEbook({ topic: "kuch bhi" }, { textGen: fake.fn, outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "garbage outline -> DigitalError outline_failed",
      caught instanceof DigitalError && caught.code === "outline_failed",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-EBOOK TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
