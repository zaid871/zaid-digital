/**
 * POD t-shirt design generator (v1) — niche in, print assets out.
 *
 * Flow: style-anchored design prompt (negative-prompt discipline, compliance
 * scanned) -> Pollinations image -> FFmpeg Lanczos upscale to print size
 * (5000x5500 default = TeePublic full-range + Redbubble men's graphic;
 * env POD_PRINT_WIDTH/POD_PRINT_HEIGHT override; honest caveat: upscale
 * grows the canvas, NOT detail — source is 1024x1280)
 * -> optional rembg background removal (graceful skip + warning when the
 * `rembg` python package is absent) -> flat mockup composite (design
 * centered on a shirt-color canvas — an honest flat preview, NOT a lifestyle
 * mockup; portrait 1080x1350 + square 1080x1080, the product-page standard)
 * -> optional Printify draft product (image upload + product create
 * as DRAFT; requires PRINTIFY_API_TOKEN + PRINTIFY_SHOP_ID, otherwise
 * skipped with a typed reason, never faked) -> manifest + zip via ./package.
 *
 * E2S design gate (src/lib/digital/pod-design.ts, from Nishkarsh
 * Sharma's design-research formula): runs BEFORE any image is generated —
 * a failing brief throws validation_error and costs no AI quota.
 *
 * Nothing here publishes anything: the Printify product is created as an
 * unpublished draft, and every skipped step records a warning instead of a
 * fabricated success.
 */
import { execFile } from "child_process";
import { mkdir, writeFile, readFile, stat } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { generateImage } from "@/lib/providers/pollinations";
import { BANNED_CLAIM_PATTERN, PRICE_PATTERN } from "@/lib/compliance";
import { DigitalError } from "./ebook";
export { DigitalError } from "./ebook";
import { scoreE2S } from "./pod-design";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

const execFileAsync = promisify(execFile);

/**
 * Print size for design-print.png. Default 5000x5500 = TeePublic full-range
 * (5000x5500 @ 150 DPI) + Redbubble men's graphic (3873x4814). Override via
 * env POD_PRINT_WIDTH / POD_PRINT_HEIGHT; clamped to 1500-6000.
 */
export function printSize(): { width: number; height: number } {
  const clamp = (v: number, fallback: number) =>
    Number.isFinite(v) ? Math.max(1500, Math.min(6000, Math.round(v))) : fallback;
  return {
    width: clamp(Number(process.env.POD_PRINT_WIDTH), 5000),
    height: clamp(Number(process.env.POD_PRINT_HEIGHT), 5500),
  };
}

