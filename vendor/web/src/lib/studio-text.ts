// generated from the Modisign monorepo, do not edit
import { DEFAULT_TEXT_STYLE, MAX_STUDIO_DURATION, MAX_TEXT_LENGTH, MIN_CLIP_DURATION, STUDIO_TIME_TOLERANCE, isTextDuration, isTextLabel, isTextStyle, type TextLabel, type TextStyle } from "@/lib/studio-project";
import { clipStarts, type TimelineText } from "@/lib/video-timeline";
import type { StudioClip } from "@/lib/studio-state";

// A bound title shows for its clip's whole span and follows it; an explicit one has its own post-overlap interval.
export type TextTiming = { clipId: string } | { start: number; duration: number };
export type StudioText = TextLabel & TextStyle & { id: string; timing: TextTiming };
export type TextPatch = Partial<Omit<StudioText, "id">>;
export const DEFAULT_TEXT_DURATION = 2;
export const TEXT_ERROR = `A title needs text of up to ${MAX_TEXT_LENGTH} characters, or a timestamp.`;

// Whole seconds as mm:ss.
export function timestampText(seconds: number) {
  const whole = Math.floor(seconds + STUDIO_TIME_TOLERANCE);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function newText(id: string, text: string, start: number, total: number): StudioText {
  const begin = Math.max(0, Math.min(start, total - MIN_CLIP_DURATION));
  return { ...DEFAULT_TEXT_STYLE, id, text, timing: { start: begin, duration: Math.max(MIN_CLIP_DURATION, Math.min(DEFAULT_TEXT_DURATION, total - begin)) } };
}

export function textSpan(title: StudioText, clips: StudioClip[], starts = clipStarts(clips)) {
  const { timing } = title;
  if (!("clipId" in timing)) return { start: timing.start, end: timing.start + timing.duration, clip: null, index: -1 };
  const index = clips.findIndex((clip) => clip.id === timing.clipId);
  if (index < 0) throw new Error("A title's clip is missing");
  return { start: starts[index], end: starts[index] + clips[index].outPoint - clips[index].inPoint, clip: clips[index], index };
}

// What the renderer draws: the stamp line above the text, each wrapped on its own.
export function timelineTexts(texts: StudioText[], clips: StudioClip[]): TimelineText[] {
  const starts = clipStarts(clips);
  return texts.map((title) => {
    const { start, end, clip, index } = textSpan(title, clips, starts);
    if (title.timestamp !== undefined && clip === null) throw new Error("A timestamp needs a bound clip");
    if (title.timestamp === "source" && clip !== null && clip.kind === "photo") throw new Error("A photo has no source timestamp");
    const stamp = title.timestamp === undefined || clip === null ? [] : [timestampText(title.timestamp === "source" ? clip.inPoint : starts[index])];
    const { font, weight, italic, fill, size, x, y, backing } = title;
    return { paragraphs: [...stamp, ...(title.text === "" ? [] : [title.text])], start, end, font, weight, italic, fill, size, x, y, backing };
  });
}

// The reason a title cannot exist on this timeline, or null.
export function textProblem(title: StudioText, clips: StudioClip[], total: number) {
  if (!isTextLabel(title) || (title.timestamp !== undefined && !("clipId" in title.timing))) return TEXT_ERROR;
  if (!isTextStyle({ ...title })) return "That text style is not available.";
  const { timing } = title;
  if ("clipId" in timing) {
    const clip = clips.find((item) => item.id === timing.clipId);
    if (clip === undefined) return "A title's clip is missing.";
    return title.timestamp === "source" && clip.kind === "photo" ? "A photo has no source timestamp. Use the timeline time." : null;
  }
  if (!isTextDuration(timing.duration)) return `A title lasts between ${MIN_CLIP_DURATION.toFixed(1)} and ${MAX_STUDIO_DURATION} seconds.`;
  return timing.start >= 0 && timing.start < total ? null : "A title must start inside the timeline.";
}
