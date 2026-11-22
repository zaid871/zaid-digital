# Nafay 3D AI Video Editor fonts (2026-11-10)

Source: `ai-video-editor.zip` shared by the user (Nafay 3D "AI Video
Editor" skill, youtube.com/@nafay3d) — `assets/fonts/ttf/`.

- `anton-400.ttf` — Anton (Vernon Adams, SIL OFL 1.1, Google Fonts).
  Condensed caps display face, used for the motion hook card line 1.
- `fraunces-700.ttf` — Fraunces (Undercase Type, SIL OFL 1.1, Google
  Fonts). Serif display face, used for the hook card accent line 2.

IMPORTANT — family names: the packager renamed the families in these
files (probably to avoid collisions with system fonts). fontconfig
reports them as **`CVE anton-400`** and **`CVE fraunces-700`**, NOT
"Anton"/"Fraunces" — the ASS overrides in `src/lib/pipeline/motion.ts`
must use those exact names, or libass silently falls back to DejaVu
Sans. Verified with `fc-list` 2026-11-10.

Licence: both SIL OFL 1.1 — free to use for rendering. Render-use
only, never sold standalone (same rule as Poppins). The Dockerfile
copies this whole directory into the image (`COPY assets/fonts ...`),
so no extra install step is needed.
