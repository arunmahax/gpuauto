/**
 * JSON Template Input Schema & Loader
 * Supports multi-video input, PiP, logo overlay, filters, transitions, and multi-TTS.
 */
import fs from "fs";
import path from "path";
import { TTSProvider } from "./voice-providers";
import { ScriptProvider } from "./script-generator";

// ─── Multi-Video Source ───

export interface VideoSource {
  id: string;
  path: string;
  label: string; // "Video 1", "Video 2"
}

// ─── PiP Settings ───

export interface PiPSettings {
  enabled: boolean;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  scale: number;       // 0.15 - 0.5
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  opacity: number;
}

// ─── Logo Settings ───

export interface LogoSettings {
  enabled: boolean;
  path: string;        // path to logo image (PNG recommended)
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  scale: number;       // relative to output width (0.05 - 0.3)
  opacity: number;     // 0 - 1
  margin: number;      // pixels from edge
}

// ─── Transition Settings ───

export interface TransitionSettings {
  type: string;        // transition preset ID
  duration: number;    // seconds
}

/**
 * Input JSON schema for the pipeline.
 */
export interface TemplateInput {
  /** Primary source video(s) — can be 1-3 */
  sourceVideos: VideoSource[];
  /** @deprecated use sourceVideos[0] — kept for backward compat */
  sourceVideo?: string;

  /** Video title for AI script generation */
  videoTitle?: string;

  /** Pre-written narration script (skips AI script generation) */
  narrationScript?: string;

  /** Background music file path */
  backgroundMusic?: string;

  /** Output filename (without extension) */
  outputName?: string;

  /** Target output duration in minutes */
  targetDurationMin?: number;

  // ─── Visual ───
  filters?: string[];          // filter preset IDs to apply
  transition?: TransitionSettings;
  contentScale?: number;       // 0.5 - 1.0
  backgroundColor?: string;
  /** Background image path (replaces solid backgroundColor when set) */
  backgroundImage?: string;
  borderRadius?: number;

  // ─── PiP ───
  pip?: PiPSettings;

  // ─── Logo ───
  logo?: LogoSettings;

  // ─── Audio ───
  narrationVolume?: number;
  musicVolume?: number;

  // ─── TTS ───
  ttsProvider?: TTSProvider;
  ttsVoice?: string;           // provider-specific voice ID

  // ─── Script Generation ───
  scriptProvider?: ScriptProvider;
  scriptModel?: string;
  /** When true, extract transcript from video and rewrite via Claude */
  useTranscriptRewrite?: boolean;

  // ─── Scene Detection ───
  sceneThreshold?: number;

  /** Legacy template overrides (merged into top-level) */
  template?: Record<string, any>;
}

/**
 * Default values.
 */
export const DEFAULT_TEMPLATE = {
  filters: [] as string[],
  transition: { type: "fade", duration: 0.3 } as TransitionSettings,
  contentScale: 0.85,
  backgroundColor: "#0a0a0a",
  backgroundImage: "",
  borderRadius: 8,
  narrationVolume: 1.0,
  musicVolume: 0.12,
  targetDurationMin: 10,
  pip: {
    enabled: false,
    position: "top-right" as const,
    scale: 0.25,
    borderRadius: 8,
    borderColor: "#ffffff",
    borderWidth: 2,
    opacity: 1.0,
  } as PiPSettings,
  logo: {
    enabled: false,
    path: "",
    position: "bottom-right" as const,
    scale: 0.12,
    opacity: 0.7,
    margin: 20,
  } as LogoSettings,
};

/**
 * Load and validate a template input JSON file.
 */
export function loadTemplateInput(jsonPath: string): TemplateInput {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Input JSON not found: ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  let input: TemplateInput;

  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in input file: ${jsonPath}`);
  }

  // Backward compat: sourceVideo → sourceVideos
  if (!input.sourceVideos && input.sourceVideo) {
    const resolved = path.isAbsolute(input.sourceVideo)
      ? input.sourceVideo
      : path.resolve(path.dirname(jsonPath), input.sourceVideo);
    input.sourceVideos = [{ id: "v1", path: resolved, label: "Video 1" }];
  }

  if (!input.sourceVideos || input.sourceVideos.length === 0) {
    throw new Error("Input must include at least one source video (sourceVideos)");
  }

  // Resolve & validate all video paths
  for (const v of input.sourceVideos) {
    if (!path.isAbsolute(v.path)) {
      v.path = path.resolve(path.dirname(jsonPath), v.path);
    }
    if (!fs.existsSync(v.path)) {
      throw new Error(`Source video not found: ${v.path}`);
    }
  }

  // Set sourceVideo for backward compat
  input.sourceVideo = input.sourceVideos[0].path;

  // Apply defaults
  input.filters = input.filters || DEFAULT_TEMPLATE.filters;
  input.transition = { ...DEFAULT_TEMPLATE.transition, ...(input.transition || {}) };
  input.contentScale = input.contentScale ?? DEFAULT_TEMPLATE.contentScale;
  input.backgroundColor = input.backgroundColor || DEFAULT_TEMPLATE.backgroundColor;
  input.borderRadius = input.borderRadius ?? DEFAULT_TEMPLATE.borderRadius;
  input.narrationVolume = input.narrationVolume ?? DEFAULT_TEMPLATE.narrationVolume;
  input.musicVolume = input.musicVolume ?? DEFAULT_TEMPLATE.musicVolume;
  input.targetDurationMin = input.targetDurationMin ?? DEFAULT_TEMPLATE.targetDurationMin;
  input.pip = { ...DEFAULT_TEMPLATE.pip, ...(input.pip || {}) };
  input.logo = { ...DEFAULT_TEMPLATE.logo, ...(input.logo || {}) };

  return input;
}

/**
 * Create an example input JSON file.
 */
export function createExampleInput(outputPath: string): void {
  const example: TemplateInput = {
    sourceVideos: [
      { id: "v1", path: "./input/video1.mp4", label: "Main Video" },
      { id: "v2", path: "./input/video2.mp4", label: "B-Roll" },
    ],
    videoTitle: "The Untold Story of...",
    outputName: "transformed_video",
    targetDurationMin: 10,
    filters: ["cinematic", "grain_light"],
    transition: { type: "fade", duration: 0.3 },
    contentScale: 0.85,
    backgroundColor: "#0a0a0a",
    pip: { enabled: true, position: "top-right", scale: 0.25, borderRadius: 8, borderColor: "#ffffff", borderWidth: 2, opacity: 1 },
    logo: { enabled: false, path: "./assets/logos/logo.png", position: "bottom-right", scale: 0.12, opacity: 0.7, margin: 20 },
    backgroundMusic: "ambient.mp3",
    narrationVolume: 1.0,
    musicVolume: 0.12,
    ttsProvider: "openai",
    ttsVoice: "onyx",
    scriptProvider: "openrouter",
  };

  fs.writeFileSync(outputPath, JSON.stringify(example, null, 2), "utf-8");
  console.log(`Example input created: ${outputPath}`);
}
