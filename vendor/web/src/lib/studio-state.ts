// generated from the Modisign monorepo, do not edit
import { clampTransition, type ClipTransition, STUDIO_ASPECTS, MAX_STUDIO_DURATION, MIN_CLIP_DURATION, STUDIO_TIME_TOLERANCE, isPhotoDuration, MIN_PHOTO_DURATION, isValidTrim, DEFAULT_CLIP_SETTINGS, isPunchIns, type PunchIn, type ClipSettings, type StudioProject } from "@/lib/studio-project";
import type { Aspect } from "@/lib/aspects";
import type { CatalogItem } from "@/lib/catalog-query";
import { editorHref } from "@/lib/hrefs";
import { configOptions, parseTemplateConfig, sameTemplate, type ConfigFamily, type TemplateConfig } from "@/lib/template-config";
import type { FamilyId } from "@/lib/family-ids";
import type { Look } from "@/lib/values";
import type { OwnVideo } from "@/lib/own-video";
import { closestVideoAspect } from "@/lib/video-placement";
import { clipGeometry, clipSourceStart } from "@/lib/clip-settings";
import { clipStarts, studioSize } from "@/lib/video-timeline";
import { studioDuration, mediaById } from "@/lib/studio-projections";
import type { ClipSilence } from "@/lib/studio-silences";

import { timelineWords, replaceCaptionWords, type CaptionWord, type CaptionSettings, type CaptionStyleId, type CaptionPlacement } from "@/lib/captions";

export const STUDIO_FORMATS = [...STUDIO_ASPECTS];
export { MAX_STUDIO_DURATION, MIN_CLIP_DURATION } from "@/lib/studio-project";
export const MEDIA_DRAG = "application/x-modisign-media";
export const OVERLAY_DRAG = "application/x-modisign-overlay";
import type { OwnPhoto } from "@/lib/studio-photo";

export type StudioMedia = ({ kind: "video"; source: OwnVideo } | { kind: "photo"; source: OwnPhoto }) & { id: string; poster: string; filmstrip: string[]; waveform: number[] | null; silenceLevels: number[] | null };
export type StudioClip = { id: string; mediaId: string | null; label: string; kind?: "video" | "photo"; duration: number; inPoint: number; outPoint: number; settings: ClipSettings; sourceStart?: number; punchIns?: PunchIn[]; transition?: ClipTransition & { to: string } };
export type StudioFamily = ConfigFamily & { id: FamilyId; name: string; looks: Look[]; freeConfigs: TemplateConfig[] };
export type StudioOverlay = { id: string; preset: CatalogItem; family: StudioFamily; config: TemplateConfig; start: number; clamped: boolean };
export function overlayIsFree(overlay: StudioOverlay) {
  return overlay.family.freeConfigs.some((config) => sameTemplate(overlay.family.variables, overlay.config, config));
}
export function overlayConfig(family: StudioFamily, href: string) {
  const config = parseTemplateConfig(family, family.looks, [...new URLSearchParams(href.slice(href.indexOf("?") + 1))]);
  if (config === undefined) throw new Error("Overlay configuration is invalid");
  return config;
}
export type StudioSelection = { kind: "clip" | "overlay"; id: string } | null;
export type StudioDocument = {
  media: StudioMedia[]; clips: StudioClip[]; overlays: StudioOverlay[];
  transcripts: Record<string, CaptionWord[]>; captions: CaptionSettings | null; savedCaptionSettings: CaptionSettings | null;
  aspect: Aspect; aspectChosen: boolean; selection: StudioSelection;
};
export type StudioState = StudioDocument & {
  playhead: number; seek: number; playing: boolean; message: string | null;
  snapping: boolean; past: StudioDocument[]; future: StudioDocument[];
  editGroup: string | null;
};
export const initialStudioState: StudioState = {
  media: [], clips: [], overlays: [], transcripts: {}, captions: null, savedCaptionSettings: null, aspect: "9x16", aspectChosen: false,
  selection: null, playhead: 0, seek: 0, playing: false, message: null,
  snapping: true, past: [], future: [], editGroup: null,
};
export type StudioAction =
  | { type: "set-transcript"; mediaId: string; words: CaptionWord[] }
  | { type: "edit-caption-line"; mediaId: string; wordIds: string[]; text: string }
  | { type: "delete-caption-line"; mediaId: string; wordIds: string[] }
  | { type: "set-caption-style"; style: CaptionStyleId }
  | { type: "set-caption-position"; position: CaptionPlacement["position"] }
  | { type: "set-caption-size"; size: CaptionPlacement["size"] }
  | { type: "clear-captions" }
  | { type: "import"; media: StudioMedia }
  | { type: "open-project"; document: Pick<StudioDocument, "clips" | "overlays" | "aspect" | "savedCaptionSettings"> }
  | { type: "relink-clip"; id: string; mediaId: string }
  | { type: "remove-media"; id: string }
  | { type: "add-clip"; id: string; mediaId: string; index?: number }
  | { type: "move-clip"; id: string; index: number }
  | { type: "edit-clip"; id: string; settings: ClipSettings; group?: string }
  | { type: "edit-punch-ins"; id: string; punchIns: PunchIn[]; group?: string }
  | { type: "end-clip-edit" }
  | { type: "set-transition"; id: string; transition: ClipTransition | null; group?: string }
  | { type: "trim-clip"; id: string; inPoint: number; outPoint: number }
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
  | { type: "set-aspect"; aspect: Aspect }
  | { type: "select"; selection: StudioSelection }
  | { type: "seek"; time: number }
  | { type: "time"; time: number }
  | { type: "toggle-play" }
  | { type: "set-playing"; playing: boolean }
  | { type: "ended" }
  | { type: "message"; message: string | null };

