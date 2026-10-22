// generated from the Modisign monorepo, do not edit
import { projectSpatial, projectTrack, defaultSpatial, isCrop, isPlace, validTrackSchedule, MAX_STUDIO_PROJECT_BYTES, MAX_STUDIO_CLIPS, MAX_STUDIO_TEXTS, type ClipSpatial, type TrackPlacement, clampTransition, type ClipTransition, STUDIO_ASPECTS, MAX_STUDIO_DURATION, MIN_CLIP_DURATION, MIN_CLIP_LABEL, STUDIO_TIME_TOLERANCE, isPhotoDuration, MIN_PHOTO_DURATION, isValidTrim, DEFAULT_CLIP_SETTINGS, isPunchIns, type PunchIn, type ClipSettings, type StudioProject, type LayerMotion, motionIsIdentity, motionProblem, motionKeyCount, MOTION_TIME, PHOTO_MOTION_TIME, MAX_MOTION_KEYS } from "@/lib/studio-project";
import type { Aspect } from "@/lib/aspects";
import type { CatalogItem } from "@/lib/catalog-query";
import { editorHref } from "@/lib/hrefs";
import { configOptions, parseTemplateConfig, sameTemplate, type ConfigFamily, type TemplateConfig } from "@/lib/template-config";
import type { FamilyId } from "@/lib/family-ids";
import type { Cue, Look } from "@/lib/values";
import type { OwnVideo } from "@/lib/own-video";
import { closestVideoAspect } from "@/lib/video-placement";
import { clipGeometry, clipSourceStart } from "@/lib/clip-settings";
import { clipStarts, studioSize } from "@/lib/video-timeline";
import { clampSeek, studioDuration, mediaById } from "@/lib/studio-projections";
import { synchronizedRanges } from "@/lib/studio-range-edit";
import type { ClipSilence } from "@/lib/studio-silences";

import { timelineWords, replaceCaptionWords, type CaptionWord, type CaptionSettings, type CaptionStyleId, type CaptionPlacement, type WordStyles } from "@/lib/captions";
import { patchedLook, type CaptionMix, type WordAppearance, type WordPatch } from "@/lib/caption-mix";
import { occlusionOverlaps, textProblem, type StudioText, type TextPatch } from "@/lib/studio-text";
import { rapidIntro, type RapidIntroInput } from "@/lib/studio-rapid-intro";
import { documentSfx, movedSfx, projectSfx, retargetedSfx, settledSfx, sfxProblem, type StudioSfx, type SfxPatch } from "@/lib/studio-sfx";
import { AUTO_SFX_STALE, appliedAutoSfx, autoSfxRevision, type AutoSfxAction } from "@/lib/studio-sfx-auto";
import { MAX_STUDIO_SFX } from "@/lib/studio-project";

export const STUDIO_FORMATS = [...STUDIO_ASPECTS];
export { MAX_STUDIO_DURATION, MIN_CLIP_DURATION } from "@/lib/studio-project";
export const MEDIA_DRAG = "application/x-modisign-media";
export const OVERLAY_DRAG = "application/x-modisign-overlay";
import type { OwnPhoto } from "@/lib/studio-photo";

export type StudioMedia = ({ kind: "video"; source: OwnVideo } | { kind: "photo"; source: OwnPhoto }) & { id: string; poster: string; hasAudio: boolean };
export type StudioClip = ClipSpatial & TrackPlacement & { id: string; mediaId: string | null; label: string; kind: "video" | "photo"; duration: number; inPoint: number; outPoint: number; settings: ClipSettings; sourceStart?: number; punchIns?: PunchIn[]; transition?: ClipTransition & { to: string }; motion?: LayerMotion };
export type StudioFamily = ConfigFamily & { id: FamilyId; name: string; cues: Cue[]; looks: Look[]; freeConfigs: TemplateConfig[] };
// MCP builds its overlay preset without the library tile, which only the Studio picker draws.
export type StudioOverlay = { id: string; preset: Omit<CatalogItem, "studioStill">; family: StudioFamily; config: TemplateConfig; start: number; clamped: boolean; motion?: LayerMotion };
// The template configuration alone matches a free preset.
export function overlayTemplateIsFree(overlay: StudioOverlay) {
  return overlay.family.freeConfigs.some((config) => sameTemplate(overlay.family.variables, overlay.config, config));
}
// A placed overlay is free only with an unchanged free template and no nonidentity motion key, active or not.
export function overlayIsFree(overlay: StudioOverlay) {
  return overlayTemplateIsFree(overlay) && motionIsIdentity(overlay.motion);
}
export function overlayConfig(family: StudioFamily, href: string) {
  const config = parseTemplateConfig(family, family.looks, [...new URLSearchParams(href.slice(href.indexOf("?") + 1))]);
  if (config === undefined) throw new Error("Overlay configuration is invalid");
  return config;
}
export type StudioSelection = { kind: "clip"; id: string; ids: string[] } | { kind: "overlay"; id: string } | { kind: "text"; id: string } | { kind: "sfx"; id: string } | null;
export type StudioDocument = {
  media: StudioMedia[]; clips: StudioClip[]; overlays: StudioOverlay[]; texts: StudioText[]; sfx: StudioSfx[];
  transcripts: Record<string, CaptionWord[]>; wordStyles: WordStyles; captions: CaptionSettings | null; savedCaptionSettings: CaptionSettings | null;
  aspect: Aspect; aspectChosen: boolean; selection: StudioSelection;
};
export type StudioState = StudioDocument & {
  projectName: string;
  playhead: number; seek: number; playing: boolean; message: string | null;
  snapping: boolean; past: StudioDocument[]; future: StudioDocument[];
  editGroup: string | null; editFuture: StudioDocument[] | null;
};
export const initialStudioState: StudioState = {
  projectName: "Untitled edit",
  media: [], clips: [], overlays: [], texts: [], sfx: [], transcripts: {}, wordStyles: {}, captions: null, savedCaptionSettings: null, aspect: "9x16", aspectChosen: false,
  selection: null, playhead: 0, seek: 0, playing: false, message: null,
  snapping: true, past: [], future: [], editGroup: null, editFuture: null,
};
export type StudioAction =
  | { type: "rename-project"; name: string }
  | { type: "set-transcript"; mediaId: string; words: CaptionWord[] }
  | { type: "edit-caption-line"; mediaId: string; wordIds: string[]; text: string }
  | { type: "delete-caption-line"; mediaId: string; wordIds: string[] }
  | { type: "set-caption-style"; style: CaptionStyleId; mix?: CaptionMix }
  | { type: "style-caption-words"; mediaId: string; wordIds: string[]; patch: WordPatch }
  | { type: "reset-caption-words"; mediaId: string; wordIds: string[] }
  | { type: "reset-all-caption-words" }
  | { type: "set-caption-position"; position: CaptionPlacement["position"] }
  | { type: "set-caption-size"; size: CaptionPlacement["size"] }
  | { type: "clear-captions" }
  | { type: "import"; media: StudioMedia }
  | { type: "open-project"; document: Pick<StudioState, "clips" | "overlays" | "texts" | "sfx" | "aspect" | "savedCaptionSettings" | "projectName"> }
  | { type: "relink-clip"; id: string; mediaId: string }
  | { type: "remove-media"; id: string }
  | { type: "add-clip"; id: string; mediaId: string; target: { track: "v1"; index?: number } | { track: "v2"; start: number } }
  | { type: "move-v2-clip"; id: string; start: number }
  | { type: "set-clip-track"; id: string; target: { track: "v1"; index: number } | { track: "v2"; start?: number } }
  | { type: "edit-clip-spatial"; id: string; crop: ClipSpatial["crop"]; place: ClipSpatial["place"]; group?: string }
  | { type: "swap-boxes"; ids: [string, string] }
  | { type: "cancel-clip-edit" }
  | { type: "split-screen"; v1Id: string; v2Id: string }
  | { type: "move-clip"; id: string; index: number }
  | { type: "edit-clip"; id: string; settings: ClipSettings; group?: string }
  | { type: "edit-punch-ins"; id: string; punchIns: PunchIn[]; group?: string }
  | { type: "edit-motion"; target: { kind: "clip" | "overlay" | "text"; id: string }; motion: LayerMotion | undefined; group?: string }
  | { type: "end-clip-edit" }
  | { type: "set-transition"; id: string; transition: ClipTransition | null; group?: string }
  | { type: "trim-clip"; id: string; inPoint: number; outPoint: number; start?: number }
  | { type: "remove-clip"; id: string }
  | { type: "split-clip"; id: string; newId: string }
  | { type: "remove-silences"; ranges: ClipSilence[] }
  | { type: "undo"; media?: StudioMedia[] }
  | { type: "redo"; media?: StudioMedia[] }
  | { type: "toggle-snap" }
  | { type: "add-overlay"; id: string; preset: CatalogItem; family: StudioFamily; start: number }
  | { type: "edit-overlay"; id: string; config: TemplateConfig; group?: string }
  | { type: "end-overlay-edit" }
  | { type: "move-overlay"; id: string; start: number }
  | { type: "remove-overlay"; id: string }
  | { type: "add-text"; text: StudioText }
  | { type: "edit-text"; id: string; patch: TextPatch; group?: string }
  | { type: "remove-text"; id: string }
  | { type: "add-sfx"; sfx: StudioSfx }
  | { type: "edit-sfx"; id: string; patch: SfxPatch; group?: string }
  | { type: "remove-sfx"; id: string }
  | AutoSfxAction
  | ({ type: "rapid-intro" } & RapidIntroInput)
  | { type: "set-aspect"; aspect: Aspect }
  | { type: "select"; selection: StudioSelection }
  | { type: "seek"; time: number }
  | { type: "time"; time: number }
  | { type: "toggle-play" }
  | { type: "set-playing"; playing: boolean }
  | { type: "ended" }
  | { type: "message"; message: string | null };