/** Deploy-time probe: is `rembg` importable? Used by scripts/check-pod-deps.ts. */
export async function checkRembgAvailable(): Promise<boolean> {
  try {
    await execFileAsync("python3", ["-c", "import rembg"], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

export interface PodDesignInput {
  niche: string;
  /** Short text for typography designs (max ~40 chars). Empty = graphic-only. */
  designText?: string;
  style?: "minimal_typography" | "line_art" | "bold_graphic";
  shirtColor?: "black" | "white" | "navy" | "sand" | "gray";
  title?: string;
  description?: string;
  /** Printify wiring. When omitted the design assets are still produced. */
  printify?: {
    blueprintId?: number;
    printProviderId?: number;
    variantIds?: number[];
    priceCents?: number;
    publishAsDraft?: boolean;
  };
  /**
   * When true, the design assets are generated but NO Printify draft is
   * created — the design waits for human approval (design-check lever).
   * Approve later via publishPodDraftFromSlug().
   */
  skipPrintify?: boolean;
}

export interface PodDesignResult {
  title: string;
  slug: string;
  dir: string;
  files: Record<string, string>;
  warnings: string[];
  printify?: { productId: string; status: string } | { skipped: string };
}

const SHIRT_HEX: Record<string, string> = {
  black: "1a1a1a",
  white: "f5f5f5",
  navy: "1f2a44",
  sand: "d9c7a7",
  gray: "9a9a9a",
};

const NEGATIVE_ANCHOR =
  "blurry, deformed text, low-res, watermark, complex gradients, photorealistic faces";

/**
 * Premium placement language (BlankBuilder system): the print is NOT a
 * centred chest graphic — it is an all-over print with the motif echoed
 * at two scales (large back, small chest), one garment base plus one
 * accent colour, print-ready vector. The placement on the actual
 * garment (seam wrap, sleeves) is Printify-side; the artwork itself
 * carries the echo + restrained palette.
 */
export function buildPrompt(input: Required<Pick<PodDesignInput, "niche" | "style" | "shirtColor">> & { designText: string }): string {
  const bg = input.shirtColor === "black" || input.shirtColor === "navy" ? "transparent background" : "isolated on pure white background";
  const styleBits: Record<string, string> = {
    minimal_typography: "clean minimalist typography t-shirt design",
    line_art: "minimal vector line art t-shirt graphic",
    bold_graphic: "bold flat vector t-shirt graphic, limited palette",
  };
  const textBit = input.designText
    ? ` featuring the exact text "${input.designText}" in clean readable lettering`
    : "";
  return (
    `${styleBits[input.style]} for niche "${input.niche}"${textBit}, ${bg}, ` +
    `all-over print, motif echoed at two scales (large back print, small chest print), ` +
    `one garment base plus one accent colour, high contrast, print-ready vector, trending on Behance. Avoid: ${NEGATIVE_ANCHOR}.`
  );
}

function scanCompliance(text: string, warnings: string[]): void {
  if (PRICE_PATTERN.test(text)) {
    throw new DigitalError("compliance_rejected", "designText must not contain prices or discounts.");
  }
  if (BANNED_CLAIM_PATTERN.test(text)) {
    throw new DigitalError("compliance_rejected", "designText contains a banned claim pattern.");
  }
  if (text.length > 40) {
    warnings.push("designText over 40 chars — AI text rendering degrades; kept as-is, review design.png.");
  }
}

async function upscale(input: string, output: string, width: number, height: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-i", input,
    "-vf", `scale=${width}:${height}:flags=lanczos`,
    output,
  ], { timeout: 300_000 });
}

async function tryRembg(input: string, output: string, warnings: string[]): Promise<boolean> {
  if (!(await checkRembgAvailable())) {
    warnings.push("rembg not installed — background removal skipped (design keeps its generated background).");
    return false;
  }
  try {
    await execFileAsync("python3", ["-m", "rembg", "i", input, output], { timeout: 300_000 });
    return true;
  } catch (err) {
    warnings.push(`rembg failed (${err instanceof Error ? err.message.slice(0, 120) : "unknown"}) — kept original.`);
    return false;
  }
}

/** Flat mockup: design centered on a shirt-color canvas. Honest, not lifestyle. */
async function flatMockup(design: string, output: string, shirtColor: string, width = 1080, height = 1350): Promise<void> {
  const hex = SHIRT_HEX[shirtColor] ?? SHIRT_HEX.black;
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=c=0x${hex}:s=${width}x${height}:d=1`,
    "-i", design,
    "-filter_complex",
    `[1:v]scale=${Math.round(width * 0.7)}:-1:flags=lanczos[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2`,
    "-frames:v", "1",
    output,
  ], { timeout: 120_000 });
}

async function printifyCall(path: string, method: string, body?: unknown): Promise<unknown> {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) throw new DigitalError("printify_not_configured", "PRINTIFY_API_TOKEN is not set.");
  const res = await fetch(`https://api.printify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new DigitalError("printify_failed", `Printify ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Best-effort blueprint discovery: first tee-like blueprint + provider + variants. */
/** Slug guard: only safe filesystem slugs may address stored designs. */
export function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new DigitalError("validation_error", "Invalid design slug.");
  }
}

interface PrintifyTarget {
  blueprintId: number;
  printProviderId: number;
  variantIds: number[];
}

async function resolvePrintifyTarget(printifyOpts?: PodDesignInput["printify"]): Promise<PrintifyTarget> {
  const target = printifyOpts?.blueprintId
    ? {
        blueprintId: printifyOpts.blueprintId,
        printProviderId: printifyOpts.printProviderId ?? 0,
        variantIds: printifyOpts.variantIds ?? [],
      }
    : await discoverPrintifyTarget();
  if (!target.printProviderId || !target.variantIds.length) {
    throw new DigitalError("printify_failed", "printify.blueprintId needs printProviderId + variantIds, or omit for auto-discovery.");
  }
  return target;
}

/** Create the Printify UNPUBLISHED draft for an already-generated design. Never publishes. */
async function createPrintifyDraft(args: {
  slug: string;
  title: string;
  description: string;
  artPath: string;
  printifyOpts?: PodDesignInput["printify"];
}): Promise<{ productId: string; status: string }> {
  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!process.env.PRINTIFY_API_TOKEN || !shopId) {
    throw new DigitalError("printify_not_configured", "PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID are not set.");
  }
  const target = await resolvePrintifyTarget(args.printifyOpts);
  const artB64 = (await readFile(args.artPath)).toString("base64");
  const upload = (await printifyCall("/uploads.json", "POST", {
    file_name: `${args.slug}.png`,
    contents: artB64,
  })) as { id: string };
  const product = (await printifyCall(`/shops/${shopId}/products.json`, "POST", {
    title: args.title,
    description: args.description,
    blueprint_id: target.blueprintId,
    print_provider_id: target.printProviderId,
    variants: target.variantIds.map((id) => ({
      id,
      price: args.printifyOpts?.priceCents ?? 2500,
      is_enabled: true,
    })),
    print_areas: [
      {
        variant_ids: target.variantIds,
        placeholders: [{ position: "front", images: [{ id: upload.id, x: 0.5, y: 0.4, scale: 0.9, angle: 0 }] }],
      },
    ],
  })) as { id: string };
  return { productId: product.id, status: "draft" };
}

