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
// Three frames at the 30 fps Studio rate: the shortest visible cut of a clip or a photo.
export const MIN_CLIP_DURATION = 3 / 30;
export const MIN_PHOTO_DURATION = MIN_CLIP_DURATION;
export const MIN_CLIP_LABEL = "3 frames (0.1 seconds)";
export const MAX_PHOTO_DURATION = 30;
// Real bundled caption faces (variable OFL files); a weight or italic outside this table has no face to draw.
export const CAPTION_FONTS = {
  sans: { family: "Montserrat", weights: [500, 700, 800, 900], defaultWeight: 800, italic: false },
  serif: { family: "Lora", weights: [400, 600, 700], defaultWeight: 600, italic: true },
  mono: { family: "Roboto Mono", weights: [400, 500, 700], defaultWeight: 500, italic: false },
} as const;
export type CaptionFont = keyof typeof CAPTION_FONTS;
export const CAPTION_FONT_IDS = Object.keys(CAPTION_FONTS) as CaptionFont[];
export const TRACKING_RANGE = { min: -0.08, max: 0.3 } as const;
export const LEADING_RANGE = { min: 1, max: 2 } as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Sparse per-word overrides. A weight or italic belongs to a face, so both require the font they refer to.
export type WordAppearance = {
  font?: CaptionFont; weight?: number; italic?: boolean; fill?: string;
  tracking?: number; leading?: number; underline?: boolean; highlight?: string | false;
};
const APPEARANCE_KEYS = ["font", "weight", "italic", "fill", "tracking", "leading", "underline", "highlight"];

export function isCaptionColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}
export function isCaptionFace(font: unknown, weight: unknown, italic: unknown) {
  if (typeof font !== "string" || !CAPTION_FONT_IDS.some((id) => id === font)) return false;
  const face = CAPTION_FONTS[font as CaptionFont];
  return (weight === undefined || (face.weights as readonly unknown[]).includes(weight)) && (italic === undefined || italic === false || (italic === true && face.italic));
}
export function isWordAppearance(value: unknown): value is WordAppearance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !APPEARANCE_KEYS.includes(key))) return false;
  const { font, weight, italic, fill, tracking, leading, underline, highlight } = value as Record<string, unknown>;
  if (font === undefined ? weight !== undefined || italic !== undefined : !isCaptionFace(font, weight, italic)) return false;
  return (!keys.includes("fill") || isCaptionColor(fill))
    && (!keys.includes("highlight") || highlight === false || isCaptionColor(highlight))
    && (!keys.includes("tracking") || range(tracking, TRACKING_RANGE.min, TRACKING_RANGE.max))
    && (!keys.includes("leading") || range(leading, LEADING_RANGE.min, LEADING_RANGE.max))
    && (!keys.includes("underline") || typeof underline === "boolean");
}

// A false underline or highlight only switches off something a style may not have; every other field changes the output.
export function isEffectiveAppearance(appearance: WordAppearance) {
  return Object.values(appearance).some((value) => value !== false);
}

export const CAPTION_MIX_PRESETS = ["creator", "editorial"] as const;
export const MIX_PALETTE_SIZE = { min: 2, max: 4 } as const;
// Per-word looks come from a pure hash of the seed and the source word id.
export type CaptionMix = { preset: typeof CAPTION_MIX_PRESETS[number]; seed: number; palette: string[] };
export function isCaptionMix(value: unknown): value is CaptionMix {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return false;
  const { preset, seed, palette } = value as Record<string, unknown>;
  return CAPTION_MIX_PRESETS.some((id) => id === preset)
    && typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
    && Array.isArray(palette) && palette.length >= MIX_PALETTE_SIZE.min && palette.length <= MIX_PALETTE_SIZE.max && palette.every(isCaptionColor);
}
export const CAPTION_STYLE_IDS = ["clean", "boxed", "minimal", "karaoke", "bold-keyword", "word-pop", "highlight-box", "neon", "pop-up", "typewriter", "outline", "editorial", "gradient", "mixed"] as const;
export type CaptionStyleId = typeof CAPTION_STYLE_IDS[number];
export type CaptionPlacement = { position: "upper" | "center" | "lower"; size: "s" | "m" | "l" };
export const MAX_STUDIO_TEXTS = 100;
export const MAX_TEXT_LENGTH = 120;
// Fractions of the output's shorter side, so a title is as tall in 16:9 as in 9:16; the renderer wraps within 86% of the width.
export const TEXT_SIZES = { s: 0.05, m: 0.07, l: 0.1, xl: 0.14 } as const;
export const TEXT_TIMESTAMPS = ["source", "timeline"] as const;
// A timestamp is a formatted mm:ss line drawn above the text; it never feeds timing.
export type TextLabel = { text: string; timestamp?: typeof TEXT_TIMESTAMPS[number] };
export type TextStyle = { font: CaptionFont; weight: number; italic: boolean; fill: string; size: keyof typeof TEXT_SIZES; x: number; y: number; backing: boolean };
export const DEFAULT_TEXT_STYLE: Readonly<TextStyle> = { font: "sans", weight: 800, italic: false, fill: "#ffffff", size: "m", x: 0.5, y: 0.5, backing: false };
// A saved title shows for its clip's whole span (`clip`, an index into the saved clips) or for an explicit post-overlap interval.
export type ProjectText = TextLabel & TextStyle & ({ clip: number; start?: never; duration?: never } | { clip?: never; start: number; duration: number })
  & { motion?: LayerMotion; reveal?: TitleReveal; occlusion?: TitleOcclusion; animationOffset?: number };
