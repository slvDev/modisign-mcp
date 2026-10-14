// generated from the Modisign monorepo, do not edit
import { captionDisplayText, captionStyle, type CaptionLine, type CaptionPlacement, type CaptionStyle, type CaptionStyleId } from "./captions";
import { captionLayout, type CaptionRect } from "./caption-layout";

const FONT_VARIABLES = { sans: "--font-montserrat", serif: "--font-caption-serif", mono: "--font-caption-mono" };
function captionFontFamily(font: CaptionStyle["font"]) {
  const family = getComputedStyle(document.documentElement).getPropertyValue(FONT_VARIABLES[font]).trim();
  if (family === "") throw new Error("The caption display font is unavailable");
  return family;
}
export async function loadCaptionFonts(lines: CaptionLine[], styleId: CaptionStyleId) {
  const style = captionStyle(styleId);
  const text = lines.flatMap((line) => line.words.map(({ text }) => captionDisplayText(text, style.casing))).join(" ");
  const font = `${style.weight} 48px ${captionFontFamily(style.font)}`;
  await Promise.all((style.activeItalic ? [font, `italic ${font}`] : [font]).map((face) => document.fonts.load(face, text)));
}
function roundedBox(ctx: CanvasRenderingContext2D, rect: CaptionRect, padding: number, color: string, radius: number) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(rect.x - padding, rect.y - padding, rect.width + padding * 2, rect.height + padding * 2, radius); ctx.fill();
}
const captionLayers = new WeakMap<CanvasRenderingContext2D, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }>();
export function drawCaptions(ctx: CanvasRenderingContext2D, lines: CaptionLine[], styleId: CaptionStyleId, time: number, width: number, height: number, placement: CaptionPlacement) {
  const line = lines.find((line) => time >= line.start && time < line.end);
  if (line === undefined) return;
  let layer = captionLayers.get(ctx);
  if (layer === undefined) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Caption layer is unavailable");
    layer = { canvas, context }; captionLayers.set(ctx, layer);
  }
  if (layer.canvas.width !== width) layer.canvas.width = width;
  if (layer.canvas.height !== height) layer.canvas.height = height;
  layer.context.clearRect(0, 0, width, height);
  // Transparent glyph rasterization must match the monitor even on an opaque export canvas.
  drawCaptionLine(layer.context, line, styleId, time, width, height, placement);
  ctx.drawImage(layer.canvas, 0, 0);
}
function drawCaptionLine(ctx: CanvasRenderingContext2D, line: CaptionLine, styleId: CaptionStyleId, time: number, width: number, height: number, placement: CaptionPlacement) {
  const style = captionStyle(styleId);
  const family = captionFontFamily(style.font);
  const font = (size: number, italic: boolean) => `${italic ? "italic " : ""}${style.weight} ${size}px ${family}`;
  const measure = (text: string, size: number, italic: boolean) => { ctx.font = font(size, italic); return ctx.measureText(text).width; };
  ctx.save();
  const layout = captionLayout(line, styleId, time, width, height, placement, measure);
  const { size } = layout;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  if (style.background === "line") {
    const boxWidth = Math.max(...layout.rows.map((row) => { const first = layout.words[row[0]]; const last = layout.words[row[row.length - 1]]; return last.x + last.width - first.x; })) + size * 0.8;
    roundedBox(ctx, { x: (width - boxWidth) / 2, y: layout.anchor - layout.rows.length * layout.lineHeight / 2, width: boxWidth, height: layout.rows.length * layout.lineHeight }, 0, "rgba(0,0,0,0.8)", size * 0.22);
  }
  if (layout.highlight !== null) roundedBox(ctx, layout.highlight, size * 0.18, "#FFD60A", size * 0.2);
  for (const word of layout.words) {
    if (word.text === "") continue;
    ctx.save();
    // Typewriter's left edge stays fixed as characters arrive.
    const textWidth = style.reveal === "characters" ? measure(word.text, size, false) : word.width;
    ctx.translate(word.x + textWidth / 2, word.y + size / 2); ctx.scale(word.scale, word.scale);
    ctx.font = font(size, word.italic);
    if (style.shadow !== null) { ctx.shadowColor = style.shadow.color; ctx.shadowBlur = size * style.shadow.blur; ctx.shadowOffsetY = size * style.shadow.offset; }
    if (style.stroke !== null) { ctx.lineWidth = size * style.stroke.width; ctx.strokeStyle = style.stroke.color; ctx.strokeText(word.text, 0, 0); }
    if (style.fill !== null || word.active) {
      ctx.fillStyle = word.active ? style.activeFill : style.fill!;
      if (style.gradient) {
        const gradient = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        gradient.addColorStop(0, "#ffae43"); gradient.addColorStop(1, "#ff4da6"); ctx.fillStyle = gradient;
      }
      if (style.glow) {
        for (const [color, offset] of [["#00e5ff", -0.08], ["#f43bda", 0.08]] as const) {
          ctx.shadowColor = color; ctx.shadowOffsetX = size * offset; ctx.shadowBlur = size * (word.active ? 0.48 : 0.24); ctx.fillText(word.text, 0, 0);
        }
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0;
      }
      ctx.fillText(word.text, 0, 0);
    }
    ctx.restore();
  }
  if (layout.caret !== null) { ctx.fillStyle = "#fff"; ctx.fillRect(layout.caret.x, layout.caret.y, layout.caret.width, layout.caret.height); }
  ctx.restore();
}
