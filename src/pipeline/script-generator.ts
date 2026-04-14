/**
 * Script Generator Module
 * Uses OpenRouter, OpenAI to generate high-retention YouTube scripts.
 * Claude Sonnet is accessed via OpenRouter (no separate Anthropic key needed).
 * Supports:
 *  - Generate from title (OpenRouter/OpenAI — any model including Claude)
 *  - Regenerate from transcript (extracts Whisper transcript → LLM rewrites it)
 */
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";
import { NarrativeScript, NarrativeSegment } from "./narrative-engine";

export type ScriptProvider = "openai" | "openrouter" | "claude";

export interface ScriptGenConfig {
  provider: ScriptProvider;
  model?: string;
  videoTitle: string;
  customPrompt?: string;
  targetSegments?: number;
  targetDurationMin?: number;
  /** Original transcript to rewrite (for transcript→Claude flow) */
  originalTranscript?: string;
}

/**
 * The master prompt for high-retention YouTube scripts.
 */
const MASTER_PROMPT = `I'm learning YouTube automation, and I need your help creating high-retention scripts that keep viewers interested and clicking. I want the scripts to have a natural flow and avoid anything that feels repetitive, robotic, or slow. Here's how we'll do it:

1. Research First and Bullet Point Structure
- Start by researching the main topic or artist. Look for the key facts but also any recent rumors, controversies, or speculations that have come up in the last few years—these elements often drive more engagement in videos.
- Give me bullet points first with the structure you plan to use, so I can check that everything flows naturally.
- As you create bullet points and write the script, keep these six things in mind:
  - Make each section introduce something new and interesting.
  - Avoid repetitive or robotic phrases; aim for smooth flow.
  - Write each sentence with the viewer in mind, keeping it clear, engaging, and moving quickly.

2. Script Structure and Flow
- Introduction: Open with a bold statement or question that immediately pulls viewers in without giving away too much.
- Sections: Break the story into 6-8 sections, each adding new information and keeping the pace fast. Avoid starting each chapter with a repeated intro or reference to the title—just dive straight into the new information.
- Conclusion: Summarize the video's main points with a thought-provoking or surprising note, encouraging viewers to think about the topic beyond the video.
- Format: Write the script in paragraph form with no "movie director" language. Avoid phrases like "[Cut to shot of…]" or stage directions, and write as though it's a story told in a straightforward, engaging way.

3. Tone and Style
- Keep the tone engaging, slightly mysterious, and conversational. Imagine you're sharing an exciting story with a friend.
- Use direct, concise language to keep the viewer interested. Avoid filler and repeated phrasing.
- Make each section feel like a quick, interesting piece of information that builds curiosity.

4. Techniques for High Retention
- Start each section with a hook that grabs attention without repeating information from earlier.
- Add brief transitions at the end of each section to hint at what's coming next. Keep these concise and impactful to maintain pacing, with phrases like "But that wasn't the whole story…" or "And what happened next would shock everyone…"
- Keep sentences short and impactful, with no long-winded or complex explanations.

5. Topics and Themes
- Focus on controversial, shocking, or unknown elements of the subject's life or career.
- Incorporate recent rumors, controversies, and speculations whenever possible to keep content fresh.
- Highlight the subject's challenges, untold stories, or conflicts that viewers may not know.

6. Phrasing, Dramatic Language, and Censorship
- Use powerful, engaging language, like "shocking," "exposed," or "revealed," to hold the viewer's attention.
- Censor or reword sensitive topics to ensure compliance with YouTube's guidelines:
  - Avoid direct language for terms like "suicide," "overdose," or "criminal accusations."
  - Use indirect phrasing (e.g., "off'd himself" for "suicide," "O.D'd" for "overdose," "accusations surfaced" for legal issues).
  - Ensure any profanity is censored, e.g., "dmn" or "sht."
- Don't repeat introductions or start each section with references to the title—just get straight to the point.

7. Varied Wording for Key Phrases
- Avoid overusing specific phrases or descriptions (e.g., "shocking truth" or "exposed"). Instead, vary the language to keep the script fresh and engaging.
- This ensures the script flows naturally and avoids a formulaic tone.

8. Your Tasks
- Do research on the topic and summarize your findings in bullet points, showing the planned structure of the script.
- Write the Full Script: Use the structure and tone above to create an engaging script in paragraph form, double-checking for natural flow and avoiding repetition.
- Smooth Transitions: Each section should lead naturally to the next, keeping viewers interested.
- Refine Tone: Keep it human and conversational, ensuring each part feels relatable and engaging without any repetition.`;

/**
 * Extract JSON from LLM response that may contain markdown fences.
 */