function required<T extends { id: string }>(items: T[], id: string) {
  const item = items.find((item) => item.id === id);
  if (item === undefined) throw new Error("Timeline item is missing");
  return item;
}
function overlayStart(start: number, total: number, duration: number) {
  return Math.max(0, Math.min(start, Math.max(0, total - duration)));
}
function edited(state: StudioState, clips = state.clips, clampOverlays = false): StudioState {
  let removed = false;
  clips = clips.map((clip, index) => {
    const transition = clip.transition;
    if (transition === undefined) return clip;
    const next = clips[index + 1];
    const valid = next !== undefined && transition.to === next.id ? clampTransition(transition, clip.outPoint - clip.inPoint, next.outPoint - next.inPoint) : undefined;
    if (valid !== undefined && valid.duration === transition.duration) return clip;
    if (next !== undefined && transition.to === next.id && valid === undefined) removed = true;
    const rest = { ...clip, transition: undefined };
    return valid === undefined ? rest : { ...rest, transition: { ...valid, to: transition.to } };
  });
  if (clips.every((clip, index) => clip === state.clips[index]) && clips.length === state.clips.length) clips = state.clips;
  const total = studioDuration(clips);
  if (total > MAX_STUDIO_DURATION + STUDIO_TIME_TOLERANCE) return { ...state, message: "The timeline can be at most 180 seconds. Trim or remove a clip first." };
  const time = Math.min(state.playhead, total);
  return { ...state, clips, playing: false, playhead: time, seek: time, message: removed ? "Transition removed: clip too short" : null,
    overlays: clampOverlays ? state.overlays.map((overlay) => {
      const start = overlayStart(overlay.start, total, overlay.config.duration);
      return { ...overlay, start, clamped: overlay.clamped || start !== overlay.start };
    }) : state.overlays };
}
function clampClip(clip: StudioClip, media: StudioMedia[], aspect: Aspect): StudioClip {
  if (clip.mediaId === null || clip.settings.frameMode === "fit") return clip;
  const { centerX, centerY } = clipGeometry(mediaById(media, clip.mediaId).source, studioSize(aspect), clip.settings);
  return { ...clip, settings: { ...clip.settings, centerX, centerY } };
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
        if (!isValidTrim(clip.duration, cursor, cut.start)) throw new Error("Silence removal leaves a clip shorter than 0.2 seconds");
        clips.push({ ...clip, transition: undefined, id, inPoint: cursor, outPoint: cut.start });
      }
      cursor = cut.end;
      id = cut.newId;
    }
    if (cursor < clip.outPoint) {
      if (!isValidTrim(clip.duration, cursor, clip.outPoint)) throw new Error("Silence removal leaves a clip shorter than 0.2 seconds");
      clips.push(cuts.length === 0 ? clip : { ...clip, id, inPoint: cursor });
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
  const overlays = state.overlays.map((overlay) => {
    let index = state.clips.length - 1;
    while (index > 0 && starts[index] > overlay.start) index--;
    const original = state.clips[index];
    const sourceTime = original.inPoint + overlay.start - starts[index];
    const fragments = next.clips.flatMap((clip, index) => owners.get(clip.id) === original.id ? [{ clip, index }] : []);
    const following = fragments.find(({ clip }) => clip.outPoint > sourceTime);
    if (following !== undefined) return { ...overlay, start: nextStarts[following.index] + Math.max(0, sourceTime - following.clip.inPoint) };
    const last = fragments.at(-1);
    if (last !== undefined) return { ...overlay, start: nextStarts[last.index] + last.clip.outPoint - last.clip.inPoint + Math.max(0, sourceTime - original.outPoint) };
    const later = next.clips.findIndex((clip) => state.clips.findIndex((original) => original.id === owners.get(clip.id)) > index);
    return { ...overlay, start: later < 0 ? studioDuration(next.clips) : nextStarts[later] };
  });
  const selected = state.selection;
  const selection = selected !== null && selected.kind === "clip" && !clips.some((clip) => clip.id === selected.id) ? null : selected;
  return { ...next, selection, overlays };
}
function editCaptionSettings(state: StudioState, patch: Partial<CaptionSettings>) {
  if (state.captions !== null) return edited({ ...state, captions: { ...state.captions, ...patch } });
  return state.savedCaptionSettings === null ? state : edited({ ...state, savedCaptionSettings: { ...state.savedCaptionSettings, ...patch } });
}
function applyAction(state: StudioState, action: Exclude<StudioAction, { type: "undo" | "redo" }>): StudioState {
  switch (action.type) {
    case "remove-silences": return removeSilences(state, action.ranges);
    case "set-transcript": {
      if (!state.media.some((media) => media.id === action.mediaId)) return state;
      const captions: CaptionSettings = state.captions !== null ? state.captions : state.savedCaptionSettings !== null ? state.savedCaptionSettings : { style: "clean", position: "lower", size: "m" };
      return edited({ ...state, transcripts: { ...state.transcripts, [action.mediaId]: action.words }, captions, savedCaptionSettings: null });
    }
    case "edit-caption-line":
    case "delete-caption-line": {
      const words = state.transcripts[action.mediaId];
      if (words === undefined) throw new Error("Transcript is missing");
      return edited({ ...state, transcripts: { ...state.transcripts, [action.mediaId]: action.type === "edit-caption-line" ? replaceCaptionWords(words, action.wordIds, action.text) : words.filter((word) => !action.wordIds.includes(word.id)) } });
    }
    case "set-caption-style": return editCaptionSettings(state, { style: action.style });
    case "set-caption-position": return editCaptionSettings(state, { position: action.position });
    case "set-caption-size": return editCaptionSettings(state, { size: action.size });
    case "clear-captions": return edited({ ...state, captions: null, savedCaptionSettings: null, transcripts: {} });
    case "relink-clip": {
      const media = mediaById(state.media, action.mediaId);
      const placeholder = required(state.clips, action.id);
      if ((placeholder.kind === "photo") !== (media.kind === "photo")) return { ...state, message: `Relink this ${placeholder.kind === "photo" ? "photo with an image" : "video with a video"}.` };
      if (media.kind === "video" && media.source.duration < MIN_CLIP_DURATION) return { ...state, message: "A timeline clip must be at least 0.2 seconds." };
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
      if (media.kind === "video" && media.source.duration < MIN_CLIP_DURATION) return { ...state, message: "A timeline clip must be at least 0.2 seconds." };
      const clips = [...state.clips];
      clips.splice(action.index === undefined ? clips.length : action.index, 0, { id: action.id, mediaId: action.mediaId, label: media.source.file.name, kind: media.kind, duration: media.kind === "photo" ? 3 : media.source.duration, inPoint: 0, outPoint: media.kind === "photo" ? 3 : media.source.duration, settings: media.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, slowZoom: false } : { ...DEFAULT_CLIP_SETTINGS } });
      const next = edited(state, clips, true);
      if (next.clips === state.clips) return next;
      return { ...next, selection: { kind: "clip", id: action.id }, aspect: !state.aspectChosen && state.clips.length === 0 ? closestVideoAspect(media.source, STUDIO_FORMATS) : state.aspect };
    }
    case "set-transition": {
      const index = state.clips.findIndex((clip) => clip.id === action.id);
      if (index < 0 || index >= state.clips.length - 1) return state;
      const clip = state.clips[index];
      const transition = action.transition === null ? undefined : { ...action.transition, to: state.clips[index + 1].id };
      if (JSON.stringify(transition) === JSON.stringify(clip.transition)) return state;
      return edited(state, state.clips.map((item) => item.id === action.id ? { ...item, transition } : item), true);
    }
    case "move-clip": {
      const clip = required(state.clips, action.id);
      if (state.clips.indexOf(clip) === action.index) return state;
      const clips = state.clips.filter((item) => item.id !== action.id);
      clips.splice(Math.max(0, Math.min(action.index, clips.length)), 0, { ...clip, transition: undefined });
      return edited(state, clips, true);
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
    case "end-clip-edit": return { ...state, editGroup: null };
    case "trim-clip": {
      const clip = required(state.clips, action.id);
      if (action.inPoint === clip.inPoint && action.outPoint === clip.outPoint) return state;
      if (clip.kind === "photo") {
        const duration = action.outPoint - action.inPoint;
        if (!isPhotoDuration(duration)) return { ...state, message: "Keep photos between 0.5 and 30 seconds." };
        return edited(state, state.clips.map((item) => item.id === clip.id ? { ...clip, duration, inPoint: 0, outPoint: duration, sourceStart: clipSourceStart(clip) + action.inPoint } : item), true);
      }
      if (!isValidTrim(clip.duration, action.inPoint, action.outPoint)) {
        return { ...state, message: "Keep at least 0.2 seconds within the source clip." };
      }
      return edited(state, state.clips.map((clip) => clip.id === action.id ? { ...clip, inPoint: action.inPoint, outPoint: action.outPoint } : clip), true);
    }
    case "split-clip": {
      const clip = required(state.clips, action.id);
      const index = state.clips.indexOf(clip);
      const local = state.playhead - clipStarts(state.clips)[index];
      const cut = clip.inPoint + Math.round(local * 30) / 30;
      const minimum = clip.kind === "photo" ? MIN_PHOTO_DURATION : MIN_CLIP_DURATION;
      if (cut - clip.inPoint < minimum - STUDIO_TIME_TOLERANCE || clip.outPoint - cut < minimum - STUDIO_TIME_TOLERANCE) {
        return { ...state, message: `Place the playhead inside the selected clip, at least ${minimum} seconds from either edge.` };
      }
      const clips = [...state.clips];
      const sourceCut = clip.kind === "photo" ? clipSourceStart(clip) + cut : cut;
      const leftPunchIns = clip.punchIns === undefined ? undefined : clip.punchIns.filter((item) => item.start < sourceCut);
      const rightPunchIns = clip.punchIns === undefined ? undefined : clip.punchIns.filter((item) => item.start >= sourceCut);
      clips.splice(index, 1, ...(clip.kind === "photo"
        ? [{ ...clip, punchIns: leftPunchIns, transition: undefined, duration: cut, outPoint: cut }, { ...clip, punchIns: rightPunchIns, sourceStart: sourceCut, id: action.newId, duration: clip.outPoint - cut, inPoint: 0, outPoint: clip.outPoint - cut }]
        : [{ ...clip, punchIns: leftPunchIns, transition: undefined, outPoint: cut }, { ...clip, punchIns: rightPunchIns, id: action.newId, inPoint: cut }]));
      return edited(state, clips, true);
    }
    case "toggle-snap": return { ...state, snapping: !state.snapping };
    case "set-playing": return state.clips.length === 0 || state.clips.some((clip) => clip.mediaId === null) ? state : { ...state, playing: action.playing, seek: state.playhead };
    case "remove-clip": return edited({ ...state, selection: null }, state.clips.filter((clip) => clip.id !== action.id), true);
    case "add-overlay": return edited({ ...state, selection: { kind: "overlay", id: action.id }, overlays: [...state.overlays, {
      id: action.id, preset: action.preset, family: action.family, config: overlayConfig(action.family, action.preset.href),
      start: overlayStart(action.start, studioDuration(state.clips), action.preset.duration), clamped: false,
    }] });
    case "edit-overlay": {
      const overlay = required(state.overlays, action.id);
      if (JSON.stringify(overlay.config) === JSON.stringify(action.config)) return state;
      return { ...state, message: null, overlays: state.overlays.map((item) => item.id === action.id ? { ...item, config: action.config } : item) };
    }
    case "end-overlay-edit": return { ...state, editGroup: null };
    case "move-overlay": {
      const overlay = required(state.overlays, action.id);
      const start = overlayStart(action.start, studioDuration(state.clips), overlay.config.duration);
      if (start === overlay.start && !overlay.clamped) return state;
      return edited({ ...state, overlays: state.overlays.map((item) => item.id === action.id ? { ...item, start, clamped: false } : item) });
    }
    case "remove-overlay": return edited({ ...state, selection: null, overlays: state.overlays.filter((overlay) => overlay.id !== action.id) });
    case "set-aspect": return edited({ ...state, aspect: action.aspect, aspectChosen: true }, state.clips.map((clip) => clampClip(clip, state.media, action.aspect)));
    case "select": return { ...state, selection: action.selection };
    case "seek": {
      const time = Math.max(0, Math.min(action.time, studioDuration(state.clips)));
      return { ...state, playhead: time, seek: time };
    }
    case "time": return { ...state, playhead: action.time };
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
  const { media, clips, overlays, aspect, aspectChosen, selection, transcripts, captions, savedCaptionSettings } = state;
  return { media, clips, overlays, aspect, aspectChosen, selection, transcripts, captions, savedCaptionSettings };
}
export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  if (action.type === "undo" || action.type === "redo") {
    const source = action.type === "undo" ? state.past : state.future;
    const snapshot = source.at(-1);
    if (snapshot === undefined) return state;
    const document = { ...snapshot, media: action.media === undefined ? snapshot.media : action.media };
    return edited({ ...state, ...document,
      editGroup: null,
      past: action.type === "undo" ? state.past.slice(0, -1) : [...state.past, documentOf(state)],
      future: action.type === "redo" ? state.future.slice(0, -1) : [...state.future, documentOf(state)],
    });
  }
  const next = applyAction(state, action);
  if (action.type === "open-project") return next;
  if (next.media === state.media && next.clips === state.clips && next.overlays === state.overlays && next.aspect === state.aspect && next.aspectChosen === state.aspectChosen && next.transcripts === state.transcripts && next.captions === state.captions && next.savedCaptionSettings === state.savedCaptionSettings) return next;
  const group = (action.type === "edit-overlay" || action.type === "edit-clip" || action.type === "set-transition" || action.type === "edit-punch-ins") && action.group !== undefined ? `${action.id}/${action.group}` : null;
  return { ...next, editGroup: group,
    past: group !== null && group === state.editGroup ? state.past : [...state.past.slice(-59), documentOf(state)], future: [] };
}

