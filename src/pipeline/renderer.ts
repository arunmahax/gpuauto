/**
 * Remotion Renderer Module
 * Handles rendering the final composition using @remotion/renderer.
 * 
 * Local files (segments, narration) are copied into the bundle's public
 * directory so Remotion can serve them over HTTP via staticFile().
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { CONFIG } from "../utils/config";
import { TransformedVideoProps, ClipData } from "../remotion/compositions/TransformedVideo";
import { SequenceResult } from "./sequencer";
import { TTSResult } from "./voice-synthesis";
import { DEFAULT_TEMPLATE, TemplateInput } from "./template-input";

interface RenderOptions {
  sequence: SequenceResult;
  ttsResult: TTSResult;
  templateInput?: TemplateInput;
  outputPath: string;
}

/**
 * Copy a file into the Remotion public directory and return the staticFile name.
 */
function copyToPublic(publicDir: string, filePath: string, subDir: string): string {
  const targetDir = path.join(publicDir, subDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = path.basename(filePath);
  const destPath = path.join(targetDir, fileName);
  fs.copyFileSync(filePath, destPath);
  // staticFile() references are relative to public dir
  return `${subDir}/${fileName}`;
}

/**
 * Bundle the Remotion project and render the final video.
 */
export async function renderFinalVideo(options: RenderOptions): Promise<string> {
  const { sequence, ttsResult, templateInput, outputPath } = options;

  // Create a temporary public directory for serving media files
  const publicDir = path.join(CONFIG.paths.temp, "remotion-public");
  fs.mkdirSync(publicDir, { recursive: true });

  console.log("Copying media files to Remotion public directory...");

  // Copy all video segments
  const clipData: ClipData[] = sequence.clips.map((clip) => {
    const staticName = copyToPublic(publicDir, clip.segment.filePath, "segments");
    return {
      src: staticName,
      startFrame: clip.startFrame,
      durationInFrames: clip.durationInFrames,
    };
  });

  // Copy narration audio
  const narrationStaticName = copyToPublic(publicDir, ttsResult.fullNarrationPath, "audio");

  // Copy background music if provided
  let musicStaticName: string | undefined;
  if (templateInput?.backgroundMusic) {
    const musicPath = path.isAbsolute(templateInput.backgroundMusic)
      ? templateInput.backgroundMusic
      : path.join(CONFIG.paths.music, templateInput.backgroundMusic);
    if (fs.existsSync(musicPath)) {
      musicStaticName = copyToPublic(publicDir, musicPath, "audio");
    }
  }

  console.log("Bundling Remotion project...");
  const entryPoint = path.resolve(__dirname, "../remotion/index.ts");

  const bundleLocation = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
    publicDir,
  });

  // Merge template settings
  const template = templateInput?.template || DEFAULT_TEMPLATE;

  const inputProps: Record<string, unknown> = {
    clips: clipData,
    narrationSrc: narrationStaticName,
    musicSrc: musicStaticName,
    backgroundSrc: (templateInput as any)?.backgroundMedia,
    ...template,
  };

  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "TransformedVideo",
    inputProps,
  });

  // Override duration to match our calculated frames
  composition.durationInFrames = sequence.totalDurationInFrames;
  composition.fps = CONFIG.fps;
  composition.width = CONFIG.width;
  composition.height = CONFIG.height;

  console.log(
    `Rendering video: ${sequence.totalDurationInFrames} frames @ ${CONFIG.fps}fps = ${sequence.totalDurationSec.toFixed(1)}s`
  );

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
  });

  console.log(`Video rendered to: ${outputPath}`);
  return outputPath;
}