function without<T extends object>(item: T, ...keys: string[]): T {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key))) as T;
}
export function required<T extends { id: string }>(items: readonly T[], id: string) {
  const item = items.find((item) => item.id === id);
  if (item === undefined) throw new Error("Timeline item is missing");
  return item;
}
function canonicalClips(clips: StudioClip[]) {
  return [...clips.filter((clip) => clip.track === "v1"), ...clips.filter((clip) => clip.track === "v2").sort((a, b) => {
    if (a.track !== "v2" || b.track !== "v2") throw new Error("Expected V2 clips");
    return a.start - b.start;
  })];
}
function onTrack(clip: StudioClip, target: TrackPlacement): StudioClip {
  const content = { ...clip };
  if (content.track === "v2") delete (content as { start?: number }).start;
  return { ...content, ...target, transition: undefined };
}
function overlayStart(start: number, total: number, duration: number) {
  return Math.max(0, Math.min(start, Math.max(0, total - duration)));
}
// A title follows its clip: it ends with the clip, and an explicit one stays inside the timeline when a timing edit shortens it.
function keptTexts(texts: StudioText[], clips: StudioClip[], total: number, clamp: boolean): StudioText[] {
  const kept = texts.flatMap((title): StudioText[] => {
    const { timing } = title;
    if ("clipId" in timing) return clips.some((clip) => clip.id === timing.clipId) ? [title] : [];
    if (title.occlusion !== undefined && !clips.some((clip) => clip.id === title.occlusion!.clipId)) return [];
    const start = clamp ? overlayStart(timing.start, total, timing.duration) : timing.start;
    return start === timing.start ? [title] : [{ ...title, timing: { ...timing, start } }];
  });
  return kept.length === texts.length && kept.every((title, index) => title === texts[index]) ? texts : kept;
}
// A bound title keeps its animation phase when its clip's source start moves: the title-local keys and reveal then sit that much later in the title.
function phased(title: StudioText, delta: number): StudioText {
  if ((title.motion === undefined && title.reveal === undefined) || Math.abs(delta) < STUDIO_TIME_TOLERANCE) return title;
  const { animationOffset, ...rest } = title;
  const offset = (animationOffset ?? 0) + delta;
  return Math.abs(offset) < STUDIO_TIME_TOLERANCE ? rest : { ...rest, animationOffset: offset };
}
// The footage edit is judged on the original state; a title's phase only moves once it is accepted.
function trimmed(state: StudioState, clips: StudioClip[], id: string, delta: number): StudioState {
  const next = edited(state, clips, true);
  return next.clips === state.clips ? next : { ...next, texts: shiftedPhases(next.texts, id, delta) };
}
function shiftedPhases(texts: StudioText[], clipId: string, delta: number): StudioText[] {
  const shifted = texts.map((title) => "clipId" in title.timing && title.timing.clipId === clipId ? phased(title, delta) : title);
  return shifted.every((title, index) => title === texts[index]) ? texts : shifted;
}
// A clip split into fragments gives each fragment its own copy of the bound titles, each at the phase of its own source start.
function fragmentTitles(texts: StudioText[], clips: StudioClip[], owners: Map<string, string>, previous: StudioClip[]): StudioText[] {
  return texts.flatMap((title) => {
    const { timing, occlusion } = title;
    if (!("clipId" in timing)) {
      // An explicit person title keeps its own timing against each surviving fragment of its owner and draws only where that fragment is on screen.
      return occlusion === undefined ? [title] : clips.filter((clip) => owners.get(clip.id) === occlusion.clipId).map((clip) => clip.id === occlusion.clipId ? title : { ...title, id: `${clip.id}/${title.id}`, occlusion: { ...occlusion, clipId: clip.id } });
    }
    const original = required(previous, timing.clipId);
    return clips.filter((clip) => owners.get(clip.id) === timing.clipId).map((clip) => phased(clip.id === timing.clipId ? title : { ...title, id: `${clip.id}/${title.id}`, timing: { clipId: clip.id }, ...(occlusion === undefined ? {} : { occlusion: { ...occlusion, clipId: clip.id } }) }, clipSourceStart(clip) - clipSourceStart(original)));
  });
}
// A timing edit keeps the animation phase: trimming an explicit title's start advances it, a new owner restarts it, a detached title keeps it.
function retimed(title: StudioText, updated: StudioText): StudioText {
  const before = title.timing;
  const after = updated.timing;
  if ((updated.motion === undefined && updated.reveal === undefined) || before === after) return updated;
  if ("clipId" in after) {
    if ("clipId" in before && before.clipId === after.clipId) return updated;
    return without(updated, "animationOffset");
  }
  if ("clipId" in before) return updated;
  const moved = after.start - before.start;
  return Math.abs(moved) > STUDIO_TIME_TOLERANCE && Math.abs(after.start + after.duration - before.start - before.duration) < STUDIO_TIME_TOLERANCE ? phased(updated, moved) : updated;
}
// Off is an absent key, a phase offset needs a motion or a reveal to shift, and a bound person title stands in front of its own clip.
function settledTitle(title: StudioText): StudioText {
  const present = Object.fromEntries(Object.entries(title).filter(([, value]) => value !== undefined)) as StudioText;
  const owned = present.occlusion !== undefined && "clipId" in present.timing && present.occlusion.clipId !== present.timing.clipId ? { ...present, occlusion: { ...present.occlusion, clipId: present.timing.clipId } } : present;
  return owned.motion === undefined && owned.reveal === undefined ? without(owned, "animationOffset") : owned;
}
function movedTitles(texts: StudioText[], move: (start: number) => number): StudioText[] {
  return texts.map((title) => "clipId" in title.timing ? title : { ...title, timing: { ...title.timing, start: move(title.timing.start) } });
}
function edited(state: StudioState, clips = state.clips, clampOverlays = false): StudioState {
  if (clips.length > MAX_STUDIO_CLIPS) return { ...state, message: "Projects can have at most 300 clips." };
  clips = canonicalClips(clips);
  let removed = false;
  clips = clips.map((clip, index) => {
    const transition = clip.transition;
    if (transition === undefined) return clip;
    const next = clips[index + 1];
    const valid = clip.track === "v1" && next !== undefined && next.track === "v1" && transition.to === next.id ? clampTransition(transition, clip.outPoint - clip.inPoint, next.outPoint - next.inPoint) : undefined;
    if (valid !== undefined && valid.duration === transition.duration) return clip;
    if (next !== undefined && transition.to === next.id && valid === undefined) removed = true;
    const rest = { ...clip, transition: undefined };
    return valid === undefined ? rest : { ...rest, transition: { ...valid, to: transition.to } };
  });
  if (clips.every((clip, index) => clip === state.clips[index]) && clips.length === state.clips.length) clips = state.clips;
  if (!validTrackSchedule(clips.map((clip) => ({ ...clip, duration: clip.outPoint - clip.inPoint })))) return { ...state, message: "V2 clips must have nonnegative starts without overlaps or transitions." };
  const total = studioDuration(clips);
  if (total > MAX_STUDIO_DURATION + STUDIO_TIME_TOLERANCE) return { ...state, message: "The timeline can be at most 180 seconds. Trim or remove a clip first." };
  const time = Math.min(state.playhead, total);
  let selection = state.selection;
  if (selection !== null && selection.kind === "clip") {
    const ids = selection.ids.filter((id) => clips.some((clip) => clip.id === id));
    if (!ids.includes(selection.id)) selection = null;
    else if (ids.length !== selection.ids.length) selection = { ...selection, ids };
  }
  const texts = keptTexts(state.texts, clips, total, clampOverlays);
  if (selection !== null && selection.kind === "text") {
    const { id } = selection;
    if (!texts.some((title) => title.id === id)) selection = null;
  }
  return { ...state, clips, texts, selection, playing: false, playhead: time, seek: time, message: removed ? "Transition removed: clip too short" : null,
    overlays: clampOverlays ? state.overlays.map((overlay) => {
      const start = overlayStart(overlay.start, total, overlay.config.duration);
      return { ...overlay, start, clamped: overlay.clamped || start !== overlay.start };
    }) : state.overlays };
}
function clampClip(clip: StudioClip, media: StudioMedia[], aspect: Aspect): StudioClip {
  if (clip.mediaId === null || clip.settings.frameMode === "fit") return clip;
  const { centerX, centerY } = clipGeometry(mediaById(media, clip.mediaId).source, studioSize(aspect), clip.settings, false, undefined, clip);
  return { ...clip, settings: { ...clip.settings, centerX, centerY } };
}
function synchronizedRemoval(state: StudioState, ranges: ClipSilence[]): StudioState {
  if (ranges.length === 0) return state;
  try {
    const result = synchronizedRanges(state.clips, ranges);
    const next = edited(state, result.clips);
    if (next.clips === state.clips) return next;
    return edited({ ...next, overlays: state.overlays.map((overlay) => ({ ...overlay, start: result.warp(overlay.start) })),
      texts: movedTitles(fragmentTitles(state.texts, next.clips, result.owners, state.clips), result.warp),
      sfx: retargetedSfx(movedSfx(state.sfx, result.warp), next.clips, result.owners) }, next.clips, true);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { ...state, message: error.message };
  }
}
function removeSilences(state: StudioState, ranges: ClipSilence[]): StudioState {
  if (ranges.length === 0) return state;
  for (const range of ranges) required(state.clips, range.clipId);
  const owners = new Map<string, string>();
  const clips: StudioClip[] = [];
  const starts = clipStarts(state.clips);
  const replacements = new Map<string, string>();
  for (const clip of state.clips) {
    const first = clips.length;
    if (clip.kind === "photo") { clips.push(clip); owners.set(clip.id, clip.id); continue; }
    const cuts = ranges.filter((range) => range.clipId === clip.id).sort((a, b) => a.start - b.start);
    let cursor = clip.inPoint;
    let id = clip.id;
    for (const cut of cuts) {
      if (!Number.isFinite(cut.start) || !Number.isFinite(cut.end) || cut.start < cursor || cut.end <= cut.start || cut.end > clip.outPoint) throw new Error("Silence range is outside its clip");
      if (cut.start > cursor) {
        if (!isValidTrim(clip.duration, cursor, cut.start)) throw new Error("Silence removal leaves a clip shorter than 3 frames");
        clips.push({ ...clip, transition: undefined, id: clips.length === first ? clip.id : id, inPoint: cursor, outPoint: cut.start });
      }
      cursor = cut.end;
      id = cut.newId;
    }
    if (cursor < clip.outPoint) {
      if (!isValidTrim(clip.duration, cursor, clip.outPoint)) throw new Error("Silence removal leaves a clip shorter than 3 frames");
      clips.push(cuts.length === 0 ? clip : { ...clip, id: clips.length === first ? clip.id : id, inPoint: cursor });
    }
    if (clips.length > first) {
      for (let index = first; index < clips.length; index++) {
        const fragment = clips[index];
        const next = clips[index + 1];
        if (cuts.length > 0 && clip.punchIns !== undefined) clips[index] = { ...fragment,
          punchIns: clip.punchIns.filter((item) => (index === first || item.start >= fragment.inPoint) && (next === undefined || item.start < next.inPoint)) };
        owners.set(fragment.id, clip.id);
      }
      replacements.set(clip.id, clips[first].id);
      const last = clips[clips.length - 1];
      clips[clips.length - 1] = { ...last, transition: clip.transition };
    }
  }
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    if (clip.transition !== undefined) {
      const to = replacements.get(clip.transition.to);
      if (to !== undefined) clips[index] = { ...clip, transition: { ...clip.transition, to } };
    }
  }
  const next = edited(state, clips);
  if (next.clips === state.clips) return next;
  const nextStarts = clipStarts(next.clips);
  const move = (at: number) => {
    let index = state.clips.length - 1;
    while (index > 0 && starts[index] > at) index--;
    const original = state.clips[index];
    const sourceTime = original.inPoint + at - starts[index];
    const fragments = next.clips.flatMap((clip, index) => owners.get(clip.id) === original.id ? [{ clip, index }] : []);
    const following = fragments.find(({ clip }) => clip.outPoint > sourceTime);
    if (following !== undefined) return nextStarts[following.index] + Math.max(0, sourceTime - following.clip.inPoint);
    const last = fragments.at(-1);
    if (last !== undefined) return nextStarts[last.index] + last.clip.outPoint - last.clip.inPoint + Math.max(0, sourceTime - original.outPoint);
    const later = next.clips.findIndex((clip) => state.clips.findIndex((original) => original.id === owners.get(clip.id)) > index);
    return later < 0 ? studioDuration(next.clips) : nextStarts[later];
  };
  const total = studioDuration(next.clips);
  return { ...next, overlays: state.overlays.map((overlay) => ({ ...overlay, start: move(overlay.start) })),
    texts: keptTexts(movedTitles(fragmentTitles(state.texts, next.clips, owners, state.clips), move), next.clips, total, true),
    sfx: retargetedSfx(movedSfx(state.sfx, move), next.clips, owners) };
}
function captionSettings(settings: CaptionSettings, patch: Partial<CaptionSettings>): CaptionSettings {
  const { style, position, size } = { ...settings, ...patch };
  const mix = patch.style === undefined ? settings.mix : patch.mix;
  if ((style === "mixed") !== (mix !== undefined)) throw new Error("The Mixed style needs a mix, and no other style has one");
  return { style, position, size, ...(mix === undefined ? {} : { mix }) };
}
function editCaptionSettings(state: StudioState, patch: Partial<CaptionSettings>) {
  if (state.captions !== null) return edited({ ...state, captions: captionSettings(state.captions, patch) });
  return state.savedCaptionSettings === null ? state : edited({ ...state, savedCaptionSettings: captionSettings(state.savedCaptionSettings, patch) });
}
// Keeps each media's overrides only for the words its transcript still has.
function prunedWordStyles(wordStyles: WordStyles, transcripts: StudioState["transcripts"]): WordStyles {
  return Object.fromEntries(Object.entries(wordStyles).flatMap(([mediaId, looks]) => {
    const kept = Object.entries(looks).filter(([id]) => transcripts[mediaId] !== undefined && transcripts[mediaId].some((word) => word.id === id));
    return kept.length === 0 ? [] : [[mediaId, Object.fromEntries(kept)]];
  }));
}
function styleWords(state: StudioState, mediaId: string, wordIds: string[], change: (existing: WordAppearance | undefined) => WordAppearance | undefined) {
  const words = state.transcripts[mediaId];
  if (words === undefined || wordIds.length === 0 || wordIds.some((id) => !words.some((word) => word.id === id))) throw new Error("Caption words are missing");
  const looks = { ...state.wordStyles[mediaId] };
  for (const id of wordIds) {
    const next = change(looks[id]);
    if (next === undefined) delete looks[id]; else looks[id] = next;
  }
  const wordStyles = prunedWordStyles({ ...state.wordStyles, [mediaId]: looks }, state.transcripts);
  return JSON.stringify(wordStyles) === JSON.stringify(state.wordStyles) ? state : edited({ ...state, wordStyles });
}
function applyAction(state: StudioState, action: Exclude<StudioAction, { type: "undo" | "redo" }>): StudioState {
  switch (action.type) {
    case "rename-project": return { ...state, projectName: action.name };
    case "remove-silences": return state.clips.some((clip) => clip.track === "v2") ? synchronizedRemoval(state, action.ranges) : removeSilences(state, action.ranges);
    case "set-transcript": {
      if (!state.media.some((media) => media.id === action.mediaId)) return state;
      const captions: CaptionSettings = state.captions !== null ? state.captions : state.savedCaptionSettings !== null ? state.savedCaptionSettings : { style: "clean", position: "lower", size: "m" };
      return edited({ ...state, transcripts: { ...state.transcripts, [action.mediaId]: action.words }, wordStyles: Object.fromEntries(Object.entries(state.wordStyles).filter(([mediaId]) => mediaId !== action.mediaId)), captions, savedCaptionSettings: null });
    }
    case "edit-caption-line":
    case "delete-caption-line": {
      const words = state.transcripts[action.mediaId];
      if (words === undefined) throw new Error("Transcript is missing");
      const transcripts = { ...state.transcripts, [action.mediaId]: action.type === "edit-caption-line" ? replaceCaptionWords(words, action.wordIds, action.text) : words.filter((word) => !action.wordIds.includes(word.id)) };
      return edited({ ...state, transcripts, wordStyles: prunedWordStyles(state.wordStyles, transcripts) });
    }
    case "set-caption-style": return editCaptionSettings(state, { style: action.style, mix: action.mix });
    case "style-caption-words": return styleWords(state, action.mediaId, action.wordIds, (existing) => patchedLook(existing, action.patch));
    case "reset-caption-words": return styleWords(state, action.mediaId, action.wordIds, () => undefined);
    case "reset-all-caption-words": return Object.keys(state.wordStyles).length === 0 ? state : edited({ ...state, wordStyles: {} });
    case "set-caption-position": return editCaptionSettings(state, { position: action.position });
    case "set-caption-size": return editCaptionSettings(state, { size: action.size });
    case "clear-captions": return edited({ ...state, captions: null, savedCaptionSettings: null, transcripts: {}, wordStyles: {} });
    case "relink-clip": {
      const media = mediaById(state.media, action.mediaId);
      const placeholder = required(state.clips, action.id);
      if ((placeholder.kind === "photo") !== (media.kind === "photo")) return { ...state, message: `Relink this ${placeholder.kind === "photo" ? "photo with an image" : "video with a video"}.` };
      if (media.kind === "video" && media.source.duration < MIN_CLIP_DURATION) return { ...state, message: `A timeline clip must be at least ${MIN_CLIP_LABEL}.` };
      return edited(state, state.clips.map((clip) => {
        if (clip.id !== action.id) return clip;
        const linked = { ...clip, mediaId: media.id, label: media.source.file.name };
        return media.kind === "photo" ? linked : { ...linked, duration: media.source.duration,
          inPoint: Math.min(clip.inPoint, media.source.duration - MIN_CLIP_DURATION), outPoint: Math.min(clip.outPoint, media.source.duration) };
      }).map((clip) => clampClip(clip, state.media, state.aspect)), true);
    }
    case "open-project": return { ...initialStudioState, ...action.document, media: state.media, aspectChosen: true };
    case "import": return { ...state, media: [...state.media, action.media] };
    case "remove-media": return edited({ ...state, media: state.media.filter((item) => item.id !== action.id), selection: null }, state.clips.filter((clip) => clip.mediaId !== action.id), true);
    case "add-clip": {
      const media = mediaById(state.media, action.mediaId);
      if (media.kind === "video" && media.source.duration < MIN_CLIP_DURATION) return { ...state, message: `A timeline clip must be at least ${MIN_CLIP_LABEL}.` };
      const clips = [...state.clips];
      const target = action.target;
      const index = target.track === "v2" ? clips.length : target.index === undefined ? clips.filter((clip) => clip.track === "v1").length : target.index;
      clips.splice(index, 0, { ...defaultSpatial(), ...(target.track === "v2" ? { track: "v2" as const, start: target.start } : { track: "v1" as const }), id: action.id, mediaId: action.mediaId, label: media.source.file.name, kind: media.kind, duration: media.kind === "photo" ? 3 : media.source.duration, inPoint: 0, outPoint: media.kind === "photo" ? 3 : media.source.duration, settings: media.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, slowZoom: false } : { ...DEFAULT_CLIP_SETTINGS } });
      const next = edited(state, clips, true);
      if (next.clips === state.clips) return next;
      return { ...next, selection: { kind: "clip", id: action.id, ids: [action.id] }, aspect: !state.aspectChosen && state.clips.length === 0 ? closestVideoAspect(media.source, STUDIO_FORMATS) : state.aspect };
    }
    case "set-transition": {
      const index = state.clips.findIndex((clip) => clip.id === action.id);
      if (index < 0 || index >= state.clips.length - 1 || state.clips[index].track !== "v1" || state.clips[index + 1].track !== "v1") return { ...state, message: "Transitions require two adjacent V1 clips." };
      const clip = state.clips[index];
      const transition = action.transition === null ? undefined : { ...action.transition, to: state.clips[index + 1].id };
      if (JSON.stringify(transition) === JSON.stringify(clip.transition)) return state;
      return edited(state, state.clips.map((item) => item.id === action.id ? { ...item, transition } : item), true);
    }
    case "move-clip": {
      const clip = required(state.clips, action.id);
      if (clip.track !== "v1") return { ...state, message: "Move V2 clips by their start time." };
      if (state.clips.indexOf(clip) === action.index) return state;
      const clips = state.clips.filter((item) => item.id !== action.id);
      clips.splice(Math.max(0, Math.min(action.index, clips.filter((clip) => clip.track === "v1").length)), 0, { ...clip, transition: undefined });
      return edited(state, clips, true);
    }
    case "move-v2-clip": {
      const clip = required(state.clips, action.id);
      if (clip.track !== "v2") return { ...state, message: "Only V2 clips have independent starts." };
      if (clip.start === action.start) return state;
      return edited(state, state.clips.map((item) => item.id === clip.id ? { ...clip, start: action.start } : item), true);
    }
    case "set-clip-track": {
      const clip = required(state.clips, action.id);
      if (clip.track === action.target.track) return state;
      const clips = state.clips.filter((item) => item.id !== clip.id);
      if (action.target.track === "v1" && (!Number.isInteger(action.target.index) || action.target.index < 0 || action.target.index > clips.filter((clip) => clip.track === "v1").length)) return { ...state, message: "Choose a valid V1 insertion index." };
      const start = clipStarts(state.clips)[state.clips.indexOf(clip)];
      const moved = onTrack(clip, action.target.track === "v1" ? { track: "v1" } : { track: "v2", start: action.target.start === undefined ? start : action.target.start });
      if (action.target.track === "v1") clips.splice(Math.max(0, Math.min(action.target.index, clips.filter((item) => item.track === "v1").length)), 0, moved);
      else clips.push(moved);
      return edited(state, clips, true);
    }
    case "edit-clip-spatial": {
      if (!isCrop(action.crop) || !isPlace(action.place)) return { ...state, message: "Crop and Place must retain at least 5% inside their bounds." };
      const clip = required(state.clips, action.id);
      const updated = clampClip({ ...clip, crop: action.crop, place: action.place }, state.media, state.aspect);
      if (JSON.stringify(updated) === JSON.stringify(clip)) return state;
      return edited(state, state.clips.map((item) => item.id === clip.id ? updated : item));
    }
    case "swap-boxes": {
      const a = required(state.clips, action.ids[0]);
      const b = required(state.clips, action.ids[1]);
      return edited(state, state.clips.map((clip) => clampClip(clip.id === a.id ? { ...clip, place: b.place } : clip.id === b.id ? { ...clip, place: a.place } : clip, state.media, state.aspect)));
    }
    case "cancel-clip-edit": return state;
    case "split-screen": {
      if (action.v1Id === action.v2Id) return { ...state, message: "Select two different clips." };
      const creator = required(state.clips, action.v1Id);
      const reference = required(state.clips, action.v2Id);
      const clips = state.clips.filter((clip) => clip.id !== reference.id);
      const creatorIndex = clips.findIndex((clip) => clip.id === creator.id);
      const v1 = creator.track === "v1" ? creator : onTrack(creator, { track: "v1" });
      clips.splice(creatorIndex, 1);
      const insertion = clips.slice(0, creatorIndex).filter((clip) => clip.track === "v1").length;
      clips.splice(insertion, 0, { ...v1, place: { mode: "bottom" } });
      const repaired = edited(state, clips);
      if (repaired.message !== null && repaired.clips === state.clips) return repaired;
      const start = clipStarts(repaired.clips)[repaired.clips.findIndex((clip) => clip.id === creator.id)];
      const v2 = onTrack(reference, { track: "v2", start });
      return edited(state, [...repaired.clips, { ...v2, place: { mode: "top" as const }, settings: { ...v2.settings, muted: true } }].map((clip) => clampClip(clip, state.media, state.aspect)), true);
    }
    case "edit-clip": {
      const clip = required(state.clips, action.id);
      const updated = clampClip({ ...clip, settings: action.settings }, state.media, state.aspect);
      if (JSON.stringify(updated.settings) === JSON.stringify(clip.settings)) return state;
      return edited(state, state.clips.map((item) => item.id === action.id ? updated : item));
    }
    case "edit-punch-ins": {
      const clip = state.clips.find((item) => item.id === action.id);
      if (clip === undefined || !isPunchIns(action.punchIns, clip.kind === "photo" ? -Number.MAX_SAFE_INTEGER : 0, clip.kind === "photo" ? Number.MAX_SAFE_INTEGER : MAX_STUDIO_DURATION)) return { ...state, message: "Could not edit punch-ins. Keep lengths between 0.5 and 4 seconds without overlaps." };
      if (JSON.stringify(clip.punchIns) === JSON.stringify(action.punchIns)) return state;
      return edited(state, state.clips.map((item) => item.id === action.id ? { ...item, punchIns: action.punchIns } : item));
    }
    case "edit-motion": {
      const { kind, id } = action.target;
      const layer = required<{ id: string; motion?: LayerMotion }>(kind === "clip" ? state.clips : kind === "overlay" ? state.overlays : state.texts, id);
      const problem = action.motion === undefined ? null : motionProblem(action.motion, kind === "clip" && required(state.clips, id).kind === "photo" ? PHOTO_MOTION_TIME : MOTION_TIME);
      if (problem !== null) return { ...state, message: problem };
      if (JSON.stringify(layer.motion) === JSON.stringify(action.motion)) return state;
      // A title's phase offset only exists together with its motion or reveal.
      const withMotion = <T extends { id: string; motion?: LayerMotion; reveal?: unknown; animationOffset?: number }>(items: T[]) => items.map((item): T => {
        if (item.id !== id) return item;
        if (action.motion !== undefined) return { ...item, motion: action.motion };
        return item.reveal === undefined ? without(item, "motion", "animationOffset") : without(item, "motion");
      });
      if (kind === "clip") return edited(state, withMotion(state.clips));
      return { ...state, message: null, ...(kind === "overlay" ? { overlays: withMotion(state.overlays) } : { texts: withMotion(state.texts) }) };
    }
    case "end-clip-edit": return { ...state, editGroup: null, editFuture: null };
    case "trim-clip": {
      const clip = required(state.clips, action.id);
      if (clip.track === "v2" && (action.start === undefined || Math.abs(action.start - (clip.start + action.inPoint - clip.inPoint)) > STUDIO_TIME_TOLERANCE)) return { ...state, message: "V2 left trims must preserve source alignment." };
      if (clip.track === "v1" && action.start !== undefined) return { ...state, message: "V1 clips cannot have a start." };
      const placement = clip.track === "v2" ? { track: "v2" as const, start: action.start! } : { track: "v1" as const };
      if (action.inPoint === clip.inPoint && action.outPoint === clip.outPoint) return state;
      if (clip.kind === "photo") {
        const duration = action.outPoint - action.inPoint;
        if (!isPhotoDuration(duration)) return { ...state, message: `Keep photos between ${MIN_CLIP_LABEL} and 30 seconds.` };
        return trimmed(state, state.clips.map((item) => item.id === clip.id ? { ...clip, ...placement, duration, inPoint: 0, outPoint: duration, sourceStart: clipSourceStart(clip) + action.inPoint } : item), clip.id, action.inPoint - clip.inPoint);
      }
      if (!isValidTrim(clip.duration, action.inPoint, action.outPoint)) {
        return { ...state, message: `Keep at least ${MIN_CLIP_LABEL} within the source clip.` };
      }
      return trimmed(state, state.clips.map((item) => item.id === action.id ? { ...item, ...placement, inPoint: action.inPoint, outPoint: action.outPoint } : item), clip.id, action.inPoint - clip.inPoint);
    }
    case "split-clip": {
      const clip = required(state.clips, action.id);
      const index = state.clips.indexOf(clip);
      const local = state.playhead - clipStarts(state.clips)[index];
      const cut = clip.inPoint + (clip.track === "v1" ? Math.round(local * 30) / 30 : local);
      const minimum = clip.kind === "photo" ? MIN_PHOTO_DURATION : MIN_CLIP_DURATION;
      if (cut - clip.inPoint < minimum - STUDIO_TIME_TOLERANCE || clip.outPoint - cut < minimum - STUDIO_TIME_TOLERANCE) {
        return { ...state, message: `Place the playhead inside the selected clip, at least ${MIN_CLIP_LABEL} from either edge.` };
      }
      const clips = [...state.clips];
      const rightPlacement = clip.track === "v2" ? { track: "v2" as const, start: state.playhead } : { track: "v1" as const };
      const sourceCut = clip.kind === "photo" ? clipSourceStart(clip) + cut : cut;
      const leftPunchIns = clip.punchIns === undefined ? undefined : clip.punchIns.filter((item) => item.start < sourceCut);
      const rightPunchIns = clip.punchIns === undefined ? undefined : clip.punchIns.filter((item) => item.start >= sourceCut);
      clips.splice(index, 1, ...(clip.kind === "photo"
        ? [{ ...clip, punchIns: leftPunchIns, transition: undefined, duration: cut, outPoint: cut }, { ...clip, ...rightPlacement, punchIns: rightPunchIns, sourceStart: sourceCut, id: action.newId, duration: clip.outPoint - cut, inPoint: 0, outPoint: clip.outPoint - cut }]
        : [{ ...clip, punchIns: leftPunchIns, transition: undefined, outPoint: cut }, { ...clip, ...rightPlacement, punchIns: rightPunchIns, id: action.newId, inPoint: cut }]));
      const next = edited(state, clips, true);
      if (next.clips === state.clips) return next;
      const owners = new Map(next.clips.map((item) => [item.id, item.id === action.newId ? action.id : item.id]));
      return { ...next, texts: fragmentTitles(next.texts, next.clips, owners, state.clips), sfx: retargetedSfx(next.sfx, next.clips, owners) };
    }
    case "toggle-snap": return { ...state, snapping: !state.snapping };
    case "set-playing": return state.clips.length === 0 || state.clips.some((clip) => clip.mediaId === null) ? state : { ...state, playing: action.playing, seek: state.playhead };
    case "remove-clip": return edited({ ...state, selection: null }, state.clips.filter((clip) => clip.id !== action.id), true);
    case "add-overlay": return edited({ ...state, selection: { kind: "overlay", id: action.id }, overlays: [...state.overlays, {
      id: action.id, preset: action.preset, family: action.family, config: overlayConfig(action.family, action.preset.href),
      start: overlayStart(action.start, studioDuration(state.clips), action.preset.duration), clamped: false,
    }] });
    case "add-text": {
      const problem = textProblem(action.text, state.clips, studioDuration(state.clips));
      return problem === null ? edited({ ...state, selection: { kind: "text", id: action.text.id }, texts: [...state.texts, action.text] }) : { ...state, message: problem };
    }
    case "edit-text": {
      const title = required(state.texts, action.id);
      const updated = settledTitle(retimed(title, { ...title, ...action.patch }));
      if (JSON.stringify(updated) === JSON.stringify(title)) return state;
      const problem = textProblem(updated, state.clips, studioDuration(state.clips))
        ?? (action.patch.occlusion !== undefined && !occlusionOverlaps(updated, state.clips) ? "That title does not overlap its person clip. Move the title or choose another clip." : null);
      return problem === null ? { ...state, message: null, texts: state.texts.map((item) => item.id === action.id ? updated : item) } : { ...state, message: problem };
    }
    case "remove-text": return edited({ ...state, selection: null, texts: state.texts.filter((title) => title.id !== action.id) });
    case "add-sfx": {
      if (state.sfx.some((sound) => sound.id === action.sfx.id)) throw new Error("A sound with this id already exists");
      const problem = sfxProblem(action.sfx, state);
      return problem === null ? { ...state, selection: { kind: "sfx", id: action.sfx.id }, sfx: [...state.sfx, action.sfx], message: null } : { ...state, message: problem };
    }
    case "edit-sfx": {
      const sound = required(state.sfx, action.id);
      const { auto, ...rest } = { ...sound, ...action.patch };
      // Any edit of a managed sound makes it the creator's own, so a later automatic pass leaves it alone.
      const updated: StudioSfx = "auto" in action.patch ? { ...rest, auto } : rest;
      if (JSON.stringify(updated) === JSON.stringify(sound)) return state;
      const problem = sfxProblem(updated, state);
      return problem === null ? { ...state, message: null, sfx: state.sfx.map((item) => item.id === action.id ? updated : item) } : { ...state, message: problem };
    }
    case "remove-sfx": {
      required(state.sfx, action.id);
      return { ...state, selection: null, sfx: state.sfx.filter((sound) => sound.id !== action.id) };
    }
    case "apply-auto-sfx": {
      if (action.revision !== autoSfxRevision(state)) return { ...state, message: AUTO_SFX_STALE };
      const sfx = appliedAutoSfx(state.sfx, action.rows, action.replace);
      if (sfx === state.sfx) return state;
      const problem = action.rows.map((row) => sfxProblem(row, state)).find((reason) => reason !== null);
      if (problem !== undefined) return { ...state, message: problem };
      const { selection } = state;
      return { ...state, sfx, message: null, selection: selection !== null && selection.kind === "sfx" && !sfx.some((sound) => sound.id === selection.id) ? null : selection };
    }
    case "rapid-intro": {
      const built = rapidIntro(state, action);
      if (typeof built === "string") return { ...state, message: built };
      const next = edited(state, built.clips);
      if (next.clips === state.clips) return next;
      return { ...next, overlays: built.overlays, texts: built.texts, sfx: built.sfx, selection: null, playhead: 0, seek: 0 };
    }
    case "edit-overlay": {
      const overlay = required(state.overlays, action.id);
      if (JSON.stringify(overlay.config) === JSON.stringify(action.config)) return state;
      return { ...state, message: null, overlays: state.overlays.map((item) => item.id === action.id ? { ...item, config: action.config } : item) };
    }
    case "end-overlay-edit": return { ...state, editGroup: null, editFuture: null };
    case "move-overlay": {
      const overlay = required(state.overlays, action.id);
      const start = overlayStart(action.start, studioDuration(state.clips), overlay.config.duration);
      if (start === overlay.start && !overlay.clamped) return state;
      return edited({ ...state, overlays: state.overlays.map((item) => item.id === action.id ? { ...item, start, clamped: false } : item) });
    }
    case "remove-overlay": return edited({ ...state, selection: null, overlays: state.overlays.filter((overlay) => overlay.id !== action.id) });
    case "set-aspect": return edited({ ...state, aspect: action.aspect, aspectChosen: true }, state.clips.map((clip) => clampClip(clip, state.media, action.aspect)));
    case "select": {
      const selection = action.selection;
      if (selection !== null && selection.kind === "clip" && (selection.ids.length > 2 || !selection.ids.includes(selection.id) || new Set(selection.ids).size !== selection.ids.length || selection.ids.some((id) => !state.clips.some((clip) => clip.id === id)))) return state;
      return { ...state, selection };
    }
    case "seek": {
      const time = clampSeek(state.clips, action.time);
      return state.playhead === time && state.seek === time ? state : { ...state, playhead: time, seek: time };
    }
    case "time": return state.playhead === action.time ? state : { ...state, playhead: action.time };
    case "toggle-play": {
      if (state.clips.length === 0 || state.clips.some((clip) => clip.mediaId === null)) return state;
      const time = state.playhead >= studioDuration(state.clips) ? 0 : state.playhead;
      return { ...state, playing: !state.playing, playhead: time, seek: time };
    }
    case "ended": return { ...state, playing: false };
    case "message": return { ...state, message: action.message };
  }
}
function documentOf(state: StudioState): StudioDocument {
  const { media, clips, overlays, texts, sfx, aspect, aspectChosen, selection, transcripts, wordStyles, captions, savedCaptionSettings } = state;
  return { media, clips, overlays, texts, sfx, aspect, aspectChosen, selection, transcripts, wordStyles, captions, savedCaptionSettings };
}
// The reason a project cannot be saved as it stands (title, motion key and byte limits), or null.
export function studioBudgetProblem(state: StudioState) {
  if (state.texts.length > MAX_STUDIO_TEXTS) return `A project has at most ${MAX_STUDIO_TEXTS} titles.`;
  if (state.sfx.length > MAX_STUDIO_SFX) return `A project has at most ${MAX_STUDIO_SFX} sounds.`;
  if ([...state.clips, ...state.overlays, ...state.texts].reduce((sum, layer) => sum + motionKeyCount(layer.motion), 0) > MAX_MOTION_KEYS) return `A project has at most ${MAX_MOTION_KEYS} motion keys.`;
  return new TextEncoder().encode(JSON.stringify(projectOf(state, state.projectName))).length > MAX_STUDIO_PROJECT_BYTES
    ? "This project exceeds the 64 KiB save limit. Shorten overlay or title text, remove keyframes or remove clips." : null;
}
// Sounds follow their owners: a removed title, transition or overlay cue takes its sounds along, and a manual start beyond a shortened output moves inside it.
function withSettledSfx(previous: StudioState, applied: StudioState): StudioState {
  if (applied.clips === previous.clips && applied.overlays === previous.overlays && applied.texts === previous.texts && applied.sfx === previous.sfx) return applied;
  const { sfx, dropped, moved } = settledSfx(applied);
  if (dropped === 0 && moved === 0) return applied;
  const notices = [dropped === 0 ? null : `${dropped} ${dropped === 1 ? "sound was" : "sounds were"} removed with ${dropped === 1 ? "its" : "their"} event.`,
    moved === 0 ? null : `${moved} ${moved === 1 ? "sound was" : "sounds were"} moved inside the shorter timeline.`];
  const { selection } = applied;
  return { ...applied, sfx, selection: selection !== null && selection.kind === "sfx" && !sfx.some((sound) => sound.id === selection.id) ? null : selection,
    message: [applied.message, ...notices].filter((part) => part !== null).join(" ") };
}
export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  function preflight(candidate: StudioState) {
    const problem = studioBudgetProblem(candidate);
    return problem === null ? candidate : { ...state, message: problem };
  }
  if (action.type === "cancel-clip-edit") {
    const snapshot = state.past.at(-1);
    if (state.editGroup === null || snapshot === undefined || state.editFuture === null) return state;
    return { ...state, ...snapshot, past: state.past.slice(0, -1), future: state.editFuture, editGroup: null, editFuture: null };
  }
  if (action.type === "undo" || action.type === "redo") {
    const source = action.type === "undo" ? state.past : state.future;
    const snapshot = source.at(-1);
    if (snapshot === undefined) return state;
    const document = { ...snapshot, media: action.media === undefined ? snapshot.media : action.media };
    return preflight(edited({ ...state, ...document,
      editGroup: null, editFuture: null,
      past: action.type === "undo" ? state.past.slice(0, -1) : [...state.past, documentOf(state)],
      future: action.type === "redo" ? state.future.slice(0, -1) : [...state.future, documentOf(state)],
    }));
  }
  const candidate = withSettledSfx(state, applyAction(state, action));
  if (action.type === "rename-project") return preflight(candidate);
  const changed = candidate.media !== state.media || candidate.clips !== state.clips || candidate.overlays !== state.overlays || candidate.texts !== state.texts || candidate.sfx !== state.sfx || candidate.aspect !== state.aspect || candidate.aspectChosen !== state.aspectChosen || candidate.transcripts !== state.transcripts || candidate.wordStyles !== state.wordStyles || candidate.captions !== state.captions || candidate.savedCaptionSettings !== state.savedCaptionSettings;
  if (!changed) return candidate;
  const next = preflight(candidate);
  if (next !== candidate || action.type === "open-project") return next;
  const group = (action.type === "edit-overlay" || action.type === "edit-text" || action.type === "edit-sfx" || action.type === "edit-clip" || action.type === "set-transition" || action.type === "edit-punch-ins" || action.type === "edit-clip-spatial" || action.type === "edit-motion") && action.group !== undefined
    ? `${action.type === "edit-motion" ? `motion:${action.target.id}` : action.id}/${action.group}` : null;
  return { ...next, editGroup: group, editFuture: group === null ? null : group === state.editGroup ? state.editFuture : state.future,
    past: group !== null && group === state.editGroup ? state.past : [...state.past.slice(-59), documentOf(state)], future: [] };
}

