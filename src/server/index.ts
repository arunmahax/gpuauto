/**
 * Express API Server v2
 * Full-featured API with multi-video upload, template management,
 * filter/transition browsing, logo upload, and pipeline control.
 */
import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { CONFIG } from "../utils/config";
import { runPipeline } from "../pipeline/orchestrator";
import { isRunPod, stopPod } from "../utils/runpod";
import { getAllFilters } from "../pipeline/filters";
import { getAllTransitions } from "../pipeline/transitions";
import { PROVIDER_VOICES, TTSProvider } from "../pipeline/voice-providers";
import { getMasterPrompt } from "../pipeline/script-generator";
import {
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
} from "../utils/templates";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.resolve(__dirname, "../web/public")));

// ─── Upload Config ───

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    let dir: string;
    // Route to backgrounds dir when uploading via /api/upload/background
    if ((req as any)._uploadTarget === "background") {
      dir = CONFIG.paths.backgrounds;
    } else if ([".png", ".jpg", ".jpeg", ".svg", ".webp"].includes(ext)) {
      dir = CONFIG.paths.logos;
    } else if ([".mp3", ".wav", ".ogg", ".m4a", ".aac"].includes(ext)) {
      dir = CONFIG.paths.music;
    } else {
      dir = path.join(CONFIG.paths.input, "uploads");
    }
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").replace(ext, "");
    cb(null, `${safeName}_${Date.now()}${ext}`);
  },
});

