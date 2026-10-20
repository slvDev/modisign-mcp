// generated from the Modisign monorepo, do not edit
import { ASPECTS, type Aspect } from "@/lib/aspects";
import { clipSchedule, TIMELINE_BOUNDARY_TOLERANCE, type VideoTrack, type ClipSpatial, clampTransition, type ClipTransition, type ClipSettings, type PunchIn, type TextStyle } from "@/lib/studio-project";
import { clipGain } from "@/lib/clip-settings";
import type { OwnPhoto } from "@/lib/studio-photo";
import type { OwnVideo } from "@/lib/own-video";

import type { Values } from "./values";
import type { CaptionLine, CaptionSettings } from "./captions";

export { TIMELINE_BOUNDARY_TOLERANCE } from "@/lib/studio-project";

export type TimelineOverlay = {
  src: string;
  width: number;
  height: number;
  duration: number;
  startsAt: number;
};

export type PreviewOverlay = TimelineOverlay & { id: string; liveValues?: Values };
// A title resolved to output time: wrapped paragraphs (stamp first) shown from `start` until `end`.
export type TimelineText = TextStyle & { paragraphs: string[]; start: number; end: number };

export type VideoPreviewTimeline = Omit<VideoTimeline, "overlays"> & { overlays: PreviewOverlay[] };

export type TimelineClip = ((OwnVideo & { kind: "video"; inPoint?: number; outPoint?: number })
  | (OwnPhoto & { kind: "photo"; duration: number })) & ClipSpatial & { id: string; track: VideoTrack; startsAt: number; settings?: ClipSettings; punchIns?: PunchIn[]; sourceStart?: number; transition?: ClipTransition };

export type TimingClip = { track: VideoTrack; start?: number; startsAt?: number; kind?: "video" | "photo"; duration: number; inPoint?: number; outPoint?: number; settings?: ClipSettings; punchIns?: PunchIn[]; sourceStart?: number; transition?: ClipTransition };

export function sourceOrigin(video: number, audio: number | null) {
  return Math.max(0, audio === null ? video : Math.min(video, audio));
}

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
  texts?: TimelineText[];
  captions?: CaptionSettings & { lines: CaptionLine[] };
  width: number;
  height: number;
  // Studio samples at 30fps; the editor preserves source frame timestamps.
  frameRate?: number;
};

function timed(clips: TimingClip[]) {
  return clips.map((clip) => {
    if (clip.track === "v1") return { track: "v1" as const, duration: clipDuration(clip), transition: clip.transition };
    if (clip.startsAt !== undefined) return { track: "v2" as const, start: clip.startsAt, duration: clipDuration(clip) };
    if (clip.start === undefined) throw new Error("V2 timing requires a start");
    return { track: "v2" as const, start: clip.start, duration: clipDuration(clip) };
  });
}
export function cutTransition(clips: TimingClip[], index: number) {
  const clip = clips[index];
  if (clip.track !== "v1") return undefined;
  const next = clips.slice(index + 1).find((clip) => clip.track === "v1");
  return next === undefined || clip.transition === undefined ? undefined : clampTransition(clip.transition, clipDuration(clip), clipDuration(next));
}
export function clipStarts(clips: TimingClip[]) {
  const starts = clipSchedule(timed(clips));
  return clips.map((clip, index) => clip.startsAt === undefined ? starts[index] : clip.startsAt);
}
export function timelineDuration(clips: TimingClip[]) {
  const starts = clipStarts(clips);
  return clips.reduce((end, clip, index) => Math.max(end, starts[index] + clipDuration(clip)), 0);
}
export function timelineSampler(clips: TimingClip[], starts = clipStarts(clips)) {
  const v1 = clips.flatMap((clip, index) => clip.track === "v1" ? [index] : []);
  const v2 = clips.flatMap((clip, index) => clip.track === "v2" ? [index] : []);
  const incoming = new Map(v1.map((index, position) => [index, position === 0 ? undefined : cutTransition(clips, v1[position - 1])]));
  const outgoing = clips.map((_, index) => cutTransition(clips, index));
  function active(indices: number[], time: number, count: number) {
    let low = 0;
    let high = indices.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[indices[middle]] <= time + TIMELINE_BOUNDARY_TOLERANCE) low = middle + 1;
      else high = middle;
    }
    return indices.slice(Math.max(0, low - count), low);
  }
  return (time: number) => {
  const visible: { index: number; time: number; opacity: number; gain: number }[] = [];
  for (const index of [...active(v1, time, 2), ...active(v2, time, 1)]) {
    const clip = clips[index];
    const duration = clipDuration(clip);
    if (time < starts[index] - TIMELINE_BOUNDARY_TOLERANCE || time >= starts[index] + duration - TIMELINE_BOUNDARY_TOLERANCE) continue;
    const local = Math.max(0, time - starts[index]);
    let opacity = 1;
    let gain = clipGain(clip.settings, local, duration);
    const incomingTransition = incoming.get(index);
    const outgoingTransition = outgoing[index];
    if (incomingTransition !== undefined) {
      const progress = Math.min(1, local / (incomingTransition.type === "crossfade" ? incomingTransition.duration : incomingTransition.duration / 2));
      opacity *= progress;
      gain *= incomingTransition.type === "crossfade" ? Math.sin(progress * Math.PI / 2) : progress;
    }
    if (outgoingTransition !== undefined) {
      const progress = Math.min(1, (duration - local) / (outgoingTransition.type === "crossfade" ? outgoingTransition.duration : outgoingTransition.duration / 2));
      opacity *= progress;
      gain *= outgoingTransition.type === "crossfade" ? Math.sin(progress * Math.PI / 2) : progress;
    }
    visible.push({ index, time: local, opacity, gain });
  }
  return visible;
  };
}
export function visibleClips(clips: TimingClip[], time: number, starts = clipStarts(clips)) {
  return timelineSampler(clips, starts)(time);
}

export function studioSize(aspect: Aspect, longSide = 1920) {
  const size = ASPECTS[aspect];
  const scale = longSide / Math.max(size.width, size.height);
  return { width: Math.round(size.width * scale / 2) * 2, height: Math.round(size.height * scale / 2) * 2 };
}
