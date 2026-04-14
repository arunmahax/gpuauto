/**
 * Voice Synthesis Module
 * Uses OpenAI TTS API to generate narration audio from script segments.
 */
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { CONFIG } from "../utils/config";
import { NarrativeScript, NarrativeSegment } from "./narrative-engine";

const openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });

export interface TTSResult {
  /** Path to the combined full narration audio file */
  fullNarrationPath: string;
  /** Paths to individual segment audio files */
  segmentPaths: string[];
  /** Actual measured durations for each segment in seconds */
  segmentDurations: number[];
  /** Total narration duration in seconds */
  totalDuration: number;
}

/**
 * Generate TTS audio for a single text segment.
 */
async function synthesizeSegment(
  text: string,
  outputPath: string
): Promise<void> {
  const response = await openai.audio.speech.create({
    model: CONFIG.ttsModel,
    voice: CONFIG.ttsVoice,
    input: text,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Get the duration of an audio file using FFmpeg.
 */
function getAudioDuration(audioPath: string): number {
  let result = "";
  try {
    result = execSync(
      `"${CONFIG.ffmpegPath}" -i "${audioPath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err: any) {
    // FFmpeg returns non-zero when just probing, but stderr has the info
    result = (err.stderr || err.stdout || "").toString();
  }

  const match = result.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  const centiseconds = parseInt(match[4]);

  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

/**
 * Concatenate multiple audio files into one using FFmpeg.
 */
function concatenateAudio(
  inputPaths: string[],
  outputPath: string
): void {
  const listPath = path.join(CONFIG.paths.temp, "audio_concat_list.txt");
  const listContent = inputPaths
    .map((p) => `file '${p.replace(/\\/g, "/")}'`)
    .join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  execSync(
    `"${CONFIG.ffmpegPath}" -y -f concat -safe 0 -i "${listPath}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
    { stdio: "pipe" }
  );
}

/**
 * Run async tasks in parallel with a concurrency limit.
 */
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const TTS_CONCURRENCY = 5;

/**
 * Generate TTS audio for the entire narrative script.
 */
export async function generateVoiceover(
  script: NarrativeScript
): Promise<TTSResult> {
  const ttsDir = path.join(CONFIG.paths.temp, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`Generating TTS for ${script.segments.length} segments (concurrency: ${TTS_CONCURRENCY})...`);

  const segmentResults = await parallelLimit(script.segments, TTS_CONCURRENCY, async (segment) => {
    const segPath = path.join(
      ttsDir,
      `narration_${String(segment.index).padStart(4, "0")}.mp3`
    );
    console.log(`  TTS segment ${segment.index + 1}/${script.segments.length}`);
    await synthesizeSegment(segment.text, segPath);
    const duration = getAudioDuration(segPath);
    return { segPath, duration };
  });

  const segmentPaths = segmentResults.map((r) => r.segPath);
  const segmentDurations = segmentResults.map((r) => r.duration);

  // Concatenate all segments into one file
  const fullNarrationPath = path.join(CONFIG.paths.temp, "full_narration.mp3");
  concatenateAudio(segmentPaths, fullNarrationPath);

  const totalDuration = getAudioDuration(fullNarrationPath);

  console.log(`Full narration generated: ${totalDuration.toFixed(1)}s`);

  return {
    fullNarrationPath,
    segmentPaths,
    segmentDurations,
    totalDuration,
  };
}

/**
 * Generate TTS from a pre-written script text (for template mode).
 */
export async function generateVoiceoverFromText(
  scriptText: string
): Promise<TTSResult> {
  const ttsDir = path.join(CONFIG.paths.temp, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });

  // Split script into paragraphs as segments
  const paragraphs = scriptText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const segmentPaths: string[] = [];
  const segmentDurations: number[] = [];

  console.log(`Generating TTS for ${paragraphs.length} paragraphs (concurrency: ${TTS_CONCURRENCY})...`);

  const paragraphItems = paragraphs.map((text, i) => ({ text, i }));
  const results = await parallelLimit(paragraphItems, TTS_CONCURRENCY, async ({ text, i }) => {
    const segPath = path.join(
      ttsDir,
      `narration_${String(i).padStart(4, "0")}.mp3`
    );
    console.log(`  TTS segment ${i + 1}/${paragraphs.length}`);
    await synthesizeSegment(text, segPath);
    const duration = getAudioDuration(segPath);
    return { segPath, duration };
  });

  const segmentPaths = results.map((r) => r.segPath);
  const segmentDurations = results.map((r) => r.duration);

  const fullNarrationPath = path.join(CONFIG.paths.temp, "full_narration.mp3");
  concatenateAudio(segmentPaths, fullNarrationPath);

  const totalDuration = getAudioDuration(fullNarrationPath);

  return {
    fullNarrationPath,
    segmentPaths,
    segmentDurations,
    totalDuration,
  };
}
