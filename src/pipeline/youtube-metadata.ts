/**
 * YouTube Metadata Generator
 * Generates SEO-optimized YouTube titles and descriptions from the script.
 * All providers (OpenRouter/OpenAI/Claude) use OpenAI-compatible API.
 * Claude is accessed via OpenRouter — no separate Anthropic key needed.
 */
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";
import { NarrativeScript } from "./narrative-engine";
import { ScriptProvider } from "./script-generator";

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
}

const METADATA_PROMPT = `You are a YouTube SEO expert and content strategist with deep knowledge of the YouTube algorithm, search ranking, and click-through rate optimization.

Your job is to generate a title and description for a YouTube video based on the script provided.

## Title Rules:
- Create a clear, engaging, and curiosity-driven title that maximizes click-through rate.
- Use power words that trigger emotion: "Shocking," "Exposed," "Hidden," "Secret," "Nobody Knew," etc.
- Keep it under 70 characters for full visibility in search results.
- Include the primary keyword naturally near the beginning.
- Do NOT use clickbait that the video doesn't deliver on — it must be relevant to the script.
- Format examples: "The Untold Truth About [Topic] That Nobody Talks About" or "[Topic]: What They Don't Want You To Know"

## Description Rules:
- First 2-3 lines (above the fold) MUST contain the strongest hook and primary keywords — this is what shows in search results.
- Include key content from the BEGINNING and END of the script to increase keyword density.
- Add relevant keywords naturally throughout (no keyword stuffing).
- Write 150-300 words total for the description.
- Structure:
  1. Hook line (compelling reason to watch)
  2. Brief summary of what the video covers (2-3 sentences pulling from the script)
  3. Key topics/timestamps placeholder
  4. Call to action (subscribe, like, comment)
- Do NOT include hashtags in the description body — they go in tags.

## Tags Rules:
- Generate 10-15 relevant tags/keywords.
- Mix broad and specific terms.
- Include long-tail keywords.

Return ONLY a JSON object:
{
  "title": "Your SEO-Optimized Title Here",
  "description": "Full description text here...",
  "tags": ["tag1", "tag2", "tag3"]
}`;

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

function getDefaultModel(provider: ScriptProvider): string {
  if (provider === "claude") return "anthropic/claude-sonnet-4";
  if (provider === "openrouter") return "google/gemini-2.0-flash-001";
  return CONFIG.llmModel;
}

function extractJson(raw: string): string {
  let cleaned = raw.replace(/\`\`\`(?:json)?\s*\n?/gi, "").replace(/\`\`\`\s*$/g, "").trim();
  const objMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1];
  return cleaned;
}

/**
 * Generate YouTube title, description, and tags from script content.
 */
export async function generateYouTubeMetadata(
  script: NarrativeScript,
  originalTitle: string | undefined,
  provider: ScriptProvider,
  model?: string
): Promise<YouTubeMetadata> {
  console.log(`  Generating YouTube metadata via ${provider}...`);

  const scriptStart = script.segments.slice(0, 2).map((s) => s.text).join("\n\n");
  const scriptEnd = script.segments.slice(-2).map((s) => s.text).join("\n\n");
  const fullScript = script.fullScript;

  const userMessage = [
    originalTitle ? `Original working title: "${originalTitle}"` : "",
    `\nFull script (${script.segments.length} segments):\n\n${fullScript}`,
    `\n\nScript opening (for description keywords):\n${scriptStart}`,
    `\n\nScript conclusion (for description keywords):\n${scriptEnd}`,
    `\nGenerate an SEO-optimized title (better than the working title if provided), a keyword-rich description, and relevant tags.`,
  ].filter(Boolean).join("\n");

  let rawResponse: string;

  const client = createClient(provider);
  const llmModel = model || getDefaultModel(provider);
  const response = await client.chat.completions.create({
    model: llmModel,
    messages: [
      { role: "system", content: METADATA_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });
  rawResponse = response.choices[0].message.content || "{}";

  let metadata: YouTubeMetadata;
  try {
    metadata = JSON.parse(extractJson(rawResponse));
  } catch {
    console.warn("  Could not parse metadata JSON, using fallback...");
    metadata = {
      title: originalTitle || "Untitled Video",
      description: script.segments[0]?.text || "",
      tags: [],
    };
  }

  // Save to temp
  const metadataPath = path.join(CONFIG.paths.temp, "youtube_metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  console.log(`  Title: "${metadata.title}"`);
  console.log(`  Description: ${metadata.description.length} chars, ${metadata.tags.length} tags`);

  return metadata;
}
