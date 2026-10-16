// generated from the Modisign monorepo, do not edit
export type VideoTrack = "v1" | "v2";
export type TrackPlacement = { track: "v1" } | { track: "v2"; start: number };
export type ClipTransition = { type: "crossfade" | "dip"; duration: number };
export const STUDIO_TIME_TOLERANCE = 1e-6;
export const TIMELINE_BOUNDARY_TOLERANCE = 1e-6 / 30;
export type SequenceClip = { duration: number; transition?: ClipTransition };
export type ScheduledClip = SequenceClip & TrackPlacement;

export function clampTransition(transition: ClipTransition, outgoing: number, incoming: number): ClipTransition | undefined {
  const limit = (transition.type === "crossfade" ? 0.45 : 2) * Math.min(outgoing, incoming);
  const duration = Math.min(transition.duration, 1, limit);
  return duration < 0.2 - STUDIO_TIME_TOLERANCE ? undefined : { type: transition.type, duration };
}
export function sequenceStarts(clips: readonly SequenceClip[]) {
  let at = 0;
  return clips.map((clip, index) => {
    const start = at;
    const next = clips[index + 1];
    const transition = next === undefined || clip.transition === undefined ? undefined : clampTransition(clip.transition, clip.duration, next.duration);
    at += clip.duration - (transition !== undefined && transition.type === "crossfade" ? transition.duration : 0);
    return start;
  });
}
export function sequenceDuration(clips: readonly SequenceClip[]) {
  return clips.length === 0 ? 0 : sequenceStarts(clips)[clips.length - 1] + clips[clips.length - 1].duration;
}
export function clipSchedule(clips: readonly ScheduledClip[]) {
  const starts = sequenceStarts(clips.filter((clip) => clip.track === "v1"));
  let index = 0;
  return clips.map((clip) => clip.track === "v1" ? starts[index++] : clip.start);
}
export function scheduleDuration(clips: readonly ScheduledClip[]) {
  const starts = clipSchedule(clips);
  return clips.reduce((end, clip, index) => Math.max(end, starts[index] + clip.duration), 0);
}
export function validTrackSchedule(clips: readonly ScheduledClip[]) {
  let end = 0;
  let v2 = false;
  for (const clip of clips) {
    if (clip.track === "v1") {
      if (v2 || Object.hasOwn(clip, "start")) return false;
    } else {
      v2 = true;
      if (clip.transition !== undefined || !Number.isFinite(clip.start) || clip.start < 0 || clip.start < end - TIMELINE_BOUNDARY_TOLERANCE) return false;
      end = clip.start + clip.duration;
    }
  }
  return true;
}

