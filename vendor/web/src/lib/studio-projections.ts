// generated from the Modisign monorepo, do not edit
import { ASPECTS } from "@/lib/aspects";
import { previewHref } from "@/lib/hrefs";
import { configOptions } from "@/lib/template-config";
import { transparentOverlay } from "@/lib/own-video";
import { clipStarts, timelineDuration, studioSize, type VideoPreviewTimeline } from "@/lib/video-timeline";
import { captionLines, timelineWords } from "@/lib/captions";
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

export function studioTimeline(state: Pick<StudioState, "media" | "clips" | "overlays" | "aspect" | "transcripts" | "captions">): VideoPreviewTimeline {
  return { clips: state.clips.map((clip) => {
    if (clip.mediaId === null) throw new Error("Relink every missing clip before rendering");
    const media = mediaById(state.media, clip.mediaId);
    return media.kind === "photo" ? { ...media.source, kind: "photo", duration: clip.outPoint - clip.inPoint, sourceStart: clip.sourceStart, punchIns: clip.punchIns, settings: clip.settings, transition: clip.transition }
      : { ...media.source, transition: clip.transition, inPoint: clip.inPoint, outPoint: clip.outPoint, punchIns: clip.punchIns, settings: clip.settings };
  }),
    ...studioSize(state.aspect), frameRate: 30,
    captions: state.captions === null ? undefined : { ...state.captions, lines: captionLines(timelineWords(state.clips, state.transcripts), state.captions.style) },
    overlays: state.overlays.map(({ id, family, config, start }) => ({
      id,
      src: previewHref(family.id, transparentOverlay(configOptions(family, family.looks, { ...config, aspect: state.aspect }))),
      ...ASPECTS[state.aspect], duration: config.duration, startsAt: start,
    })) };
}
export function overlayLanes(overlays: StudioOverlay[]) {
  const lanes: StudioOverlay[][] = [];
  for (const overlay of overlays) {
    let index = 0;
    for (const [laneIndex, lane] of lanes.entries()) {
      if (lane.some((item) => item.start < overlay.start + overlay.config.duration && overlay.start < item.start + item.config.duration)) index = laneIndex + 1;
    }
    if (index === lanes.length) lanes.push([]);
    lanes[index].push(overlay);
  }
  return lanes;
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
  return targets;
}
