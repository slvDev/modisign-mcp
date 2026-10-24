// generated from the Modisign monorepo, do not edit
import { captionDisplayText, captionStyle, resolveLook, type CaptionLine, type CaptionStyle, type LineTreatment, type ResolvedLook } from "./captions";
import { CAPTION_FONTS } from "./caption-mix";

export type CaptionRect = { x: number; y: number; width: number; height: number };
export type CaptionFace = Pick<ResolvedLook, "font" | "weight" | "italic">;
export type CaptionLayoutWord = CaptionRect & CaptionFace & {
  index: number; row: number; text: string; active: boolean; scale: number;
  tracking: number; fill: string | null; underline: boolean; highlight: string | null; textWidth: number;
};
export type CaptionMeasure = (text: string, size: number, face: CaptionFace) => number;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const captionGraphemes = (text: string) => Array.from(segmenter.segment(text), ({ segment }) => segment);
export function captionCharacterCount(text: string, start: number, end: number, time: number) {
  if (time < start) return 0;
  const length = Array.from(text).length;
  return Math.min(length, 1 + Math.floor(length * clamp((time - start) / (end - start))));
}
export function captionPopScale(elapsed: number) {
  const progress = clamp(elapsed / 0.12);
  if (progress < 0.7) return 0.6 + 0.48 * (1 - (1 - progress / 0.7) ** 3);
  return 1.08 - 0.08 * ((progress - 0.7) / 0.3);
}
// A tracked word is laid out glyph by glyph: each glyph sits where the kerned prefix ending with it puts it, plus the tracking; the last carries none, so the ink stays centred. Layout and painting both read these offsets.
export function glyphOffsets(text: string, size: number, face: CaptionFace, tracking: number, measure: CaptionMeasure) {
  const glyphs = captionGraphemes(text);
  let prefix = "";
  const offsets = glyphs.map((glyph, index) => {
    prefix += glyph;
    return measure(prefix, size, face) - measure(glyph, size, face) + index * tracking * size;
  });
  return { glyphs, offsets, width: glyphs.length === 0 ? 0 : offsets[offsets.length - 1] + measure(glyphs[glyphs.length - 1], size, face) };
}
export function trackedWidth(text: string, size: number, face: CaptionFace, tracking: number, measure: CaptionMeasure) {
  return tracking === 0 ? measure(text, size, face) : glyphOffsets(text, size, face, tracking, measure).width;
}
// Only a face with a real italic may slant; no word is ever synthesized.
export const italicFace = (face: CaptionFace): CaptionFace => CAPTION_FONTS[face.font].italic ? { ...face, italic: true } : face;
export type CaptionPoint = { x: number; y: number };
const SIZE_FRACTIONS = { s: 0.037, m: 0.048, l: 0.063 } as const;
// A line's nominal font height in output pixels: a number is a fraction of the shorter side, S/M/L are width-relative.
export const captionSizePixels = (size: LineTreatment["size"], width: number, height: number) => typeof size === "number" ? Math.min(width, height) * size : width * SIZE_FRACTIONS[size];
// Ink beyond the text rectangles, as a fraction of the font size: stroke, shadow and glow blur, and the word highlight box.
function paintPadding(style: CaptionStyle) {
  const shadow = style.shadow === null ? 0 : style.shadow.blur + style.shadow.offset;
  return Math.max(0.06, style.stroke === null ? 0 : style.stroke.width / 2 + 0.03, shadow + 0.04, style.glow ? 0.6 : 0, style.background === "word" ? 0.3 : 0);
}
const rotated = (point: CaptionPoint, center: CaptionPoint, radians: number): CaptionPoint => ({
  x: center.x + (point.x - center.x) * Math.cos(radians) - (point.y - center.y) * Math.sin(radians),
  y: center.y + (point.x - center.x) * Math.sin(radians) + (point.y - center.y) * Math.cos(radians),
});
// Time-independent for a line except the words' reveal state; every rectangle is in output pixels before the block's rotation about `center`.
export function captionLayout(line: CaptionLine, time: number, width: number, height: number, measure: CaptionMeasure) {
  const { treatment } = line;
  const style = captionStyle(treatment.style);
  const texts = line.words.map(({ text }) => captionDisplayText(text, style.casing));
  const looks = line.words.map(({ look }) => resolveLook(style, look));
  const maxScale = Math.max(style.activeScale, style.motion === "pop" ? 1.08 : 1);
  let size = captionSizePixels(treatment.size, width, height) * (style.motion === "word" ? 1.6 : 1);
  const base: CaptionFace = { font: style.font, weight: style.weight, italic: false };
  let rows: number[][] = [];
  let widths: number[] = [];
  let space = 0;
  function wrap() {
    widths = texts.map((text, i) => Math.max(trackedWidth(text, size, looks[i], looks[i].tracking, measure), style.activeItalic ? trackedWidth(text, size, italicFace(looks[i]), looks[i].tracking, measure) : 0) * maxScale);
    space = measure(" ", size, base);
    rows = [[]];
    let used = 0;
    for (let i = 0; i < texts.length; i++) {
      const row = rows[rows.length - 1];
      const next = used + (row.length === 0 ? 0 : space) + widths[i];
      if (row.length > 0 && next > width * 0.86) { rows.push([i]); used = widths[i]; }
      else { row.push(i); used = next; }
    }
  }
  wrap();
  while (rows.length > 2 || widths.some((value) => value > width * 0.86)) { size *= 0.9; wrap(); }
  // A row is as tall as its most open word; with no leading overrides every row is 1.35 × size.
  const rowHeights = rows.map((row) => size * Math.max(...row.map((i) => looks[i].leading)));
  const total = rowHeights.reduce((sum, value) => sum + value, 0);
  const rowWidths = rows.map((row) => row.reduce((sum, i) => sum + widths[i], 0) + space * (row.length - 1));
  const extent = Math.max(...rowWidths);
  const pad = size * paintPadding(style);
  const backingWidth = style.background === "line" ? extent + size * 0.8 : 0;
  const radians = treatment.rotation * Math.PI / 180;
  // The block is placed about its centre; its rotated paint bound is then kept inside the frame.
  const half = { x: Math.max(extent, backingWidth) / 2 + pad, y: total / 2 + pad };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotated({ x: sx * half.x, y: sy * half.y }, { x: 0, y: 0 }, radians));
  const wanted = { x: width * treatment.x, y: height * treatment.y };
  const [lowX, highX, lowY, highY] = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.y))];
  const fit = (at: number, low: number, high: number, limit: number) => at + low < 0 ? -low : at + high > limit ? limit - high : at;
  const center = { x: fit(wanted.x, lowX, highX, width), y: fit(wanted.y, lowY, highY, height) };
  const box = { x: center.x - extent / 2, y: center.y - total / 2, width: extent, height: total };
  const words: CaptionLayoutWord[] = [];
  let top = box.y;
  rows.forEach((row, rowIndex) => {
    let x = center.x - rowWidths[rowIndex] / 2;
    const y = top + rowHeights[rowIndex] / 2;
    top += rowHeights[rowIndex];
    for (const i of row) {
      const word = line.words[i];
      const look = looks[i];
      const active = time >= word.start && time < word.end;
      let text = texts[i];
      if (style.reveal === "accumulate" && time < word.start) text = "";
      if (style.reveal === "characters") text = Array.from(text).slice(0, captionCharacterCount(text, word.start, word.end, time)).join("");
      const scale = style.motion === "pop" ? captionPopScale(time - word.start) : style.motion === "word" ? 0.8 + 0.2 * (1 - (1 - clamp((time - line.start) / 0.08)) ** 3) : active ? style.activeScale : 1;
      const italic = look.italic || (active && style.activeItalic && CAPTION_FONTS[look.font].italic);
      const textWidth = trackedWidth(text, size, { font: look.font, weight: look.weight, italic }, look.tracking, measure);
      words.push({ index: i, row: rowIndex, x, y: y - size / 2, width: widths[i], height: size, text, active, italic, scale, font: look.font, weight: look.weight, tracking: look.tracking, fill: look.fill, underline: look.underline, highlight: look.highlight, textWidth });
      x += widths[i] + space;
    }
  });
  const backing: CaptionRect | null = backingWidth === 0 ? null : { x: center.x - backingWidth / 2, y: box.y, width: backingWidth, height: total };
  const lastSpoken = words.filter(({ index }) => time >= line.words[index].start).at(-1);
  let highlight: CaptionRect | null = null;
  if (style.background === "word" && lastSpoken !== undefined) {
    const previous = words[lastSpoken.index - 1];
    const progress = clamp((time - line.words[lastSpoken.index].start) / 0.09);
    const ease = 1 - (1 - progress) ** 3;
    const from = previous === undefined ? lastSpoken : previous;
    highlight = Object.fromEntries((["x", "y", "width", "height"] as const).map((key) => [key, from[key] + (lastSpoken[key] - from[key]) * ease])) as CaptionRect;
  }
  const lastVisible = words.filter(({ text }) => text !== "").at(-1);
  const caret = style.reveal === "characters" && lastVisible !== undefined && Math.floor((time - line.start) * 2) % 2 === 0 ? {
    x: lastVisible.x + trackedWidth(lastVisible.text, size, { font: lastVisible.font, weight: lastVisible.weight, italic: false }, lastVisible.tracking, measure) + size * 0.1,
    y: lastVisible.y, width: size * 0.035, height: size,
  } : null;
  // The padded paint bound before rotation, and its corners after it: what handles, safe zones and collision checks use.
  const bound: CaptionRect = { x: center.x - half.x, y: center.y - half.y, width: half.x * 2, height: half.y * 2 };
  return { size, anchor: center.y, center, rotation: radians, box, rows, words, backing, highlight, caret, bound, corners: corners.map((corner) => ({ x: center.x + corner.x, y: center.y + corner.y })) };
}
