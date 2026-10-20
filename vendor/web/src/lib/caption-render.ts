// generated from the Modisign monorepo, do not edit
import { captionDisplayText, captionStyle, resolveLook, type CaptionLine, type CaptionPlacement, type CaptionStyleId } from "./captions";
import { captionLayout, glyphOffsets, italicFace, type CaptionFace, type CaptionLayoutWord, type CaptionRect } from "./caption-layout";
import type { CaptionFont } from "./caption-mix";

const FONT_VARIABLES: Record<CaptionFont, string> = { sans: "--font-caption-sans", serif: "--font-caption-serif", mono: "--font-caption-mono" };
const families = new Map<CaptionFont, string>();
function captionFontFamily(font: CaptionFont) {
  const known = families.get(font);
  if (known !== undefined) return known;
  const family = getComputedStyle(document.documentElement).getPropertyValue(FONT_VARIABLES[font]).trim();
  if (family === "") throw new Error("The caption display font is unavailable");
  families.set(font, family);
  return family;
}
export const fontString = (face: CaptionFace, size: number) => `${face.italic ? "italic " : ""}${face.weight} ${size}px ${captionFontFamily(face.font)}`;
// Every face the lines draw, with the displayed text it must cover: the style's own face first, then each word's.
function usedFaces(lines: CaptionLine[], styleId: CaptionStyleId) {
  const style = captionStyle(styleId);
  const faces = new Map<string, { face: CaptionFace; texts: Set<string> }>();
  const add = (face: CaptionFace, text: string) => {
    const key = fontString(face, 48);
    const entry = faces.get(key);
    if (entry === undefined) faces.set(key, { face, texts: new Set([text]) });
    else entry.texts.add(text);
  };
  for (const word of lines.flatMap((line) => line.words)) {
    const { font, weight, italic } = resolveLook(style, word.look);
    const face = { font, weight, italic };
    const text = captionDisplayText(word.text, style.casing);
    add(face, text);
    if (style.activeItalic) add(italicFace(face), text);
  }
  // Word spacing is always measured in the style's own face.
  const base = { font: style.font, weight: style.weight, italic: false };
  if (!faces.has(fontString(base, 48))) add(base, " ");
  return [...faces.values()].map(({ face, texts }) => ({ face, text: [...texts].join(" ") }));
}
// Loads every face with its displayed text and fails when one is not usable, so no measurement or draw falls back to another face.
export async function loadFaces(faces: { face: CaptionFace; text: string }[]) {
  await Promise.all(faces.map(async ({ face, text }) => {
    const font = fontString(face, 48);
    await document.fonts.load(font, text);
    if (!document.fonts.check(font, text)) throw new Error(`The caption font ${font} is unavailable`);
  }));
}
export const loadCaptionFonts = (lines: CaptionLine[], styleId: CaptionStyleId) => loadFaces(usedFaces(lines, styleId));
function roundedBox(ctx: CanvasRenderingContext2D, rect: CaptionRect, padding: number, color: string, radius: number) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(rect.x - padding, rect.y - padding, rect.width + padding * 2, rect.height + padding * 2, radius); ctx.fill();
}
const layers = new WeakMap<CanvasRenderingContext2D, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }>();
// A cleared transparent layer per target context, so glyphs rasterize the same on the monitor and on an opaque export canvas.
export function transparentLayer(ctx: CanvasRenderingContext2D, width: number, height: number) {
  let layer = layers.get(ctx);
  if (layer === undefined) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Text layer is unavailable");
    layer = { canvas, context }; layers.set(ctx, layer);
  }
  if (layer.canvas.width !== width) layer.canvas.width = width;
  if (layer.canvas.height !== height) layer.canvas.height = height;
  layer.context.clearRect(0, 0, width, height);
  return layer;
}
export function drawCaptions(ctx: CanvasRenderingContext2D, lines: CaptionLine[], styleId: CaptionStyleId, time: number, width: number, height: number, placement: CaptionPlacement) {
  const line = lines.find((line) => time >= line.start && time < line.end);
  if (line === undefined) return;
  const layer = transparentLayer(ctx, width, height);
  drawCaptionLine(layer.context, line, styleId, time, width, height, placement);
  ctx.drawImage(layer.canvas, 0, 0);
}
// Tracked words paint each glyph at the offsets layout measured, so width, centring, underline and highlight agree with the ink.
function paintText(ctx: CanvasRenderingContext2D, mode: "fillText" | "strokeText", word: CaptionLayoutWord, size: number, measure: (text: string, size: number, face: CaptionFace) => number) {
  if (word.tracking === 0) { ctx[mode](word.text, 0, 0); return; }
  const { glyphs, offsets } = glyphOffsets(word.text, size, word, word.tracking, measure);
  ctx.textAlign = "left";
  glyphs.forEach((glyph, index) => ctx[mode](glyph, -word.textWidth / 2 + offsets[index], 0));
  ctx.textAlign = "center";
}
function drawCaptionLine(ctx: CanvasRenderingContext2D, line: CaptionLine, styleId: CaptionStyleId, time: number, width: number, height: number, placement: CaptionPlacement) {
  const style = captionStyle(styleId);
  const measure = (text: string, size: number, face: CaptionFace) => { ctx.font = fontString(face, size); return ctx.measureText(text).width; };
  ctx.save();
  const layout = captionLayout(line, styleId, time, width, height, placement, measure);
  const { size } = layout;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  if (style.background === "line") {
    const boxWidth = Math.max(...layout.rows.map((row) => { const first = layout.words[row[0]]; const last = layout.words[row[row.length - 1]]; return last.x + last.width - first.x; })) + size * 0.8;
    roundedBox(ctx, { x: (width - boxWidth) / 2, y: layout.box.y, width: boxWidth, height: layout.box.height }, 0, "rgba(0,0,0,0.8)", size * 0.22);
  }
  if (layout.highlight !== null) roundedBox(ctx, layout.highlight, size * 0.18, "#FFD60A", size * 0.2);
  for (const word of layout.words) {
    if (word.text === "") continue;
    ctx.save();
    // Typewriter's left edge stays fixed as characters arrive.
    const boxWidth = style.reveal === "characters" ? word.textWidth : word.width;
    ctx.translate(word.x + boxWidth / 2, word.y + size / 2); ctx.scale(word.scale, word.scale);
    const face = { font: word.font, weight: word.weight, italic: word.italic };
    ctx.font = fontString(face, size);
    const fill = word.active && style.activeFill !== style.fill ? style.activeFill : word.fill !== null ? word.fill : style.fill;
    if (word.highlight !== null) roundedBox(ctx, { x: -word.textWidth / 2, y: -size / 2, width: word.textWidth, height: size }, size * 0.12, word.highlight, size * 0.16);
    if (word.underline) {
      const underline = { x: -word.textWidth / 2, y: size * 0.34, width: word.textWidth, height: size * 0.06 };
      if (style.stroke !== null) { ctx.lineWidth = size * style.stroke.width; ctx.strokeStyle = style.stroke.color; ctx.strokeRect(underline.x, underline.y, underline.width, underline.height); }
      ctx.fillStyle = fill === null ? style.stroke!.color : fill;
      ctx.fillRect(underline.x, underline.y, underline.width, underline.height);
    }
    if (style.shadow !== null) { ctx.shadowColor = style.shadow.color; ctx.shadowBlur = size * style.shadow.blur; ctx.shadowOffsetY = size * style.shadow.offset; }
    const paint = (mode: "fillText" | "strokeText") => paintText(ctx, mode, word, size, measure);
    if (style.stroke !== null) { ctx.lineWidth = size * style.stroke.width; ctx.strokeStyle = style.stroke.color; paint("strokeText"); }
    if (fill !== null) {
      ctx.fillStyle = fill;
      if (style.gradient && word.fill === null) {
        const gradient = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        gradient.addColorStop(0, "#ffae43"); gradient.addColorStop(1, "#ff4da6"); ctx.fillStyle = gradient;
      }
      if (style.glow) {
        for (const [color, offset] of [["#00e5ff", -0.08], ["#f43bda", 0.08]] as const) {
          ctx.shadowColor = color; ctx.shadowOffsetX = size * offset; ctx.shadowBlur = size * (word.active ? 0.48 : 0.24); paint("fillText");
        }
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0;
      }
      paint("fillText");
    }
    ctx.restore();
  }
  if (layout.caret !== null) { ctx.fillStyle = "#fff"; ctx.fillRect(layout.caret.x, layout.caret.y, layout.caret.width, layout.caret.height); }
  ctx.restore();
}
