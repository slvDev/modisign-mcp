// generated from the Modisign monorepo, do not edit
import { type ClipSpatial, type Place, DEFAULT_CLIP_SETTINGS, STUDIO_TIME_TOLERANCE, type PunchIn, type ClipSettings } from "@/lib/studio-project";

type Size = { width: number; height: number };
export type ClipRect = { x: number; y: number; width: number; height: number };

export function photoSettingsAtTime(settings: ClipSettings = DEFAULT_CLIP_SETTINGS, time: number, duration: number): ClipSettings {
  const progress = Math.max(0, Math.min(1, time / duration));
  const zoom = settings.frameMode === "fit" ? 1 : settings.zoom;
  return { ...settings, zoom: zoom * (settings.slowZoom === true ? 1 + 0.08 * progress : 1) };
}

export type PunchInTiming = { punchIns?: PunchIn[]; inPoint: number; outPoint: number; sourceTime: number };
export function clampPunchInLength(start: number, length: number, nextStart?: number) {
  if (nextStart === undefined) return Math.min(length, 4);
  const gap = nextStart - start;
  const limit = Math.floor(gap * 10 + STUDIO_TIME_TOLERANCE) / 10;
  return Math.min(length, 4, limit, gap);
}
export function activePunchIns(punchIns: PunchIn[] | undefined, inPoint: number, outPoint: number) {
  return punchIns === undefined ? [] : punchIns.filter((item) => item.start >= inPoint && item.start < outPoint).sort((a, b) => a.start - b.start);
}
function punchInZoom(timing: PunchInTiming) {
  const active = activePunchIns(timing.punchIns, timing.inPoint, timing.outPoint)
    .find((item) => timing.sourceTime >= item.start && timing.sourceTime < item.start + item.length);
  return active === undefined ? 1 : active.zoom;
}
// Photos use a virtual source clock; extending the left edge can make it negative.
export function clipSourceStart(clip: { kind?: "photo" | "video"; inPoint?: number; sourceStart?: number }) {
  return clip.kind === "photo" ? clip.sourceStart === undefined ? 0 : clip.sourceStart : clip.inPoint === undefined ? 0 : clip.inPoint;
}

export function clipPunchInTiming(clip: { kind?: "photo" | "video"; inPoint?: number; outPoint?: number; sourceStart?: number; duration: number; punchIns?: PunchIn[] }, time: number): PunchInTiming {
  const inPoint = clipSourceStart(clip);
  const outPoint = clip.kind === "photo" ? inPoint + clip.duration : clip.outPoint === undefined ? clip.duration : clip.outPoint;
  return { punchIns: clip.punchIns, inPoint, outPoint, sourceTime: inPoint + time };
}

export function placeRect(place: Place, output: Size): ClipRect {
  let box: ClipRect;
  switch (place.mode) {
    case "custom": box = place; break;
    case "full": box = { x: 0, y: 0, width: 1, height: 1 }; break;
    case "top": box = { x: 0, y: 0, width: 1, height: 0.5 }; break;
    case "bottom": box = { x: 0, y: 0.5, width: 1, height: 0.5 }; break;
    case "left": box = { x: 0, y: 0, width: 0.5, height: 1 }; break;
    case "right": box = { x: 0.5, y: 0, width: 0.5, height: 1 }; break;
    default: box = { x: place.mode.endsWith("left") ? 0.03 : 0.67, y: place.mode.startsWith("pip-top") ? 0.03 : 0.67, width: 0.3, height: 0.3 };
  }
  return { x: box.x * output.width, y: box.y * output.height, width: box.width * output.width, height: box.height * output.height };
}
export function clipGeometry(source: Size, output: Size, settings: ClipSettings | undefined, zoomFit: boolean, punchIn: PunchInTiming | undefined, spatial: ClipSpatial) {
  if (settings === undefined) settings = DEFAULT_CLIP_SETTINGS;
  const box = placeRect(spatial.place, output);
  const { crop } = spatial;
  const retained = { x: source.width * crop.left / 100, y: source.height * crop.top / 100,
    width: source.width * (100 - crop.left - crop.right) / 100, height: source.height * (100 - crop.top - crop.bottom) / 100 };
  const cover = Math.max(box.width / retained.width, box.height / retained.height);
  const factor = settings.frameMode === "fill" && punchIn !== undefined ? punchInZoom(punchIn) : 1;
  const scale = cover * settings.zoom * factor;
  const width = retained.width * scale;
  const height = retained.height * scale;
  const centerX = Math.max(box.width / (2 * width), Math.min(settings.centerX, 1 - box.width / (2 * width)));
  const centerY = Math.max(box.height / (2 * height), Math.min(settings.centerY, 1 - box.height / (2 * height)));
  if (settings.frameMode === "fill") return {
    centerX, centerY, scale, box, source: retained,
    picture: { x: box.x + box.width / 2 - centerX * width, y: box.y + box.height / 2 - centerY * height, width, height },
    backdrop: null,
  };
  const contain = Math.min(box.width / retained.width, box.height / retained.height) * (zoomFit ? settings.zoom : 1);
  return {
    centerX, centerY, scale, box, source: retained,
    picture: { x: box.x + (box.width - retained.width * contain) / 2, y: box.y + (box.height - retained.height * contain) / 2,
      width: retained.width * contain, height: retained.height * contain },
    backdrop: { x: box.x + (box.width - retained.width * cover) / 2, y: box.y + (box.height - retained.height * cover) / 2,
      width: retained.width * cover, height: retained.height * cover },
  };
}

export function drawClip(context: CanvasRenderingContext2D, source: Size, output: Size,
  settings: ClipSettings | undefined, draw: (rect: ClipRect, source: ClipRect) => void, spatial: ClipSpatial, photo?: { time: number; duration: number }, punchIn?: PunchInTiming) {
  const geometry = photo === undefined ? clipGeometry(source, output, settings, false, punchIn, spatial)
    : clipGeometry(source, output, photoSettingsAtTime(settings, photo.time, photo.duration), true, punchIn, spatial);
  context.save();
  context.beginPath();
  context.rect(geometry.box.x, geometry.box.y, geometry.box.width, geometry.box.height);
  context.clip();
  if (geometry.backdrop !== null) {
    context.filter = `blur(${Math.max(geometry.box.width, geometry.box.height) * 0.015}px) brightness(60%)`;
    draw(geometry.backdrop, geometry.source);
    context.filter = "none";
  }
  draw(geometry.picture, geometry.source);
  context.restore();
}

export function clipGain(settings: ClipSettings = DEFAULT_CLIP_SETTINGS, time: number, duration: number) {
  if (settings.muted) return 0;
  const fadeIn = settings.fadeIn === 0 ? 1 : Math.max(0, Math.min(1, time / settings.fadeIn));
  const fadeOut = settings.fadeOut === 0 ? 1 : Math.max(0, Math.min(1, (duration - time) / settings.fadeOut));
  return settings.volume * fadeIn * fadeOut;
}