const ALLOWED_VIDEO_EXT = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
const ALLOWED_AUDIO_EXT = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];
const ALLOWED_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([...ALLOWED_VIDEO_EXT, ...ALLOWED_AUDIO_EXT, ...ALLOWED_IMAGE_EXT].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed`));
    }
  },
});

// ─── Job Tracking ───

interface Job {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: string;
  sourceVideos: string[];
  outputPath?: string;
  outputName: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  settings: Record<string, unknown>;
  youtubeMetadata?: { title: string; description: string; tags: string[] };
}

const jobs = new Map<string, Job>();

// ═══════════════════════════════════════
//  VIDEO UPLOAD (multi-file)
// ═══════════════════════════════════════

app.post("/api/upload/videos", upload.array("videos", 3), (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No video files uploaded" });
    return;
  }
  const result = files.map((f, i) => ({
    id: `v${i + 1}`,
    filename: f.filename,
    path: f.path,
    size: f.size,
    label: `Video ${i + 1}`,
  }));
  res.json(result);
});

// Single video upload (backward compat)
app.post("/api/upload/video", upload.single("video"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No video file" }); return; }
  res.json({ filename: req.file.filename, path: req.file.path, size: req.file.size });
});

// ═══════════════════════════════════════
//  MUSIC UPLOAD
// ═══════════════════════════════════════

app.post("/api/upload/music", upload.single("music"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No music file" }); return; }
  res.json({ filename: req.file.filename, path: req.file.path, size: req.file.size });
});

// ═══════════════════════════════════════
//  LOGO UPLOAD
// ═══════════════════════════════════════

app.post("/api/upload/logo", upload.single("logo"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No logo file" }); return; }
  res.json({ filename: req.file.filename, path: req.file.path, size: req.file.size });
});

// ═══════════════════════════════════════
//  BACKGROUND IMAGE UPLOAD
// ═══════════════════════════════════════

app.post("/api/upload/background", (req, res, next) => {
  (req as any)._uploadTarget = "background";
  next();
}, upload.single("background"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No background image" }); return; }
  res.json({ filename: req.file.filename, path: req.file.path, size: req.file.size });
});

// ═══════════════════════════════════════
//  YOUTUBE URL DOWNLOAD
// ═══════════════════════════════════════

app.post("/api/download-youtube", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  // Basic YouTube URL validation
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/;
  if (!ytRegex.test(url)) {
    res.status(400).json({ error: "Invalid YouTube URL" });
    return;
  }

  const uploadsDir = path.join(CONFIG.paths.input, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const safeId = `yt_${Date.now()}`;
  const outputFile = path.join(uploadsDir, `${safeId}.mp4`);

  // Try yt-dlp first, fall back to youtube-dl
  const ytBin = await findYtDlp();
  if (!ytBin) {
    res.status(500).json({ error: "yt-dlp not installed. Run: pip install yt-dlp" });
    return;
  }

  const args = [
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", outputFile,
    url,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(ytBin, args, { timeout: 300000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
    });

    const stat = fs.statSync(outputFile);
    const filename = path.basename(outputFile);
    res.json({ filename, path: outputFile, size: stat.size });
  } catch (err: any) {
    res.status(500).json({ error: "Download failed: " + err.message });
  }
});

function findYtDlp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("yt-dlp", ["--version"], (err) => {
      if (!err) return resolve("yt-dlp");
      execFile("youtube-dl", ["--version"], (err2) => {
        resolve(err2 ? null : "youtube-dl");
      });
    });
  });
}

// ═══════════════════════════════════════
//  TRANSFORM (start pipeline)
// ═══════════════════════════════════════

app.post("/api/transform", (req, res) => {
  const body = req.body;

  // Build sourceVideos array
  let sourceVideos: { id: string; path: string; label: string }[] = [];

  if (body.sourceVideos && Array.isArray(body.sourceVideos)) {
    sourceVideos = body.sourceVideos.map((v: any, i: number) => ({
      id: v.id || `v${i + 1}`,
      path: path.isAbsolute(v.path) ? v.path : path.resolve(CONFIG.paths.input, v.path),
      label: v.label || `Video ${i + 1}`,
    }));
  } else if (body.sourceVideoPath) {
    const p = path.isAbsolute(body.sourceVideoPath)
      ? body.sourceVideoPath
      : path.resolve(CONFIG.paths.input, body.sourceVideoPath);
    sourceVideos = [{ id: "v1", path: p, label: "Video 1" }];
  }

  if (sourceVideos.length === 0) {
    res.status(400).json({ error: "At least one source video is required" });
    return;
  }

  // Verify all videos exist
  for (const v of sourceVideos) {
    if (!fs.existsSync(v.path)) {
      res.status(400).json({ error: `Video not found: ${v.path}` });
      return;
    }
  }

  const jobId = uuidv4();
  const jobOutputName = body.outputName || `transformed_${Date.now()}`;

  // Build pipeline input JSON
  const inputJson: Record<string, any> = {
    sourceVideos,
    sourceVideo: sourceVideos[0].path,
    videoTitle: body.videoTitle || null,
    narrationScript: body.narrationScript || null,
    backgroundMusic: body.backgroundMusic || null,
    outputName: jobOutputName,
    targetDurationMin: body.targetDurationMin || 10,
    filters: body.filters || [],
    transition: body.transition || { type: "fade", duration: 0.3 },
    contentScale: body.contentScale ?? 0.85,
    backgroundColor: body.backgroundColor || "#0a0a0a",
    backgroundImage: body.backgroundImage || "",
    borderRadius: body.borderRadius ?? 8,
    pip: body.pip || { enabled: false },
    logo: body.logo || { enabled: false },
    narrationVolume: body.narrationVolume ?? 1.0,
    musicVolume: body.musicVolume ?? 0.12,
    ttsProvider: body.ttsProvider || "openai",
    ttsVoice: body.ttsVoice || "onyx",
    scriptProvider: body.scriptProvider || "openrouter",
    scriptModel: body.scriptModel || null,
    sceneThreshold: body.sceneThreshold || 0.3,
    useTranscriptRewrite: body.useTranscriptRewrite || false,
  };

  const inputJsonPath = path.join(CONFIG.paths.temp, `job_${jobId}.json`);
  fs.mkdirSync(CONFIG.paths.temp, { recursive: true });
  fs.writeFileSync(inputJsonPath, JSON.stringify(inputJson, null, 2));

  const job: Job = {
    id: jobId,
    status: "queued",
    progress: "Queued...",
    sourceVideos: sourceVideos.map((v) => v.path),
    outputName: jobOutputName,
    createdAt: new Date().toISOString(),
    settings: inputJson,
  };
  jobs.set(jobId, job);

  // Run async
  (async () => {
    try {
      job.status = "processing";
      job.progress = "Starting pipeline...";
      const result = await runPipeline(inputJsonPath);
      job.status = "completed";
      job.progress = "Done!";
      job.outputPath = result.outputPath;
      job.youtubeMetadata = result.youtubeMetadata;
      job.completedAt = new Date().toISOString();

      // Auto-stop RunPod pod after completion (saves costs)
      if (isRunPod()) {
        // Small delay to let the client poll the completed status and download
        setTimeout(() => stopPod(), 60_000);
        job.progress = "Done! Pod will auto-stop in 60s. Download your video now.";
      }
    } catch (err: any) {
      job.status = "failed";
      job.error = err.message || String(err);
      job.progress = `Failed: ${job.error}`;
    }
  })();

  res.json({ jobId, status: "queued" });
});

// ═══════════════════════════════════════
//  JOBS
// ═══════════════════════════════════════

app.get("/api/jobs", (_req, res) => {
  const allJobs = Array.from(jobs.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(allJobs);
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job);
});

// ═══════════════════════════════════════
//  DOWNLOADS
// ═══════════════════════════════════════

app.get("/api/download/:filename", (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(CONFIG.paths.output, safeName);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath);
});

// ═══════════════════════════════════════
//  FILE LISTINGS
// ═══════════════════════════════════════

app.get("/api/files/music", (_req, res) => {
  const dir = CONFIG.paths.music;
  if (!fs.existsSync(dir)) { res.json([]); return; }
  res.json(fs.readdirSync(dir).filter((f) => ALLOWED_AUDIO_EXT.includes(path.extname(f).toLowerCase())));
});

app.get("/api/files/logos", (_req, res) => {
  const dir = CONFIG.paths.logos;
  if (!fs.existsSync(dir)) { res.json([]); return; }
  res.json(fs.readdirSync(dir).filter((f) => ALLOWED_IMAGE_EXT.includes(path.extname(f).toLowerCase())));
});

app.get("/api/files/backgrounds", (_req, res) => {
  const dir = CONFIG.paths.backgrounds;
  if (!fs.existsSync(dir)) { res.json([]); return; }
  res.json(fs.readdirSync(dir).filter((f) => ALLOWED_IMAGE_EXT.includes(path.extname(f).toLowerCase())));
});

app.get("/api/files/outputs", (_req, res) => {
  const dir = CONFIG.paths.output;
  if (!fs.existsSync(dir)) { res.json([]); return; }
  res.json(fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")));
});

// ═══════════════════════════════════════
//  FILTERS & TRANSITIONS
// ═══════════════════════════════════════

app.get("/api/filters", (_req, res) => {
  res.json(getAllFilters());
});

app.get("/api/transitions", (_req, res) => {
  res.json(getAllTransitions());
});

// ═══════════════════════════════════════
//  TTS VOICES
// ═══════════════════════════════════════

app.get("/api/voices", (_req, res) => {
  res.json(PROVIDER_VOICES);
});

app.get("/api/voices/:provider", (req, res) => {
  const provider = req.params.provider as TTSProvider;
  const voices = PROVIDER_VOICES[provider];
  if (!voices) { res.status(404).json({ error: "Unknown provider" }); return; }
  res.json(voices);
});

// ═══════════════════════════════════════
//  SCRIPT PROMPT
// ═══════════════════════════════════════

app.get("/api/prompt", (_req, res) => {
  res.json({ prompt: getMasterPrompt() });
});

// ═══════════════════════════════════════
//  TEMPLATES (save/load)
// ═══════════════════════════════════════

app.get("/api/templates", (_req, res) => {
  res.json(listTemplates());
});

app.get("/api/templates/:id", (req, res) => {
  const t = loadTemplate(req.params.id);
  if (!t) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(t);
});

app.post("/api/templates", (req, res) => {
  if (!req.body.name) { res.status(400).json({ error: "name is required" }); return; }
  const saved = saveTemplate(req.body);
  res.json(saved);
});

app.delete("/api/templates/:id", (req, res) => {
  const ok = deleteTemplate(req.params.id);
  res.json({ deleted: ok });
});

// ═══════════════════════════════════════
//  RUNPOD CLOUD GPU
// ═══════════════════════════════════════

const RUNPOD_GQL = "https://api.runpod.io/graphql";

async function runpodQuery(apiKey: string, query: string) {
  const resp = await fetch(`${RUNPOD_GQL}?api_key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return resp.json();
}

