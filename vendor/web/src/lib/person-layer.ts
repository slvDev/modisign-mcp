// generated from the Modisign monorepo, do not edit
import { clipPunchInTiming, drawClipForeground, placeRect, type Size } from "@/lib/clip-settings";
import { PERSON_MASK_SIZE } from "@/lib/person-manifest";
import type { PersonMasks, PersonParams, PersonPicture } from "@/lib/person-masks";
import { drawLayer, mapPoint, type MotionMatrix } from "@/lib/studio-motion";
import { drawOwnedTexts, titleActive } from "@/lib/text-render";
import { clipDuration, clipInPoint, type TimelineClip, type TimelineText } from "@/lib/video-timeline";

export const personTitlesOf = (texts: TimelineText[] | undefined) => texts === undefined ? [] : texts.filter((title) => title.occlusion !== undefined);

// An active person title whose owner picture had no prepared alpha.
export type MissingPerson = { owner: number; picture: PersonPicture };

// The titles of `people` (from `personTitlesOf`) that the owner footage item draws at this output time, in title order.
export function activePersonTitles(people: TimelineText[], owner: number, time: number) {
  return people.filter((title) => title.occlusion !== undefined && title.occlusion.owner === owner && titleActive(title, time));
}

// How far ahead of the playing Program the pictures of a person title must already have alphas (O5: pause before an unprepared boundary rather than infer or show it bare).
export const PERSON_LOOKAHEAD = 0.25;

// What the boundary check reads of a video slot's source: its packet-derived picture table and shared origin.
export type PersonSourceTable = { origin: number; videoOrigin: number; pictureAt(timestamp: number): { start: number; end: number } };

// The owner pictures a playing Program is about to show (the current one, the next one and the one `PERSON_LOOKAHEAD` ahead) that an active or imminent person title has no prepared alpha for. Pure lookups, constant work per owner; empty means playback may go on.
export function personBoundary(people: TimelineText[], masks: PersonMasks, visible: { index: number; time: number }[], clips: TimelineClip[], time: number, sourceOf: (index: number) => PersonSourceTable | null) {
  const missing: MissingPerson[] = [];
  for (const item of visible) {
    const clip = clips[item.index];
    if (clip.kind === "photo") continue;
    const titles = people.filter((title) => title.occlusion !== undefined && title.occlusion.owner === item.index && title.start < time + PERSON_LOOKAHEAD && title.end > time);
    const source = titles.length === 0 ? null : sourceOf(item.index);
    if (source === null) continue;
    const first = source.origin + clipInPoint(clip) + item.time;
    const end = source.origin + clipInPoint(clip) + clipDuration(clip);
    const current = source.pictureAt(Math.max(first, source.videoOrigin));
    const starts = new Set([current.start, source.pictureAt(Math.min(current.end, end - 1e-3)).start, source.pictureAt(Math.min(first + PERSON_LOOKAHEAD, end - 1e-3)).start]);
    for (const start of starts) {
      for (const title of titles) {
        if (!titleActive(title, time + Math.max(0, start - first))) continue;
        if (!masks.ready({ file: clip.file, time: start }) && !missing.some((entry) => entry.owner === item.index && entry.picture.time === start)) missing.push({ owner: item.index, picture: { file: clip.file, time: start } });
      }
    }
  }
  return missing;
}

export function personParams(title: TimelineText): PersonParams {
  if (title.occlusion === undefined) throw new Error("A person title needs its occlusion");
  const { threshold, feather, smoothing } = title.occlusion;
  return { threshold, feather, smoothing };
}

// Draws the 256x256 alpha through the owner's own foreground frame: the grid is the whole oriented source picture before crop, then Fill pan/zoom, punch-in, photo slow zoom or the contained Fit picture, clipped to the Place box. Never the Fit backdrop.
export function drawPersonMask(context: CanvasRenderingContext2D, mask: CanvasImageSource, clip: TimelineClip, output: Size, clipTime: number) {
  const grid = PERSON_MASK_SIZE;
  drawClipForeground(context, clip, output, clip.settings,
    (rect, source) => context.drawImage(mask, source.x * grid / clip.width, source.y * grid / clip.height, source.width * grid / clip.width, source.height * grid / clip.height, rect.x, rect.y, rect.width, rect.height),
    clip, clip.kind === "photo" ? { time: clipTime, duration: clipDuration(clip) } : undefined, clipPunchInTiming(clip, clipTime));
}

