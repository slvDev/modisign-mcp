// generated from the Modisign monorepo, do not edit
import { DEFAULT_CLIP_SETTINGS, STUDIO_TIME_TOLERANCE, type PunchIn, type ClipSettings } from "@/lib/studio-project";

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

export function clipGeometry(source: Size, output: Size, settings: ClipSettings = DEFAULT_CLIP_SETTINGS, zoomFit = false, punchIn?: PunchInTiming) {
  const cover = Math.max(output.width / source.width, output.height / source.height);
  const factor = settings.frameMode === "fill" && punchIn !== undefined ? punchInZoom(punchIn) : 1;
  const scale = cover * settings.zoom * factor;
  const width = source.width * scale;
  const height = source.height * scale;
  const centerX = Math.max(output.width / (2 * width), Math.min(settings.centerX, 1 - output.width / (2 * width)));
  const centerY = Math.max(output.height / (2 * height), Math.min(settings.centerY, 1 - output.height / (2 * height)));
  if (settings.frameMode === "fill") return {
    centerX, centerY, scale,
    picture: { x: output.width / 2 - centerX * width, y: output.height / 2 - centerY * height, width, height },
    backdrop: null,
  };
  const contain = Math.min(output.width / source.width, output.height / source.height) * (zoomFit ? settings.zoom : 1);
  return {
    centerX, centerY, scale,
    picture: { x: (output.width - source.width * contain) / 2, y: (output.height - source.height * contain) / 2,
      width: source.width * contain, height: source.height * contain },
    backdrop: { x: (output.width - source.width * cover) / 2, y: (output.height - source.height * cover) / 2,
      width: source.width * cover, height: source.height * cover },
  };
}

export function drawClip(context: CanvasRenderingContext2D, source: Size, output: Size,
  settings: ClipSettings | undefined, draw: (rect: ClipRect) => void, photo?: { time: number; duration: number }, punchIn?: PunchInTiming) {
  const geometry = photo === undefined ? clipGeometry(source, output, settings, false, punchIn)
    : clipGeometry(source, output, photoSettingsAtTime(settings, photo.time, photo.duration), true, punchIn);
  context.save();
  context.beginPath();
  context.rect(0, 0, output.width, output.height);
  context.clip();
  if (geometry.backdrop !== null) {
    context.filter = `blur(${Math.max(output.width, output.height) * 0.015}px) brightness(60%)`;
    draw(geometry.backdrop);
    context.filter = "none";
  }
  draw(geometry.picture);
  context.restore();
}

export function clipGain(settings: ClipSettings = DEFAULT_CLIP_SETTINGS, time: number, duration: number) {
  if (settings.muted) return 0;
  const fadeIn = settings.fadeIn === 0 ? 1 : Math.max(0, Math.min(1, time / settings.fadeIn));
  const fadeOut = settings.fadeOut === 0 ? 1 : Math.max(0, Math.min(1, (duration - time) / settings.fadeOut));
  return settings.volume * fadeIn * fadeOut;
}
