/**
 * Main Pipeline Orchestrator v2
 * Supports multi-video input, filter presets, transitions, PiP,
 * logo overlay, multiple TTS providers, OpenRouter script generation,
 * and target duration control.
 *
 * Pipeline Steps:
 * 1. Scene detection & video splitting (per source video)
 * 2. Script generation (OpenRouter/OpenAI) or pre-written
 * 3. TTS voice synthesis (OpenAI/ElevenLabs/Fish/Google)
 * 4. Non-linear sequencing with target duration
 * 5. FFmpeg rendering (filters, transitions, PiP, logo, audio mix)
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";
import {
  splitVideoIntoSegments,
  extractAudio,
  SceneSegment,
  getVideoDuration,
} from "./scene-detection";
import {
  generateNarrative,
  NarrativeScript,
} from "./narrative-engine";
import {
  generateVoiceover,
  generateVoiceoverFromText,
  TTSResult,
  TTSConfig,
} from "./voice-providers";
import {
  generateScript,
  regenerateFromTranscript,
  ScriptGenConfig,
} from "./script-generator";
import { generateYouTubeMetadata, YouTubeMetadata } from "./youtube-metadata";
import { buildSequence, SequenceResult } from "./sequencer";
import { renderFinalVideo } from "./ffmpeg-renderer";
import {
  loadTemplateInput,
  TemplateInput,
  createExampleInput,
} from "./template-input";

interface PipelineResult {
  outputPath: string;
  totalDurationSec: number;
  segmentsUsed: number;
  clipsInSequence: number;
  youtubeMetadata?: YouTubeMetadata;
}

interface CacheManifest {
  sourceVideos: string[];
  segments: SceneSegment[];
  narrativeScript: NarrativeScript | null;
  ttsResult: TTSResult | null;
  completedSteps: number[];
}

const CACHE_FILE = "pipeline_cache.json";

function loadCache(tempDir: string): CacheManifest | null {
  const cachePath = path.join(tempDir, CACHE_FILE);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch { return null; }
}

function saveCache(tempDir: string, cache: CacheManifest): void {
  fs.writeFileSync(path.join(tempDir, CACHE_FILE), JSON.stringify(cache, null, 2), "utf-8");
}

function validateCachedSegments(segments: SceneSegment[]): boolean {
  return segments.every((s) => fs.existsSync(s.filePath));
}

function validateCachedTTS(ttsResult: TTSResult): boolean {
  if (!fs.existsSync(ttsResult.fullNarrationPath)) return false;
  return ttsResult.segmentPaths.every((p) => fs.existsSync(p));
}

/**
 * Run the full transformation pipeline.
 */
