/**
 * Background Layer Component (Bottom Level)
 * Renders an animated textured background behind the content.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Video,
  Img,
  staticFile,
} from "remotion";

interface BackgroundLayerProps {
  /** Path to a background video or image (optional) */
  backgroundSrc?: string;
  /** Background color if no media provided */
  backgroundColor?: string;
  /** Enable animated gradient */
  animatedGradient?: boolean;
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({
  backgroundSrc,
  backgroundColor = "#1a1a2e",
  animatedGradient = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Slow animated gradient rotation
  const gradientAngle = interpolate(frame, [0, fps * 60], [0, 360], {
    extrapolateRight: "extend",
  });

  // Subtle pulsing opacity for atmosphere
  const pulseOpacity = interpolate(
    frame % (fps * 4),
    [0, fps * 2, fps * 4],
    [0.3, 0.5, 0.3]
  );

  if (backgroundSrc) {
    const isVideo =
      backgroundSrc.endsWith(".mp4") || backgroundSrc.endsWith(".webm");

    return (
      <AbsoluteFill>
        {isVideo ? (
          <Video
            src={staticFile(backgroundSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loop
            muted
          />
        ) : (
          <Img
            src={staticFile(backgroundSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        background: animatedGradient
          ? `linear-gradient(${gradientAngle}deg, ${backgroundColor}, #16213e, #0f3460, ${backgroundColor})`
          : backgroundColor,
      }}
    >
      {/* Subtle animated texture overlay */}
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          opacity: pulseOpacity,
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 0%, transparent 60%)",
        }}
      />
    </AbsoluteFill>
  );
};
