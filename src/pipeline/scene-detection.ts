/**
 * Scene Detection Module
 * Uses FFmpeg to detect scene changes and split video into segments.
 */
import { execSync, exec } from "child_process";
import path from "path";
import fs from "fs";
import { CONFIG } from "../utils/config";

export interface SceneSegment {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  filePath: string;
  isConclusion: boolean;
}

/**
 * Detect scene changes in a video using FFmpeg's scene detection filter.
 * Returns an array of timestamps where scene changes occur.
 */
export async function detectScenes(videoPath: string): Promise<number[]> {
  const threshold = CONFIG.sceneThreshold;

  return new Promise((resolve, reject) => {
    const cmd = `"${CONFIG.ffmpegPath}" -i "${videoPath}" -filter_complex "select='gt(scene,${threshold})',metadata=print:file=-" -an -f null -`;

    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stderr.includes("frame=")) {
        reject(new Error(`Scene detection failed: ${error.message}`));
        return;
      }

      const rawTimestamps: number[] = [0]; // Always start at 0
      const lines = (stdout || stderr).split("\n");

      for (const line of lines) {
        const match = line.match(/pts_time:([\d.]+)/);
        if (match) {
          const time = parseFloat(match[1]);
          if (time > 0) {
            rawTimestamps.push(time);
          }
        }
      }

      // Deduplicate and sort
      const sorted = [...new Set(rawTimestamps)].sort((a, b) => a - b);

      // Enforce minimum gap between scene cuts (default 3s)
      const MIN_GAP = 3;
      const timestamps: number[] = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - timestamps[timestamps.length - 1] >= MIN_GAP) {
          timestamps.push(sorted[i]);
        }
      }

      // If no scenes detected, create segments every 5 seconds
      if (timestamps.length <= 1) {
        console.log(
          "No scene changes detected, falling back to fixed intervals"
        );
        const duration = getVideoDuration(videoPath);
        for (let t = 5; t < duration; t += 5) {
          timestamps.push(t);
        }
      }

      console.log(`Detected ${timestamps.length} scene boundaries (min gap: ${MIN_GAP}s)`);
      resolve(timestamps);
    });
  });
}

/**
 * Get the total duration of a video file in seconds.
 */
export function getVideoDuration(videoPath: string): number {
  let result = "";
  try {
    result = execSync(
      `"${CONFIG.ffmpegPath}" -i "${videoPath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err: any) {
    // FFmpeg returns non-zero when just probing, but stderr has the info
    result = (err.stderr || err.stdout || "").toString();
  }

  const match = result.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) throw new Error("Could not determine video duration");

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  const centiseconds = parseInt(match[4]);

  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

/**
 * Split video into segments at the detected scene boundaries.
 */
export async function splitVideoIntoSegments(
  videoPath: string,
  outputDir: string
): Promise<SceneSegment[]> {
  // Ensure output dir exists
  fs.mkdirSync(outputDir, { recursive: true });

  const sceneTimestamps = await detectScenes(videoPath);
  const totalDuration = getVideoDuration(videoPath);
  const segments: SceneSegment[] = [];

  for (let i = 0; i < sceneTimestamps.length; i++) {
    const startTime = sceneTimestamps[i];
    const endTime =
      i < sceneTimestamps.length - 1 ? sceneTimestamps[i + 1] : totalDuration;
    const duration = endTime - startTime;

    // Skip short segments (< 2s)
    if (duration < 2) continue;

    const segmentPath = path.join(
      outputDir,
      `segment_${String(i).padStart(4, "0")}.mp4`
    );

    await extractSegment(videoPath, startTime, duration, segmentPath);

    segments.push({
      index: i,
      startTime,
      endTime,
      duration,
      filePath: segmentPath,
      isConclusion: false, // Will be set by the narrative engine
    });
  }

  console.log(`Split video into ${segments.length} segments`);
  return segments;
}

/**
 * Extract a single segment from the video.
 */
function extractSegment(
  videoPath: string,
  startTime: number,
  duration: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = `"${CONFIG.ffmpegPath}" -y -ss ${startTime} -i "${videoPath}" -t ${duration} -c:v libx264 -preset fast -an "${outputPath}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
      if (error) {
        reject(new Error(`Segment extraction failed: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Extract audio track from the source video (for transcript extraction).
 */
export function extractAudio(
  videoPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Compress to MP3 at 64kbps mono to stay under Whisper's 25MB limit
    const cmd = `"${CONFIG.ffmpegPath}" -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
      if (error) {
        reject(new Error(`Audio extraction failed: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}
