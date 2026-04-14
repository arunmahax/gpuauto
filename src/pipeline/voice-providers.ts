/**
 * Multi-Provider Voice Synthesis Module
 * Supports: OpenAI TTS, ElevenLabs, Fish Audio, Google Cloud TTS
 */
import OpenAI from "openai";
import https from "https";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { CONFIG } from "../utils/config";
import { NarrativeScript } from "./narrative-engine";

export type TTSProvider = "openai" | "elevenlabs" | "fish" | "google";

export interface TTSConfig {
  provider: TTSProvider;
  voice?: string;       // provider-specific voice ID
  model?: string;       // provider-specific model
  speed?: number;       // speech speed multiplier
  stability?: number;   // ElevenLabs stability (0-1)
  similarity?: number;  // ElevenLabs similarity boost (0-1)
}

export interface TTSResult {
  fullNarrationPath: string;
  segmentPaths: string[];
  segmentDurations: number[];
  totalDuration: number;
}

// ─── Provider Voices (for UI dropdowns) ───

export const PROVIDER_VOICES: Record<TTSProvider, { id: string; name: string }[]> = {
  openai: [
    { id: "alloy", name: "Alloy" },
    { id: "echo", name: "Echo" },
    { id: "fable", name: "Fable" },
    { id: "onyx", name: "Onyx" },
    { id: "nova", name: "Nova" },
    { id: "shimmer", name: "Shimmer" },
  ],
  elevenlabs: [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
    { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
    { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
    { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
    { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
    { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
    { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
    { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
  ],
  fish: [
    { id: "default", name: "Default" },
  ],
  google: [
    { id: "en-US-Neural2-A", name: "Neural2-A (Female)" },
    { id: "en-US-Neural2-C", name: "Neural2-C (Female)" },
    { id: "en-US-Neural2-D", name: "Neural2-D (Male)" },
    { id: "en-US-Neural2-F", name: "Neural2-F (Female)" },
    { id: "en-US-Neural2-I", name: "Neural2-I (Male)" },
    { id: "en-US-Neural2-J", name: "Neural2-J (Male)" },
    { id: "en-US-Studio-M", name: "Studio-M (Male)" },
    { id: "en-US-Studio-O", name: "Studio-O (Female)" },
  ],
};

// ─── Audio Duration Helper ───

function getAudioDuration(audioPath: string): number {
  let result = "";
  try {
    result = execSync(
      `"${CONFIG.ffmpegPath}" -i "${audioPath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err: any) {
    result = (err.stderr || err.stdout || "").toString();
  }
  const match = result.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 +
    parseInt(match[3]) + parseInt(match[4]) / 100;
}

// ─── Concatenate Audio ───

function concatenateAudio(inputPaths: string[], outputPath: string): void {
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

// ─── OpenAI TTS ───

async function synthesizeOpenAI(text: string, outputPath: string, config: TTSConfig): Promise<void> {
  const openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });
  const response = await openai.audio.speech.create({
    model: (config.model as "tts-1" | "tts-1-hd") || CONFIG.ttsModel,
    voice: (config.voice || CONFIG.ttsVoice) as any,
    input: text,
    response_format: "mp3",
    speed: config.speed || 1.0,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

// ─── ElevenLabs TTS ───

async function synthesizeElevenLabs(text: string, outputPath: string, config: TTSConfig): Promise<void> {
  const apiKey = CONFIG.elevenlabsApiKey;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set in .env");

  const voiceId = config.voice || CONFIG.elevenlabsVoiceId;
  const body = JSON.stringify({
    text,
    model_id: config.model || "eleven_monolingual_v1",
    voice_settings: {
      stability: config.stability ?? 0.5,
      similarity_boost: config.similarity ?? 0.75,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${voiceId}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
          Accept: "audio/mpeg",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (d) => (errBody += d));
          res.on("end", () => reject(new Error(`ElevenLabs ${res.statusCode}: ${errBody}`)));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          fs.writeFileSync(outputPath, Buffer.concat(chunks));
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Fish Audio TTS ───

async function synthesizeFish(text: string, outputPath: string, config: TTSConfig): Promise<void> {
  const apiKey = CONFIG.fishApiKey;
  if (!apiKey) throw new Error("FISH_API_KEY not set in .env");

  const body = JSON.stringify({
    text,
    reference_id: config.voice || CONFIG.fishReferenceId || undefined,
    format: "mp3",
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.fish.audio",
        path: "/v1/tts",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (d) => (errBody += d));
          res.on("end", () => reject(new Error(`Fish Audio ${res.statusCode}: ${errBody}`)));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          fs.writeFileSync(outputPath, Buffer.concat(chunks));
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Google Cloud TTS ───

async function synthesizeGoogle(text: string, outputPath: string, config: TTSConfig): Promise<void> {
  const apiKey = CONFIG.googleTtsApiKey;
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY not set in .env");

  const body = JSON.stringify({
    input: { text },
    voice: {
      languageCode: "en-US",
      name: config.voice || "en-US-Neural2-D",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: config.speed || 1.0,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "texttospeech.googleapis.com",
        path: `/v1/text:synthesize?key=${apiKey}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let resBody = "";
        res.on("data", (d) => (resBody += d));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Google TTS ${res.statusCode}: ${resBody}`));
            return;
          }
          try {
            const json = JSON.parse(resBody);
            const audioBuffer = Buffer.from(json.audioContent, "base64");
            fs.writeFileSync(outputPath, audioBuffer);
            resolve();
          } catch (e: any) {
            reject(new Error(`Google TTS parse error: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Unified Synthesize Function ───

async function synthesizeSegment(
  text: string,
  outputPath: string,
  config: TTSConfig
): Promise<void> {
  switch (config.provider) {
    case "openai":
      return synthesizeOpenAI(text, outputPath, config);
    case "elevenlabs":
      return synthesizeElevenLabs(text, outputPath, config);
    case "fish":
      return synthesizeFish(text, outputPath, config);
    case "google":
      return synthesizeGoogle(text, outputPath, config);
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}

// ─── Concurrency Helper ───

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

// ─── Main Export: Generate Full Voiceover ───

export async function generateVoiceover(
  script: NarrativeScript,
  config?: TTSConfig
): Promise<TTSResult> {
  const ttsConfig: TTSConfig = config || {
    provider: CONFIG.defaultTtsProvider,
    voice: CONFIG.ttsVoice,
  };

  const ttsDir = path.join(CONFIG.paths.temp, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`Generating TTS (${ttsConfig.provider}) for ${script.segments.length} segments (concurrency: ${TTS_CONCURRENCY})...`);

  const segmentResults = await parallelLimit(script.segments, TTS_CONCURRENCY, async (segment) => {
    const segPath = path.join(ttsDir, `narration_${String(segment.index).padStart(4, "0")}.mp3`);
    console.log(`  TTS segment ${segment.index + 1}/${script.segments.length} [${ttsConfig.provider}]`);
    await synthesizeSegment(segment.text, segPath, ttsConfig);
    const duration = getAudioDuration(segPath);
    return { segPath, duration };
  });

  const segmentPaths = segmentResults.map((r) => r.segPath);
  const segmentDurations = segmentResults.map((r) => r.duration);

  const fullNarrationPath = path.join(CONFIG.paths.temp, "full_narration.mp3");
  concatenateAudio(segmentPaths, fullNarrationPath);
  const totalDuration = getAudioDuration(fullNarrationPath);

  console.log(`Full narration: ${totalDuration.toFixed(1)}s (${ttsConfig.provider})`);

  return { fullNarrationPath, segmentPaths, segmentDurations, totalDuration };
}

/**
 * Generate TTS from pre-written script text.
 */
export async function generateVoiceoverFromText(
  scriptText: string,
  config?: TTSConfig
): Promise<TTSResult> {
  const ttsConfig: TTSConfig = config || {
    provider: CONFIG.defaultTtsProvider,
    voice: CONFIG.ttsVoice,
  };

  const ttsDir = path.join(CONFIG.paths.temp, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });

  const paragraphs = scriptText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  console.log(`Generating TTS (${ttsConfig.provider}) for ${paragraphs.length} paragraphs (concurrency: ${TTS_CONCURRENCY})...`);

  const paragraphItems = paragraphs.map((text, i) => ({ text, i }));
  const results = await parallelLimit(paragraphItems, TTS_CONCURRENCY, async ({ text, i }) => {
    const segPath = path.join(ttsDir, `narration_${String(i).padStart(4, "0")}.mp3`);
    console.log(`  TTS segment ${i + 1}/${paragraphs.length} [${ttsConfig.provider}]`);
    await synthesizeSegment(text, segPath, ttsConfig);
    const duration = getAudioDuration(segPath);
    return { segPath, duration };
  });

  const segmentPaths = results.map((r) => r.segPath);
  const segmentDurations = results.map((r) => r.duration);

  const fullNarrationPath = path.join(CONFIG.paths.temp, "full_narration.mp3");
  concatenateAudio(segmentPaths, fullNarrationPath);
  const totalDuration = getAudioDuration(fullNarrationPath);

  return { fullNarrationPath, segmentPaths, segmentDurations, totalDuration };
}