// Why applying these rows would be refused on this document (stale review, owners, 100 sounds, 64 KiB), or null; the reducer is the one judge.
export function autoSfxProblem(state: StudioState, action: AutoSfxAction) {
  return studioReducer({ ...state, message: null }, action).message;
}

export function projectOf(state: StudioState, name: string): StudioProject {
  const captions = state.savedCaptionSettings !== null ? state.savedCaptionSettings
    : state.captions !== null && timelineWords(state.clips, state.transcripts).length > 0 ? state.captions : null;
  const transitions = state.clips.filter((clip) => clip.track === "v1").flatMap((clip, cut) => clip.transition === undefined ? [] : [{ cut, type: clip.transition.type, duration: clip.transition.duration }]);
  const ordered = canonicalClips(state.clips);
  return { name, aspect: state.aspect,
    ...(captions === null ? {} : { captions: { style: captions.style, position: captions.position, size: captions.size, ...(captions.mix === undefined ? {} : { mix: captions.mix }) } }),
    ...(transitions.length === 0 ? {} : { transitions }),
    ...(state.sfx.length === 0 ? {} : { sfx: projectSfx(state.sfx, { clips: ordered, texts: state.texts, overlays: state.overlays }) }),
    ...(state.texts.length === 0 ? {} : { texts: state.texts.map(({ text, timestamp, font, weight, italic, fill, size, x, y, backing, timing, motion, reveal, occlusion, animationOffset }) => {
      const ownerIndex = (clipId: string) => { const found = ordered.findIndex((item) => item.id === clipId); if (found < 0) throw new Error("A title's person clip is missing"); return found; };
      const label = { text, ...(timestamp === undefined ? {} : { timestamp }), font, weight, italic, fill, size, x, y, backing, ...(motion === undefined ? {} : { motion }), ...(reveal === undefined ? {} : { reveal }),
        ...(occlusion === undefined ? {} : { occlusion: { clip: ownerIndex(occlusion.clipId), model: occlusion.model, threshold: occlusion.threshold, feather: occlusion.feather, smoothing: occlusion.smoothing } }), ...(animationOffset === undefined ? {} : { animationOffset }) };
      if (!("clipId" in timing)) return { ...label, start: timing.start, duration: timing.duration };
      const clip = ordered.findIndex((item) => item.id === timing.clipId);
      if (clip < 0) throw new Error("A title's clip is missing");
      return { ...label, clip };
    }) }),
    clips: ordered.map((clip) => {
      const { label, kind, duration, inPoint, outPoint, settings, punchIns, sourceStart, crop, place, motion } = clip;
      const structure = {
        ...(Object.values(crop).every((edge) => edge === 0) ? {} : { crop }), ...(place.mode === "full" ? {} : { place }), ...(motion === undefined ? {} : { motion }) };
      const content = kind === "photo"
      ? { ...structure, label, kind: "photo" as const, duration: outPoint - inPoint, ...(sourceStart === undefined || sourceStart === 0 ? {} : { sourceStart }), ...(punchIns === undefined || punchIns.length === 0 ? {} : { punchIns }), settings: { frameMode: settings.frameMode, centerX: settings.centerX, centerY: settings.centerY, zoom: settings.zoom, slowZoom: settings.slowZoom === true } }
      : { ...structure, label, kind: "video" as const, duration, inPoint, outPoint, settings, ...(punchIns === undefined || punchIns.length === 0 ? {} : { punchIns }) };
      return clip.track === "v2" ? { ...content, track: "v2" as const, start: clip.start } : content; }),
    overlays: state.overlays.map(({ preset, family, config, start, motion }) => ({ family: preset.family, preset: preset.id, start,
      configuration: editorHref(family.id, configOptions(family, family.looks, config)), ...(motion === undefined ? {} : { motion }) })) };
}

