/**
 * 3D LUT generator — named colour looks as .cube files.
 *
 * Correction to the earlier "NO" verdict: a .cube LUT is PLAIN TEXT,
 * not a binary format. A 32^3 lattice with a per-channel transform is
 * a real, importable LUT (DaVinci Resolve, Premiere, Final Cut,
 * Lightroom, Photoshop Camera Raw all read .cube). What we cannot do
 * is measure a real camera/film stock — these looks are mathematical
 * transforms (warm / cool / contrast / faded / teal-orange), honestly
 * labelled as such in the manifest.
 *
 * Deterministic — no AI call, no provider quota. Values are computed
 * from the formulas below and written with 4 decimals.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

export type LutPresetName = "warm" | "cool" | "contrast" | "faded" | "teal-orange";

export interface LutPreset {
  name: LutPresetName;
  title: string;
  description: string;
  /** Per-channel transform on [0,1] inputs. */
  transform: (r: number, g: number, b: number) => [number, number, number];
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export const LUT_PRESETS: LutPreset[] = [
  {
    name: "warm",
    title: "Warm Glow",
    description: "Golden-hour warmth: reds lifted, blues pulled back.",
    transform: (r, g, b) => [clamp(r * 1.08 + 0.02), clamp(g * 1.0), clamp(b * 0.92)],
  },
  {
    name: "cool",
    title: "Cool Morning",
    description: "Clean blue morning: blues lifted, reds pulled back.",
    transform: (r, g, b) => [clamp(r * 0.92), clamp(g * 1.0), clamp(b * 1.08 + 0.02)],
  },
  {
    name: "contrast",
    title: "Punchy Contrast",
    description: "Smoothstep S-curve: deeper blacks, brighter whites, same mid-point.",
    transform: (r, g, b) => {
      const s = (x: number) => x * x * (3 - 2 * x);
      return [s(r), s(g), s(b)];
    },
  },
  {
    name: "faded",
    title: "Faded Film",
    description: "Lifted blacks, lowered whites — the matte film look.",
    transform: (r, g, b) => [clamp(0.08 + r * 0.84), clamp(0.08 + g * 0.84), clamp(0.08 + b * 0.84)],
  },
  {
    name: "teal-orange",
    title: "Teal & Orange",
    description: "Cinematic blockbuster grade: teal shadows, warm highlights.",
    transform: (r, g, b) => {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const shadow = 1 - lum;
      return [clamp(r * 1.06), clamp(g * 1.0 + 0.03 * shadow), clamp(b * 1.02 + 0.05 * shadow)];
    },
  },
];

export const LUT_SIZE = 32;

export interface LutPackRequest {
  presets?: LutPresetName[];
}

export interface LutPackResult {
  title: string;
  slug: string;
  dir: string;
  presets: string[];
  files: { manifest: string; zip: string | null };
  warnings: string[];
}

/** Render one .cube file. Data order: red fastest, then green, blue slowest. */
export function renderCube(preset: LutPreset): string {
  const lines: string[] = [
    `# ${preset.title} — generated 3D LUT (mathematical transform, not a measured film stock)`,
    `TITLE "${preset.title}"`,
    `LUT_3D_SIZE ${LUT_SIZE}`,
    `DOMAIN_MIN 0.0 0.0 0.0`,
    `DOMAIN_MAX 1.0 1.0 1.0`,
    ``,
  ];
  for (let b = 0; b < LUT_SIZE; b++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      for (let r = 0; r < LUT_SIZE; r++) {
        const [or, og, ob] = preset.transform(r / (LUT_SIZE - 1), g / (LUT_SIZE - 1), b / (LUT_SIZE - 1));
        lines.push(`${or.toFixed(4)} ${og.toFixed(4)} ${ob.toFixed(4)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

export async function generateLutPack(
  req: LutPackRequest,
  deps?: { outRoot?: string }
): Promise<LutPackResult> {
  const wanted = (req.presets ?? []).map((p) => String(p).trim().toLowerCase());
  const chosen =
    wanted.length > 0
      ? LUT_PRESETS.filter((p) => wanted.includes(p.name))
      : LUT_PRESETS;
  const warnings: string[] = [];
  if (wanted.length > 0 && chosen.length === 0) {
    warnings.push(`unknown_presets: no matching preset in [${wanted.join(", ")}] — full pack shipped instead`);
    chosen.push(...LUT_PRESETS);
  }

  const title = "LUT Pack — 5 Cinematic Looks";
  const slug = slugify(title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  for (const preset of chosen) {
    await writeFile(join(dir, `${preset.name}.cube`), renderCube(preset), "utf-8");
  }

  const manifestPath = await writeManifest(dir, {
    type: "lut_pack",
    title,
    presets: chosen.map((p) => ({ name: p.name, title: p.title, description: p.description, file: `${p.name}.cube` })),
    format: ".cube (Adobe 3D LUT, 32^3 lattice)",
    deliveryNotes: [
      "Import the .cube file in DaVinci Resolve, Premiere Pro, Final Cut, Lightroom, or Photoshop Camera Raw.",
      "These are mathematical transforms, not measured film stocks — the look is honest, not a clone of a named film.",
    ],
    createdAt: new Date().toISOString(),
    warnings,
  });
  const zipPath = await zipDirectory(dir);
  if (!zipPath) warnings.push("zip_unavailable: product folder is the deliverable (zip binary not found)");

  return {
    title,
    slug,
    dir,
    presets: chosen.map((p) => p.name),
    files: { manifest: manifestPath, zip: zipPath },
    warnings,
  };
}
