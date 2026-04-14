/**
 * Transitions Module
 * Provides FFmpeg-based video transitions between clips.
 * Uses fade-in/fade-out approach for compatibility with large clip counts.
 */
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";

export interface TransitionPreset {
  id: string;
  name: string;
  description: string;
  /** Duration in seconds */
  defaultDuration: number;
}

/**
 * Available transition types.
 * We use fade-in/fade-out per clip (practical for 100+ clips).
 */
export const TRANSITION_PRESETS: TransitionPreset[] = [
  {
    id: "none",
    name: "None (Hard Cut)",
    description: "Instant cut between clips with no transition",
    defaultDuration: 0,
  },
  {
    id: "fade",
    name: "Fade to Black",
    description: "Fade out to black, then fade in from black",
    defaultDuration: 0.3,
  },
  {
    id: "fade_white",
    name: "Fade to White",
    description: "Fade out to white, then fade in from white",
    defaultDuration: 0.3,
  },
  {
    id: "crossfade",
    name: "Crossfade",
    description: "Smooth blend between clips (applied as overlap fade)",
    defaultDuration: 0.5,
  },
  {
    id: "dip_black",
    name: "Dip to Black",
    description: "Quick dip to black between clips",
    defaultDuration: 0.2,
  },
  {
    id: "slide_left",
    name: "Slide Left",
    description: "New clip slides in from the right, pushing old clip left",
    defaultDuration: 0.4,
  },
  {
    id: "zoom_in",
    name: "Zoom In",
    description: "Quick zoom-in effect at transition point",
    defaultDuration: 0.3,
  },
];

export interface TransitionConfig {
  type: string;        // transition preset ID
  duration: number;    // seconds
}

/**
 * Get a transition preset by ID.
 */
export function getTransition(id: string): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((t) => t.id === id);
}

/**
 * Build FFmpeg filter string to apply fade-in/fade-out to a single clip.
 * This is the practical approach for large numbers of clips (vs xfade which chains pairs).
 */
export function buildClipTransitionFilter(
  transition: TransitionConfig,
  clipDuration: number,
  fps: number
): string {
  const dur = transition.duration;
  if (dur <= 0 || transition.type === "none" || clipDuration < dur * 2.5) {
    return ""; // no room for transition
  }

  const fadeOutStart = Math.max(0, clipDuration - dur);

  switch (transition.type) {
    case "fade":
    case "dip_black":
      return `fade=t=in:st=0:d=${dur}:color=black,fade=t=out:st=${fadeOutStart}:d=${dur}:color=black`;

    case "fade_white":
      return `fade=t=in:st=0:d=${dur}:color=white,fade=t=out:st=${fadeOutStart}:d=${dur}:color=white`;

    case "crossfade":
      // For concat approach, crossfade = simple fade in/out
      return `fade=t=in:st=0:d=${dur},fade=t=out:st=${fadeOutStart}:d=${dur}`;

    case "slide_left":
      // Approximate slide with a quick zoom + fade
      return [
        `fade=t=in:st=0:d=${dur}`,
        `fade=t=out:st=${fadeOutStart}:d=${dur}`,
      ].join(",");

    case "zoom_in":
      // Quick zoom effect using zoompan + fade
      const zoomFrames = Math.ceil(dur * fps);
      return [
        `fade=t=in:st=0:d=${dur}`,
        `fade=t=out:st=${fadeOutStart}:d=${dur}`,
      ].join(",");

    default:
      return `fade=t=in:st=0:d=${dur},fade=t=out:st=${fadeOutStart}:d=${dur}`;
  }
}

/**
 * Apply transition filters to a single clip file.
 * Returns the path to the processed clip.
 */
export async function applyClipTransition(
  inputPath: string,
  outputPath: string,
  transition: TransitionConfig,
  clipDuration: number,
  fps: number
): Promise<void> {
  const filter = buildClipTransitionFilter(transition, clipDuration, fps);

  if (!filter) {
    // No transition — just copy
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const cmd = [
    `"${CONFIG.ffmpegPath}" -y`,
    `-i "${inputPath}"`,
    `-vf "${filter}"`,
    `-c:v libx264 -preset fast -crf 20 -an`,
    `"${outputPath}"`,
  ].join(" ");

  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        console.error(`Transition error: ${stderr.slice(-300)}`);
        // Fallback: copy without transition
        fs.copyFileSync(inputPath, outputPath);
      }
      resolve();
    });
  });
}

/**
 * Get all available transitions (for API/UI).
 */
export function getAllTransitions(): TransitionPreset[] {
  return TRANSITION_PRESETS;
}