/**
 * Human-approval step for the design-check lever: create the Printify
 * UNPUBLISHED draft for a design that was generated with skipPrintify.
 * Reads the stored manifest — the design is never regenerated.
 */
export async function publishPodDraftFromSlug(
  slug: string,
  printifyOpts?: PodDesignInput["printify"]
): Promise<{ productId: string; status: string; slug: string }> {
  assertSafeSlug(slug);
  const dir = join(digitalRoot(), productDirName(`pod-${slug}`));
  let manifest: {
    title?: string;
    description?: string;
    files?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8"));
  } catch {
    throw new DigitalError("validation_error", `No stored design found for slug "${slug}" — generate it first.`);
  }
  const artPath =
    manifest.files?.designTransparent ?? manifest.files?.designPrint ?? null;
  if (!artPath) {
    throw new DigitalError("validation_error", `Stored design "${slug}" has no printable art file.`);
  }
  try {
    await stat(artPath);
  } catch {
    throw new DigitalError("validation_error", `Stored art file for "${slug}" is missing on disk.`);
  }
  const draft = await createPrintifyDraft({
    slug,
    title: manifest.title ?? slug,
    description: manifest.description ?? `Original design. Printed on demand.`,
    artPath,
    printifyOpts,
  });
  return { ...draft, slug };
}

/** Best-effort blueprint discovery: first tee-like blueprint + provider + variants. */
async function discoverPrintifyTarget(): Promise<{ blueprintId: number; printProviderId: number; variantIds: number[] }> {
  const blueprints = (await printifyCall("/catalog/blueprints.json", "GET")) as Array<{ id: number; title: string }>;
  const tee = blueprints.find((b) => /t-shirt|tee/i.test(b.title)) ?? blueprints[0];
  if (!tee) throw new DigitalError("printify_failed", "No Printify blueprints found.");
  const providers = (await printifyCall(`/catalog/blueprints/${tee.id}/print_providers.json`, "GET")) as Array<{ id: number }>;
  if (!providers[0]) throw new DigitalError("printify_failed", "No print providers for blueprint.");
  const variants = (await printifyCall(
    `/catalog/blueprints/${tee.id}/print_providers/${providers[0].id}/variants.json`, "GET"
  )) as { variants: Array<{ id: number }> };
  const ids = variants.variants.slice(0, 6).map((v) => v.id);
  if (!ids.length) throw new DigitalError("printify_failed", "No variants for print provider.");
  return { blueprintId: tee.id, printProviderId: providers[0].id, variantIds: ids };
}

