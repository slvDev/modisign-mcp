// generated from the Modisign monorepo, do not edit
import type { Aspect } from "@/lib/aspects";
import type { CaptionMeasure } from "@/lib/caption-layout";
import { revealIsOpen, revealProgress, revealWindow } from "@/lib/title-reveal";
import { layerPose, mapPoint, type MotionMatrix } from "@/lib/studio-motion";
import { textLayout, type TextRect } from "@/lib/text-layout";
import { TIMELINE_BOUNDARY_TOLERANCE, studioSize, type TimelineOverlay, type TimelineText } from "@/lib/video-timeline";

export const SAMPLE_RATE = 30;
// The two export raster sizes (1080p and 720p long sides); a plan is certified against both.
export const RASTER_LONG_SIDES = [1920, 1280] as const;
// Raster rounding and the downscaled composite can touch one pixel beyond the measured ink.
const ROUNDING_PIXELS = 2;

// A rectangle in fractions of the output.
export type Obstacle = { owner: string; x0: number; y0: number; x1: number; y1: number };
export type ObstacleField = ReadonlyMap<number, readonly Obstacle[]>;
// The ink of one captured overlay frame in fractions of its own composition, or null when it is fully transparent.
export type Ink = { x0: number; y0: number; x1: number; y1: number };
export type OverlayDescriptor = Pick<TimelineOverlay, "src" | "width" | "height" | "duration" | "startsAt" | "motion"> & { id: string };
export type TitleDescriptor = { id: string; title: TimelineText };

export const rasterSizes = (aspect: Aspect) => RASTER_LONG_SIDES.map((side) => studioSize(aspect, side));
// Every 30 fps output sample a line shown in [start, end) can meet, plus one either side for the preview's in-between times.
export function sampleRange(start: number, end: number) {
  const first = Math.floor(start * SAMPLE_RATE + 1e-6);
  const last = Math.ceil(end * SAMPLE_RATE - 1e-6);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
export const sampleTime = (sample: number) => sample / SAMPLE_RATE;

const unionOf = (owner: string, rects: Omit<Obstacle, "owner">[]): Obstacle => ({
  owner, x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)), x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)),
});
function boundsOf(points: { x: number; y: number }[], width: number, height: number): Omit<Obstacle, "owner"> {
  const pad = ROUNDING_PIXELS;
  return { x0: (Math.min(...points.map((p) => p.x)) - pad) / width, y0: (Math.min(...points.map((p) => p.y)) - pad) / height, x1: (Math.max(...points.map((p) => p.x)) + pad) / width, y1: (Math.max(...points.map((p) => p.y)) + pad) / height };
}
const cornersOf = (rect: TextRect) => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
const through = (points: { x: number; y: number }[], matrix: MotionMatrix | null) => matrix === null ? points : points.map((point) => mapPoint(matrix, point));

