/**
 * Narrative Engine Module
 * Uses OpenAI to process transcripts and generate third-person narration scripts.
 */
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";
import { SceneSegment } from "./scene-detection";

const openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });

/**
 * Extract JSON from LLM response that may contain markdown fences or extra text.
 */
function extractJson(raw: string): string {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  let cleaned = raw.replace(/```(?:json)?\s*\n?/gi, "").replace(/```\s*$/g, "").trim();

  // Try to find a JSON object or array
  const objMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1];

  const arrMatch = cleaned.match(/(\[[\s\S]*\])/);
  if (arrMatch) return arrMatch[1];

  return cleaned;
}

export interface NarrativeScript {
  segments: NarrativeSegment[];
  fullScript: string;
  conclusionIndex: number;
}

export interface NarrativeSegment {
  index: number;
  text: string;
  isConclusion: boolean;
  estimatedDurationSec: number;
}

/**
 * Extract transcript from audio using OpenAI Whisper API.
 */
export async function extractTranscript(audioPath: string): Promise<string> {
  console.log("Extracting transcript via Whisper...");

  const audioFile = fs.createReadStream(audioPath);

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: audioFile,
    response_format: "text",
  });

  console.log("Transcript extracted successfully");
  return transcription as unknown as string;
}

/**
 * Summarize the transcript into key points using LLM.
 */
export async function summarizeTranscript(
  transcript: string
): Promise<string[]> {
  console.log("Summarizing transcript into key points...");

  const response = await openai.chat.completions.create({
    model: CONFIG.llmModel,
    messages: [
      {
        role: "system",
        content: `You are a video content analyst. Extract the key points from the following transcript. 
Return them as a JSON array of strings, ordered chronologically. 
The LAST point should always be the verdict, conclusion, or final outcome.
Return ONLY the JSON array, no other text.`,
      },
      {
        role: "user",
        content: transcript,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0].message.content || "[]";
  try {
    return JSON.parse(extractJson(content));
  } catch {
    // If JSON parsing fails, split by newlines and clean up
    return content
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean);
  }
}

/**
 * Expand key points into a full third-person narration script.
 */
export async function expandToNarration(
  keyPoints: string[],
  segmentCount: number
): Promise<NarrativeScript> {
  console.log("Expanding key points into narration script...");

  const response = await openai.chat.completions.create({
    model: CONFIG.llmModel,
    messages: [
      {
        role: "system",
        content: `You are a professional narrator script writer. Convert the following key points into a compelling third-person narration script.

Rules:
- Write in third person (e.g., "The narrator describes the scene...", "The judge then stated...")
- Break the script into exactly ${segmentCount} segments
- Each segment should be 2-4 sentences
- The LAST segment MUST be the conclusion/verdict
- Mark the last segment with [CONCLUSION] at the start
- Return as a JSON object with this structure:
{
  "segments": [
    { "index": 0, "text": "narration text here", "isConclusion": false },
    ...
    { "index": ${segmentCount - 1}, "text": "[CONCLUSION] narration text here", "isConclusion": true }
  ]
}
Return ONLY the JSON, no other text.`,
      },
      {
        role: "user",
        content: keyPoints
          .map((point, i) => `${i + 1}. ${point}`)
          .join("\n"),
      },
    ],
    temperature: 0.7,
  });

  const rawContent = response.choices[0].message.content || "{}";
  let parsed: { segments: Array<{ index: number; text: string; isConclusion: boolean }> };
  
  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch {
    // Last resort: build segments from the raw text
    console.warn("Could not parse LLM JSON, building segments from raw text...");
    const lines = rawContent
      .split(/\n+/)
      .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter((l) => l.length > 10);

    parsed = {
      segments: lines.map((text, i) => ({
        index: i,
        text,
        isConclusion: i === lines.length - 1,
      })),
    };
  }

  // Estimate duration: ~150 words per minute for narration
  const segments: NarrativeSegment[] = parsed.segments.map((seg, i) => {
    const wordCount = seg.text.replace("[CONCLUSION]", "").trim().split(/\s+/).length;
    return {
      index: i,
      text: seg.text.replace("[CONCLUSION]", "").trim(),
      isConclusion: seg.isConclusion || i === parsed.segments.length - 1,
      estimatedDurationSec: (wordCount / 150) * 60,
    };
  });

  const conclusionIndex = segments.findIndex((s) => s.isConclusion);

  return {
    segments,
    fullScript: segments.map((s) => s.text).join("\n\n"),
    conclusionIndex: conclusionIndex >= 0 ? conclusionIndex : segments.length - 1,
  };
}

/**
 * Process the entire narrative pipeline: transcript -> key points -> script.
 */
export async function generateNarrative(
  audioPath: string,
  videoSegments: SceneSegment[]
): Promise<NarrativeScript> {
  const transcript = await extractTranscript(audioPath);

  // Save transcript for reference
  const transcriptPath = path.join(CONFIG.paths.temp, "transcript.txt");
  fs.writeFileSync(transcriptPath, transcript, "utf-8");
  console.log(`Transcript saved to ${transcriptPath}`);

  const keyPoints = await summarizeTranscript(transcript);
  console.log(`Extracted ${keyPoints.length} key points`);

  // Save key points
  const keyPointsPath = path.join(CONFIG.paths.temp, "key_points.json");
  fs.writeFileSync(keyPointsPath, JSON.stringify(keyPoints, null, 2), "utf-8");

  const narrativeScript = await expandToNarration(
    keyPoints,
    videoSegments.length
  );

  // Save the full script
  const scriptPath = path.join(CONFIG.paths.temp, "narration_script.json");
  fs.writeFileSync(
    scriptPath,
    JSON.stringify(narrativeScript, null, 2),
    "utf-8"
  );
  console.log(`Narration script saved to ${scriptPath}`);

  return narrativeScript;
}
