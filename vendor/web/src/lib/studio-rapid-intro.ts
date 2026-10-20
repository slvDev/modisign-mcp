// generated from the Modisign monorepo, do not edit
import { DEFAULT_TEXT_STYLE, MAX_STUDIO_TEXTS, MAX_TEXT_LENGTH } from "@/lib/studio-project";
import { clipSourceStart } from "@/lib/clip-settings";
import { TEXT_ERROR, textProblem, type StudioText } from "@/lib/studio-text";
import type { StudioClip, StudioOverlay } from "@/lib/studio-state";

export const RAPID_FRAMES = [3, 4, 5, 6] as const;
export const RAPID_CLIPS = { min: 5, max: 7 } as const;
export const RAPID_TIMESTAMPS = ["source", "timeline", "none"] as const;
export type RapidFrames = typeof RAPID_FRAMES[number];
// One entry per chosen V1 clip, in teaser order: a teaser is the first `frames` frames of the clip's current trim, and its description labels the clip in the body.
export type RapidIntroInput = {
  entries: { clipId: string; teaserId: string; text: string }[];
  frames: RapidFrames; timestamp: typeof RAPID_TIMESTAMPS[number]; muteTeasers: boolean;
  labelIds: string[];
};
const LABEL_STYLE = { ...DEFAULT_TEXT_STYLE, y: 0.82, backing: true };
export const PHOTO_STAMP_MESSAGE = "A photo has no source timestamp. Use the timeline time or none.";

// Teasers go first on V1; everything already placed on an absolute time (V2, overlays, titles) moves later by the same amount.
export function rapidIntro(state: { clips: StudioClip[]; overlays: StudioOverlay[]; texts: StudioText[] }, input: RapidIntroInput) {
  const { entries, frames, timestamp, muteTeasers, labelIds } = input;
  if (entries.length < RAPID_CLIPS.min || entries.length > RAPID_CLIPS.max) return `Choose ${RAPID_CLIPS.min} to ${RAPID_CLIPS.max} clips.`;
  if (!RAPID_FRAMES.includes(frames)) return "A teaser cut is 3, 4, 5 or 6 frames.";
  if (new Set(entries.map((entry) => entry.clipId)).size !== entries.length) return "Choose each clip once.";
  if (labelIds.length !== entries.length || new Set([...entries.map((entry) => entry.teaserId), ...state.clips.map((clip) => clip.id)]).size !== entries.length + state.clips.length) throw new Error("Rapid intro needs a fresh id for every teaser and label");
  const length = frames / 30;
  const teasers: StudioClip[] = [];
  const labels: StudioText[] = [];
  for (const [position, entry] of entries.entries()) {
    const body = state.clips.find((clip) => clip.id === entry.clipId);
    if (body === undefined || body.track !== "v1") return "Rapid intro uses clips on V1.";
    if (body.outPoint - body.inPoint < length - 1e-6) return `“${body.label}” is shorter than ${frames} frames. Choose a shorter teaser.`;
    if (timestamp === "source" && body.kind === "photo") return PHOTO_STAMP_MESSAGE;
    if (entry.text.length > MAX_TEXT_LENGTH) return TEXT_ERROR;
    teasers.push({ ...body, id: entry.teaserId, transition: undefined, punchIns: undefined,
      ...(body.kind === "photo" ? { duration: length, inPoint: 0, outPoint: length, sourceStart: clipSourceStart(body) } : { outPoint: body.inPoint + length }),
      settings: { ...body.settings, fadeIn: 0, fadeOut: 0, muted: muteTeasers ? true : body.settings.muted } });
    const label: StudioText = { ...LABEL_STYLE, id: labelIds[position], text: entry.text, ...(timestamp === "none" ? {} : { timestamp }), timing: { clipId: body.id } };
    if (label.text !== "" || timestamp !== "none") labels.push(label);
  }
  if (state.texts.length + labels.length > MAX_STUDIO_TEXTS) return `A project has at most ${MAX_STUDIO_TEXTS} titles.`;
  const shift = teasers.length * length;
  const clips = [...teasers, ...state.clips.filter((clip) => clip.track === "v1"), ...state.clips.filter((clip) => clip.track === "v2").map((clip) => clip.track === "v2" ? { ...clip, start: clip.start + shift } : clip)];
  const texts = [...state.texts.map((title) => "clipId" in title.timing ? title : { ...title, timing: { ...title.timing, start: title.timing.start + shift } }), ...labels];
  const problem = texts.map((title) => textProblem(title, clips, Number.MAX_VALUE)).find((message) => message !== null);
  return problem === undefined ? { clips, texts, overlays: state.overlays.map((overlay) => ({ ...overlay, start: overlay.start + shift })) } : problem;
}
