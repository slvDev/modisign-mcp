// generated from the Modisign monorepo, do not edit
import { ASPECTS } from "@/lib/aspects";
import { previewHref } from "@/lib/hrefs";
import { configOptions } from "@/lib/template-config";
import { transparentOverlay } from "@/lib/own-video";
import { clipStarts, timelineDuration, studioSize, type VideoPreviewTimeline } from "@/lib/video-timeline";
import { captionLines, styledWords, timelineWords } from "@/lib/captions";
import { timelineTexts, textSpan, type StudioText } from "@/lib/studio-text";
import type { StudioClip, StudioMedia, StudioOverlay, StudioState } from "@/lib/studio-state";

export function studioDuration(clips: StudioClip[]) {
  return timelineDuration(clips);
}
export function mediaById(media: StudioMedia[], id: string | null) {
  const item = media.find((item) => item.id === id);
  if (item === undefined) throw new Error("Timeline media is missing");
  return item;
}

export function clipTime(time: number) {
  const sign = time < 0 ? "−" : "";
  const tenths = Math.round(Math.abs(time) * 10);
  return `${sign}${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

export function studioTimeline(state: Pick<StudioState, "media" | "clips" | "overlays" | "texts" | "aspect" | "transcripts" | "wordStyles" | "captions">): VideoPreviewTimeline {
  const starts = clipStarts(state.clips);
  return { clips: state.clips.map((clip, index) => {
    if (clip.mediaId === null) throw new Error("Relink every missing clip before rendering");
    const media = mediaById(state.media, clip.mediaId);
    const schedule = { id: clip.id, track: clip.track, startsAt: starts[index], crop: clip.crop, place: clip.place };
    return media.kind === "photo" ? { ...media.source, ...schedule, kind: "photo", duration: clip.outPoint - clip.inPoint, sourceStart: clip.sourceStart, punchIns: clip.punchIns, settings: clip.settings, transition: clip.transition }
      : { ...media.source, ...schedule, kind: "video", transition: clip.transition, inPoint: clip.inPoint, outPoint: clip.outPoint, punchIns: clip.punchIns, settings: clip.settings };
  }),
    ...studioSize(state.aspect), frameRate: 30,
    texts: timelineTexts(state.texts, state.clips),
    captions: state.captions === null ? undefined : { ...state.captions, lines: captionLines(styledWords(timelineWords(state.clips, state.transcripts), state.captions, state.wordStyles), state.captions.style) },
    overlays: state.overlays.map(({ id, family, config, start }) => ({
      id,
      src: previewHref(family.id, transparentOverlay(configOptions(family, family.looks, { ...config, aspect: state.aspect }))),
      ...ASPECTS[state.aspect], duration: config.duration, startsAt: start,
    })) };
}
// Where a seek lands: inside the sequence.
export const clampSeek = (clips: StudioClip[], time: number) => Math.max(0, Math.min(time, studioDuration(clips)));
// A moment when the overlay is on screen (its animation is still entering or leaving at the edges), or null when the playhead is already on one.
export function overlayPose(overlay: StudioOverlay, playhead: number) {
  const { start, config: { duration } } = overlay;
  return playhead >= start + 0.3 * duration && playhead <= start + 0.8 * duration ? null : start + 0.6 * duration;
}
// The part of an overlay that lies on the timeline (its block width), shown in tenths, and whether the timeline's end cuts it short.
export function overlayVisibility(overlay: StudioOverlay, total: number) {
  const visible = Math.min(overlay.config.duration, Math.max(0, total - overlay.start));
  return { visible, seconds: Math.round(visible * 10) / 10, trimmed: overlay.clamped || overlay.config.duration > total };
}
// Rows of time blocks: a block joins the row after the last row it overlaps.
function laneRows<T>(items: T[], span: (item: T) => { start: number; end: number }) {
  const lanes: T[][] = [];
  for (const item of items) {
    const { start, end } = span(item);
    let index = 0;
    for (const [laneIndex, lane] of lanes.entries()) {
      if (lane.some((other) => { const taken = span(other); return taken.start < end && start < taken.end; })) index = laneIndex + 1;
    }
    if (index === lanes.length) lanes.push([]);
    lanes[index].push(item);
  }
  return lanes;
}
export const overlayLanes = (overlays: StudioOverlay[]) => laneRows(overlays, (overlay) => ({ start: overlay.start, end: overlay.start + overlay.config.duration }));
// The T lane: titles on their clip span or explicit interval, overlapping ones on separate rows.
export function textLanes(texts: StudioText[], clips: StudioClip[]) {
  const starts = clipStarts(clips);
  return laneRows(texts, (title) => textSpan(title, clips, starts));
}
export function studioTime(time: number) {
  const frames = Math.max(0, Math.round(time * 30));
  return [Math.floor(frames / 1800), Math.floor(frames / 30) % 60, frames % 30]
    .map((value) => value.toString().padStart(2, "0")).join(":");
}

export function snapTime(time: number, targets: number[], pixelsPerSecond: number, enabled: boolean) {
  const frame = Math.round(time * 30) / 30;
  if (!enabled) return frame;
  const near = targets.filter((target) => Math.abs(target - time) * pixelsPerSecond <= 8);
  return near.length === 0 ? frame : near.reduce((best, target) => Math.abs(target - time) < Math.abs(best - time) ? target : best, near[0]);
}
export function snapTargets(state: StudioState, excludeId?: string) {
  const targets = [0, studioDuration(state.clips), state.playhead];
  const starts = clipStarts(state.clips);
  for (const [index, clip] of state.clips.entries()) {
    if (clip.id !== excludeId) targets.push(starts[index], starts[index] + clip.outPoint - clip.inPoint);
  }
  for (const overlay of state.overlays) if (overlay.id !== excludeId) targets.push(overlay.start, overlay.start + overlay.config.duration);
  for (const title of state.texts) if (title.id !== excludeId) { const { start, end } = textSpan(title, state.clips, starts); targets.push(start, end); }
  return targets;
}