export function documentFromProject(project: StudioProject, presets: CatalogItem[], families: StudioFamily[]): Pick<StudioState, "clips" | "overlays" | "texts" | "sfx" | "aspect" | "savedCaptionSettings" | "projectName"> {
  const ids = project.clips.map(() => crypto.randomUUID());
  const textIds = (project.texts === undefined ? [] : project.texts).map(() => crypto.randomUUID());
  const overlayIds = project.overlays.map(() => crypto.randomUUID());
  let cut = 0;
  return { aspect: project.aspect, projectName: project.name,
    sfx: documentSfx(project.sfx === undefined ? [] : project.sfx, { clips: ids, texts: textIds, overlays: overlayIds }),
    texts: (project.texts === undefined ? [] : project.texts).map(({ text, timestamp, font, weight, italic, fill, size, x, y, backing, clip, start, duration, motion, reveal, occlusion, animationOffset }, index): StudioText => ({
      id: textIds[index], text, ...(timestamp === undefined ? {} : { timestamp }), font, weight, italic, fill, size, x, y, backing, ...(motion === undefined ? {} : { motion }), ...(reveal === undefined ? {} : { reveal }),
      ...(occlusion === undefined ? {} : { occlusion: { clipId: ids[occlusion.clip], model: occlusion.model, threshold: occlusion.threshold, feather: occlusion.feather, smoothing: occlusion.smoothing } }), ...(animationOffset === undefined ? {} : { animationOffset }),
      timing: clip === undefined ? { start, duration } : { clipId: ids[clip] } })),
    savedCaptionSettings: project.captions === undefined ? null : project.captions,
    clips: project.clips.map((clip, index) => {
      const transition = clip.track === "v2" || project.transitions === undefined ? undefined : project.transitions.find((transition) => transition.cut === cut);
      if (clip.track === undefined) cut++;
      const source = clip.kind === "photo" ? { ...clip, inPoint: 0, outPoint: clip.duration } : clip;
      return { ...source, ...projectTrack(clip), ...projectSpatial(clip), settings: clip.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, ...clip.settings } : clip.settings, id: ids[index], mediaId: null, transition: transition === undefined ? undefined : { type: transition.type, duration: transition.duration, to: ids[index + 1] } };
    }),
    overlays: project.overlays.map((overlay, index) => {
      const preset = presets.find((item) => item.family === overlay.family && item.id === overlay.preset);
      if (preset === undefined) throw new Error("Saved overlay is no longer listed");
      const family = families.find((item) => item.id === preset.family);
      if (family === undefined) throw new Error("Saved overlay family is unavailable");
      const config = overlayConfig(family, overlay.configuration);
      return { id: overlayIds[index], preset, family, config, start: overlay.start, clamped: false, ...(overlay.motion === undefined ? {} : { motion: overlay.motion }) };
    }) };
}
