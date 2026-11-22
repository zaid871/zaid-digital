/**
 * Digital docs tests: supplied structured content -> real DOCX / PPTX /
 * EPUB / XLSX files via scripts/docs_bridge.py, then reopened with the
 * real Python libs to prove the files are valid and carry the content.
 * No LLM calls in these tests — content is supplied, like the hub does.
 * Run: npx tsx scripts/test-digital-docs.ts
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { DigitalError } from "../src/lib/digital/ebook";
import {
  generateDocx,
  generateDocxFromEbook,
  generateEpub,
  generatePptx,
  generateSpreadsheet,
} from "../src/lib/digital/docs";

const execFileAsync = promisify(execFile);

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

const OUT = "/tmp/digital-docs-test";

async function pyCheck(name: string, code: string, file: string) {
  try {
    await execFileAsync("python3", ["-c", code, file], { timeout: 60_000 });
    check(name, true);
  } catch (err) {
    check(name, false, err instanceof Error ? err.message.slice(0, 200) : String(err));
  }
}

function isZip(path: string): boolean {
  const head = readFileSync(path).subarray(0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

const sections = [
  {
    heading: "Pehla Step",
    paragraphs: [
      "Chhota shuru karo aur roz thoda waqt do. Jo kaam likha hota hai, usi ko behtar banaya ja sakta hai.",
      "Har hafte apni progress dekho aur ek chhoti galti sudhaaro.",
    ],
    bullets: ["Roz 20 minute", "Ek page likho"],
  },
  {
    heading: "Dusra Step",
    paragraphs: ["Seekhne ka tareeqa simple rakho. Ek cheez seekho, usko istemal karo, phir agli par jao."],
    bullets: ["Seekho", "Istemaal karo"],
  },
];

async function main() {
  // 1. DOCX — real file, reopened with python-docx.
  {
    const r = await generateDocx(
      { title: "Test Guide", subtitle: "Seedhi saadi guide", author: "Test", sections },
      { outRoot: OUT }
    );
    check("docx file exists", r.file !== null && existsSync(r.file));
    check("docx is a zip container (PK)", r.file !== null && isZip(r.file));
    check("docx manifest type", existsSync(r.files.manifest));
    check("docx zip produced", r.files.zip !== null && existsSync(r.files.zip));
    if (r.file) {
      await pyCheck(
        "docx reopens and carries title + heading",
        "import sys; from docx import Document; d=Document(sys.argv[1]); t='\\n'.join(p.text for p in d.paragraphs); assert 'Test Guide' in t and 'Pehla Step' in t, t; print('ok')",
        r.file
      );
    }
  }

  // 2. PPTX — title slide + 2 content slides, reopened with python-pptx.
  {
    const r = await generatePptx(
      {
        title: "Test Deck",
        subtitle: "Do slide",
        slides: [
          { title: "Slide Ek", bullets: ["Pehli baat", "Dusri baat"], notes: "Bolne ke liye note" },
          { title: "Slide Do", bullets: ["Aakhri baat"] },
        ],
      },
      { outRoot: OUT }
    );
    check("pptx file exists", r.file !== null && existsSync(r.file));
    check("pptx is a zip container (PK)", r.file !== null && isZip(r.file));
    check("pptx count is 3 slides (title + 2)", r.count === 3, String(r.count));
    if (r.file) {
      await pyCheck(
        "pptx reopens with 3 slides and correct titles",
        "import sys; from pptx import Presentation; p=Presentation(sys.argv[1]); assert len(p.slides)==3, len(p.slides); assert p.slides[1].shapes.title.text=='Slide Ek'; assert p.slides[2].shapes.title.text=='Slide Do'; print('ok')",
        r.file
      );
    }
  }

  // 3. EPUB — reflowable book, reopened with EbookLib.
  {
    const r = await generateEpub(
      {
        title: "Test Guide",
        author: "Test",
        chapters: sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs })),
      },
      { outRoot: OUT }
    );
    check("epub file exists", r.file !== null && existsSync(r.file));
    check("epub is a zip container (PK)", r.file !== null && isZip(r.file));
    if (r.file) {
      await pyCheck(
        "epub reopens with title + 2 chapters",
        "import sys; from ebooklib import epub; b=epub.read_epub(sys.argv[1]); items=[i for i in b.get_items() if i.get_type()==9]; assert b.title=='Test Guide'; assert len(items)>=2, len(items); print('ok')",
        r.file
      );
    }
  }

  // 4. XLSX — numbers stay numeric, reopened with openpyxl.
  {
    const r = await generateSpreadsheet(
      {
        title: "Hafte Ka Plan",
        sheets: [
          {
            name: "Plan",
            headers: ["Kaam", "Ghante"],
            rows: [
              ["Likho", 10],
              ["Seekho", 20],
              ["Dohrano", 20],
            ],
          },
        ],
      },
      { outRoot: OUT }
    );
    check("xlsx file exists", r.file !== null && existsSync(r.file));
    check("xlsx is a zip container (PK)", r.file !== null && isZip(r.file));
    if (r.file) {
      await pyCheck(
        "xlsx reopens, headers + numeric cells intact (10+20=30)",
        "import sys; from openpyxl import load_workbook; wb=load_workbook(sys.argv[1]); ws=wb['Plan']; assert ws['A2'].value=='Kaam'; assert ws['B3'].value==10 and isinstance(ws['B3'].value,(int,float)); assert ws['B3'].value+ws['B4'].value==30; print('ok')",
        r.file
      );
    }
  }

  // 5. DOCX from ebook chapters — same chapters, no re-generation.
  {
    const r = await generateDocxFromEbook(
      "Test Guide",
      "Seedhi saadi guide",
      "Test",
      sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs })),
      { outRoot: OUT }
    );
    check("docx-from-ebook file exists", r.file !== null && existsSync(r.file));
    check("docx-from-ebook has 2 sections", r.count === 2, String(r.count));
  }

  // 6. Compliance: price text is rejected, no file shipped.
  {
    let caught: unknown = null;
    try {
      await generateDocx(
        {
          title: "Test Guide",
          sections: [{ heading: "Offer", paragraphs: ["Ye khaas offer sirf 499 me milega, jaldi karo!"] }],
        },
        { outRoot: OUT }
      );
    } catch (err) {
      caught = err;
    }
    check(
      "price text -> DigitalError compliance_rejected",
      caught instanceof DigitalError && caught.code === "compliance_rejected",
      String(caught)
    );
  }

  // 7. Validation: no sections -> typed validation error.
  {
    let caught: unknown = null;
    try {
      await generatePptx({ title: "Khaali Deck", slides: [] }, { outRoot: OUT });
    } catch (err) {
      caught = err;
    }
    check(
      "empty slides -> DigitalError validation_error",
      caught instanceof DigitalError && caught.code === "validation_error",
      String(caught)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DIGITAL-DOCS TESTS PASSED");
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
