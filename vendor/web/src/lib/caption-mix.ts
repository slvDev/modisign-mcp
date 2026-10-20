// generated from the Modisign monorepo, do not edit
import { CAPTION_MIX_PRESETS, isWordAppearance, type CaptionMix, type WordAppearance } from "../../../server/src/studio-project";
export { CAPTION_FONTS, CAPTION_FONT_IDS, CAPTION_MIX_PRESETS, LEADING_RANGE, MIX_PALETTE_SIZE, isEffectiveAppearance, TRACKING_RANGE, isCaptionColor, isCaptionFace, isCaptionMix, isWordAppearance, type CaptionFont, type CaptionMix, type WordAppearance } from "../../../server/src/studio-project";

// A null value removes a field; a font in the patch replaces the whole face group (font, weight, italic).
export type WordPatch = { [K in keyof WordAppearance]?: WordAppearance[K] | null };
// The one reduction of word styles, used by the reducer and by MCP selectors.
export function patchedLook(existing: WordAppearance | undefined, patch: WordPatch): WordAppearance | undefined {
  const next: Record<string, unknown> = { ...existing };
  if (Object.hasOwn(patch, "font")) { delete next.font; delete next.weight; delete next.italic; }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  if (Object.keys(next).length === 0) return undefined;
  if (!isWordAppearance(next)) throw new Error("The word style is not a valid face or value");
  return next;
}

export const MIX_PALETTES = [
  { id: "cream-yellow-pink", name: "Cream, yellow, pink", colors: ["#FFF4DC", "#FFD60A", "#FF5FA2"] },
  { id: "white-cyan-lime", name: "White, cyan, lime", colors: ["#FFFFFF", "#3DE0FF", "#B6FF3B"] },
  { id: "ivory-gold-coral", name: "Ivory, gold, coral", colors: ["#FAF3E0", "#F2C14E", "#FF7B6B"] },
  { id: "white-lilac-mint", name: "White, lilac, mint", colors: ["#FFFFFF", "#C9A7FF", "#7DF0C7"] },
] as const;
const INK = "#111111";
// `color` and `highlight` index the mix palette; a highlighted word is drawn in ink.
type Variant = { font: "sans" | "serif" | "mono"; weight: number; italic?: true; color: number; tracking?: number; underline?: true; highlight?: number };
export const CAPTION_MIXES: Record<typeof CAPTION_MIX_PRESETS[number], { name: string; palette: readonly string[]; variants: readonly Variant[] }> = {
  creator: {
    name: "Creator trio", palette: MIX_PALETTES[0].colors,
    variants: [
      { font: "sans", weight: 900, color: 0 }, { font: "sans", weight: 800, color: 1 }, { font: "serif", weight: 600, italic: true, color: 2 },
      { font: "mono", weight: 700, color: 0, tracking: 0.02 }, { font: "sans", weight: 500, color: 2, tracking: 0.06 }, { font: "serif", weight: 700, color: 1 },
      { font: "sans", weight: 900, color: 1, underline: true }, { font: "mono", weight: 500, color: 0, highlight: 1 },
    ],
  },
  editorial: {
    name: "Editorial trio", palette: MIX_PALETTES[2].colors,
    variants: [
      { font: "serif", weight: 700, color: 0 }, { font: "serif", weight: 600, italic: true, color: 1 }, { font: "serif", weight: 400, italic: true, color: 0 },
      { font: "sans", weight: 700, color: 2, tracking: 0.12 }, { font: "mono", weight: 500, color: 1, tracking: 0.04 }, { font: "serif", weight: 600, color: 2, underline: true },
      { font: "sans", weight: 900, color: 0 }, { font: "serif", weight: 700, italic: true, color: 0, highlight: 1 },
    ],
  },
};
export const DEFAULT_MIX_PRESET = "creator";
// Also the sample on the Mixed card and the seed `edit_video` uses when none is given; ids 0, 1 and 2 draw three families.
export const DEFAULT_MIX_SEED = 58;

export function newMix(preset: CaptionMix["preset"], seed: number, palette: readonly string[] = CAPTION_MIXES[preset].palette): CaptionMix {
  return { preset, seed, palette: [...palette] };
}
export function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
// FNV-1a over the seed and the source word id, finished with an avalanche so neighbouring ids spread.
function hash(seed: number, id: string) {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of id) value = Math.imul(value ^ character.codePointAt(0)!, 16777619) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 2246822519) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
export function mixAppearance(mix: CaptionMix, wordId: string): WordAppearance {
  const { variants } = CAPTION_MIXES[mix.preset];
  const variant = variants[hash(mix.seed, wordId) % variants.length];
  const colors = (index: number) => mix.palette[index % mix.palette.length];
  const fill = variant.highlight === undefined ? colors(variant.color) : INK;
  return {
    font: variant.font, weight: variant.weight, ...(variant.italic === undefined ? {} : { italic: true }), fill,
    ...(variant.tracking === undefined ? {} : { tracking: variant.tracking }), ...(variant.underline === undefined ? {} : { underline: true }),
    ...(variant.highlight === undefined ? {} : { highlight: colors(variant.highlight) }),
  };
}
