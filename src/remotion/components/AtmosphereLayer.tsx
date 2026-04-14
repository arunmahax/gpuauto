/**
 * Atmosphere Layer Component (Top Level)
 * Applies color filters, grain effects, and visual overlays.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

interface AtmosphereLayerProps {
  /** Color tint to apply (CSS color) */
  tintColor?: string;
  /** Tint opacity (0.0 - 1.0) */
  tintOpacity?: number;
  /** Enable grain/noise overlay */
  grainEnabled?: boolean;
  /** Grain opacity (0.0 - 1.0) */
  grainOpacity?: number;
  /** Enable black dots effect */
  dotsEnabled?: boolean;
  /** Dots opacity (0.0 - 1.0) */
  dotsOpacity?: number;
  /** Enable vignette */
  vignetteEnabled?: boolean;
}

/**
 * Generates a pseudo-random grain pattern via CSS.
 * We use a shifting background-position to simulate film grain movement.
 */
const GrainOverlay: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();

  // Shift grain position every frame for animation effect
  const offsetX = (frame * 37) % 200;
  const offsetY = (frame * 53) % 200;

  return (
    <AbsoluteFill
      style={{
        opacity,
        mixBlendMode: "overlay",
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundSize: "200px 200px",
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
    />
  );
};

/**
 * Creates a scattered black dots pattern.
 */
const DotsOverlay: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle movement
  const shift = interpolate(frame, [0, fps * 10], [0, 50], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.8) 1px, transparent 1px)`,
        backgroundSize: "8px 8px",
        backgroundPosition: `${shift % 8}px ${shift % 8}px`,
      }}
    />
  );
};

/**
 * Vignette effect darkening the edges.
 */
const VignetteOverlay: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
        pointerEvents: "none",
      }}
    />
  );
};

export const AtmosphereLayer: React.FC<AtmosphereLayerProps> = ({
  tintColor = "rgba(180, 150, 50, 0.15)",
  tintOpacity = 1,
  grainEnabled = true,
  grainOpacity = 0.3,
  dotsEnabled = true,
  dotsOpacity = 0.08,
  vignetteEnabled = true,
}) => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Color tint filter */}
      <AbsoluteFill
        style={{
          backgroundColor: tintColor,
          opacity: tintOpacity,
          mixBlendMode: "multiply",
        }}
      />

      {/* Film grain */}
      {grainEnabled && <GrainOverlay opacity={grainOpacity} />}

      {/* Black dots pattern */}
      {dotsEnabled && <DotsOverlay opacity={dotsOpacity} />}

      {/* Vignette */}
      {vignetteEnabled && <VignetteOverlay />}
    </AbsoluteFill>
  );
};
