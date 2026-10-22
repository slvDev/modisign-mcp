// generated from the Modisign monorepo, do not edit
import { DEFAULT_TEXT_STYLE, MAX_STUDIO_DURATION, MAX_TEXT_LENGTH, MIN_CLIP_DURATION, STUDIO_TIME_TOLERANCE, isTextDuration, isTextLabel, isTextStyle, occlusionProblem, revealProblem, type TextLabel, type TextStyle, type LayerMotion, type TitleOcclusion, type TitleReveal } from "@/lib/studio-project";
import { clipStarts, type TimelineText } from "@/lib/video-timeline";
import type { StudioClip } from "@/lib/studio-state";

// A bound title shows for its clip's whole span and follows it; an explicit one has its own post-overlap interval.
export type TextTiming = { clipId: string } | { start: number; duration: number };
// Motion keys and the reveal's start are title-local seconds; `animationOffset` shifts them when a title was cut from the middle of a longer one.
// Person effect: the people of `clipId`'s own pictures stand in front of the title. A bound title's owner is its own clip.
export type TextOcclusion = Omit<TitleOcclusion, "clip"> & { clipId: string };
export type StudioText = TextLabel & TextStyle & { id: string; timing: TextTiming; motion?: LayerMotion; reveal?: TitleReveal; occlusion?: TextOcclusion; animationOffset?: number };
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
    const { font, weight, italic, fill, size, x, y, backing, motion, reveal, animationOffset } = title;
    const owner = title.occlusion === undefined ? -1 : clips.findIndex((item) => item.id === title.occlusion!.clipId);
    if (title.occlusion !== undefined && owner < 0) throw new Error("A title's person clip is missing");
    const occlusion = title.occlusion === undefined ? undefined : { owner, threshold: title.occlusion.threshold, feather: title.occlusion.feather, smoothing: title.occlusion.smoothing };
    return { paragraphs: [...stamp, ...(title.text === "" ? [] : [title.text])], start, end, font, weight, italic, fill, size, x, y, backing, motion, reveal, occlusion, animationOffset };
  });
}

// The reason a title cannot exist on this timeline, or null.
export function textProblem(title: StudioText, clips: StudioClip[], total: number) {
  if (!isTextLabel(title) || (title.timestamp !== undefined && !("clipId" in title.timing))) return TEXT_ERROR;
  if (!isTextStyle({ ...title })) return "That text style is not available.";
  if (title.reveal !== undefined) { const problem = revealProblem(title.reveal); if (problem !== null) return problem.message; }
  const person = title.occlusion;
  if (person !== undefined) {
    const problem = occlusionProblem(person);
    if (problem !== null) return problem.message;
    if (!clips.some((clip) => clip.id === person.clipId)) return "A title's person clip is missing.";
    if ("clipId" in title.timing && title.timing.clipId !== person.clipId) return "Behind person uses the title's own clip. Use explicit timing to place it against another clip.";
  }
  const { timing } = title;
  if ("clipId" in timing) {
    const clip = clips.find((item) => item.id === timing.clipId);
    if (clip === undefined) return "A title's clip is missing.";
    return title.timestamp === "source" && clip.kind === "photo" ? "A photo has no source timestamp. Use the timeline time." : null;
  }
  if (!isTextDuration(timing.duration)) return `A title lasts between ${MIN_CLIP_DURATION.toFixed(1)} and ${MAX_STUDIO_DURATION} seconds.`;
  return timing.start >= 0 && timing.start < total ? null : "A title must start inside the timeline.";
}

// True when any stored title has an expressive effect (inactive or not): the one title fact the export gate reads.
export const titleEffectsOn = (texts: readonly { reveal?: unknown; occlusion?: unknown }[]) => texts.some((title) => title.reveal !== undefined || title.occlusion !== undefined);

// True when an explicit person title shares any time with its owner clip; a bound one always does.
export function occlusionOverlaps(title: StudioText, clips: StudioClip[]) {
  if (title.occlusion === undefined) return true;
  const { start, end } = textSpan(title, clips);
  const index = clips.findIndex((clip) => clip.id === title.occlusion!.clipId);
  if (index < 0) return false;
  const owner = clipStarts(clips)[index];
  return start < owner + clips[index].outPoint - clips[index].inPoint - STUDIO_TIME_TOLERANCE && end > owner + STUDIO_TIME_TOLERANCE;
}