export async function generatePodDesign(input: PodDesignInput): Promise<PodDesignResult> {
  const niche = input.niche.trim();
  if (niche.length < 2) throw new DigitalError("validation_error", "niche is required.");
  const designText = (input.designText ?? "").trim();
  const style = input.style ?? "minimal_typography";
  const shirtColor = input.shirtColor ?? "black";
  const warnings: string[] = [];
  scanCompliance(`${niche} ${designText}`, warnings);

  // E2S design gate (Nishkarsh Sharma's design-research formula — see
  // src/lib/digital/pod-design.ts). Runs BEFORE any image is generated,
  // so a failing brief costs no AI quota. A failing brief is a
  // validation error, not a retryable failure — fix the brief, don't
  // re-run it.
  const e2s = scoreE2S({ niche, designText });
  warnings.push(...e2s.warnings);
  if (!e2s.passed) {
    throw new DigitalError("validation_error", `E2S design check failed (${e2s.score}/6): ${e2s.reasons.join(" ")}`);
  }

  const title = input.title?.trim() || `${niche} tee — ${style.replace(/_/g, " ")}`;
  const slug = slugify(title);
  const dir = join(digitalRoot(), productDirName(`pod-${slug}`));
  await mkdir(dir, { recursive: true });

  // 1. Design image (Pollinations-first, like the video pipeline's image chain).
  const prompt = buildPrompt({ niche, style, shirtColor, designText });
  const img = await generateImage({ prompt, width: 1024, height: 1280, model: "flux" });
  if (!img.ok) {
    throw new DigitalError("generation_failed", `Design image failed: ${img.error.message}`);
  }
  const rawPath = join(dir, "design-raw.png");
  await writeFile(rawPath, img.data);

  // 2. Upscale to print size (Lanczos; honest about AI-text limits).
  // Caveat: upscale grows the canvas, NOT detail — source is 1024x1280.
  const printPath = join(dir, "design-print.png");
  const { width: printW, height: printH } = printSize();
  await upscale(rawPath, printPath, printW, printH);
  warnings.push("AI-rendered text may be imperfect — review design-print.png before any publish.");

  // 3. Optional background removal.
  const transparentPath = join(dir, "design-transparent.png");
  const removed = await tryRembg(printPath, transparentPath, warnings);
  const artPath = removed ? transparentPath : printPath;

  // 4. Flat mockup preview (portrait) + square mockup (1080x1080 —
  // the product-page standard; mockups improve conversions, and the
  // square variant feeds the storefront + Pinterest pins directly).
  const mockupPath = join(dir, "mockup-flat.png");
  await flatMockup(artPath, mockupPath, shirtColor);
  const mockupSquarePath = join(dir, "mockup-square.png");
  await flatMockup(artPath, mockupSquarePath, shirtColor, 1080, 1080);

  // 5. Optional Printify draft (never auto-publishes).
  let printify: PodDesignResult["printify"];
  if (input.skipPrintify) {
    // Design-check lever: human reviews design-print.png BEFORE any draft.
    printify = { skipped: "awaiting_human_approval" };
    warnings.push(
      "Printify draft NOT created (skipPrintify) — review design-print.png, then approve via POST /api/v1/digital/pod/publish."
    );
  } else if (!process.env.PRINTIFY_API_TOKEN || !process.env.PRINTIFY_SHOP_ID) {
    printify = { skipped: "printify_not_configured" };
    warnings.push("PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID not set — Printify draft skipped (assets are local).");
  } else {
    const draft = await createPrintifyDraft({
      slug,
      title,
      description: input.description ?? `Original ${niche} design. Printed on demand.`,
      artPath,
      printifyOpts: input.printify,
    });
    printify = { productId: draft.productId, status: draft.status };
    warnings.push("Printify product created as UNPUBLISHED draft — review in Printify before publishing.");
  }

  const files: Record<string, string> = {
    designRaw: rawPath,
    designPrint: printPath,
    mockupFlat: mockupPath,
    mockupSquare: mockupSquarePath,
  };
  if (removed) files.designTransparent = transparentPath;

  await writeManifest(dir, {
    kind: "pod_design",
    title, slug, niche, designText, style, shirtColor,
    description: input.description ?? null,
    prompt, files, warnings,
    e2s: { score: e2s.score, max: e2s.max, passed: e2s.passed },
    printify: printify ?? null,
    flatMockupNote: "mockup-flat.png (1080x1350) + mockup-square.png (1080x1080) are flat preview composites, not lifestyle mockups.",
    createdAt: new Date().toISOString(),
  });
  const zip = await zipDirectory(dir);

  return {
    title, slug, dir,
    files: { ...files, ...(zip ? { zip } : {}), manifest: join(dir, "manifest.json") },
    warnings,
    printify,
  };
}
