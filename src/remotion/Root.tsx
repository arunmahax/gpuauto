/**
 * Remotion Root — Registers all compositions.
 */
import React from "react";
import { Composition } from "remotion";
import { TransformedVideo } from "./compositions/TransformedVideo";

export const RemotionRoot: React.FC = () => {
  // Default props for preview — these get overridden by inputProps during render
  const defaultProps: Record<string, unknown> = {
    clips: [],
    narrationSrc: "",
    musicSrc: undefined,
    backgroundSrc: undefined,
    contentScale: 0.8,
    tintColor: "rgba(180, 150, 50, 0.15)",
    tintOpacity: 1,
    grainEnabled: true,
    grainOpacity: 0.3,
    dotsEnabled: true,
    dotsOpacity: 0.08,
    vignetteEnabled: true,
    narrationVolume: 1.0,
    musicVolume: 0.15,
    backgroundColor: "#1a1a2e",
    animatedGradient: true,
    borderRadius: 12,
    contentShadow: true,
  };

  return (
    <>
      <Composition
        id="TransformedVideo"
        component={TransformedVideo as any}
        durationInFrames={30 * 60} // Default 60s, overridden at render time
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
    </>
  );
};
