/**
 * test-digital-ebook-styles: writingStyle (standard/kadnar/saqlain)
 * reaches the outline + chapter prompts and lands in the manifest.
 * Uses a capturing stub TextGen — no live providers, no network.
 * Run: npx tsx scripts/test-digital-ebook-styles.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { generateEbook, writingStyleNotes, type TextGen } from "../src/lib/digital/ebook";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const OUT = "/tmp/digital-ebook-styles-test";

const cleanChapter =
  "Pehla kadam hamesha chhota hota hai, aur yahi is chapter ka asal point hai. Jab aap roz thoda waqt dete hain, to natija dheere dheere saaf dikhne lagta hai aur confidence banta hai.\n\n" +
  "Dusri baat, apne kaam ko note karna seekhein. Jo cheez likhi hoti hai, usi ko behtar banaya ja sakta hai. Har hafte apni progress dekho aur ek chhoti galti sudhaaro.";

function makeCapturingFake(): { fn: TextGen; prompts: string[] } {
  const prompts: string[] = [];
  const fn: TextGen = async (prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes("Reply with ONLY a JSON object")) {
      return JSON.stringify({
        title: "Paise Ki Samajh",
        subtitle: "Seedhi saadi guide",
        chapters: [
          { heading: "Shuruaat", brief: "pehla kadam" },
          { heading: "Beech Ka Raasta", brief: "aage kaise badhein" },
          { heading: "Manzil", brief: "aakhir mein kya karna hai" },
        ],
      });
    }
    return cleanChapter;
  };
  return { fn, prompts };
}

async function main() {
  // --- Unit: the style notes themselves ---
  const std = writingStyleNotes("standard");
  check("standard style adds nothing", std.outline === "" && std.chapter === "", JSON.stringify(std));

  const kad = writingStyleNotes("kadnar");
  check("kadnar outline: three parts", kad.outline.includes("three parts"), kad.outline);
  check("kadnar chapter: one analogy per idea", kad.chapter.includes("ONE vivid everyday analogy"), kad.chapter);
  check("kadnar chapter: no invented personal stories",
    kad.chapter.includes("Do NOT invent personal stories"), kad.chapter);

  const saq = writingStyleNotes("saqlain");
  check("saqlain outline: documentary arc", saq.outline.includes("documentary arc"), saq.outline);
  check("saqlain chapter: never invent statistics",
    saq.chapter.includes("NEVER invent statistics"), saq.chapter);

  // --- Integration: style reaches the prompts + manifest ---
  for (const style of ["kadnar", "saqlain", "standard"] as const) {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const fake = makeCapturingFake();
    const r = await generateEbook(
      { topic: "Paise ki samajh", chapters: 3, wordsPerChapter: 300, writingStyle: style },
      { textGen: fake.fn, outRoot: OUT }
    );
    const outlinePrompt = fake.prompts.find((p) => p.includes("Reply with ONLY a JSON object")) ?? "";
    const chapterPrompts = fake.prompts.filter((p) => !p.includes("Reply with ONLY a JSON object"));
    const marker = style === "kadnar" ? "practical explainer" : style === "saqlain" ? "documentary narrative" : "";
    if (marker) {
      check(`${style}: outline prompt carries style`, outlinePrompt.includes(marker), outlinePrompt.slice(0, 120));
      check(`${style}: chapter prompts carry style`,
        chapterPrompts.length === 3 && chapterPrompts.every((p) => p.includes(marker)),
        `chapter prompts: ${chapterPrompts.length}`);
    } else {
      check("standard: outline prompt has no style marker",
        !outlinePrompt.includes("WRITING STYLE"), outlinePrompt.slice(0, 120));
      check("standard: chapter prompts have no style marker",
        chapterPrompts.every((p) => !p.includes("WRITING STYLE")), `chapter prompts: ${chapterPrompts.length}`);
    }
    check(`${style}: 3 chapters written`, r.chapters.length === 3, String(r.chapters.length));
    const manifestPath = join(r.dir, "manifest.json");
    check(`${style}: manifest exists`, existsSync(manifestPath), manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { writingStyle?: string };
    check(`${style}: manifest records writingStyle`, manifest.writingStyle === style, String(manifest.writingStyle));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
