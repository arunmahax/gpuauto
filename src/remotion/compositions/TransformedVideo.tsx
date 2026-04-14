/**
 * TransformedVideo Composition
 * Main Remotion composition that assembles all layers into the final video.
 * Layers (bottom to top):
 *   1. Background (animated/textured)
 *   2. Content (scaled-down source clips in non-linear order)
 *   3. Atmosphere (color tint, grain, dots overlay)
 *   + Audio (narration + ducked background music)
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useVideoConfig,
} from "remotion";
import { BackgroundLayer } from "../components/BackgroundLayer";
import { ContentLayer } from "../components/ContentLayer";
import { AtmosphereLayer } from "../components/AtmosphereLayer";
import { AudioLayer } from "../components/AudioLayer";

/** Shape of a single clip in the sequence */
export interface ClipData {
  /** Path to the video clip file */
  src: string;
  /** Frame offset where this clip starts */
  startFrame: number;
  /** Number of frames this clip lasts */
  durationInFrames: number;
}

/** Props passed to the composition via inputProps */
export interface TransformedVideoProps {
  /** Ordered array of video clips to play */
  clips: ClipData[];
  /** Path to the full narration audio */
  narrationSrc: string;
  /** Path to background music file (optional) */
  musicSrc?: string;
  /** Background media source (optional) */
  backgroundSrc?: string;

  // --- Template constants (overridable) ---
  /** Scale factor for content video (default: 0.8) */
  contentScale?: number;
  /** Color tint (default: yellowish) */
  tintColor?: string;
  /** Tint opacity */
  tintOpacity?: number;
  /** Grain effect enabled */
  grainEnabled?: boolean;
  /** Grain opacity */
  grainOpacity?: number;
  /** Dots overlay enabled */
  dotsEnabled?: boolean;
  /** Dots opacity */
  dotsOpacity?: number;
  /** Vignette enabled */
  vignetteEnabled?: boolean;
  /** Narration volume */
  narrationVolume?: number;
  /** Music volume */
  musicVolume?: number;
  /** Background color */
  backgroundColor?: string;
  /** Animated gradient background */
  animatedGradient?: boolean;
  /** Content border radius */
  borderRadius?: number;
  /** Content shadow */
  contentShadow?: boolean;
}

export const TransformedVideo: React.FC<TransformedVideoProps> = ({
  clips,
  narrationSrc,
  musicSrc,
  backgroundSrc,
  // Template defaults
  contentScale = 0.8,
  tintColor = "rgba(180, 150, 50, 0.15)",
  tintOpacity = 1,
  grainEnabled = true,
  grainOpacity = 0.3,
  dotsEnabled = true,
  dotsOpacity = 0.08,
  vignetteEnabled = true,
  narrationVolume = 1.0,
  musicVolume = 0.15,
  backgroundColor = "#1a1a2e",
  animatedGradient = true,
  borderRadius = 12,
  contentShadow = true,
}) => {
  return (
    <AbsoluteFill>
      {/* === LAYER 1: Background (Bottom) === */}
      <BackgroundLayer
        backgroundSrc={backgroundSrc}
        backgroundColor={backgroundColor}
        animatedGradient={animatedGradient}
      />

      {/* === LAYER 2: Content (Middle) — Video clips in sequence === */}
      {clips.map((clip, index) => (
        <Sequence
          key={`clip-${index}`}
          from={clip.startFrame}
          durationInFrames={clip.durationInFrames}
        >
          <ContentLayer
            clipSrc={clip.src}
            scale={contentScale}
            borderRadius={borderRadius}
            shadow={contentShadow}
          />
        </Sequence>
      ))}

      {/* === LAYER 3: Atmosphere (Top) — Filters & overlays === */}
      <AtmosphereLayer
        tintColor={tintColor}
        tintOpacity={tintOpacity}
        grainEnabled={grainEnabled}
        grainOpacity={grainOpacity}
        dotsEnabled={dotsEnabled}
        dotsOpacity={dotsOpacity}
        vignetteEnabled={vignetteEnabled}
      />

      {/* === AUDIO: Narration + Background Music === */}
      <AudioLayer
        narrationSrc={narrationSrc}
        musicSrc={musicSrc}
        narrationVolume={narrationVolume}
        musicVolume={musicVolume}
      />
    </AbsoluteFill>
  );
};