// The owner's Place box after the owner's outer motion: the only area a person title may show in.
export function personRegion(clip: TimelineClip, output: Size, matrix: MotionMatrix | null) {
  const box = placeRect(clip.place, output);
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  return matrix === null ? corners : corners.map((corner) => mapPoint(matrix, corner));
}

function surface(doc: Document) {
  const canvas = doc.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D is unavailable");
  return { canvas, context };
}

export type PersonGroup = {
  // The owner's footage with its outer motion and its people titles, fully transparent where nothing was drawn; the caller composites it once with the owner's total opacity.
  group: HTMLCanvasElement;
  // Titles that could not be drawn because the picture was unknown or its alpha not prepared; they are never drawn as plain text.
  omitted: TimelineText[];
};

export type PersonOwner = { index: number; clip: TimelineClip; clipTime: number; matrix: MotionMatrix | null; footage: CanvasImageSource; picture: PersonPicture | null };

export interface PersonLayer {
  // Sizes the scratch surfaces like the footage layers: `raster` pixels for `output` units (a display-sized Program raster is smaller than the output).
  resize(raster: Size, output: Size): void;
  // `footage` is the owner's finished layer in the same raster, `matrix` its outer motion, `clipTime` its clip-local time; `time` is the output time.
  compose(owner: PersonOwner, titles: TimelineText[], time: number, masks: PersonMasks): PersonGroup;
  dispose(): void;
}

// Scratch surfaces for owner groups, allocated once per renderer.
export function createPersonLayer(doc: Document = document): PersonLayer {
  const group = surface(doc);
  const title = surface(doc);
  const mask = surface(doc);
  mask.canvas.width = PERSON_MASK_SIZE; mask.canvas.height = PERSON_MASK_SIZE;
  const pixels = new ImageData(PERSON_MASK_SIZE, PERSON_MASK_SIZE);
  let output: Size | null = null;

  function resize(raster: Size, size: Size) {
    for (const { canvas, context } of [group, title]) {
      if (canvas.width !== raster.width || canvas.height !== raster.height) { canvas.width = raster.width; canvas.height = raster.height; }
      context.setTransform(raster.width / size.width, 0, 0, raster.height / size.height, 0, 0);
    }
    output = size;
  }

  function compose(owner: PersonOwner, titles: TimelineText[], time: number, masks: PersonMasks): PersonGroup {
    if (output === null) throw new Error("The person layer has no size");
    const { width, height } = output;
    const { clip, matrix } = owner;
    group.context.clearRect(0, 0, width, height);
    drawLayer(group.context, owner.footage, { matrix, opacity: 1 }, 1, "source-over", output);
    const region = personRegion(clip, output, matrix);
    const omitted: TimelineText[] = [];
    for (const person of titles) {
      const alpha = owner.picture === null ? null : masks.alpha(owner.picture, personParams(person));
      if (alpha === null) { omitted.push(person); continue; }
      if (alpha.length !== PERSON_MASK_SIZE * PERSON_MASK_SIZE) throw new Error(`A person alpha has ${alpha.length} values, expected ${PERSON_MASK_SIZE * PERSON_MASK_SIZE}`);
      for (let index = 0; index < alpha.length; index++) pixels.data[index * 4 + 3] = alpha[index];
      mask.context.putImageData(pixels, 0, 0);
      title.context.clearRect(0, 0, width, height);
      drawOwnedTexts(title.context, [person], owner.index, time, width, height);
      title.context.save();
      if (matrix !== null) title.context.transform(...matrix);
      title.context.globalCompositeOperation = "destination-out";
      drawPersonMask(title.context, mask.canvas, clip, output, owner.clipTime);
      title.context.restore();
      group.context.save();
      group.context.beginPath();
      region.forEach((corner, index) => { if (index === 0) group.context.moveTo(corner.x, corner.y); else group.context.lineTo(corner.x, corner.y); });
      group.context.closePath();
      group.context.clip();
      group.context.drawImage(title.canvas, 0, 0, width, height);
      group.context.restore();
    }
    return { group: group.canvas, omitted };
  }

  function dispose() {
    for (const { canvas } of [group, title, mask]) { canvas.width = 0; canvas.height = 0; }
    output = null;
  }

  return { resize, compose, dispose };
}