// Phrase grouping and the Scatter recipe are saved preferences; phrase membership, line geometry and per-line styles are local to the tab.
export type CaptionSettings = CaptionPlacement & { style: CaptionStyleId; mix?: CaptionMix; grouping?: CaptionGrouping; scatter?: CaptionScatter };
// Words per phrase, characters per phrase, phrase seconds and the pause that ends one; the defaults are the historical grouping.
export type CaptionGrouping = { maxWords: number; maxCharacters: number; maxDuration: number; pause: number };
export const GROUPING_LIMITS = { maxWords: { min: 1, max: 12 }, maxCharacters: { min: 8, max: 60 }, maxDuration: { min: 0.5, max: 30 }, pause: { min: 0.1, max: 2 } } as const;
export const DEFAULT_GROUPING: Readonly<CaptionGrouping> = { maxWords: 7, maxCharacters: 32, maxDuration: 30, pause: 0.6 };
export const SCATTER_GROUPING: Readonly<CaptionGrouping> = { maxWords: 4, maxCharacters: 24, maxDuration: 1.8, pause: 0.35 };
export const SCATTER_SAFE_ZONES = ["social", "frame"] as const;
export const SCATTER_INTENSITIES = ["subtle", "normal"] as const;
export type CaptionScatter = { seed: number; safeZone: typeof SCATTER_SAFE_ZONES[number]; intensity: typeof SCATTER_INTENSITIES[number]; styles: CaptionStyleId[] };
// Per-line geometry: block centre as output fractions, nominal font height as a fraction of the shorter output side, clockwise degrees.
export const LINE_SIZE = { min: 0.02, max: 0.14 } as const;
export const LINE_ROTATION = { min: -30, max: 30 } as const;
// Sparse overrides of one phrase; absent fields inherit. A style other than Mixed carries no mix, and Mixed carries its own.
export type CaptionLineOverride = { x?: number; y?: number; size?: number; rotation?: number; style?: CaptionStyleId; mix?: CaptionMix };
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

