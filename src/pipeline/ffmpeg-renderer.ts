/**
 * FFmpeg Renderer Module v2
 * Full-featured rendering pipeline with:
 * - Filter presets
 * - Clip transitions (fade in/out)
 * - PiP (picture-in-picture) overlay
 * - Logo watermark overlay
 * - Background music with ducking
 * - Multi-video support
 *
 * Pipeline:
 *   1. Prepare clips (apply transitions per clip)
 *   2. Concatenate clips
 *   3. Apply visual filters (user-chosen presets + scale/pad)
 *   4. Add PiP overlay (if enabled)
 *   5. Add logo overlay (if enabled)
 *   6. Mix audio (narration + music)
 *   7. Mux video + audio → final output
 */
import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";
import { SequenceResult } from "./sequencer";
import { TTSResult } from "./voice-providers";
import { TemplateInput, DEFAULT_TEMPLATE } from "./template-input";
import { buildFilterChain } from "./filters";
import { buildClipTransitionFilter, TransitionConfig } from "./transitions";

// Lossless intermediate encoding (no quality loss between passes)
const INTERMEDIATE_CODEC = "-c:v libx264 -crf 0 -preset ultrafast";

// Final encode codecs
const NVENC_CODEC = "-c:v h264_nvenc -preset p7 -rc vbr -cq 18 -b:v 15M -maxrate 20M -bufsize 30M -profile:v high -pix_fmt yuv420p";
const CPU_CODEC = "-c:v libx264 -preset medium -crf 17 -profile:v high -pix_fmt yuv420p";

export interface RenderOptions {
  sequence: SequenceResult;
  ttsResult: TTSResult;
  templateInput?: TemplateInput;
  outputPath: string;
  /** Optional: PiP video source path (from secondary video) */
  pipVideoPath?: string;
}

// ─── Helpers ───

function runFFmpeg(cmd: string, label?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  [ffmpeg${label ? ` ${label}` : ""}] Running...`);
    exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        console.error(`  [ffmpeg] stderr: ${stderr.slice(-800)}`);
        reject(new Error(`FFmpeg failed: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

function parseColor(color: string): string {
  if (color.startsWith("#")) return color;
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return "#" + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, "0")).join("");
  }
  return "#0a0a0a";
}

// ─── Step 1: Concatenate clips with transitions ───

async function concatenateClips(
  sequence: SequenceResult,
  outputPath: string,
  transition?: TransitionConfig
): Promise<void> {
  const w = CONFIG.width;
  const h = CONFIG.height;

  if (transition && transition.type !== "none" && transition.duration > 0) {
    // Apply transitions: process each clip individually with fade, then concat
    const transDir = path.join(CONFIG.paths.temp, "transition_clips");
    fs.mkdirSync(transDir, { recursive: true });

    const processedPaths: string[] = [];

    for (let i = 0; i < sequence.clips.length; i++) {
      const clip = sequence.clips[i];
      const inPath = clip.segment.filePath.replace(/\\/g, "/");
      const outPath = path.join(transDir, `trans_${String(i).padStart(4, "0")}.mp4`);

      const clipDur = clip.durationInFrames / CONFIG.fps;
      const filter = buildClipTransitionFilter(transition, clipDur, CONFIG.fps);

      if (filter) {
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
        const cmd = [
          `"${CONFIG.ffmpegPath}" -y`,
          `-i "${inPath}"`,
          `-t ${clipDur}`,
          `-vf "${scaleFilter},${filter}"`,
          `${INTERMEDIATE_CODEC} -an`,
          `"${outPath}"`,
        ].join(" ");
        await runFFmpeg(cmd);
      } else {
        // Just scale/pad
        const cmd = [
          `"${CONFIG.ffmpegPath}" -y`,
          `-i "${inPath}"`,
          `-t ${clipDur}`,
          `-vf "scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black"`,
          `${INTERMEDIATE_CODEC} -an`,
          `"${outPath}"`,
        ].join(" ");
        await runFFmpeg(cmd);
      }
      processedPaths.push(outPath);
    }

    // Concatenate processed clips
    const listPath = path.join(CONFIG.paths.temp, "trans_concat_list.txt");
    fs.writeFileSync(
      listPath,
      processedPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"),
      "utf-8"
    );

    const cmd = [
      `"${CONFIG.ffmpegPath}" -y`,
      `-f concat -safe 0 -i "${listPath}"`,
      `-t ${sequence.totalDurationSec}`,
      `${INTERMEDIATE_CODEC} -an`,
      `"${outputPath}"`,
    ].join(" ");
    await runFFmpeg(cmd);
  } else {
    // No transitions: simple concat with resize
    const listPath = path.join(CONFIG.paths.temp, "clip_concat_list.txt");
    const lines = sequence.clips.map((clip) => {
      return `file '${clip.segment.filePath.replace(/\\/g, "/")}'`;
    });
    fs.writeFileSync(listPath, lines.join("\n"), "utf-8");

    const cmd = [
      `"${CONFIG.ffmpegPath}" -y`,
      `-f concat -safe 0 -i "${listPath}"`,
      `-t ${sequence.totalDurationSec}`,
      `-vf "scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black"`,
      `${INTERMEDIATE_CODEC} -an`,
      `"${outputPath}"`,
    ].join(" ");
    await runFFmpeg(cmd);
  }
}

