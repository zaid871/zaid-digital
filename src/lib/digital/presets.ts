/**
 * Lightroom preset generator — named looks as .xmp files.
 *
 * Correction to the earlier "NO" verdict: a Lightroom preset (.xmp)
 * is XML TEXT, not a binary format. Each preset is a set of Camera Raw
 * slider values (exposure, contrast, highlights, shadows, temperature,
 * vibrance, ...) — the same values the Lightroom UI writes. These
 * files import directly into Lightroom / Camera Raw.
 *
 * The slider values are chosen looks (warm / moody / bright / faded /
 * golden), not measurements of a real photo — the manifest says so.
 * What we still cannot do: Photoshop ACTIONS (.atn, binary) and
 * Lightroom CATALOG presets that need a real edited photo.
 *
 * Deterministic — no AI call, no provider quota.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { digitalRoot, productDirName, slugify, writeManifest, zipDirectory } from "./package";

export interface PresetLook {
  name: string;
  title: string;
  description: string;
  /** Camera Raw slider values (strings as Lightroom writes them). */
  settings: Record<string, string>;
}

export const PRESET_LOOKS: PresetLook[] = [
  {
    name: "warm-glow",
    title: "Warm Glow",
    description: "Golden, cozy warmth for portraits and food.",
    settings: {
      Exposure2012: "+0.35", Contrast2012: "+12", Highlights2012: "-15", Shadows2012: "+20",
      Whites2012: "+8", Blacks2012: "-8", Temperature: "6200", Tint: "+8",
      Vibrance: "+18", Saturation: "0", Clarity2012: "+8", Dehaze: "0", Sharpness: "25",
    },
  },
  {
    name: "moody-dark",
    title: "Moody Dark",
    description: "Dark, cinematic mood — crushed blacks, cool shadows.",
    settings: {
      Exposure2012: "-0.40", Contrast2012: "+25", Highlights2012: "-30", Shadows2012: "-10",
      Whites2012: "-15", Blacks2012: "-25", Temperature: "5200", Tint: "-4",
      Vibrance: "+10", Saturation: "-5", Clarity2012: "+15", Dehaze: "+10", Sharpness: "30",
    },
  },
  {
    name: "bright-airy",
    title: "Bright Airy",
    description: "Light, clean, high-key look for lifestyle and products.",
    settings: {
      Exposure2012: "+0.60", Contrast2012: "-8", Highlights2012: "-25", Shadows2012: "+35",
      Whites2012: "+20", Blacks2012: "+10", Temperature: "5800", Tint: "+2",
      Vibrance: "+12", Saturation: "0", Clarity2012: "-5", Dehaze: "-5", Sharpness: "20",
    },
  },
  {
    name: "faded-film",
    title: "Faded Film",
    description: "Matte film look — lifted blacks, muted colours.",
    settings: {
      Exposure2012: "+0.15", Contrast2012: "-18", Highlights2012: "-10", Shadows2012: "+30",
      Whites2012: "-20", Blacks2012: "+25", Temperature: "5600", Tint: "+3",
      Vibrance: "-8", Saturation: "-12", Clarity2012: "-10", Dehaze: "0", Sharpness: "15",
    },
  },
  {
    name: "golden-hour",
    title: "Golden Hour",
    description: "Sunset gold — warm highlights, deep amber shadows.",
    settings: {
      Exposure2012: "+0.25", Contrast2012: "+18", Highlights2012: "-10", Shadows2012: "+15",
      Whites2012: "+12", Blacks2012: "-12", Temperature: "6800", Tint: "+12",
      Vibrance: "+25", Saturation: "+5", Clarity2012: "+10", Dehaze: "0", Sharpness: "25",
    },
  },
];

export interface PresetPackRequest {
  presets?: string[];
}

export interface PresetPackResult {
  title: string;
  slug: string;
  dir: string;
  presets: string[];
  files: { manifest: string; zip: string | null };
  warnings: string[];
}

function renderXmp(look: PresetLook): string {
  const attrs = Object.entries(look.settings)
    .map(([k, v]) => `   crs:${k}="${v}"`)
    .join("\n");
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140 79.160451, 2017/05/06-01:08:21">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:Version="14.0"
   crs:ProcessVersion="11.0"
${attrs}
   crs:HasSettings="True"
   crs:HasCrop="False"/>
 </rdf:RDF>
</x:xmpmeta>
`;
}

export async function generatePresetPack(
  req: PresetPackRequest,
  deps?: { outRoot?: string }
): Promise<PresetPackResult> {
  const wanted = (req.presets ?? []).map((p) => String(p).trim().toLowerCase());
  const chosen =
    wanted.length > 0
      ? PRESET_LOOKS.filter((p) => wanted.includes(p.name))
      : PRESET_LOOKS;
  const warnings: string[] = [];
  if (wanted.length > 0 && chosen.length === 0) {
    warnings.push(`unknown_presets: no matching preset in [${wanted.join(", ")}] — full pack shipped instead`);
    chosen.push(...PRESET_LOOKS);
  }

  const title = "Lightroom Preset Pack — 5 Looks";
  const slug = slugify(title);
  const dir = join(deps?.outRoot ?? digitalRoot(), productDirName(slug));
  await mkdir(dir, { recursive: true });

  for (const look of chosen) {
    await writeFile(join(dir, `${look.name}.xmp`), renderXmp(look), "utf-8");
  }

  const manifestPath = await writeManifest(dir, {
    type: "lightroom_preset_pack",
    title,
    presets: chosen.map((p) => ({ name: p.name, title: p.title, description: p.description, file: `${p.name}.xmp` })),
    format: ".xmp (Adobe Camera Raw settings)",
    deliveryNotes: [
      "Import the .xmp files in Lightroom (Develop > Presets > Import) or copy them into the Camera Raw Settings folder.",
      "Slider values are chosen looks, not measurements of a real photo — adjust exposure to taste per photo.",
      "Photoshop Actions (.atn) are NOT included — they are binary and cannot be generated here.",
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
