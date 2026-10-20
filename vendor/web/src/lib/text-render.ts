// generated from the Modisign monorepo, do not edit
import { fontString, loadFaces, transparentLayer } from "./caption-render";
import type { CaptionFace } from "./caption-layout";
import { textLayout } from "./text-layout";
import { TIMELINE_BOUNDARY_TOLERANCE, type TimelineText } from "./video-timeline";

// Every face the titles draw with the paragraphs it must cover.
export function loadTextFonts(texts: TimelineText[]) {
  const faces = new Map<string, { face: CaptionFace; text: string }>();
  for (const { font, weight, italic, paragraphs } of texts) {
    const face = { font, weight, italic };
    const key = fontString(face, 48);
    const entry = faces.get(key);
    const text = `${paragraphs.join(" ")} `;
    faces.set(key, { face, text: entry === undefined ? text : entry.text + text });
  }
  return loadFaces([...faces.values()]);
}

// One deterministic canvas drawing for the monitor and the export; fonts must be loaded first.
export function drawTexts(ctx: CanvasRenderingContext2D, texts: TimelineText[], time: number, width: number, height: number) {
  const active = texts.filter((title) => time >= title.start && time < title.end - TIMELINE_BOUNDARY_TOLERANCE);
  if (active.length === 0) return;
  const { canvas, context } = transparentLayer(ctx, width, height);
  for (const title of active) {
    const face = { font: title.font, weight: title.weight, italic: title.italic };
    const layout = textLayout(title, width, height, (text, size, measured) => { context.font = fontString(measured, size); return context.measureText(text).width; });
    context.save();
    context.font = fontString(face, layout.size);
    context.textAlign = "center"; context.textBaseline = "middle"; context.lineJoin = "round";
    if (title.backing) {
      context.fillStyle = "rgba(0,0,0,0.6)";
      context.beginPath(); context.roundRect(layout.box.x, layout.box.y, layout.box.width, layout.box.height, layout.size * 0.3); context.fill();
    } else {
      context.shadowColor = "rgba(0,0,0,0.55)"; context.shadowBlur = layout.size * 0.12; context.shadowOffsetY = layout.size * 0.04;
    }
    context.fillStyle = title.fill;
    for (const row of layout.rows) context.fillText(row.text, row.x, row.y);
    context.restore();
  }
  ctx.drawImage(canvas, 0, 0);
}
