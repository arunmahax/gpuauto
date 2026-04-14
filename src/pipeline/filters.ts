/**
 * Filter Library Module
 * Provides a collection of FFmpeg video filters that users can choose from.
 * Filters can be combined and customized.
 */

export interface FilterPreset {
  id: string;
  name: string;
  category: "color" | "style" | "atmosphere" | "artistic" | "correction";
  description: string;
  /** FFmpeg -vf filter string (use {w} and {h} for output dimensions) */
  filter: string;
  /** Preview-friendly CSS filter approximation for UI thumbnails */
  cssPreview?: string;
  /** Parameters that can be adjusted */
  params?: FilterParam[];
}

export interface FilterParam {
  name: string;
  label: string;
  type: "number" | "color" | "boolean";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Master filter library — all available presets.
 */
export const FILTER_PRESETS: FilterPreset[] = [
  // ─── Color Grading ───
  {
    id: "cinematic",
    name: "Cinematic",
    category: "color",
    description: "Warm cinematic look with crushed blacks and golden highlights",
    filter: "colorbalance=rs=0.1:gs=-0.05:bs=-0.1:rm=0.05:gm=0:bm=-0.05,curves=m='0/0 0.25/0.15 0.5/0.5 0.75/0.85 1/1',eq=contrast=1.1:brightness=0.02:saturation=1.2",
    cssPreview: "sepia(15%) contrast(110%) saturate(120%) brightness(102%)",
  },
  {
    id: "vintage",
    name: "Vintage",
    category: "color",
    description: "Faded retro look with warm tones and reduced saturation",
    filter: "colorbalance=rs=0.15:gs=0.05:bs=-0.1:rm=0.1:gm=0.05:bm=-0.05,eq=saturation=0.7:contrast=0.95:brightness=0.05,curves=m='0/0.05 0.5/0.55 1/0.95'",
    cssPreview: "sepia(30%) saturate(70%) contrast(95%) brightness(105%)",
  },
  {
    id: "noir",
    name: "Film Noir",
    category: "color",
    description: "High contrast black and white with dramatic shadows",
    filter: "hue=s=0,eq=contrast=1.4:brightness=-0.05:gamma=0.9,curves=m='0/0 0.25/0.1 0.5/0.5 0.75/0.9 1/1'",
    cssPreview: "grayscale(100%) contrast(140%) brightness(95%)",
  },
  {
    id: "warm",
    name: "Warm Glow",
    category: "color",
    description: "Warm, inviting tones with soft orange/amber cast",
    filter: "colorbalance=rs=0.15:gs=0.05:bs=-0.15:rm=0.1:gm=0.02:bm=-0.1,eq=saturation=1.1:brightness=0.03",
    cssPreview: "sepia(20%) saturate(110%) brightness(103%)",
  },
  {
    id: "cool",
    name: "Cool Blue",
    category: "color",
    description: "Cool blue-teal tones for a modern, sleek feel",
    filter: "colorbalance=rs=-0.1:gs=-0.02:bs=0.15:rm=-0.08:gm=0:bm=0.1,eq=saturation=1.05:contrast=1.05",
    cssPreview: "saturate(105%) contrast(105%) hue-rotate(10deg)",
  },
  {
    id: "dramatic",
    name: "Dramatic",
    category: "color",
    description: "High contrast with desaturated midtones and punchy colors",
    filter: "eq=contrast=1.3:saturation=1.3:brightness=-0.02,curves=m='0/0 0.15/0.05 0.5/0.5 0.85/0.95 1/1'",
    cssPreview: "contrast(130%) saturate(130%) brightness(98%)",
  },
  {
    id: "pastel",
    name: "Pastel Dream",
    category: "color",
    description: "Soft, light pastel tones with lifted shadows",
    filter: "eq=saturation=0.6:brightness=0.08:contrast=0.85,curves=m='0/0.15 0.5/0.55 1/0.95'",
    cssPreview: "saturate(60%) brightness(108%) contrast(85%)",
  },
  {
    id: "orange_teal",
    name: "Orange & Teal",
    category: "color",
    description: "Classic Hollywood color grading with orange skin and teal shadows",
    filter: "colorbalance=rs=0.15:gs=-0.05:bs=-0.2:rh=0.05:gh=-0.05:bh=-0.1:rs=0.1:gs=-0.02:bs=-0.15,eq=saturation=1.25:contrast=1.1",
    cssPreview: "saturate(125%) contrast(110%)",
  },

  // ─── Style Effects ───
  {
    id: "grain_light",
    name: "Light Film Grain",
    category: "style",
    description: "Subtle film grain texture",
    filter: "noise=alls=15:allf=t",
    cssPreview: "",
  },
  {
    id: "grain_heavy",
    name: "Heavy Film Grain",
    category: "style",
    description: "Strong visible film grain for a raw, documentary look",
    filter: "noise=alls=40:allf=t",
    cssPreview: "",
  },
  {
    id: "vignette_soft",
    name: "Soft Vignette",
    category: "style",
    description: "Gentle edge darkening to focus attention on center",
    filter: "vignette=PI/5",
    cssPreview: "",
  },
  {
    id: "vignette_strong",
    name: "Strong Vignette",
    category: "style",
    description: "Heavy vignette for a dramatic framed look",
    filter: "vignette=PI/3",
    cssPreview: "",
  },
  {
    id: "sharpen",
    name: "Sharpen",
    category: "style",
    description: "Enhanced sharpness for crisp, detailed footage",
    filter: "unsharp=3:3:1.5:3:3:0.0",
    cssPreview: "",
  },
  {
    id: "blur_soft",
    name: "Soft Focus",
    category: "style",
    description: "Dreamy soft focus / slight blur",
    filter: "gblur=sigma=1.5",
    cssPreview: "blur(1.5px)",
  },

  // ─── Atmosphere ───
  {
    id: "horror",
    name: "Horror",
    category: "atmosphere",
    description: "Dark, desaturated, greenish tint with heavy contrast",
    filter: "colorbalance=rs=-0.1:gs=0.05:bs=-0.05:rm=-0.05:gm=0.03:bm=-0.02,eq=contrast=1.3:saturation=0.5:brightness=-0.08:gamma=0.85,noise=alls=25:allf=t",
    cssPreview: "saturate(50%) contrast(130%) brightness(92%) hue-rotate(-10deg)",
  },
  {
    id: "documentary",
    name: "Documentary",
    category: "atmosphere",
    description: "Natural, slightly desaturated professional broadcast look",
    filter: "eq=saturation=0.85:contrast=1.05:brightness=0.01,curves=m='0/0 0.5/0.52 1/1'",
    cssPreview: "saturate(85%) contrast(105%) brightness(101%)",
  },
  {
    id: "neon",
    name: "Neon Nights",
    category: "atmosphere",
    description: "Vibrant, over-saturated with boosted blues and pinks",
    filter: "colorbalance=rs=0.1:gs=-0.1:bs=0.2:rm=0.05:gm=-0.1:bm=0.15,eq=saturation=1.5:contrast=1.15:brightness=-0.02",
    cssPreview: "saturate(150%) contrast(115%) brightness(98%) hue-rotate(10deg)",
  },
  {
    id: "sunset",
    name: "Golden Hour",
    category: "atmosphere",
    description: "Warm golden hour lighting with soft amber glow",
    filter: "colorbalance=rs=0.2:gs=0.1:bs=-0.15:rm=0.15:gm=0.05:bm=-0.1,eq=saturation=1.15:brightness=0.04:contrast=0.95",
    cssPreview: "sepia(25%) saturate(115%) brightness(104%) contrast(95%)",
  },
  {
    id: "moonlight",
    name: "Moonlight",
    category: "atmosphere",
    description: "Cool blue-silver tones like moonlit scenes",
    filter: "colorbalance=rs=-0.15:gs=-0.05:bs=0.2:rm=-0.1:gm=0:bm=0.15,eq=saturation=0.7:brightness=-0.02:contrast=1.1",
    cssPreview: "saturate(70%) brightness(98%) contrast(110%) hue-rotate(20deg)",
  },

  // ─── Artistic ───
  {
    id: "comic",
    name: "Comic Book",
    category: "artistic",
    description: "Bold edges, high saturation, poster-like effect",
    filter: "eq=saturation=1.5:contrast=1.4,edgedetect=low=0.1:high=0.3:mode=colormix",
    cssPreview: "saturate(150%) contrast(140%)",
  },
  {
    id: "sepia",
    name: "Sepia Tone",
    category: "artistic",
    description: "Classic sepia brown tone for an antique look",
    filter: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    cssPreview: "sepia(100%)",
  },
  {
    id: "cross_process",
    name: "Cross Process",
    category: "artistic",
    description: "Cross-processed film look with shifted colors",
    filter: "curves=r='0/0.1 0.5/0.6 1/0.9':g='0/0 0.5/0.45 1/1':b='0/0.2 0.5/0.5 1/0.8',eq=saturation=1.2",
    cssPreview: "saturate(120%) hue-rotate(15deg)",
  },

  // ─── Correction ───
  {
    id: "auto_levels",
    name: "Auto Levels",
    category: "correction",
    description: "Automatic contrast and level balancing",
    filter: "normalize=blackpt=black:whitept=white:smoothing=0",
    cssPreview: "",
  },
  {
    id: "stabilize",
    name: "De-shake",
    category: "correction",
    description: "Reduce camera shake (2-pass required)",
    filter: "deshake=rx=32:ry=32",
    cssPreview: "",
  },
];

/**
 * Get a filter by ID.
 */
export function getFilter(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((f) => f.id === id);
}

/**
 * Get all filters in a category.
 */
export function getFiltersByCategory(category: FilterPreset["category"]): FilterPreset[] {
  return FILTER_PRESETS.filter((f) => f.category === category);
}

/**
 * Build a combined FFmpeg -vf filter chain from multiple filter IDs.
 * Returns empty string if no valid filters selected.
 */
export function buildFilterChain(filterIds: string[], width?: number, height?: number): string {
  const w = width || 1920;
  const h = height || 1080;

  const filters = filterIds
    .map((id) => getFilter(id))
    .filter((f): f is FilterPreset => !!f)
    .map((f) => f.filter.replace(/\{w\}/g, String(w)).replace(/\{h\}/g, String(h)));

  return filters.join(",");
}

/**
 * Get all available filter presets (for API/UI).
 */
export function getAllFilters(): FilterPreset[] {
  return FILTER_PRESETS;
}
