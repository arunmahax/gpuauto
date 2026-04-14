/**
 * Audio Layer Component
 * Handles narration overlay, original audio muting, and background music ducking.
 */
import React from "react";
import {
  Audio,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from "remotion";

interface AudioLayerProps {
  /** Path to the narration audio file */
  narrationSrc: string;
  /** Path to background music file */
  musicSrc?: string;
  /** Base volume for narration (0.0 - 1.0) */
  narrationVolume?: number;
  /** Base volume for background music (0.0 - 1.0) */
  musicVolume?: number;
  /** Whether narration src is absolute path */
  isAbsolutePath?: boolean;
}

export const AudioLayer: React.FC<AudioLayerProps> = ({
  narrationSrc,
  musicSrc,
  narrationVolume = 1.0,
  musicVolume = 0.15,
  isAbsolutePath = true,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in narration over first 0.5 seconds
  const narrationFadeIn = interpolate(
    frame,
    [0, Math.floor(fps * 0.5)],
    [0, narrationVolume],
    { extrapolateRight: "clamp" }
  );

  // Fade out narration over last 1 second
  const narrationFadeOut = interpolate(
    frame,
    [durationInFrames - fps, durationInFrames],
    [narrationVolume, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const currentNarrationVolume = Math.min(narrationFadeIn, narrationFadeOut);

  // Music ducking: lower music when narration is playing
  // Music fades in and out at beginning and end
  const musicFadeIn = interpolate(
    frame,
    [0, Math.floor(fps * 2)],
    [0, musicVolume],
    { extrapolateRight: "clamp" }
  );

  const musicFadeOut = interpolate(
    frame,
    [durationInFrames - fps * 2, durationInFrames],
    [musicVolume, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Duck music behind narration (reduce to 30% of base when narration is loud)
  const duckFactor = interpolate(
    currentNarrationVolume,
    [0, narrationVolume],
    [1, 0.3],
    { extrapolateRight: "clamp" }
  );

  const currentMusicVolume = Math.min(musicFadeIn, musicFadeOut) * duckFactor;

  const narrationAudioSrc = staticFile(narrationSrc);

  return (
    <>
      {/* Narration audio: original video audio is completely muted via <Video muted /> in ContentLayer */}
      <Audio src={narrationAudioSrc} volume={currentNarrationVolume} />

      {/* Background music with ducking */}
      {musicSrc && (
        <Audio
          src={staticFile(musicSrc)}
          volume={currentMusicVolume}
          loop
        />
      )}
    </>
  );
};
