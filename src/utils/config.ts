import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const CONFIG = {
  // ─── API Keys ───
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
  fishApiKey: process.env.FISH_API_KEY || "",
  fishReferenceId: process.env.FISH_REFERENCE_ID || "",
  googleTtsApiKey: process.env.GOOGLE_TTS_API_KEY || "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // ─── LLM ───
  llmModel: process.env.LLM_MODEL || "gpt-4o",

  // ─── TTS ───
  ttsModel: (process.env.TTS_MODEL || "tts-1") as "tts-1" | "tts-1-hd",
  ttsVoice: (process.env.TTS_VOICE || "onyx") as
    | "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
  defaultTtsProvider: (process.env.DEFAULT_TTS_PROVIDER || "openai") as
    | "openai" | "elevenlabs" | "fish" | "google",

  // ─── Script Generation ───
  defaultScriptProvider: (process.env.DEFAULT_SCRIPT_PROVIDER || "openrouter") as
    | "openai" | "openrouter" | "claude",

  // ─── FFmpeg ───
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  sceneThreshold: parseFloat(process.env.SCENE_THRESHOLD || "0.3"),

  // ─── Output ───
  fps: parseInt(process.env.OUTPUT_FPS || "30", 10),
  width: parseInt(process.env.OUTPUT_WIDTH || "1920", 10),
  height: parseInt(process.env.OUTPUT_HEIGHT || "1080", 10),
  defaultTargetDuration: parseInt(process.env.DEFAULT_TARGET_DURATION || "600", 10),

  // ─── Paths ───
  paths: {
    assets: path.resolve(__dirname, "../../assets"),
    backgrounds: path.resolve(__dirname, "../../assets/backgrounds"),
    music: path.resolve(__dirname, "../../assets/music"),
    logos: path.resolve(__dirname, "../../assets/logos"),
    templates: path.resolve(__dirname, "../../assets/templates"),
    input: path.resolve(__dirname, "../../input"),
    output: path.resolve(__dirname, "../../output"),
    temp: path.resolve(__dirname, "../../temp"),
  },
};