function extractJson(raw: string): string {
  let cleaned = raw.replace(/\`\`\`(?:json)?\s*\n?/gi, "").replace(/\`\`\`\s*$/g, "").trim();
  const objMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1];
  const arrMatch = cleaned.match(/(\[[\s\S]*\])/);
  if (arrMatch) return arrMatch[1];
  return cleaned;
}

/**
 * Create an OpenAI-compatible client.
 * Both OpenRouter and Claude route through OpenRouter's API.
 */
function createClient(provider: ScriptProvider): OpenAI {
  if (provider === "openrouter" || provider === "claude") {
    if (!CONFIG.openrouterApiKey) throw new Error("OPENROUTER_API_KEY not set in .env");
    return new OpenAI({
      apiKey: CONFIG.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return new OpenAI({ apiKey: CONFIG.openaiApiKey });
}

/**
 * Get the default model for a provider.
 */
function getDefaultModel(provider: ScriptProvider): string {
  if (provider === "claude") return "anthropic/claude-sonnet-4";
  if (provider === "openrouter") return "google/gemini-2.0-flash-001";
  return CONFIG.llmModel;
}

/**
 * Generate a full script from a video title (or rewrite from transcript).
 * All providers (OpenRouter, OpenAI, Claude) use OpenAI-compatible API.
 * Claude is accessed via OpenRouter — no separate Anthropic key needed.
 */
export async function generateScript(config: ScriptGenConfig): Promise<NarrativeScript> {
  const targetMin = config.targetDurationMin || 10;
  const targetSegments = config.targetSegments || Math.max(6, Math.ceil(targetMin / 1.5));
  const prompt = config.customPrompt || MASTER_PROMPT;

  console.log(`Generating script via ${config.provider}...`);
  console.log(`  Title: "${config.videoTitle}"`);
  console.log(`  Target: ~${targetMin} min, ${targetSegments} segments`);

  const client = createClient(config.provider);
  const model = config.model || getDefaultModel(config.provider);

  // If we have an original transcript, include it as context
  const transcriptContext = config.originalTranscript
    ? `\n\nHere is the original video transcript for context and facts (DO NOT copy it — rewrite completely in your own style):\n\n---\n${config.originalTranscript}\n---\n`
    : "";
  const transcriptInstruction = config.originalTranscript
    ? `\nUse the transcript above as source material for facts, but create a COMPLETELY DIFFERENT and better script. Do not copy phrases or structure from it.`
    : "";

  // Step 1: Research & bullet points
  const researchResponse = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `The Title For The Video Is: ${config.videoTitle}${transcriptContext}\n\nFirst, give me the research bullet points and planned structure. Target approximately ${targetMin} minutes of narration (about ${targetMin * 150} words). Include ${targetSegments} sections.${transcriptInstruction}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });
  const bulletPoints = researchResponse.choices[0].message.content || "";
  console.log(`  Research & bullet points generated (${config.provider})`);

  // Step 2: Full script
  const scriptResponse = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `The Title For The Video Is: ${config.videoTitle}${transcriptContext}\n\nHere are the bullet points and structure:\n${bulletPoints}\n\nNow write the FULL script. Requirements:\n- Target length: approximately ${targetMin * 150} words (${targetMin} minutes of narration)\n- Break into exactly ${targetSegments} sections/paragraphs\n- The LAST section must be the conclusion\n- Write in paragraph form with no stage directions\n- Keep each section 100-200 words for good pacing${config.originalTranscript ? "\n- This must be COMPLETELY ORIGINAL — not a paraphrase of the transcript" : ""}\n\nReturn ONLY as a JSON object:\n{\n  "segments": [\n    { "index": 0, "text": "paragraph text here", "isConclusion": false },\n    ...\n    { "index": ${targetSegments - 1}, "text": "conclusion paragraph", "isConclusion": true }\n  ]\n}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 8000,
  });
  const rawScript = scriptResponse.choices[0].message.content || "{}";

  return parseScriptResponse(rawScript, targetSegments);
}

/**
 * Regenerate a script from an existing transcript.
 * Steps: takes the raw Whisper transcript → LLM rewrites it into
 * a high-retention YouTube script that is completely different.
 * Supports any provider: OpenRouter, OpenAI, or Claude.
 */
export async function regenerateFromTranscript(
  transcript: string,
  videoTitle: string,
  targetDurationMin?: number,
  model?: string,
  provider?: ScriptProvider
): Promise<NarrativeScript> {
  const selectedProvider = provider || CONFIG.defaultScriptProvider;
  console.log(`Regenerating script from transcript via ${selectedProvider}...`);
  console.log(`  Transcript length: ${transcript.length} chars (~${transcript.split(/\s+/).length} words)`);

  return generateScript({
    provider: selectedProvider,
    model,
    videoTitle,
    originalTranscript: transcript,
    targetDurationMin: targetDurationMin || 10,
  });
}

/**
 * Parse the LLM script response JSON into NarrativeScript.
 */
function parseScriptResponse(rawContent: string, targetSegments: number): NarrativeScript {
  let parsed: { segments: Array<{ index: number; text: string; isConclusion: boolean }> };
  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch {
    // Fallback: split paragraphs
    console.warn("Could not parse script JSON, splitting raw text into paragraphs...");
    const paragraphs = rawContent
      .split(/\n\n+/)
      .map((p) => p.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter((p) => p.length > 30);

    parsed = {
      segments: paragraphs.map((text, i) => ({
        index: i,
        text,
        isConclusion: i === paragraphs.length - 1,
      })),
    };
  }

  const segments: NarrativeSegment[] = parsed.segments.map((seg, i) => {
    const wordCount = seg.text.split(/\s+/).length;
    return {
      index: i,
      text: seg.text,
      isConclusion: seg.isConclusion || i === parsed.segments.length - 1,
      estimatedDurationSec: (wordCount / 150) * 60,
    };
  });

  const conclusionIndex = segments.findIndex((s) => s.isConclusion);
  const fullScript = segments.map((s) => s.text).join("\n\n");

  // Save
  const scriptPath = path.join(CONFIG.paths.temp, "narration_script.json");
  const result: NarrativeScript = {
    segments,
    fullScript,
    conclusionIndex: conclusionIndex >= 0 ? conclusionIndex : segments.length - 1,
  };
  fs.writeFileSync(scriptPath, JSON.stringify(result, null, 2), "utf-8");

  const totalWords = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  console.log(`  Script generated: ${segments.length} segments, ~${totalWords} words (~${(totalWords / 150).toFixed(1)} min)`);

  return result;
}

/**
 * Get the master prompt (for display in UI).
 */
export function getMasterPrompt(): string {
  return MASTER_PROMPT;
}