// Where the alpha channel of a captured frame has any ink, as fractions of the frame.
export function inkFromPixels(data: ArrayLike<number>, width: number, height: number): Ink | null {
  const rowHas = (y: number) => { for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 0) return true; return false; };
  let top = 0;
  while (top < height && !rowHas(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (!rowHas(bottom)) bottom--;
  const columnHas = (x: number) => { for (let y = top; y <= bottom; y++) if (data[(y * width + x) * 4 + 3] > 0) return true; return false; };
  let left = 0;
  while (!columnHas(left)) left++;
  let right = width - 1;
  while (!columnHas(right)) right--;
  return { x0: left / width, y0: top / height, x1: (right + 1) / width, y1: (bottom + 1) / height };
}

// The overlay's ink exactly where the export draws it: width-scaled, vertically centred, through its motion at `local`; null when it draws nothing.
export function overlayObstacle(overlay: OverlayDescriptor, ink: Ink, local: number, aspect: Aspect): Obstacle | null {
  const rects: Omit<Obstacle, "owner">[] = [];
  for (const { width, height } of rasterSizes(aspect)) {
    const pose = layerPose(overlay.motion, local, { width, height }, { x: width / 2, y: height / 2 });
    if (pose.opacity === 0) return null;
    const placedHeight = overlay.height * width / overlay.width;
    const top = (height - placedHeight) / 2;
    const corners = cornersOf({ x: ink.x0 * width, y: top + ink.y0 * placedHeight, width: (ink.x1 - ink.x0) * width, height: (ink.y1 - ink.y0) * placedHeight });
    rects.push(boundsOf(through(corners, pose.matrix), width, height));
  }
  return unionOf(`overlay:${overlay.id}`, rects);
}

// A title's reserved box at output time `time`: its padded box through its motion, narrowed by a running reveal; a title behind people reserves the whole box.
export function titleObstacle({ id, title }: TitleDescriptor, time: number, aspect: Aspect, measure: CaptionMeasure): Obstacle | null {
  if (!(time >= title.start && time < title.end - TIMELINE_BOUNDARY_TOLERANCE)) return null;
  const local = time - title.start + (title.animationOffset === undefined ? 0 : title.animationOffset);
  const rects: Omit<Obstacle, "owner">[] = [];
  for (const { width, height } of rasterSizes(aspect)) {
    const layout = textLayout(title, width, height, measure);
    const pad = title.backing ? 0 : layout.size * 0.2;
    const padded: TextRect = { x: layout.box.x - pad, y: layout.box.y - pad, width: layout.box.width + pad * 2, height: layout.box.height + pad * 2 };
    let shown: TextRect | null = padded;
    if (title.reveal !== undefined && title.occlusion === undefined) {
      const progress = revealProgress(title.reveal, local);
      const aperture = revealWindow(title.reveal, layout.box, progress);
      if (aperture === null) return null;
      if (!revealIsOpen(title.reveal, progress)) {
        const x0 = Math.max(padded.x, aperture.x), y0 = Math.max(padded.y, aperture.y);
        const x1 = Math.min(padded.x + padded.width, aperture.x + aperture.width), y1 = Math.min(padded.y + padded.height, aperture.y + aperture.height);
        shown = x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
      }
    }
    if (shown === null) return null;
    const pose = layerPose(title.motion, local, { width, height }, { x: layout.box.x + layout.box.width / 2, y: layout.box.y + layout.box.height / 2 });
    if (pose.opacity === 0) return null;
    rects.push(boundsOf(through(cornersOf(shown), pose.matrix), width, height));
  }
  return unionOf(`title:${id}`, rects);
}

const ENTRY_BYTES = 96;
// Compact per-frame ink only, by overlay identity (its preview URL carries the whole configuration and aspect, plus its duration) and local time; the oldest overlay is dropped first.
export type InkCache = { get: (identity: string, local: number) => Ink | null | undefined; set: (identity: string, local: number, ink: Ink | null) => void; readonly bytes: number };
export function createInkCache(maxBytes = 4 * 1024 * 1024): InkCache {
  const byOverlay = new Map<string, Map<string, Ink | null>>();
  let entries = 0;
  const key = (local: number) => local.toFixed(6);
  return {
    get(identity, local) {
      const frames = byOverlay.get(identity);
      if (frames === undefined) return undefined;
      byOverlay.delete(identity); byOverlay.set(identity, frames);
      return frames.get(key(local));
    },
    set(identity, local, ink) {
      let frames = byOverlay.get(identity);
      if (frames === undefined) { frames = new Map(); byOverlay.set(identity, frames); }
      if (!frames.has(key(local))) entries++;
      frames.set(key(local), ink);
      while (entries * ENTRY_BYTES > maxBytes && byOverlay.size > 1) {
        const [oldest, dropped] = byOverlay.entries().next().value as [string, Map<string, Ink | null>];
        byOverlay.delete(oldest); entries -= dropped.size;
      }
    },
    get bytes() { return entries * ENTRY_BYTES; },
  };
}
export const inkIdentity = (overlay: OverlayDescriptor) => `${overlay.src}|${overlay.duration}`;

// Every obstacle at each requested output sample. `inkAt` captures one frame of an overlay at local seconds (the only expensive step; cached frames are never captured again); `onStep` reports progress after each sample.
export async function obstacleField(input: {
  samples: readonly number[]; overlays: readonly OverlayDescriptor[]; titles: readonly TitleDescriptor[]; aspect: Aspect; measure: CaptionMeasure;
  inkAt: (overlay: OverlayDescriptor, local: number) => Promise<Ink | null>; cache: InkCache; signal: AbortSignal; onStep: (done: number, total: number) => void;
}): Promise<ObstacleField> {
  const { samples, overlays, titles, aspect, measure, inkAt, cache, signal, onStep } = input;
  const field = new Map<number, Obstacle[]>();
  samples.forEach((sample) => field.set(sample, []));
  let done = 0;
  for (const sample of samples) {
    signal.throwIfAborted();
    const time = sampleTime(sample);
    const here = field.get(sample)!;
    for (const title of titles) {
      const obstacle = titleObstacle(title, time, aspect, measure);
      if (obstacle !== null) here.push(obstacle);
    }
    for (const overlay of overlays) {
      if (time < overlay.startsAt || time >= overlay.startsAt + overlay.duration - TIMELINE_BOUNDARY_TOLERANCE) continue;
      const local = time - overlay.startsAt;
      const identity = inkIdentity(overlay);
      let ink = cache.get(identity, local);
      if (ink === undefined) { ink = await inkAt(overlay, local); cache.set(identity, local, ink); }
      signal.throwIfAborted();
      const obstacle = ink === null ? null : overlayObstacle(overlay, ink, local, aspect);
      if (obstacle !== null) here.push(obstacle);
    }
    onStep(++done, samples.length);
  }
  return field;
}