app.get("/api/runpod/status", async (_req, res) => {
  const apiKey = process.env.RUNPOD_API_KEY;
  const podId = process.env.RUNPOD_POD_ID;
  if (!apiKey) { res.json({ configured: false }); return; }

  try {
    if (podId) {
      const r: any = await runpodQuery(apiKey, `{ pod(input: { podId: "${podId}" }) { id name desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } } machine { gpuDisplayName } } }`);
      const pod = r.data?.pod;
      if (pod) {
        const httpPort = pod.runtime?.ports?.find((p: any) => p.privatePort === 3000);
        const proxyUrl = pod.runtime ? `https://${podId}-3000.proxy.runpod.net` : null;
        res.json({ configured: true, pod: { ...pod, proxyUrl }, hasRuntime: !!pod.runtime });
        return;
      }
    }
    // No pod ID saved — check balance
    const r: any = await runpodQuery(apiKey, `{ myself { clientBalance } }`);
    res.json({ configured: true, pod: null, balance: r.data?.myself?.clientBalance });
  } catch (err: any) {
    res.json({ configured: true, error: err.message });
  }
});

app.post("/api/runpod/start", async (_req, res) => {
  const apiKey = process.env.RUNPOD_API_KEY;
  const podId = process.env.RUNPOD_POD_ID;
  if (!apiKey || !podId) { res.status(400).json({ error: "RUNPOD_API_KEY and RUNPOD_POD_ID required in .env" }); return; }

  try {
    const r: any = await runpodQuery(apiKey, `mutation { podResume(input: { podId: "${podId}", gpuCount: 1 }) { id desiredStatus } }`);
    if (r.errors?.length) {
      res.status(500).json({ error: r.errors[0].message });
    } else {
      res.json(r.data?.podResume || { error: "Failed to start" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/runpod/stop", async (_req, res) => {
  const apiKey = process.env.RUNPOD_API_KEY;
  const podId = process.env.RUNPOD_POD_ID;
  if (!apiKey || !podId) { res.status(400).json({ error: "RUNPOD_API_KEY and RUNPOD_POD_ID required in .env" }); return; }

  try {
    const r: any = await runpodQuery(apiKey, `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`);
    res.json(r.data?.podStop || { error: "Failed to stop" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/runpod/create", async (req, res) => {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) { res.status(400).json({ error: "RUNPOD_API_KEY required in .env" }); return; }

  const gpu = req.body.gpu || "NVIDIA GeForce RTX 4090";
  try {
    const r: any = await runpodQuery(apiKey, `mutation { podFindAndDeployOnDemand(input: { name: "yt-automation", gpuTypeId: "${gpu}", imageName: "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04", cloudType: SECURE, gpuCount: 1, volumeInGb: 50, containerDiskInGb: 20, volumeMountPath: "/workspace", ports: "3000/http,22/tcp", startSsh: true }) { id machine { gpuDisplayName } desiredStatus } }`);
    const pod = r.data?.podFindAndDeployOnDemand;
    if (pod) {
      res.json({ ...pod, message: `Pod created! Add RUNPOD_POD_ID=${pod.id} to your .env` });
    } else {
      res.status(500).json({ error: "Failed to create pod", details: r });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
//  CLEANUP — delete uploads, temp, output
// ═══════════════════════════════════════

function clearDirectory(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    fs.rmSync(full, { recursive: true, force: true });
  }
}

app.post("/api/cleanup", (req, res) => {
  const targets: string[] = req.body.targets || ["uploads", "temp", "output"];
  const cleared: string[] = [];

  if (targets.includes("uploads")) {
    clearDirectory(path.join(CONFIG.paths.input, "uploads"));
    cleared.push("uploads");
  }
  if (targets.includes("temp")) {
    clearDirectory(CONFIG.paths.temp);
    cleared.push("temp");
  }
  if (targets.includes("output")) {
    clearDirectory(CONFIG.paths.output);
    cleared.push("output");
  }

  res.json({ cleared });
});

// ─── SPA fallback ───
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../web/public/index.html"));
});

// ─── Start ───
app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`\n  Dashboard: http://localhost:${PORT}\n`);
});

export default app;
