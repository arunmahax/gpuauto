/**
 * Sequencer Module
 * Handles non-linear rearrangement of video segments.
 * Supports target duration control and multi-video source mixing.
 */
import { SceneSegment } from "./scene-detection";
import { NarrativeScript } from "./narrative-engine";
import { TTSResult } from "./voice-providers";

export interface SequencedClip {
  segment: SceneSegment;
  sequenceIndex: number;
  startFrame: number;
  durationInFrames: number;
  narrationText: string;
}

export interface SequenceResult {
  clips: SequencedClip[];
  totalDurationInFrames: number;
  totalDurationSec: number;
}

/**
 * Fisher-Yates shuffle (deterministic with seed).
 */
function seededShuffle<T>(array: T[], seed: number = 42): T[] {
  const shuffled = [...array];
  let currentSeed = seed;
  function random() {
    const x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
  }
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Build a non-linear sequence from video segments.
 *
 * @param segments - All scene segments (can be from multiple videos)
 * @param narrative - The narration script
 * @param ttsResult - TTS audio result with durations
 * @param fps - Output frames per second
 * @param targetDurationSec - Target output duration (0 = use narration length)
 */
export function buildSequence(
  segments: SceneSegment[],
  narrative: NarrativeScript,
  ttsResult: TTSResult,
  fps: number,
  targetDurationSec: number = 0
): SequenceResult {
  const narrationDurationSec = ttsResult.totalDuration;

  // Target = max of narration and user-specified target
  // If narration is longer, we follow narration; if target is longer, we pad with more clips
  const effectiveTargetSec = targetDurationSec > 0
    ? Math.max(narrationDurationSec, targetDurationSec)
    : narrationDurationSec;

  const effectiveTargetFrames = Math.ceil(effectiveTargetSec * fps);

  // Separate conclusion from other segments
  const conclusionSegment =
    segments.find((s) => s.isConclusion) || segments[segments.length - 1];
  const otherSegments = segments.filter((s) => s !== conclusionSegment);

  // Shuffle non-conclusion segments
  const shuffled = seededShuffle(otherSegments);

  const conclusionDurationSec = conclusionSegment.duration;
  const conclusionFrames = Math.ceil(conclusionDurationSec * fps);

  // Build clip list — body = target - conclusion
  const clips: SequencedClip[] = [];
  let currentFrame = 0;
  let narrationSegmentIndex = 0;

  const targetBodyFrames = Math.max(
    effectiveTargetFrames - conclusionFrames,
    fps * 10 // minimum 10 seconds
  );

  let clipSourceIndex = 0;

  while (currentFrame < targetBodyFrames) {
    const segment = shuffled[clipSourceIndex % shuffled.length];
    const clipFrames = Math.ceil(segment.duration * fps);

    const remainingFrames = targetBodyFrames - currentFrame;
    const actualFrames = Math.min(clipFrames, remainingFrames + fps); // 1s overshoot

    const narrationText =
      narrationSegmentIndex < narrative.segments.length
        ? narrative.segments[narrationSegmentIndex].text
        : "";

    clips.push({
      segment,
      sequenceIndex: clips.length,
      startFrame: currentFrame,
      durationInFrames: actualFrames,
      narrationText,
    });

    currentFrame += actualFrames;
    clipSourceIndex++;
    narrationSegmentIndex++;
  }

  // Add conclusion at end
  const conclusionNarration =
    narrative.conclusionIndex < narrative.segments.length
      ? narrative.segments[narrative.conclusionIndex].text
      : "";

  clips.push({
    segment: conclusionSegment,
    sequenceIndex: clips.length,
    startFrame: currentFrame,
    durationInFrames: conclusionFrames,
    narrationText: conclusionNarration,
  });

  currentFrame += conclusionFrames;

  const totalDurationInFrames = Math.max(currentFrame, effectiveTargetFrames);

  return {
    clips,
    totalDurationInFrames,
    totalDurationSec: totalDurationInFrames / fps,
  };
}