const TEMPLATE_HREF = /^\/overlays\/[a-z0-9]+(?:-[a-z0-9]+)*\?(?:[A-Za-z0-9!$&'()*+,./:;=?@_~-]|%[0-9a-fA-F]{2})+$/;

export function isTemplateHref(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2000 && TEMPLATE_HREF.test(value);
}

export const STUDIO_ASPECTS = ["9x16", "4x5", "1x1", "16x9"] as const;
export const MAX_STUDIO_DURATION = 180;
export const MAX_STUDIO_CLIPS = 300;
export const MAX_STUDIO_PROJECT_BYTES = 64 * 1024;
export const MIN_CLIP_DURATION = 0.2;
export const MIN_PHOTO_DURATION = 0.5;
export const MAX_PHOTO_DURATION = 30;
export const CAPTION_STYLE_IDS = ["clean", "boxed", "minimal", "karaoke", "bold-keyword", "word-pop", "highlight-box", "neon", "pop-up", "typewriter", "outline", "editorial", "gradient"] as const;
export type CaptionStyleId = typeof CAPTION_STYLE_IDS[number];
export type CaptionPlacement = { position: "upper" | "center" | "lower"; size: "s" | "m" | "l" };
export type CaptionSettings = CaptionPlacement & { style: CaptionStyleId };
export type ClipSettings = {
  frameMode: "fill" | "fit";
  centerX: number; centerY: number; zoom: number;
  volume: number; muted: boolean; fadeIn: number; fadeOut: number;
  slowZoom?: boolean;
};
export const DEFAULT_CLIP_SETTINGS: Readonly<ClipSettings> = {
  frameMode: "fill", centerX: 0.5, centerY: 0.5, zoom: 1,
  volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
};
export type PhotoSettings = Pick<ClipSettings, "frameMode" | "centerX" | "centerY" | "zoom"> & { slowZoom: boolean };
export type PunchIn = { start: number; length: number; zoom: 1.1 | 1.25 | 1.4 };
export const MAX_PUNCH_INS = 50;
export type Crop = { top: number; right: number; bottom: number; left: number };
export const PLACE_MODES = ["full", "top", "bottom", "left", "right", "pip-top-left", "pip-top-right", "pip-bottom-left", "pip-bottom-right"] as const;
export type Place = { mode: typeof PLACE_MODES[number] } | { mode: "custom"; x: number; y: number; width: number; height: number };
export type ClipSpatial = { crop: Crop; place: Place };
export function defaultSpatial(): ClipSpatial {
  return { crop: { top: 0, right: 0, bottom: 0, left: 0 }, place: { mode: "full" } };
}
export function isCrop(value: unknown): value is Crop {
  return record(value, ["top", "right", "bottom", "left"])
    && range(value.top, 0, 95) && range(value.right, 0, 95) && range(value.bottom, 0, 95) && range(value.left, 0, 95)
    && value.left + value.right <= 95 && value.top + value.bottom <= 95;
}
export function isPlace(value: unknown): value is Place {
  if (typeof value !== "object" || value === null || !("mode" in value)) return false;
  if (value.mode !== "custom") return record(value, ["mode"]) && PLACE_MODES.some((mode) => mode === value.mode);
  if (!record(value, ["mode", "x", "y", "width", "height"])) return false;
  return range(value.x, 0, 1) && range(value.y, 0, 1) && range(value.width, 0.05, 1) && range(value.height, 0.05, 1)
    && value.x + value.width <= 1 + STUDIO_TIME_TOLERANCE && value.y + value.height <= 1 + STUDIO_TIME_TOLERANCE;
}
export type ProjectClip = (
  | { label: string; kind: "video"; duration: number; inPoint: number; outPoint: number; settings: ClipSettings; punchIns?: PunchIn[] }
  | { label: string; kind: "photo"; duration: number; settings: PhotoSettings; sourceStart?: number; punchIns?: PunchIn[] }
) & { crop?: Crop; place?: Place } & ({ track?: never; start?: never } | { track: "v2"; start: number });
export function projectClipDuration(clip: ProjectClip) {
  return clip.kind === "photo" ? clip.duration : clip.outPoint - clip.inPoint;
}
export function projectTrack(clip: ProjectClip): TrackPlacement {
  return clip.track === undefined ? { track: "v1" } : { track: "v2", start: clip.start };
}
export function projectSpatial(clip: ProjectClip): ClipSpatial {
  const defaults = defaultSpatial();
  return { crop: clip.crop === undefined ? defaults.crop : clip.crop, place: clip.place === undefined ? defaults.place : clip.place };
}
export function projectSchedule(project: Pick<StudioProject, "clips" | "transitions">) {
  let cut = 0;
  return project.clips.map((clip) => {
    const transition = clip.track === "v2" || project.transitions === undefined ? undefined : project.transitions.find((transition) => transition.cut === cut);
    if (clip.track === undefined) cut++;
    return { ...projectTrack(clip), duration: projectClipDuration(clip), transition };
  });
}
export function projectDuration(project: Pick<StudioProject, "clips" | "transitions">) {
  return scheduleDuration(projectSchedule(project));
}
export type StudioProject = {
  name: string;
  aspect: typeof STUDIO_ASPECTS[number];
  clips: ProjectClip[];
  transitions?: (ClipTransition & { cut: number })[];
  captions?: CaptionSettings;
  overlays: { family: string; preset: string; start: number; configuration: string }[];
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  aspect: StudioProject["aspect"];
  clipCount: number;
  duration: number;
  updated_at: string;
};

function record<K extends string>(value: unknown, keys: K[]): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() !== ""
    && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_STUDIO_DURATION;
}

function range(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
export function isCaptionSettings(value: unknown): value is CaptionSettings {
  return record(value, ["style", "position", "size"])
    && CAPTION_STYLE_IDS.some((style) => style === value.style)
    && (value.position === "upper" || value.position === "center" || value.position === "lower")
    && (value.size === "s" || value.size === "m" || value.size === "l");
}
export function isClipSettings(value: unknown): value is ClipSettings {
  return record(value, ["frameMode", "centerX", "centerY", "zoom", "volume", "muted", "fadeIn", "fadeOut"])
    && (value.frameMode === "fill" || value.frameMode === "fit")
    && range(value.centerX, 0, 1) && range(value.centerY, 0, 1) && range(value.zoom, 1, 3)
    && range(value.volume, 0, 2) && typeof value.muted === "boolean"
    && range(value.fadeIn, 0, 2) && range(value.fadeOut, 0, 2);
}

export function isPhotoDuration(value: unknown): value is number {
  return range(value, MIN_PHOTO_DURATION - STUDIO_TIME_TOLERANCE, MAX_PHOTO_DURATION + STUDIO_TIME_TOLERANCE);
}
function isPhotoSettings(value: unknown): value is PhotoSettings {
  return record(value, ["frameMode", "centerX", "centerY", "zoom", "slowZoom"])
    && (value.frameMode === "fill" || value.frameMode === "fit") && range(value.centerX, 0, 1)
    && range(value.centerY, 0, 1) && range(value.zoom, 1, 3) && typeof value.slowZoom === "boolean";
}

export function isPunchIns(value: unknown, minStart = -Number.MAX_SAFE_INTEGER, maxStart = Number.MAX_SAFE_INTEGER): value is PunchIn[] {
  if (!Array.isArray(value) || value.length > MAX_PUNCH_INS) return false;
  if (!value.every((item) => record(item, ["start", "length", "zoom"])
    && range(item.start, minStart, maxStart) && range(item.length, 0.5 - STUDIO_TIME_TOLERANCE, 4 + STUDIO_TIME_TOLERANCE)
    && Math.abs(item.length * 10 - Math.round(item.length * 10)) < STUDIO_TIME_TOLERANCE
    && (item.zoom === 1.1 || item.zoom === 1.25 || item.zoom === 1.4))) return false;
  const sorted = [...value].sort((a, b) => a.start - b.start);
  return sorted.every((item, index) => index === 0 || item.start >= sorted[index - 1].start + sorted[index - 1].length - STUDIO_TIME_TOLERANCE);
}

export function isValidTrim(duration: number, inPoint: number, outPoint: number) {
  return Number.isFinite(inPoint) && Number.isFinite(outPoint) && inPoint >= 0
    && outPoint <= duration && outPoint - inPoint >= MIN_CLIP_DURATION - STUDIO_TIME_TOLERANCE;
}

// The API supplies its startup catalog; the browser supplies the catalog loaded for Studio.
export function isStudioProject(value: unknown, presets: ReadonlySet<string>): value is StudioProject {
  if (typeof value !== "object" || value === null) return false;
  const keys = ["name", "aspect", "clips", "overlays"];
  if (Object.hasOwn(value, "transitions")) keys.push("transitions");
  if (Object.hasOwn(value, "captions")) keys.push("captions");
  if (!record(value, keys) || !text(value.name, 80)
    || !STUDIO_ASPECTS.some((aspect) => aspect === value.aspect)
    || !Array.isArray(value.clips) || value.clips.length > MAX_STUDIO_CLIPS
    || !Array.isArray(value.overlays) || value.overlays.length > 100) return false;
  if (Object.hasOwn(value, "captions") && !isCaptionSettings(value.captions)) return false;
  const v1: ProjectClip[] = [];
  for (const clip of value.clips) {
    if (typeof clip !== "object" || clip === null || !text(clip.label, 255)) return false;
    const spatialKeys: string[] = [];
    if (Object.hasOwn(clip, "crop")) { if (!isCrop(clip.crop)) return false; spatialKeys.push("crop"); }
    if (Object.hasOwn(clip, "place")) { if (!isPlace(clip.place)) return false; spatialKeys.push("place"); }
    if (Object.hasOwn(clip, "track")) {
      if (clip.track !== "v2" || !number(clip.start)) return false;
      spatialKeys.push("track", "start");
    } else { if (Object.hasOwn(clip, "start")) return false; v1.push(clip); }
    if (clip.kind === "photo") {
      if (Object.hasOwn(clip, "punchIns") && !isPunchIns(clip.punchIns)) return false;
      const keys = ["label", "kind", "duration", "settings", ...spatialKeys];
      if (Object.hasOwn(clip, "punchIns")) keys.push("punchIns");
      if (Object.hasOwn(clip, "sourceStart")) {
        if (!range(clip.sourceStart, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) return false;
        keys.push("sourceStart");
      }
      if (!record(clip, keys) || !isPhotoDuration(clip.duration) || !isPhotoSettings(clip.settings)) return false;
    } else {
      const keys = ["label", "kind", "duration", "inPoint", "outPoint", "settings", ...spatialKeys];
      if (clip.kind !== "video" || !isClipSettings(clip.settings)) return false;
      if (Object.hasOwn(clip, "punchIns")) keys.push("punchIns");
      if (!record(clip, keys) || !number(clip.duration) || clip.duration < MIN_CLIP_DURATION
        || !number(clip.inPoint) || !number(clip.outPoint) || !isValidTrim(clip.duration, clip.inPoint, clip.outPoint)) return false;
      if (Object.hasOwn(clip, "punchIns") && !isPunchIns(clip.punchIns, 0, MAX_STUDIO_DURATION)) return false;
    }
  }
  if (Object.hasOwn(value, "transitions")) {
    if (!Array.isArray(value.transitions)) return false;
    const cuts = new Set<number>();
    for (const transition of value.transitions) {
      if (!record(transition, ["cut", "type", "duration"]) || typeof transition.cut !== "number"
        || !Number.isInteger(transition.cut) || transition.cut < 0 || transition.cut >= v1.length - 1
        || cuts.has(transition.cut) || (transition.type !== "crossfade" && transition.type !== "dip")
        || !range(transition.duration, 0.2 - STUDIO_TIME_TOLERANCE, 1)) return false;
      const valid = clampTransition({ type: transition.type, duration: transition.duration }, projectClipDuration(v1[transition.cut]), projectClipDuration(v1[transition.cut + 1]));
      if (valid === undefined || valid.duration < transition.duration - STUDIO_TIME_TOLERANCE) return false;
      cuts.add(transition.cut);
    }
  }
  const project = value as StudioProject;
  if (!validTrackSchedule(projectSchedule(project))) return false;
  const total = projectDuration(project);
  if (total > MAX_STUDIO_DURATION + STUDIO_TIME_TOLERANCE) return false;
  for (const overlay of value.overlays) {
    if (!record(overlay, ["family", "preset", "start", "configuration"])
      || !text(overlay.family, 100) || !text(overlay.preset, 100)
      || !presets.has(`${overlay.family}/${overlay.preset}`) || !number(overlay.start)
      || (total === 0 ? overlay.start !== 0 : overlay.start >= total)) return false;
    if (!isTemplateHref(overlay.configuration)
      || !overlay.configuration.startsWith(`/overlays/${overlay.family}?`)) return false;
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_STUDIO_PROJECT_BYTES;
}

