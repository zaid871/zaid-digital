/**
 * CodeMotion — Remotion composition for the "code motion" video tier.
 *
 * 1080x1920 vertical. Ken Burns drift over the scene still + a bottom
 * title card (scene on-screen text) with a brand-accent bar. Deterministic
 * code — NOT AI generation — so output is always on-brief and quota-free.
 *
 * This file is bundled at RENDER time by @remotion/bundler (see
 * ../providers/remotion-motion.ts). It is never imported by our TS code,
 * so the `remotion` package is a render-time dependency only.
 */
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type CodeMotionProps = {
  /** data: URI of the scene still (base64). */
  imageDataUri: string;
  /** On-screen title line (already truncated by the caller). */
  title: string;
  /** Brand accent hex, e.g. "#ff6b35". */
  accentColor: string;
};

export const CodeMotion: React.FC<CodeMotionProps> = ({ imageDataUri, title, accentColor }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Ken Burns: slow push-in with a slight upward drift.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.14], {
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(frame, [0, durationInFrames], [0, -36], {
    extrapolateRight: "clamp",
  });

  // Title card entrance.
  const titleOpacity = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: "clamp" });
  const titleRise = interpolate(frame, [6, 26], [46, 0], { extrapolateRight: "clamp" });

  // Gentle fade-out at the very end so scenes cut cleanly.
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0.92], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0b", opacity: fadeOut }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translateY(${translateY}px)`,
        }}
      >
        <Img
          src={imageDataUri}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      {/* Bottom scrim for legibility */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 34%, rgba(0,0,0,0) 55%)",
        }}
      />

      {/* Title card */}
      {title ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "stretch",
            paddingLeft: 90,
            paddingRight: 90,
            paddingBottom: 420,
            opacity: titleOpacity,
            transform: `translateY(${titleRise}px)`,
          }}
        >
          <div
            style={{
              width: 120,
              height: 10,
              backgroundColor: accentColor,
              marginBottom: 28,
              borderRadius: 5,
            }}
          />
          <div
            style={{
              color: "#ffffff",
              fontFamily: "Inter, system-ui, -apple-system, sans-serif",
              fontWeight: 800,
              fontSize: 62,
              lineHeight: 1.22,
              textShadow: "0 2px 18px rgba(0,0,0,0.55)",
            }}
          >
            {title}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