export function projectOf(state: StudioState, name: string): StudioProject {
  const captions = state.savedCaptionSettings !== null ? state.savedCaptionSettings
    : state.captions !== null && timelineWords(state.clips, state.transcripts).length > 0 ? state.captions : null;
  return { name, aspect: state.aspect,
    ...(captions === null ? {} : { captions: { style: captions.style, position: captions.position, size: captions.size } }),
    transitions: state.clips.flatMap((clip, cut) => clip.transition === undefined ? [] : [{ cut, type: clip.transition.type, duration: clip.transition.duration }]),
    clips: state.clips.map(({ label, kind, duration, inPoint, outPoint, settings, punchIns, sourceStart }) => kind === "photo"
      ? { label, kind, duration: outPoint - inPoint, ...(sourceStart === undefined || sourceStart === 0 ? {} : { sourceStart }), ...(punchIns === undefined || punchIns.length === 0 ? {} : { punchIns }), settings: { frameMode: settings.frameMode, centerX: settings.centerX, centerY: settings.centerY, zoom: settings.zoom, slowZoom: settings.slowZoom === true } }
      : { label, kind: "video", duration, inPoint, outPoint, settings, ...(punchIns === undefined || punchIns.length === 0 ? {} : { punchIns }) }),
    overlays: state.overlays.map(({ preset, family, config, start }) => ({ family: preset.family, preset: preset.id, start,
      configuration: editorHref(family.id, configOptions(family, family.looks, config)) })) };
}