export const MOTION_CHANNELS = ["x", "y", "scale", "rotation", "opacity"] as const;
export type MotionChannel = typeof MOTION_CHANNELS[number];
export const MOTION_EASINGS = ["hold", "linear", "ease-in", "ease-out", "ease-in-out"] as const;
export type MotionEasing = typeof MOTION_EASINGS[number] | [number, number, number, number];
// `at` is source seconds for footage, local seconds for titles and catalog overlays.
export type MotionKey = { at: number; value: number; easing: MotionEasing };
export type LayerMotion = { [channel in MotionChannel]?: MotionKey[] };
// x/y are fractions of the output width/height, scale a uniform multiplier, rotation unwrapped clockwise degrees.
export const MOTION_RANGES: Readonly<Record<MotionChannel, { min: number; max: number }>> = {
  x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, scale: { min: 0.1, max: 5 }, rotation: { min: -3600, max: 3600 }, opacity: { min: 0, max: 1 },
};
export const MOTION_IDENTITY: Readonly<Record<MotionChannel, number>> = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
export const MAX_MOTION_CHANNEL_KEYS = 60;
export const MAX_MOTION_KEYS = 1000;
// Key times of video clips, titles and catalog overlays; photos keep their signed virtual source clock.
export const MOTION_TIME = { min: 0, max: MAX_STUDIO_DURATION } as const;
export const PHOTO_MOTION_TIME = { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER } as const;
// The easing of the segment that starts at a key; the four numbers are a CSS-style cubic Bezier (x1, y1, x2, y2), all within 0..1.
export function isMotionEasing(value: unknown): value is MotionEasing {
  if (typeof value === "string") return MOTION_EASINGS.some((easing) => easing === value);
  return Array.isArray(value) && value.length === 4 && value.every((item) => range(item, 0, 1));
}
// The reason a motion cannot exist, naming the channel and row, or null.
export function motionProblem(value: unknown, time: { min: number; max: number }): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "Motion must be an object of channels.";
  const channels = Object.keys(value);
  if (channels.length === 0) return "Motion needs at least one channel.";
  for (const channel of channels) {
    if (!MOTION_CHANNELS.some((known) => known === channel)) return `Motion has no ${channel} channel. Use ${MOTION_CHANNELS.join(", ")}.`;
    const keys: unknown = (value as Record<string, unknown>)[channel];
    if (!Array.isArray(keys) || keys.length === 0) return `Motion ${channel} needs at least one key.`;
    if (keys.length > MAX_MOTION_CHANNEL_KEYS) return `Motion ${channel} has at most ${MAX_MOTION_CHANNEL_KEYS} keys.`;
    const { min, max } = MOTION_RANGES[channel as MotionChannel];
    for (const [index, key] of keys.entries()) {
      const at = `Motion ${channel}[${index}]`;
      if (!record(key, ["at", "value", "easing"])) return `${at} needs exactly at, value and easing.`;
      if (!range(key.at, time.min, time.max)) return `${at}.at must be between ${time.min} and ${time.max} seconds.`;
      if (!range(key.value, min, max)) return `${at}.value must be between ${min} and ${max}.`;
      if (!isMotionEasing(key.easing)) return `${at}.easing must be ${MOTION_EASINGS.join(", ")} or four numbers between 0 and 1.`;
      if (index > 0 && key.at - (keys[index - 1] as MotionKey).at <= STUDIO_TIME_TOLERANCE) return `${at}.at must be later than the previous key.`;
    }
  }
  return null;
}
export function isLayerMotion(value: unknown, time: { min: number; max: number }): value is LayerMotion {
  return motionProblem(value, time) === null;
}
export function motionKeyCount(motion: LayerMotion | undefined) {
  return motion === undefined ? 0 : MOTION_CHANNELS.reduce((sum, channel) => sum + (motion[channel] === undefined ? 0 : motion[channel].length), 0);
}
// Absent channels are identity; any stored nonidentity value counts, in or out of the visible span.
export function motionIsIdentity(motion: LayerMotion | undefined) {
  return motion === undefined || MOTION_CHANNELS.every((channel) => (motion[channel] ?? []).every((key) => key.value === MOTION_IDENTITY[channel]));
}

export const REVEAL_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type RevealRect = { x: number; y: number; width: number; height: number };
// `rect` is a fraction of the title's padded box; `start` is title-local seconds like title motion keys; the edge named by `direction` travels.
export type TitleReveal = { rect: RevealRect; direction: typeof REVEAL_DIRECTIONS[number]; start: number; duration: number; easing: MotionEasing };
export const REVEAL_DURATION = { min: 1 / 30, max: 10 } as const;
export const REVEAL_MIN_SIDE = 0.01;
export const DEFAULT_TITLE_REVEAL: Readonly<TitleReveal> = { rect: { x: 0, y: 0, width: 1, height: 1 }, direction: "up", start: 0, duration: 0.4, easing: "ease-out" };
export const revealIsFull = ({ x, y, width, height }: RevealRect) => x === 0 && y === 0 && width === 1 && height === 1;
// The first reason a reveal cannot exist, naming its field ("" when it is not a reveal at all), or null.
export function revealProblem(value: unknown): { field: string; message: string } | null {
  if (!record(value, ["rect", "direction", "start", "duration", "easing"])) return { field: "", message: "A reveal needs exactly rect, direction, start, duration and easing." };
  const { rect } = value;
  if (!record(rect, ["x", "y", "width", "height"]) || !range(rect.x, 0, 1) || !range(rect.y, 0, 1) || !range(rect.width, REVEAL_MIN_SIDE, 1) || !range(rect.height, REVEAL_MIN_SIDE, 1)
    || rect.x + rect.width > 1 + STUDIO_TIME_TOLERANCE || rect.y + rect.height > 1 + STUDIO_TIME_TOLERANCE) return { field: "rect", message: `The reveal rectangle needs x, y, width and height as fractions of the title box, at least ${REVEAL_MIN_SIDE} wide and tall and inside it.` };
  if (!REVEAL_DIRECTIONS.some((direction) => direction === value.direction)) return { field: "direction", message: `The reveal direction must be ${REVEAL_DIRECTIONS.join(", ")}.` };
  if (!range(value.start, 0, MAX_STUDIO_DURATION)) return { field: "start", message: `The reveal start must be between 0 and ${MAX_STUDIO_DURATION} seconds.` };
  if (!range(value.duration, REVEAL_DURATION.min - STUDIO_TIME_TOLERANCE, REVEAL_DURATION.max)) return { field: "duration", message: `The reveal lasts between ${REVEAL_DURATION.min.toFixed(2)} and ${REVEAL_DURATION.max} seconds.` };
  if (!isMotionEasing(value.easing)) return { field: "easing", message: `The reveal easing must be ${MOTION_EASINGS.join(", ")} or four numbers between 0 and 1.` };
  return null;
}
export const isTitleReveal = (value: unknown): value is TitleReveal => revealProblem(value) === null;

