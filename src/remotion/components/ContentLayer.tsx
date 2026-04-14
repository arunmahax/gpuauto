/**
 * Content Layer Component (Middle Level)
 * Renders the source video clips scaled down within the frame.
 */
import React from "react";
import {
  AbsoluteFill,
  Video,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
} from "remotion";

interface ContentLayerProps {
  /** Path to the current video clip */
  clipSrc: string;
  /** Scale factor for the video (0.0 - 1.0) */
  scale?: number;
  /** Border radius in pixels */
  borderRadius?: number;
  /** Whether to add a shadow */
  shadow?: boolean;
  /** Whether this clip is file path (true) or staticFile reference (false) */
  isAbsolutePath?: boolean;
}

export const ContentLayer: React.FC<ContentLayerProps> = ({
  clipSrc,
  scale = 0.8,
  borderRadius = 12,
  shadow = true,
  isAbsolutePath = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle entrance animation
  const entryScale = spring({
    frame,
    fps,
    config: {
      damping: 200,
      stiffness: 100,
      mass: 0.5,
    },
  });

  const currentScale = interpolate(entryScale, [0, 1], [scale * 0.95, scale]);

  const videoSrc = staticFile(clipSrc);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          transform: `scale(${currentScale})`,
          borderRadius,
          overflow: "hidden",
          boxShadow: shadow
            ? "0 20px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 0, 0, 0.3)"
            : "none",
          width: "100%",
          height: "100%",
        }}
      >
        <Video
          src={videoSrc}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          muted
        />
      </div>
    </AbsoluteFill>
  );
};
