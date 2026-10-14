// generated from the Modisign monorepo, do not edit
const TEMPLATE_HREF = /^\/overlays\/[a-z0-9]+(?:-[a-z0-9]+)*\?(?:[A-Za-z0-9!$&'()*+,./:;=?@_~-]|%[0-9a-fA-F]{2})+$/;

export function isTemplateHref(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2000 && TEMPLATE_HREF.test(value);
}

export const STUDIO_ASPECTS = ["9x16", "4x5", "1x1", "16x9"] as const;
export const MAX_STUDIO_DURATION = 180;
export const MAX_STUDIO_CLIPS = 300;
export const MIN_CLIP_DURATION = 0.2;
export const MIN_PHOTO_DURATION = 0.5;
export const MAX_PHOTO_DURATION = 30;
export const STUDIO_TIME_TOLERANCE = 1e-6;
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
export type ProjectClip =
  | { label: string; kind: "video"; duration: number; inPoint: number; outPoint: number; settings: ClipSettings; punchIns?: PunchIn[] }
  | { label: string; kind: "photo"; duration: number; settings: PhotoSettings; sourceStart?: number; punchIns?: PunchIn[] };
export function projectClipDuration(clip: ProjectClip) {
  return clip.kind === "photo" ? clip.duration : clip.outPoint - clip.inPoint;
}
export type ClipTransition = { type: "crossfade" | "dip"; duration: number };
export function clampTransition(transition: ClipTransition, outgoing: number, incoming: number): ClipTransition | undefined {
  const limit = (transition.type === "crossfade" ? 0.45 : 2) * Math.min(outgoing, incoming);
  const duration = Math.min(transition.duration, 1, limit);
  return duration < 0.2 - STUDIO_TIME_TOLERANCE ? undefined : { type: transition.type, duration };
}
export function projectDuration(project: Pick<StudioProject, "clips" | "transitions">) {
  const total = project.clips.reduce((sum, clip) => sum + projectClipDuration(clip), 0);
  return project.transitions === undefined ? total : total - project.transitions.reduce((sum, transition) => sum + (transition.type === "crossfade" ? transition.duration : 0), 0);
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

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
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
  let total = 0;
  for (const clip of value.clips) {
    if (typeof clip !== "object" || clip === null || !text(clip.label, 255)) return false;
    if (clip.kind === "photo") {
      if (Object.hasOwn(clip, "punchIns") && !isPunchIns(clip.punchIns)) return false;
      const keys = ["label", "kind", "duration", "settings"];
      if (Object.hasOwn(clip, "punchIns")) keys.push("punchIns");
      if (Object.hasOwn(clip, "sourceStart")) {
        if (!range(clip.sourceStart, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) return false;
        keys.push("sourceStart");
      }
      if (!record(clip, keys) || !isPhotoDuration(clip.duration) || !isPhotoSettings(clip.settings)) return false;
      total += clip.duration;
    } else {
      const keys = ["label", "kind", "duration", "inPoint", "outPoint", "settings"];
      if (clip.kind !== "video" || !isClipSettings(clip.settings)) return false;
      if (Object.hasOwn(clip, "punchIns")) keys.push("punchIns");
      if (!record(clip, keys) || !number(clip.duration) || clip.duration < MIN_CLIP_DURATION
        || !number(clip.inPoint) || !number(clip.outPoint) || !isValidTrim(clip.duration, clip.inPoint, clip.outPoint)) return false;
      if (Object.hasOwn(clip, "punchIns") && !isPunchIns(clip.punchIns, 0, MAX_STUDIO_DURATION)) return false;
      total += clip.outPoint - clip.inPoint;
    }
  }
  if (Object.hasOwn(value, "transitions")) {
    if (!Array.isArray(value.transitions)) return false;
    const cuts = new Set<number>();
    for (const transition of value.transitions) {
      if (!record(transition, ["cut", "type", "duration"]) || typeof transition.cut !== "number"
        || !Number.isInteger(transition.cut) || transition.cut < 0 || transition.cut >= value.clips.length - 1
        || cuts.has(transition.cut) || (transition.type !== "crossfade" && transition.type !== "dip")
        || !range(transition.duration, 0.2 - STUDIO_TIME_TOLERANCE, 1)) return false;
      const valid = clampTransition({ type: transition.type, duration: transition.duration }, projectClipDuration(value.clips[transition.cut]), projectClipDuration(value.clips[transition.cut + 1]));
      if (valid === undefined || valid.duration < transition.duration - STUDIO_TIME_TOLERANCE) return false;
      cuts.add(transition.cut);
      if (transition.type === "crossfade") total -= transition.duration;
    }
  }
  if (total > MAX_STUDIO_DURATION + STUDIO_TIME_TOLERANCE) return false;
  for (const overlay of value.overlays) {
    if (!record(overlay, ["family", "preset", "start", "configuration"])
      || !text(overlay.family, 100) || !text(overlay.preset, 100)
      || !presets.has(`${overlay.family}/${overlay.preset}`) || !number(overlay.start)
      || (total === 0 ? overlay.start !== 0 : overlay.start >= total)) return false;
    if (!isTemplateHref(overlay.configuration)
      || !overlay.configuration.startsWith(`/overlays/${overlay.family}?`)) return false;
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= 65536;
}