export async function runPipeline(inputJsonPath: string): Promise<PipelineResult> {
  const startTime = Date.now();

  console.log("═══════════════════════════════════════");
  console.log("  Video Transformation Pipeline v2");
  console.log("═══════════════════════════════════════\n");

  const input = loadTemplateInput(inputJsonPath);
  const sourceVideos = input.sourceVideos;
  console.log(`Sources: ${sourceVideos.map((v) => v.label).join(", ")}`);
  console.log(`Target: ~${input.targetDurationMin || 10} minutes`);

  fs.mkdirSync(CONFIG.paths.temp, { recursive: true });

  // ─── Check cache ───
  const cache = loadCache(CONFIG.paths.temp);
  const cacheVideoPaths = sourceVideos.map((v) => v.path).sort().join("|");
  const canResume = cache &&
    Array.isArray(cache.sourceVideos) &&
    cache.sourceVideos.sort().join("|") === cacheVideoPaths &&
    Array.isArray(cache.segments) &&
    validateCachedSegments(cache.segments);

  if (canResume) {
    console.log("Cache valid — resuming...\n");
  } else if (cache) {
    console.log("Cache invalid — starting fresh...\n");
    fs.rmSync(CONFIG.paths.temp, { recursive: true });
    fs.mkdirSync(CONFIG.paths.temp, { recursive: true });
  }

  const currentCache: CacheManifest = canResume
    ? cache!
    : { sourceVideos: sourceVideos.map((v) => v.path), segments: [], narrativeScript: null, ttsResult: null, completedSteps: [] };

  // ═══ Step 1: Scene Detection (per video) ═══
  let allSegments: SceneSegment[];

  if (currentCache.completedSteps.includes(1) && currentCache.segments.length > 0) {
    console.log("[1/5] Scene Detection — CACHED");
    allSegments = currentCache.segments;
    console.log(`  ${allSegments.length} total segments from cache\n`);
  } else {
    console.log("[1/5] Scene Detection & Video Splitting...");
    allSegments = [];

    for (let i = 0; i < sourceVideos.length; i++) {
      const v = sourceVideos[i];
      const segDir = path.join(CONFIG.paths.temp, `segments_v${i + 1}`);
      console.log(`  Processing ${v.label}: ${path.basename(v.path)}`);

      const segments = await splitVideoIntoSegments(v.path, segDir);
      // Tag segments with source video id
      segments.forEach((s) => {
        (s as any).sourceVideoId = v.id;
        (s as any).sourceVideoLabel = v.label;
      });
      allSegments.push(...segments);
      console.log(`  → ${segments.length} segments from ${v.label}`);
    }

    currentCache.segments = allSegments;
    currentCache.completedSteps.push(1);
    saveCache(CONFIG.paths.temp, currentCache);
    console.log(`  Total: ${allSegments.length} segments\n`);
  }

  // ═══ Step 2: Script Generation ═══
  let narrativeScript: NarrativeScript;

  const hasCachedNarrative = currentCache.completedSteps.includes(2) && currentCache.narrativeScript;
  const hasCachedTTS = currentCache.completedSteps.includes(3) && currentCache.ttsResult && validateCachedTTS(currentCache.ttsResult);

  if (input.narrationScript) {
    // Pre-written script mode
    console.log("[2/5] Script — using pre-written narration");
    const paragraphs = input.narrationScript.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    narrativeScript = {
      segments: paragraphs.map((text, i) => ({
        index: i,
        text,
        isConclusion: i === paragraphs.length - 1,
        estimatedDurationSec: (text.split(/\s+/).length / 150) * 60,
      })),
      fullScript: input.narrationScript,
      conclusionIndex: paragraphs.length - 1,
    };
  } else if (hasCachedNarrative) {
    console.log("[2/5] Script Generation — CACHED");
    narrativeScript = currentCache.narrativeScript!;
  } else if (input.useTranscriptRewrite) {
    // Transcript rewrite pipeline: Whisper → LLM rewrite
    const rewriteProvider = input.scriptProvider || CONFIG.defaultScriptProvider;
    console.log(`[2/5] Transcript → ${rewriteProvider} Rewrite...`);
    const audioPath = path.join(CONFIG.paths.temp, "source_audio.mp3");
    if (!fs.existsSync(audioPath)) {
      await extractAudio(sourceVideos[0].path, audioPath);
    }

    // Extract transcript via Whisper
    const { extractTranscript } = await import("./narrative-engine");
    const transcript = await extractTranscript(audioPath);
    const transcriptPath = path.join(CONFIG.paths.temp, "transcript.txt");
    fs.writeFileSync(transcriptPath, transcript, "utf-8");
    console.log(`  Transcript extracted: ~${transcript.split(/\\s+/).length} words`);

    // Derive a title from transcript if not provided
    const title = input.videoTitle || transcript.slice(0, 200).replace(/\n/g, " ");

    // Regenerate via selected provider
    narrativeScript = await regenerateFromTranscript(
      transcript,
      title,
      input.targetDurationMin || CONFIG.defaultTargetDuration / 60,
      input.scriptModel,
      input.scriptProvider || CONFIG.defaultScriptProvider
    );

    currentCache.narrativeScript = narrativeScript;
    if (!currentCache.completedSteps.includes(2)) currentCache.completedSteps.push(2);
    saveCache(CONFIG.paths.temp, currentCache);
  } else if (input.videoTitle) {
    // OpenRouter/OpenAI script generation from title
    console.log(`[2/5] Generating Script (${input.scriptProvider || CONFIG.defaultScriptProvider})...`);
    const scriptConfig: ScriptGenConfig = {
      provider: input.scriptProvider || CONFIG.defaultScriptProvider,
      model: input.scriptModel,
      videoTitle: input.videoTitle,
      targetDurationMin: input.targetDurationMin || CONFIG.defaultTargetDuration / 60,
    };
    narrativeScript = await generateScript(scriptConfig);
    currentCache.narrativeScript = narrativeScript;
    if (!currentCache.completedSteps.includes(2)) currentCache.completedSteps.push(2);
    saveCache(CONFIG.paths.temp, currentCache);
  } else {
    throw new Error("No script source provided. Set a video title, provide a script, or enable transcript rewrite mode.");
  }

  console.log(`  Script: ${narrativeScript.segments.length} segments\n`);

  // ═══ Step 2b: YouTube Metadata (Title + Description) ═══
  let youtubeMetadata: YouTubeMetadata | undefined;
  try {
    console.log("[2b/5] Generating YouTube Title & Description...");
    youtubeMetadata = await generateYouTubeMetadata(
      narrativeScript,
      input.videoTitle,
      input.scriptProvider || CONFIG.defaultScriptProvider,
      input.scriptModel
    );
  } catch (err: any) {
    console.warn(`  YouTube metadata generation failed: ${err.message}`);
    console.warn("  Continuing without metadata...\n");
  }

  // ═══ Step 3: TTS Voice Synthesis ═══
  let ttsResult: TTSResult;

  if (hasCachedTTS) {
    console.log("[3/5] Voice Synthesis — CACHED");
    ttsResult = currentCache.ttsResult!;
  } else {
    const ttsConfig: TTSConfig = {
      provider: input.ttsProvider || CONFIG.defaultTtsProvider,
      voice: input.ttsVoice || CONFIG.ttsVoice,
    };
    console.log(`[3/5] Voice Synthesis (${ttsConfig.provider})...`);

    if (input.narrationScript) {
      ttsResult = await generateVoiceoverFromText(input.narrationScript, ttsConfig);
    } else {
      ttsResult = await generateVoiceover(narrativeScript, ttsConfig);
    }

    currentCache.ttsResult = ttsResult;
    if (!currentCache.completedSteps.includes(3)) currentCache.completedSteps.push(3);
    saveCache(CONFIG.paths.temp, currentCache);
  }

  console.log(`  Narration: ${ttsResult.totalDuration.toFixed(1)}s\n`);

  // Mark conclusion
  if (allSegments.length > 0) {
    allSegments[allSegments.length - 1].isConclusion = true;
  }

  // ═══ Step 4: Sequencing ═══
  console.log("[4/5] Building Sequence...");
  const targetDurationSec = (input.targetDurationMin || 10) * 60;
  const sequence = buildSequence(
    allSegments,
    narrativeScript,
    ttsResult,
    CONFIG.fps,
    targetDurationSec
  );
  console.log(`  Sequence: ${sequence.clips.length} clips, ${sequence.totalDurationSec.toFixed(1)}s\n`);

  // ═══ Step 5: Render ═══
  console.log("[5/5] Rendering...");
  const outputName = input.outputName || "transformed_video";
  const outputPath = path.join(CONFIG.paths.output, `${outputName}.mp4`);
  fs.mkdirSync(CONFIG.paths.output, { recursive: true });

  // Determine PiP video path (second source video if available)
  let pipVideoPath: string | undefined;
  if (input.pip?.enabled && sourceVideos.length > 1) {
    pipVideoPath = sourceVideos[1].path;
  }

  await renderFinalVideo({
    sequence,
    ttsResult,
    templateInput: input,
    outputPath,
    pipVideoPath,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n═══════════════════════════════════════");
  console.log(`  Done! ${elapsed}s elapsed`);
  console.log(`  Output: ${outputPath}`);
  console.log("═══════════════════════════════════════\n");

  return {
    outputPath,
    totalDurationSec: sequence.totalDurationSec,
    segmentsUsed: allSegments.length,
    clipsInSequence: sequence.clips.length,
    youtubeMetadata,
  };
}

// ─── CLI entry point ───
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--example")) {
    const outPath = path.join(CONFIG.paths.input, "example_input.json");
    createExampleInput(outPath);
    process.exit(0);
  }
  const inputPath = args[0] || path.join(CONFIG.paths.input, "input.json");
  runPipeline(inputPath)
    .then((r) => console.log("Pipeline complete:", r))
    .catch((e) => { console.error("Pipeline failed:", e); process.exit(1); });
}
