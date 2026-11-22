# ---- Build stage ----
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
# Prisma 7 requires DATABASE_URL to load prisma.config.ts at generate time.
# generate never connects to the DB, so a dummy URL is enough here; the
# real URL comes from compose `environment:` at runtime.
RUN DATABASE_URL=postgresql://pv:dummy@postgres:5432/product_video npx prisma generate
RUN npm run build
# Drop devDependencies so the runtime image stays slim
RUN npm prune --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user for least privilege
RUN addgroup -S app && adduser -S app -G app

# Digital-product engines (ebook PDF + template previews + packaging):
# python3/fpdf2 render ebook PDFs via scripts/pdf_bridge.py, pypdf stamps
# buyer-licensed footers via scripts/pdf_stamp.py, ffmpeg (librsvg) renders
# template PNG previews, zip packages the products.
# python-docx / python-pptx / EbookLib / openpyxl render DOCX, PPTX, EPUB,
# XLSX via scripts/docs_bridge.py (src/lib/digital/docs.ts).
# Deploy-check: confirm this ffmpeg build lists the librsvg decoder —
# without it previews are skipped with a warning, SVGs still ship.
# rembg: DROPPED 2026-11-13 — POD background removal is optional
# (pod.ts skips it gracefully with a warning when rembg is absent).
# rembg needs numba/llvmlite, which have NO musllinux wheels and no
# Alpine packages (no py3-llvmlite/py3-numba); pip fails building the
# llvmlite wheel from source. onnxruntime (apk py3-onnxruntime) was
# therefore also dropped — nothing else uses it. Restore via a
# Debian-based sidecar if POD background removal is ever required.
# First rembg run downloads the ~176MB u2net model to ~/.u2net — disk +
# network needed once. Deploy-check: npx tsx scripts/check-pod-deps.ts
# Tool Registry CLIs (2026-11-22): the tools adapters shell out from
# this container, so their CLIs must live in this image — `kaggle`
# (kaggle adapter: kernels push/status/output) and `modal` (modal
# adapter: `modal run` for Wan/upscale/Whisper workers). Both are pure
# Python + protobuf (musllinux wheels exist), unlike rembg's numba.
# Auth comes from env at runtime (KAGGLE_USERNAME/KEY,
# MODAL_TOKEN_ID/SECRET) — never baked into the image.
# pypdf is PINNED to 6.21.4: pdf_stamp.py uses PageObject.replace_contents(),
# removed in pypdf 7.0.0 — an unpinned install breaks buyer-stamping at
# deploy (caught 2026-11-11 while verifying the full test suite).
RUN apk add --no-cache python3 py3-pip ffmpeg zip fontconfig font-dejavu \
  && pip3 install --no-cache-dir --break-system-packages fpdf2 "pypdf==6.21.4" pytrends python-docx python-pptx EbookLib openpyxl kaggle modal

# Cloudflare Wrangler CLI (2026-11-22): the cf-workers adapter shells
# out to `wrangler deploy` from this container. Global install so it is
# on PATH for USER app at runtime; auth is CLOUDFLARE_API_TOKEN from env.
RUN npm install -g wrangler --no-audit --no-fund

# Premium typography: Poppins (SIL OFL, assets/fonts/) for template SVG
# text + thumbnail drawtext. OFL.txt ships next to the fonts.
# Same directory also carries Anton + Fraunces (SIL OFL) from the Nafay 3D
# AI Video Editor pack (assets/fonts/NAFAY-FONTS.md) for the motion hook
# card — note their renamed families ("CVE anton-400"/"CVE fraunces-700").
COPY assets/fonts /usr/share/fonts/truetype/poppins
RUN fc-cache -f >/dev/null 2>&1 || true

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.* ./
# Prisma 7's runtime client loads prisma.config.ts to resolve the
# datasource URL (env DATABASE_URL). Without this file the client fails
# with "Invalid URL" and the DB stays unreachable (first deploy 2026-11-13).
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/scripts/pdf_bridge.py ./scripts/pdf_bridge.py
COPY --from=builder /app/scripts/docs_bridge.py ./scripts/docs_bridge.py

# Writable asset + temp dirs owned by the app user.
# Everything under /app must belong to `app`: the image runs as USER app,
# and root-owned package.json/.next/node_modules caused EACCES crashes
# on first deploy (2026-11-13) — npm/tsx could not read package.json.
RUN mkdir -p /app/storage/jobs /app/storage/digital /tmp/renders && chown -R app:app /app /tmp/renders

USER app
EXPOSE 3000

# BusyBox wget ships with alpine — no extra package needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["npm", "run", "start"]
