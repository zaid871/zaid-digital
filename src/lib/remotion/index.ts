/**
 * Remotion entry point — loaded ONLY by @remotion/bundler at render time
 * (file path passed as a string). Never imported by our TS code, so the
 * `remotion` package never enters Next.js/Turbopack bundles.
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { CodeMotion, type CodeMotionProps } from "./CodeMotion";

export const RemotionRoot: React.FC = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Composition, {
      id: "CodeMotion",
      component: CodeMotion as unknown as React.ComponentType<Record<string, unknown>>,
      durationInFrames: 150, // overridden per render via selectComposition
      fps: 30,
      width: 1080,
      height: 1920,
      defaultProps: {
        imageDataUri: "",
        title: "",
        accentColor: "#ff6b35",
      } satisfies CodeMotionProps,
    })
  );

registerRoot(RemotionRoot);