// The frozen person-mask preset: one exact model, runtime and pre/postprocess revision. A saved id never means a downloadable model.
export const PEOPLE_MODEL = "people-v1";
// `clip` is the saved index of the footage whose people stand in front of the title; threshold is a confidence, feather a blur radius in mask pixels of the 256-pixel grid, smoothing the weight of the two preceding source pictures.
export type TitleOcclusion = { clip: number; model: typeof PEOPLE_MODEL; threshold: number; feather: number; smoothing: number };
export const OCCLUSION_RANGES = { threshold: { min: 0.1, max: 0.9 }, feather: { min: 0, max: 4 }, smoothing: { min: 0, max: 0.5 } } as const;
export const DEFAULT_OCCLUSION: Readonly<Omit<TitleOcclusion, "clip">> = { model: PEOPLE_MODEL, threshold: 0.5, feather: 1, smoothing: 0.2 };
// The first reason these quality fields cannot exist, naming the field, or null.
export function occlusionProblem(value: Readonly<Record<string, unknown>>): { field: string; message: string } | null {
  if (value.model !== PEOPLE_MODEL) return { field: "model", message: `The person model must be ${PEOPLE_MODEL}.` };
  for (const field of ["threshold", "feather", "smoothing"] as const) {
    const { min, max } = OCCLUSION_RANGES[field];
    if (!range(value[field], min, max)) return { field, message: `Behind-person ${field} must be between ${min} and ${max}.` };
  }
  return null;
}
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
export type ProjectOverlay = { family: string; preset: string; start: number; configuration: string; motion?: LayerMotion };
// `captionEnabled: false` keeps the clip's speech out of the captions; present only when off.
export type ProjectClip = (
  | { label: string; kind: "video"; duration: number; inPoint: number; outPoint: number; settings: ClipSettings; punchIns?: PunchIn[] }
  | { label: string; kind: "photo"; duration: number; settings: PhotoSettings; sourceStart?: number; punchIns?: PunchIn[] }
) & { crop?: Crop; place?: Place; motion?: LayerMotion; captionEnabled?: false } & ({ track?: never; start?: never } | { track: "v2"; start: number });
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
  texts?: ProjectText[];
  overlays: ProjectOverlay[];
  sfx?: ProjectSfx[];
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
export function isCaptionGrouping(value: unknown): value is CaptionGrouping {
  if (!record(value, ["maxWords", "maxCharacters", "maxDuration", "pause"])) return false;
  const whole = (item: unknown, { min, max }: { min: number; max: number }) => range(item, min, max) && Number.isInteger(item);
  return whole(value.maxWords, GROUPING_LIMITS.maxWords) && whole(value.maxCharacters, GROUPING_LIMITS.maxCharacters)
    && range(value.maxDuration, GROUPING_LIMITS.maxDuration.min, GROUPING_LIMITS.maxDuration.max) && range(value.pause, GROUPING_LIMITS.pause.min, GROUPING_LIMITS.pause.max);
}
export const isCaptionStyleId = (value: unknown): value is CaptionStyleId => CAPTION_STYLE_IDS.some((style) => style === value);
export function isCaptionScatter(value: unknown): value is CaptionScatter {
  return record(value, ["seed", "safeZone", "intensity", "styles"])
    && typeof value.seed === "number" && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffffffff
    && SCATTER_SAFE_ZONES.some((zone) => zone === value.safeZone) && SCATTER_INTENSITIES.some((intensity) => intensity === value.intensity)
    && Array.isArray(value.styles) && value.styles.length >= 1 && value.styles.every(isCaptionStyleId) && new Set(value.styles).size === value.styles.length;
}
// The first reason a line override cannot exist, naming its field, or null. Every field is optional but at least one is present.
export function lineOverrideProblem(value: unknown): { field: string; message: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { field: "", message: "A line override is an object." };
  const keys = Object.keys(value);
  const unknown = keys.find((key) => !["x", "y", "size", "rotation", "style", "mix"].includes(key));
  if (unknown !== undefined) return { field: unknown, message: `A line has no ${unknown} field. Use x, y, size, rotation, style and mix.` };
  if (keys.length === 0) return { field: "", message: "A line override needs at least one field." };
  const line = value as Record<string, unknown>;
  for (const field of ["x", "y"] as const) if (keys.includes(field) && !range(line[field], 0, 1)) return { field, message: `The line ${field} is a fraction from 0 to 1.` };
  if (keys.includes("size") && !range(line.size, LINE_SIZE.min, LINE_SIZE.max)) return { field: "size", message: `The line size is a fraction of the shorter side from ${LINE_SIZE.min} to ${LINE_SIZE.max}.` };
  if (keys.includes("rotation") && !range(line.rotation, LINE_ROTATION.min, LINE_ROTATION.max)) return { field: "rotation", message: `The line rotation is from ${LINE_ROTATION.min} to ${LINE_ROTATION.max} degrees.` };
  if (keys.includes("style") && !isCaptionStyleId(line.style)) return { field: "style", message: `The line style must be one of ${CAPTION_STYLE_IDS.join(", ")}.` };
  if (keys.includes("mix") && !isCaptionMix(line.mix)) return { field: "mix", message: "The line mix needs a preset, a seed and a palette." };
  if ((line.style === "mixed") !== keys.includes("mix") && keys.includes("style")) return { field: "mix", message: "The Mixed style needs a mix, and no other style has one." };
  if (keys.includes("mix") && !keys.includes("style")) return { field: "mix", message: "A line mix goes with the Mixed style." };
  return null;
}
export const isCaptionLineOverride = (value: unknown): value is CaptionLineOverride => lineOverrideProblem(value) === null;
export function isCaptionSettings(value: unknown): value is CaptionSettings {
  if (typeof value !== "object" || value === null) return false;
  const mixed = Object.hasOwn(value, "mix");
  const keys = ["style", "position", "size", ...(mixed ? ["mix"] : []), ...(Object.hasOwn(value, "grouping") ? ["grouping"] : []), ...(Object.hasOwn(value, "scatter") ? ["scatter"] : [])];
  return record(value, keys)
    && isCaptionStyleId(value.style)
    && (value.style === "mixed") === mixed && (!mixed || isCaptionMix(value.mix))
    && (!Object.hasOwn(value, "grouping") || isCaptionGrouping(value.grouping)) && (!Object.hasOwn(value, "scatter") || isCaptionScatter(value.scatter))
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

const TEXT_STYLE_KEYS = ["font", "weight", "italic", "fill", "size", "x", "y", "backing"];
export function isTextLabel(value: Readonly<Record<string, unknown>>) {
  const stamped = value.timestamp !== undefined;
  return (stamped ? TEXT_TIMESTAMPS.some((kind) => kind === value.timestamp) : true)
    && (value.text === "" ? stamped : typeof value.text === "string" && text(value.text, MAX_TEXT_LENGTH));
}
export function isTextStyle(value: Readonly<Record<string, unknown>>) {
  return isCaptionFace(value.font, value.weight, value.italic) && typeof value.weight === "number" && typeof value.italic === "boolean"
    && isCaptionColor(value.fill) && typeof value.size === "string" && Object.hasOwn(TEXT_SIZES, value.size)
    && range(value.x, 0, 1) && range(value.y, 0, 1) && typeof value.backing === "boolean";
}
export function isTextDuration(value: unknown): value is number {
  return range(value, MIN_CLIP_DURATION - STUDIO_TIME_TOLERANCE, MAX_STUDIO_DURATION);
}
function isProjectText(value: unknown, clips: ProjectClip[], total: number): value is ProjectText {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const anchored = Object.hasOwn(value, "clip");
  const keys = ["text", ...TEXT_STYLE_KEYS, ...(anchored ? ["clip"] : ["start", "duration"])];
  if (Object.hasOwn(value, "timestamp")) keys.push("timestamp");
  const moving = Object.hasOwn(value, "motion");
  if (moving) { if (!isLayerMotion((value as ProjectText).motion, MOTION_TIME)) return false; keys.push("motion"); }
  const revealing = Object.hasOwn(value, "reveal");
  if (revealing) { if (!isTitleReveal((value as ProjectText).reveal)) return false; keys.push("reveal"); }
  if (Object.hasOwn(value, "animationOffset")) {
    const offset = (value as ProjectText).animationOffset;
    if (!(moving || revealing) || !range(offset, PHOTO_MOTION_TIME.min, PHOTO_MOTION_TIME.max) || offset === 0) return false;
    keys.push("animationOffset");
  }
  const occluded = Object.hasOwn(value, "occlusion");
  if (occluded) keys.push("occlusion");
  if (!record(value, keys) || !isTextLabel(value) || !isTextStyle(value)) return false;
  const person = occluded ? (value as ProjectText).occlusion : undefined;
  if (occluded && (!record(person, ["clip", "model", "threshold", "feather", "smoothing"]) || occlusionProblem(person) !== null
    || typeof person.clip !== "number" || !Number.isInteger(person.clip) || clips[person.clip] === undefined || (anchored && person.clip !== value.clip))) return false;
  if (!anchored) return value.timestamp === undefined && number(value.start) && isTextDuration(value.duration) && (total === 0 ? value.start === 0 : value.start < total);
  const owner = typeof value.clip === "number" && Number.isInteger(value.clip) ? clips[value.clip] : undefined;
  return owner !== undefined && (value.timestamp !== "source" || owner.kind === "video");
}

export const SFX_PACK = "ugc-1";
export const SFX_RATE = 48_000;
export const SFX_CATEGORIES = ["click", "typing", "whoosh", "pop", "sparkle"] as const;
export type SfxCategory = typeof SFX_CATEGORIES[number];
// The frozen pack. `file` is content-hashed, `frames` counts stereo frames at SFX_RATE, `syncSample` is the frame whose attack meets an event.
export type SfxAsset = { id: string; name: string; category: SfxCategory; file: string; sha256: string; bytes: number; frames: number; defaultGain: number; syncSample: number };
export const SFX_ASSETS: readonly SfxAsset[] = [
  { id: "ugc-click-01", name: "Interface click", category: "click", file: "ugc-click-01.992934be.wav", sha256: "992934bed738c3e8c4f0f96de38fd20012204f22a05715e317a81ebe586d0117", bytes: 18692, frames: 4662, defaultGain: 0.35, syncSample: 0 },
  { id: "ugc-click-02", name: "Mouse click", category: "click", file: "ugc-click-02.1bfe47db.wav", sha256: "1bfe47dbb026d662c3b38dd15d9e98b42c8d85a2166a6002a4be3fc1ab691379", bytes: 10888, frames: 2711, defaultGain: 0.35, syncSample: 502 },
  { id: "ugc-typing-01", name: "Keyboard burst", category: "typing", file: "ugc-typing-01.2586a3c2.wav", sha256: "2586a3c20e75c054f78b0bc2fbc03fb6e0e824828fb80afd82494fafebb6052a", bytes: 730232, frames: 182547, defaultGain: 0.25, syncSample: 3582 },
  { id: "ugc-typing-02", name: "Single mechanical key", category: "typing", file: "ugc-typing-02.da13d327.wav", sha256: "da13d32739cab89cc1979da06a2fd67033b3fbf1c88433b7b6bd3292d4d21b9b", bytes: 60232, frames: 15047, defaultGain: 0.25, syncSample: 3916 },
  { id: "ugc-whoosh-01", name: "Bamboo swish", category: "whoosh", file: "ugc-whoosh-01.9a0cf026.wav", sha256: "9a0cf0267f1edddeb8979efd4b04d943fb08051866bd71d5f83fcf0c1428e4b7", bytes: 81872, frames: 20457, defaultGain: 0.3, syncSample: 4104 },
  { id: "ugc-whoosh-02", name: "Air sweep", category: "whoosh", file: "ugc-whoosh-02.bb9b11a2.wav", sha256: "bb9b11a21e1486f13dbd3dc973bff328843b40c8bcfc55a845e1862f59b44a2e", bytes: 323204, frames: 80790, defaultGain: 0.3, syncSample: 44328 },
  { id: "ugc-pop-01", name: "Bubble pop", category: "pop", file: "ugc-pop-01.11dc33b7.wav", sha256: "11dc33b7aa35a8534e9230a59e9f950cd36d6b7db94f37e8ada7864331d71bf1", bytes: 28744, frames: 7175, defaultGain: 0.35, syncSample: 262 },
  { id: "ugc-pop-02", name: "Mouth pop", category: "pop", file: "ugc-pop-02.7ecf8370.wav", sha256: "7ecf837064d232374a72e68702885301ffb7e3e2b39b58e126c4175a9cc843d7", bytes: 112888, frames: 28211, defaultGain: 0.35, syncSample: 6993 },
  { id: "ugc-sparkle-01", name: "Cartoon sparkle", category: "sparkle", file: "ugc-sparkle-01.423655b4.wav", sha256: "423655b4f6080bea2fb772f1f94a7f812867173e6f16bcb5b7d8192c38a5bc0b", bytes: 122524, frames: 30620, defaultGain: 1.5, syncSample: 72 },
  { id: "ugc-sparkle-02", name: "Magic chime", category: "sparkle", file: "ugc-sparkle-02.a75b4305.wav", sha256: "a75b4305f4c168a73897c369393d980d011f19d05bd14beb7bf23c543f064aa8", bytes: 374824, frames: 93695, defaultGain: 0.25, syncSample: 167 },
];
export const MAX_STUDIO_SFX = 100;
export const SFX_OFFSET = { min: -2, max: 2 } as const;
export const SFX_GAIN = { min: 0, max: 2 } as const;
export const SFX_FADE_MAX = 2;
export const SFX_CUE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type SfxSettings = { asset: string; inPoint: number; outPoint: number; gain: number; muted: boolean; fadeIn: number; fadeOut: number };
const SFX_SETTING_KEYS = ["asset", "inPoint", "outPoint", "gain", "muted", "fadeIn", "fadeOut"];
export type ProjectSfxAnchor = { kind: "title-enter"; text: number } | { kind: "transition"; from: number; to: number } | { kind: "overlay-cue"; overlay: number; cue: string };
// A saved sound starts at an absolute post-overlap time or follows an event of a saved title, V1 transition or overlay cue, `offset` seconds away.
export type ProjectSfx = SfxSettings & ({ start: number; anchor?: never; offset?: never } | { anchor: ProjectSfxAnchor; offset: number; start?: never }) & { auto?: typeof SFX_PACK };

export function sfxAsset(id: unknown) {
  return SFX_ASSETS.find((asset) => asset.id === id);
}
export function sfxDuration(asset: SfxAsset) {
  return asset.frames / SFX_RATE;
}
export function isSfxOffset(value: unknown): value is number {
  return range(value, SFX_OFFSET.min, SFX_OFFSET.max);
}
// The reason the settings of a sound cannot exist, or null. At least one sample stays inside the asset; fades fit the retained length.
export function sfxSettingsProblem(value: Readonly<Record<string, unknown>>) {
  const asset = sfxAsset(value.asset);
  if (asset === undefined) return "Unknown sound.";
  const { inPoint, outPoint, gain, muted, fadeIn, fadeOut } = value;
  if (!range(inPoint, 0, sfxDuration(asset)) || !range(outPoint, 0, sfxDuration(asset) + STUDIO_TIME_TOLERANCE)
    || outPoint - inPoint < 1 / SFX_RATE - STUDIO_TIME_TOLERANCE) return "Keep at least one sample of the sound between its start and end.";
  if (!range(gain, SFX_GAIN.min, SFX_GAIN.max) || typeof muted !== "boolean") return "A sound's volume is between 0 and 2.";
  if (!range(fadeIn, 0, SFX_FADE_MAX) || !range(fadeOut, 0, SFX_FADE_MAX) || fadeIn + fadeOut > outPoint - inPoint + STUDIO_TIME_TOLERANCE) return "Fades are at most 2 seconds and must fit inside the trimmed sound.";
  return null;
}
// The reason a saved sound cannot exist in this project, or null. Cue availability needs composition metadata and is checked where that is loaded.
function projectSfxProblem(value: unknown, project: Pick<StudioProject, "clips" | "transitions" | "texts" | "overlays">, total: number) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "A saved sound is not an object.";
  const anchored = Object.hasOwn(value, "anchor");
  const keys = [...SFX_SETTING_KEYS, ...(anchored ? ["anchor", "offset"] : ["start"]), ...(Object.hasOwn(value, "auto") ? ["auto"] : [])];
  if (!record(value, keys)) return "A saved sound has unknown or missing fields.";
  if (value.auto !== undefined && value.auto !== SFX_PACK) return "Unknown sound origin.";
  const problem = sfxSettingsProblem(value);
  if (problem !== null) return problem;
  if (!anchored) return number(value.start) && value.start < total ? null : "A sound must start inside the timeline.";
  if (!isSfxOffset(value.offset)) return "A linked sound is at most 2 seconds from its event.";
  const { anchor } = value;
  const index = (item: unknown, length: number): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0 && item < length;
  if (record(anchor, ["kind", "text"]) && anchor.kind === "title-enter") {
    return index(anchor.text, (project.texts === undefined ? [] : project.texts).length) ? null : "A sound's title is missing.";
  }
  if (record(anchor, ["kind", "overlay", "cue"]) && anchor.kind === "overlay-cue") {
    return index(anchor.overlay, project.overlays.length) && typeof anchor.cue === "string" && anchor.cue.length <= 64 && SFX_CUE_ID.test(anchor.cue) ? null : "A sound's overlay cue is malformed.";
  }
  if (record(anchor, ["kind", "from", "to"]) && anchor.kind === "transition") {
    const v1 = project.clips.filter((clip) => clip.track === undefined).length;
    const valid = index(anchor.from, v1) && anchor.to === anchor.from + 1 && anchor.to < v1
      && project.transitions !== undefined && project.transitions.some((transition) => transition.cut === anchor.from);
    return valid ? null : "A sound's transition does not exist.";
  }
  return "A sound's event is unknown or malformed.";
}

