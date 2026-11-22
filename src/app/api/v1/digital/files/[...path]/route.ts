import { NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { extname, resolve, sep } from "path";
import { failure } from "@/lib/envelope";
import { digitalRoot } from "@/lib/digital/package";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * GET /api/v1/digital/files/<path> — serve a digital product image
 * (template pack PNGs etc.) so IG's servers can fetch it for carousels.
 * No auth (IG fetches it server-side, like the video downloadUrl);
 * protection is path containment under the digital root + image
 * extensions only. Anything else -> 400/404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const rel = (path ?? []).join("/");
  if (!rel) return failure("missing_path", "File path zaroori hai.", 400);
  const type = CONTENT_TYPES[extname(rel).toLowerCase()];
  if (!type) return failure("not_supported", "Sirf PNG/JPG/WebP images serve hoti hain.", 400);
  const root = resolve(digitalRoot());
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return failure("invalid_path", "Path digital root ke bahar hai.", 400);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return failure("not_found", "File nahi mili.", 404);
    const stream = createReadStream(abs);
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return failure("not_found", "File nahi mili.", 404);
  }
}
