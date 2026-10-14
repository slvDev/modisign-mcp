// generated from the Modisign monorepo, do not edit
import { ASPECTS, type Aspect } from "@/lib/aspects";
import { clampTransition, type ClipTransition, type ClipSettings, type PunchIn } from "@/lib/studio-project";
import { clipGain } from "@/lib/clip-settings";
import type { OwnPhoto } from "@/lib/studio-photo";
import type { OwnVideo } from "@/lib/own-video";

import type { Values } from "./values";
import type { CaptionLine, CaptionSettings } from "./captions";

// One millionth of a Studio frame, shared by visibility and decoded-frame scheduling.
export const TIMELINE_BOUNDARY_TOLERANCE = 1e-6 / 30;

export type TimelineOverlay = {
  src: string;
  width: number;
  height: number;
  duration: number;
  startsAt: number;
};

export type PreviewOverlay = TimelineOverlay & { id: string; liveValues?: Values };
export type VideoPreviewTimeline = Omit<VideoTimeline, "overlays"> & { overlays: PreviewOverlay[] };

export type TimelineClip = ((OwnVideo & { kind?: "video"; inPoint?: number; outPoint?: number })
  | (OwnPhoto & { kind: "photo"; duration: number })) & { settings?: ClipSettings; punchIns?: PunchIn[]; sourceStart?: number; transition?: ClipTransition };

export type TimingClip = { kind?: "video" | "photo"; duration: number; inPoint?: number; outPoint?: number; settings?: ClipSettings; punchIns?: PunchIn[]; sourceStart?: number; transition?: ClipTransition };

export function clipInPoint(clip: TimingClip) {
  return clip.kind === "photo" || clip.inPoint === undefined ? 0 : clip.inPoint;
}

export function clipDuration(clip: TimingClip) {
  if (clip.kind === "photo") return clip.duration;
  return (clip.outPoint === undefined ? clip.duration : clip.outPoint) - clipInPoint(clip);
}

export type VideoTimeline = {
  clips: TimelineClip[];
  overlays: TimelineOverlay[];
  captions?: CaptionSettings & { lines: CaptionLine[] };
  width: number;
  height: number;
  // Studio samples at 30fps; the editor preserves source frame timestamps.
  frameRate?: number;
};

export function cutTransition(clips: TimingClip[], index: number) {
  const next = clips[index + 1];
  const transition = clips[index].transition;
  return next === undefined || transition === undefined ? undefined : clampTransition(transition, clipDuration(clips[index]), clipDuration(next));
}
export function clipStarts(clips: TimingClip[]) {
  let at = 0;
  return clips.map((clip, index) => {
    const start = at;
    const transition = cutTransition(clips, index);
    at += clipDuration(clip) - (transition !== undefined && transition.type === "crossfade" ? transition.duration : 0);
    return start;
  });
}
export function timelineDuration(clips: TimingClip[]) {
  if (clips.length === 0) return 0;
  return clipStarts(clips)[clips.length - 1] + clipDuration(clips[clips.length - 1]);
}
export function visibleClips(clips: TimingClip[], time: number, starts = clipStarts(clips)) {
  const visible: { index: number; time: number; opacity: number; gain: number }[] = [];
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= time + TIMELINE_BOUNDARY_TOLERANCE) low = middle + 1;
    else high = middle;
  }
  for (let index = Math.max(0, low - 2); index < low; index++) {
    const clip = clips[index];
    const duration = clipDuration(clip);
    if (time >= starts[index] + duration - TIMELINE_BOUNDARY_TOLERANCE) continue;
    const local = Math.max(0, time - starts[index]);
    let opacity = 1;
    let gain = clipGain(clip.settings, local, duration);
    const incoming = index === 0 ? undefined : cutTransition(clips, index - 1);
    const outgoing = cutTransition(clips, index);
    if (incoming !== undefined) {
      const progress = Math.min(1, local / (incoming.type === "crossfade" ? incoming.duration : incoming.duration / 2));
      opacity *= progress;
      gain *= incoming.type === "crossfade" ? Math.sin(progress * Math.PI / 2) : progress;
    }
    if (outgoing !== undefined) {
      const progress = Math.min(1, (duration - local) / (outgoing.type === "crossfade" ? outgoing.duration : outgoing.duration / 2));
      opacity *= progress;
      gain *= outgoing.type === "crossfade" ? Math.sin(progress * Math.PI / 2) : progress;
    }
    visible.push({ index, time: local, opacity, gain });
  }
  return visible;
}

export function studioSize(aspect: Aspect, longSide = 1920) {
  const size = ASPECTS[aspect];
  const scale = longSide / Math.max(size.width, size.height);
  return { width: Math.round(size.width * scale / 2) * 2, height: Math.round(size.height * scale / 2) * 2 };
}