// ─── Step 2: Apply visual filters + background ───

async function applyFilters(
  inputPath: string,
  outputPath: string,
  input: TemplateInput
): Promise<void> {
  const filterIds = input.filters || [];
  const w = CONFIG.width;
  const h = CONFIG.height;

  // Build user-selected filter chain
  const userFilters = buildFilterChain(filterIds, w, h);

  // Content scale + background
  const scale = input.contentScale ?? DEFAULT_TEMPLATE.contentScale;
  const bgColor = parseColor(input.backgroundColor || DEFAULT_TEMPLATE.backgroundColor);
  const bgImage = input.backgroundImage || "";

  // If a background image is provided, use it instead of solid color
  const hasBgImage = bgImage && fs.existsSync(
    path.isAbsolute(bgImage) ? bgImage : path.join(CONFIG.paths.backgrounds, bgImage)
  );

  if (hasBgImage && scale < 0.99) {
    const bgPath = (path.isAbsolute(bgImage) ? bgImage : path.join(CONFIG.paths.backgrounds, bgImage)).replace(/\\/g, "/");
    const innerW = Math.round(w * scale);
    const innerH = Math.round(h * scale);

    // Filter chain: scale bg image to full res, scale video content, overlay centered
    const fc = [
      `[0:v]scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=black`,
      userFilters ? `,${userFilters}` : "",
      `[fg];`,
      `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[bg];`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[out]`,
    ].join("");

    const cmd = [
      `"${CONFIG.ffmpegPath}" -y`,
      `-i "${inputPath}"`,
      `-i "${bgPath}"`,
      `-filter_complex "${fc}"`,
      `-map "[out]" ${INTERMEDIATE_CODEC} -an`,
      `"${outputPath}"`,
    ].join(" ");

    await runFFmpeg(cmd, "filters+bg-image");
    return;
  }

  // Fallback: solid color background
  const filters: string[] = [];

  if (scale < 0.99) {
    const innerW = Math.round(w * scale);
    const innerH = Math.round(h * scale);
    filters.push(
      `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(${w}-iw)/2:(${h}-ih)/2:color='${bgColor}'`
    );
  }

  if (userFilters) {
    filters.push(userFilters);
  }

  if (filters.length === 0) {
    // No filters — just copy
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const filterChain = filters.join(",");
  const cmd = [
    `"${CONFIG.ffmpegPath}" -y`,
    `-i "${inputPath}"`,
    `-vf "${filterChain}"`,
    `${INTERMEDIATE_CODEC} -an`,
    `"${outputPath}"`,
  ].join(" ");

  await runFFmpeg(cmd, "filters");
}

// ─── Step 3: PiP Overlay ───

async function applyPiP(
  mainVideoPath: string,
  pipVideoPath: string,
  outputPath: string,
  input: TemplateInput
): Promise<void> {
  const pip = input.pip || DEFAULT_TEMPLATE.pip;
  if (!pip.enabled) {
    fs.copyFileSync(mainVideoPath, outputPath);
    return;
  }

  const w = CONFIG.width;
  const h = CONFIG.height;
  const pipW = Math.round(w * pip.scale);
  const pipH = Math.round(h * pip.scale);
  const margin = 20;

  // Position
  let x: string, y: string;
  switch (pip.position) {
    case "top-left":     x = `${margin}`; y = `${margin}`; break;
    case "top-right":    x = `${w - pipW - margin}`; y = `${margin}`; break;
    case "bottom-left":  x = `${margin}`; y = `${h - pipH - margin}`; break;
    case "bottom-right": x = `${w - pipW - margin}`; y = `${h - pipH - margin}`; break;
    case "center":       x = `(W-w)/2`; y = `(H-h)/2`; break;
    default:             x = `${w - pipW - margin}`; y = `${margin}`; break;
  }

  const borderW = pip.borderWidth || 2;
  const borderColor = parseColor(pip.borderColor || "#ffffff");
  const pipPadW = pipW + borderW * 2;
  const pipPadH = pipH + borderW * 2;

  // Build filter: scale PiP, add border (pad), overlay on main video
  const fc = [
    `[1:v]scale=${pipW}:${pipH}:force_original_aspect_ratio=decrease,pad=${pipPadW}:${pipPadH}:${borderW}:${borderW}:color='${borderColor}'`,
    pip.opacity < 1 ? `,format=rgba,colorchannelmixer=aa=${pip.opacity}` : "",
    `[pip];[0:v][pip]overlay=${x}:${y}[out]`,
  ].join("");

  const cmd = [
    `"${CONFIG.ffmpegPath}" -y`,
    `-i "${mainVideoPath}"`,
    `-stream_loop -1 -i "${pipVideoPath}"`,
    `-filter_complex "${fc}"`,
    `-map "[out]" ${INTERMEDIATE_CODEC} -an`,
    `"${outputPath}"`,
  ].join(" ");

  await runFFmpeg(cmd, "pip");
}

// ─── Step 4: Logo Overlay ───

async function applyLogo(
  videoPath: string,
  outputPath: string,
  input: TemplateInput
): Promise<void> {
  const logo = input.logo || DEFAULT_TEMPLATE.logo;
  if (!logo.enabled || !logo.path) {
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  const logoPath = path.isAbsolute(logo.path)
    ? logo.path
    : path.join(CONFIG.paths.logos, logo.path);

  if (!fs.existsSync(logoPath)) {
    console.log(`  Warning: Logo not found: ${logoPath}, skipping...`);
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  const w = CONFIG.width;
  const h = CONFIG.height;
  const logoW = Math.round(w * logo.scale);
  const margin = logo.margin || 20;

  let x: string, y: string;
  switch (logo.position) {
    case "top-left":     x = `${margin}`; y = `${margin}`; break;
    case "top-right":    x = `W-w-${margin}`; y = `${margin}`; break;
    case "bottom-left":  x = `${margin}`; y = `H-h-${margin}`; break;
    case "bottom-right": x = `W-w-${margin}`; y = `H-h-${margin}`; break;
    case "center":       x = `(W-w)/2`; y = `(H-h)/2`; break;
    default:             x = `W-w-${margin}`; y = `H-h-${margin}`; break;
  }

  const fc = [
    `[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=${logo.opacity}[logo]`,
    `;[0:v][logo]overlay=${x}:${y}[out]`,
  ].join("");

  const cmd = [
    `"${CONFIG.ffmpegPath}" -y`,
    `-i "${videoPath}"`,
    `-i "${logoPath}"`,
    `-filter_complex "${fc}"`,
    `-map "[out]" ${INTERMEDIATE_CODEC} -an`,
    `"${outputPath}"`,
  ].join(" ");

  await runFFmpeg(cmd, "logo");
}

// ─── Step 5: Mix Audio ───

async function mixAudio(
  narrationPath: string,
  musicPath: string | null,
  duration: number,
  outputPath: string,
  input: TemplateInput
): Promise<void> {
  const narVol = input.narrationVolume ?? DEFAULT_TEMPLATE.narrationVolume;
  const musVol = input.musicVolume ?? DEFAULT_TEMPLATE.musicVolume;

  if (musicPath && fs.existsSync(musicPath)) {
    const cmd = [
      `"${CONFIG.ffmpegPath}" -y`,
      `-i "${narrationPath}"`,
      `-stream_loop -1 -i "${musicPath}"`,
      `-t ${duration}`,
      `-filter_complex`,
      `"[0:a]volume=${narVol}[narr];[1:a]volume=${musVol}[music];[narr][music]amix=inputs=2:duration=first:dropout_transition=2[out]"`,
      `-map "[out]" -c:a aac -b:a 192k`,
      `"${outputPath}"`,
    ].join(" ");
    await runFFmpeg(cmd, "audio");
  } else {
    const cmd = [
      `"${CONFIG.ffmpegPath}" -y`,
      `-i "${narrationPath}"`,
      `-t ${duration}`,
      `-af "volume=${narVol}"`,
      `-c:a aac -b:a 192k`,
      `"${outputPath}"`,
    ].join(" ");
    await runFFmpeg(cmd, "audio");
  }
}

// ─── Step 6: Mux Video + Audio ───

async function muxVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  duration: number
): Promise<void> {
  const buildCmd = (codec: string) => [
    `"${CONFIG.ffmpegPath}" -y`,
    `-i "${videoPath}"`,
    `-i "${audioPath}"`,
    `-t ${duration}`,
    `${codec} -c:a copy -shortest`,
    `"${outputPath}"`,
  ].join(" ");

  // Try GPU first, fall back to CPU
  try {
    console.log(`  Trying NVIDIA GPU (NVENC)...`);
    await runFFmpeg(buildCmd(NVENC_CODEC), "mux-gpu");
    console.log(`  Final encode: NVIDIA GPU (NVENC) ✓`);
  } catch {
    console.log(`  NVENC unavailable — using CPU (libx264 medium)`);
    await runFFmpeg(buildCmd(CPU_CODEC), "mux-cpu");
  }
}

// ─── Main Export ───

export async function renderFinalVideo(options: RenderOptions): Promise<string> {
  const { sequence, ttsResult, templateInput, outputPath, pipVideoPath } = options;
  const input = templateInput || {} as TemplateInput;
  const duration = sequence.totalDurationSec;
  const transition = input.transition || DEFAULT_TEMPLATE.transition;

  // Resolve music path
  let musicPath: string | null = null;
  if (input.backgroundMusic) {
    musicPath = path.isAbsolute(input.backgroundMusic)
      ? input.backgroundMusic
      : path.join(CONFIG.paths.music, input.backgroundMusic);
    if (!fs.existsSync(musicPath)) {
      console.log(`  Warning: Music not found: ${musicPath}`);
      musicPath = null;
    }
  }

  // Temp intermediates
  const t = CONFIG.paths.temp;
  const tempConcat   = path.join(t, "r_concat.mp4");
  const tempFiltered = path.join(t, "r_filtered.mp4");
  const tempPip      = path.join(t, "r_pip.mp4");
  const tempLogo     = path.join(t, "r_logo.mp4");
  const tempAudio    = path.join(t, "r_audio.aac");
  const temps = [tempConcat, tempFiltered, tempPip, tempLogo, tempAudio];

  const totalSteps = 6;
  let step = 0;

  // Step 1: Concatenate + transitions
  step++;
  console.log(`  [${step}/${totalSteps}] Concatenating ${sequence.clips.length} clips${transition.type !== "none" ? ` (${transition.type} transitions)` : ""}...`);
  await concatenateClips(sequence, tempConcat, transition);

  // Step 2: Apply filters
  step++;
  const filterCount = (input.filters || []).length;
  console.log(`  [${step}/${totalSteps}] Applying ${filterCount} filter(s) + layout...`);
  await applyFilters(tempConcat, tempFiltered, input);

  // Step 3: PiP overlay
  step++;
  const pip = input.pip || DEFAULT_TEMPLATE.pip;
  if (pip.enabled && pipVideoPath && fs.existsSync(pipVideoPath)) {
    console.log(`  [${step}/${totalSteps}] Adding PiP overlay (${pip.position}, ${(pip.scale * 100).toFixed(0)}%)...`);
    await applyPiP(tempFiltered, pipVideoPath, tempPip, input);
  } else {
    console.log(`  [${step}/${totalSteps}] PiP: skipped`);
    fs.copyFileSync(tempFiltered, tempPip);
  }

  // Step 4: Logo overlay
  step++;
  const logo = input.logo || DEFAULT_TEMPLATE.logo;
  if (logo.enabled && logo.path) {
    console.log(`  [${step}/${totalSteps}] Adding logo overlay (${logo.position})...`);
    await applyLogo(tempPip, tempLogo, input);
  } else {
    console.log(`  [${step}/${totalSteps}] Logo: skipped`);
    fs.copyFileSync(tempPip, tempLogo);
  }

  // Step 5: Mix audio
  step++;
  console.log(`  [${step}/${totalSteps}] Mixing audio...`);
  await mixAudio(ttsResult.fullNarrationPath, musicPath, duration, tempAudio, input);

  // Step 6: Final mux
  step++;
  console.log(`  [${step}/${totalSteps}] Muxing final video...`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await muxVideoAudio(tempLogo, tempAudio, outputPath, duration);

  // Cleanup
  for (const f of temps) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // Cleanup transition clips dir
  const transDir = path.join(t, "transition_clips");
  if (fs.existsSync(transDir)) {
    fs.rmSync(transDir, { recursive: true });
  }

  console.log(`  Rendered: ${outputPath}`);
  return outputPath;
}
