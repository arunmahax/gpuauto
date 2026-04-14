/**
 * Rebuild cache manifest from existing temp files.
 * Run this once to enable resume for a previous run.
 *
 * Usage: npx ts-node src/utils/rebuild-cache.ts <source_video_path>
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "./config";
import { getVideoDuration } from "../pipeline/scene-detection";

const sourceVideo = process.argv[2];
if (!sourceVideo) {
  console.log("Usage: npx ts-node src/utils/rebuild-cache.ts <source_video_path>");
  process.exit(1);
}

const tempDir = CONFIG.paths.temp;
const segmentsDir = path.join(tempDir, "segments");
const ttsDir = path.join(tempDir, "tts");

// Rebuild segments
const segmentFiles = fs
  .readdirSync(segmentsDir)
  .filter((f) => f.endsWith(".mp4"))
  .sort();

const segments = segmentFiles.map((file, i) => {
  const filePath = path.join(segmentsDir, file);
  const duration = getVideoDuration(filePath);
  return {
    index: i,
    startTime: 0, // approximate — not critical for rendering
    endTime: duration,
    duration,
    filePath,
    isConclusion: i === segmentFiles.length - 1,
  };
});

// Rebuild TTS result
const ttsFiles = fs
  .readdirSync(ttsDir)
  .filter((f) => f.endsWith(".mp3"))
  .sort();

const fullNarrationPath = path.join(tempDir, "full_narration.mp3");
const segmentDurations = ttsFiles.map((f) => getVideoDuration(path.join(ttsDir, f)));
const totalDuration = getVideoDuration(fullNarrationPath);

const ttsResult = {
  fullNarrationPath,
  segmentPaths: ttsFiles.map((f) => path.join(ttsDir, f)),
  segmentDurations,
  totalDuration,
};

// Rebuild narrative script
let narrativeScript = null;
const scriptPath = path.join(tempDir, "narration_script.json");
if (fs.existsSync(scriptPath)) {
  narrativeScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
}

const cache = {
  sourceVideo: path.resolve(sourceVideo),
  segments,
  narrativeScript,
  ttsResult,
  completedSteps: [1, 2, 3],
};

const cachePath = path.join(tempDir, "pipeline_cache.json");
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
console.log(`Cache rebuilt: ${segments.length} segments, ${ttsFiles.length} TTS files`);
console.log(`Saved to: ${cachePath}`);