export function documentFromProject(project: StudioProject, presets: CatalogItem[], families: StudioFamily[]): Pick<StudioDocument, "clips" | "overlays" | "aspect" | "savedCaptionSettings"> {
  const ids = project.clips.map(() => crypto.randomUUID());
  return { aspect: project.aspect,
    savedCaptionSettings: project.captions === undefined ? null : project.captions,
    clips: project.clips.map((clip, index) => {
      const transition = project.transitions === undefined ? undefined : project.transitions.find((transition) => transition.cut === index);
      const source = clip.kind === "photo" ? { ...clip, inPoint: 0, outPoint: clip.duration } : clip;
      return { ...source, settings: clip.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, ...clip.settings } : clip.settings, id: ids[index], mediaId: null, transition: transition === undefined ? undefined : { type: transition.type, duration: transition.duration, to: ids[index + 1] } };
    }),
    overlays: project.overlays.map((overlay) => {
      const preset = presets.find((item) => item.family === overlay.family && item.id === overlay.preset);
      if (preset === undefined) throw new Error("Saved overlay is no longer listed");
      const family = families.find((item) => item.id === preset.family);
      if (family === undefined) throw new Error("Saved overlay family is unavailable");
      const config = overlayConfig(family, overlay.configuration);
      return { id: crypto.randomUUID(), preset, family, config, start: overlay.start, clamped: false };
    }) };
}
