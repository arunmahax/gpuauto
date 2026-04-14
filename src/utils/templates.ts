/**
 * Template Manager
 * Save, load, list, delete user-created templates.
 * Templates are stored as JSON files in assets/templates/.
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/config";

export interface SavedTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;

  // ─── Visual Settings ───
  filters: string[];            // filter preset IDs
  transitionType: string;       // transition preset ID
  transitionDuration: number;
  contentScale: number;
  backgroundColor: string;
  borderRadius: number;

  // ─── Logo ───
  logoEnabled: boolean;
  logoPosition: string;
  logoScale: number;
  logoOpacity: number;

  // ─── PiP ───
  pipEnabled: boolean;
  pipPosition: string;
  pipScale: number;
  pipBorderRadius: number;
  pipBorderColor: string;
  pipBorderWidth: number;

  // ─── Audio ───
  narrationVolume: number;
  musicVolume: number;

  // ─── TTS ───
  ttsProvider: string;
  ttsVoice: string;

  // ─── Script ───
  scriptProvider: string;
  scriptModel?: string;
  targetDurationMin: number;
}

/**
 * Default template values.
 */
export const DEFAULT_SAVED_TEMPLATE: Omit<SavedTemplate, "id" | "name" | "createdAt" | "updatedAt"> = {
  filters: ["cinematic"],
  transitionType: "fade",
  transitionDuration: 0.3,
  contentScale: 0.85,
  backgroundColor: "#0a0a0a",
  borderRadius: 8,
  logoEnabled: false,
  logoPosition: "bottom-right",
  logoScale: 0.12,
  logoOpacity: 0.7,
  pipEnabled: false,
  pipPosition: "top-right",
  pipScale: 0.25,
  pipBorderRadius: 8,
  pipBorderColor: "#ffffff",
  pipBorderWidth: 2,
  narrationVolume: 1.0,
  musicVolume: 0.12,
  ttsProvider: "openai",
  ttsVoice: "onyx",
  scriptProvider: "openrouter",
  targetDurationMin: 10,
};

function getTemplateDir(): string {
  const dir = CONFIG.paths.templates;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50);
}

/**
 * Save a template. If id exists, overwrites.
 */
export function saveTemplate(template: Partial<SavedTemplate> & { name: string }): SavedTemplate {
  const dir = getTemplateDir();
  const id = template.id || sanitizeId(template.name);
  const now = new Date().toISOString();

  const existing = loadTemplate(id);
  const saved: SavedTemplate = {
    ...DEFAULT_SAVED_TEMPLATE,
    ...(existing || {}),
    ...template,
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(saved, null, 2), "utf-8");
  return saved;
}

/**
 * Load a template by ID.
 */
export function loadTemplate(id: string): SavedTemplate | null {
  const filePath = path.join(getTemplateDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * List all saved templates.
 */
export function listTemplates(): SavedTemplate[] {
  const dir = getTemplateDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as SavedTemplate;
      } catch {
        return null;
      }
    })
    .filter((t): t is SavedTemplate => !!t)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Delete a template by ID.
 */
export function deleteTemplate(id: string): boolean {
  const filePath = path.join(getTemplateDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
