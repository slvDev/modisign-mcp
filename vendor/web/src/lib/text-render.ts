// generated from the Modisign monorepo, do not edit
import { fontString, loadFaces, transparentLayer } from "./caption-render";
import type { CaptionFace } from "./caption-layout";
import { textLayout } from "./text-layout";
import { drawLayer, layerPose } from "./studio-motion";
import { revealIsOpen, revealProgress, revealWindow } from "./title-reveal";
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

// One deterministic canvas drawing for the monitor and the export; fonts must be loaded first. Titles with a person effect are not drawn here: their owner footage group draws them (`drawOwnedTexts`).
export function drawTexts(ctx: CanvasRenderingContext2D, texts: TimelineText[], time: number, width: number, height: number) {
  drawTitles(ctx, texts.filter((title) => title.occlusion === undefined), time, width, height);
}

// The person titles of one owner footage item, in title order, drawn like any title; the caller erases the people from the result.
export function drawOwnedTexts(ctx: CanvasRenderingContext2D, texts: TimelineText[], owner: number, time: number, width: number, height: number) {
  drawTitles(ctx, texts.filter((title) => title.occlusion !== undefined && title.occlusion.owner === owner), time, width, height);
}

export const titleActive = (title: TimelineText, time: number) => time >= title.start && time < title.end - TIMELINE_BOUNDARY_TOLERANCE;

// Still titles share one rasterization; a moving title is composited alone, once, in its own order.
function drawTitles(ctx: CanvasRenderingContext2D, texts: TimelineText[], time: number, width: number, height: number) {
  const active = texts.filter((title) => titleActive(title, time));
  if (active.length === 0) return;
  const { canvas, context } = transparentLayer(ctx, width, height);
  let stacked = false;
  for (const title of active) {
    const face = { font: title.font, weight: title.weight, italic: title.italic };
    const layout = textLayout(title, width, height, (text, size, measured) => { context.font = fontString(measured, size); return context.measureText(text).width; });
    const local = time - title.start + (title.animationOffset === undefined ? 0 : title.animationOffset);
    const progress = title.reveal === undefined ? 1 : revealProgress(title.reveal, local);
    const aperture = title.reveal === undefined ? null : revealWindow(title.reveal, layout.box, progress);
    if (title.reveal !== undefined && aperture === null) continue;
    const pose = layerPose(title.motion, local, { width, height }, { x: layout.box.x + layout.box.width / 2, y: layout.box.y + layout.box.height / 2 });
    const moving = pose.matrix !== null || pose.opacity !== 1;
    if (moving && stacked) { ctx.drawImage(canvas, 0, 0); context.clearRect(0, 0, width, height); stacked = false; }
    context.save();
    if (title.reveal !== undefined && aperture !== null && !revealIsOpen(title.reveal, progress)) { context.beginPath(); context.rect(aperture.x, aperture.y, aperture.width, aperture.height); context.clip(); }
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
    if (moving) { drawLayer(ctx, canvas, pose, 1); context.clearRect(0, 0, width, height); }
    else stacked = true;
  }
  if (stacked) ctx.drawImage(canvas, 0, 0);
}