// The API supplies its startup catalog; the browser supplies the catalog loaded for Studio.
export function isStudioProject(value: unknown, presets: ReadonlySet<string>): value is StudioProject {
  if (typeof value !== "object" || value === null) return false;
  const keys = ["name", "aspect", "clips", "overlays"];
  if (Object.hasOwn(value, "transitions")) keys.push("transitions");
  if (Object.hasOwn(value, "captions")) keys.push("captions");
  if (Object.hasOwn(value, "texts")) keys.push("texts");
  if (Object.hasOwn(value, "sfx")) keys.push("sfx");
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
    if (Object.hasOwn(clip, "motion")) { if (!isLayerMotion(clip.motion, clip.kind === "photo" ? PHOTO_MOTION_TIME : MOTION_TIME)) return false; spatialKeys.push("motion"); }
    if (Object.hasOwn(clip, "captionEnabled")) { if (clip.captionEnabled !== false) return false; spatialKeys.push("captionEnabled"); }
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
    const keys = ["family", "preset", "start", "configuration"];
    if (typeof overlay === "object" && overlay !== null && Object.hasOwn(overlay, "motion")) {
      if (!isLayerMotion((overlay as ProjectOverlay).motion, MOTION_TIME)) return false;
      keys.push("motion");
    }
    if (!record(overlay, keys)
      || !text(overlay.family, 100) || !text(overlay.preset, 100)
      || !presets.has(`${overlay.family}/${overlay.preset}`) || !number(overlay.start)
      || (total === 0 ? overlay.start !== 0 : overlay.start >= total)) return false;
    if (!isTemplateHref(overlay.configuration)
      || !overlay.configuration.startsWith(`/overlays/${overlay.family}?`)) return false;
  }
  if (Object.hasOwn(value, "texts")) {
    if (!Array.isArray(value.texts) || value.texts.length === 0 || value.texts.length > MAX_STUDIO_TEXTS) return false;
    for (const title of value.texts) if (!isProjectText(title, project.clips, total)) return false;
  }
  if (Object.hasOwn(value, "sfx")) {
    if (!Array.isArray(value.sfx) || value.sfx.length === 0 || value.sfx.length > MAX_STUDIO_SFX || total <= 0) return false;
    for (const sound of value.sfx) if (projectSfxProblem(sound, project, total) !== null) return false;
  }
  const motionKeys = [...project.clips, ...project.overlays, ...(project.texts === undefined ? [] : project.texts)].reduce((sum, layer) => sum + motionKeyCount(layer.motion), 0);
  return motionKeys <= MAX_MOTION_KEYS && new TextEncoder().encode(JSON.stringify(value)).length <= MAX_STUDIO_PROJECT_BYTES;
}

