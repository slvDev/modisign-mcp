import { defaultSpatial, isCrop, isPlace, validTrackSchedule, isCaptionSettings, isClipSettings, isPhotoDuration, isPunchIns, isValidTrim, clampTransition, MAX_STUDIO_CLIPS, MAX_STUDIO_DURATION, STUDIO_ASPECTS, STUDIO_TIME_TOLERANCE, DEFAULT_CLIP_SETTINGS, type CaptionSettings, type TrackPlacement, type Crop, type Place } from "../vendor/web/src/lib/studio-project.js";
import { clipGeometry } from "../vendor/web/src/lib/clip-settings.js";
import { studioSize, timelineDuration } from "../vendor/web/src/lib/video-timeline.js";
import { initialStudioState, type StudioClip, type StudioMedia, type StudioState } from "../vendor/web/src/lib/studio-state.js";
import { replaceCaptionWords, type CaptionWord } from "../vendor/web/src/lib/captions.js";
import { ToolError } from "./errors.js";

export type EditClip = TrackPlacement & { path: string; crop?: Crop; place?: Place; in?: number; out?: number; fit?: "fill" | "fit"; zoom?: number; pan_x?: number; pan_y?: number; slow_zoom?: boolean; volume?: number; mute?: boolean; fade_in?: number; fade_out?: number; punch_ins?: { at: number; length: number; zoom: 110 | 125 | 140 }[] };
export type EditInput = { clips: EditClip[]; transitions?: { after_clip: number; type: "crossfade" | "dip"; duration: number }[];
  remove_silences?: { sensitivity: "gentle" | "normal" | "strong"; shortest_pause: 0.3 | 0.5 | 1 };
  overlays?: { configuration: string; start: number }[]; captions?: CaptionSettings & { corrections?: { from: string; to: string }[] };
  aspect: typeof STUDIO_ASPECTS[number]; quality?: "1080p" | "720p"; output_path?: string };
export type MediaInfo = { kind: "video" | "photo"; duration: number; width: number; height: number };
function invalid(field: string, allowed: string): never { throw new ToolError(`Invalid ${field}: ${allowed}.`, { field, allowed }); }
function keys(value: unknown, allowed: string[], field: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid(field, "an object with supported fields only");
}
export function validateEdit(input: EditInput) {
  keys(input, ["clips", "transitions", "remove_silences", "overlays", "captions", "aspect", "quality", "output_path"], "request");
  if (!STUDIO_ASPECTS.includes(input.aspect)) invalid("aspect", STUDIO_ASPECTS.join(", "));
  if (!Array.isArray(input.clips) || input.clips.length === 0 || input.clips.length > MAX_STUDIO_CLIPS) invalid("clips", "1–300 local clips");
  for (const [index, clip] of input.clips.entries()) {
    keys(clip, ["path", "track", "start", "crop", "place", "in", "out", "fit", "zoom", "pan_x", "pan_y", "slow_zoom", "volume", "mute", "fade_in", "fade_out", "punch_ins"], `clips.${index}`);
    const field = `clips.${index}`;
    if (clip.track !== "v1" && clip.track !== "v2") invalid(`${field}.track`, "required v1 or v2");
    if (clip.track === "v1" && Object.hasOwn(clip, "start")) invalid(`${field}.start`, "forbidden on v1; clips play in request order");
    if (clip.track === "v2" && (!Number.isFinite(clip.start) || clip.start < 0)) invalid(`${field}.start`, "required nonnegative seconds on v2");
    if (clip.crop !== undefined && !isCrop(clip.crop)) invalid(`${field}.crop`, "top/right/bottom/left percentages 0–95, opposite sides totaling at most 95, no other fields");
    if (clip.place !== undefined && !isPlace(clip.place)) invalid(`${field}.place`, "a named mode only, or custom with normalized x/y/width/height contained in the output and dimensions at least 0.05");
    if (typeof clip.path !== "string" || clip.path.trim() === "") invalid(`clips.${index}.path`, "a local path");
  }
  if (input.transitions !== undefined) {
    if (!Array.isArray(input.transitions)) invalid("transitions", "an array of cuts");
    const cuts = new Set<number>();
    for (const [index, transition] of input.transitions.entries()) {
      const field = `transitions.${index}`;
      keys(transition, ["after_clip", "type", "duration"], field);
      const cut = transition.after_clip;
      if (!Number.isInteger(cut) || cut < 0 || cut >= input.clips.length || input.clips[cut].track !== "v1" || !input.clips.slice(cut + 1).some((clip) => clip.track === "v1") || cuts.has(cut)) invalid(`${field}.after_clip`, "a unique request index of a v1 clip with a following v1 clip");
      if (transition.type !== "crossfade" && transition.type !== "dip") invalid(`${field}.type`, "crossfade or dip");
      if (!Number.isFinite(transition.duration) || transition.duration < 0.2 || transition.duration > 1) invalid(`${field}.duration`, "0.2–1 seconds");
      cuts.add(cut);
    }
  }
  if (input.quality !== undefined && input.quality !== "1080p" && input.quality !== "720p") invalid("quality", "1080p or 720p");
  if (input.output_path !== undefined && typeof input.output_path !== "string") invalid("output_path", "an absolute MP4 path");
  if (input.captions !== undefined) {
    keys(input.captions, ["style", "position", "size", "corrections"], "captions");
    const { style, position, size, corrections } = input.captions;
    if (!isCaptionSettings({ style, position, size })) invalid("captions", "a supported style, upper/center/lower position and s/m/l size");
    if (corrections !== undefined) {
      if (!Array.isArray(corrections) || corrections.length > 100) invalid("captions.corrections", "at most 100 replacements");
      for (const replacement of corrections) {
        keys(replacement, ["from", "to"], "captions.corrections");
        if (typeof replacement.from !== "string" || replacement.from.trim() === "" || replacement.from.length > 200 || typeof replacement.to !== "string" || replacement.to.length > 200) invalid("captions.corrections", "from/to phrases up to 200 characters, with nonempty from");
      }
    }
  }
  if (input.remove_silences !== undefined) {
    keys(input.remove_silences, ["sensitivity", "shortest_pause"], "remove_silences");
    if (!["gentle", "normal", "strong"].includes(input.remove_silences.sensitivity) || ![0.3, 0.5, 1].includes(input.remove_silences.shortest_pause)) invalid("remove_silences", "gentle/normal/strong and 0.3/0.5/1 seconds");
  }
  if (input.overlays !== undefined) {
    if (!Array.isArray(input.overlays) || input.overlays.length > 100) invalid("overlays", "at most 100 overlays");
    for (const overlay of input.overlays) {
      keys(overlay, ["configuration", "start"], "overlays");
      if (typeof overlay.configuration !== "string" || !Number.isFinite(overlay.start) || overlay.start < 0) invalid("overlays", "configuration URL and a nonnegative start");
    }
  }
}
export function mapClips(input: EditInput, sources: MediaInfo[]): StudioClip[] {
  validateEdit(input);
  if (sources.length !== input.clips.length) throw new Error("Media metadata is incomplete");
  const clips = input.clips.map((request, index): StudioClip => {
    const source = sources[index];
    const field = `clips.${index}`;
    if (![source.width, source.height].every((value) => Number.isFinite(value) && value > 0)) invalid(field, "readable picture dimensions");
    const start = request.in === undefined ? 0 : request.in;
    const end = request.out === undefined ? source.kind === "photo" ? 3 : source.duration : request.out;
    if (source.kind === "photo" ? !Number.isFinite(start) || start < 0 || !isPhotoDuration(end - start) : !Number.isFinite(source.duration) || source.duration > MAX_STUDIO_DURATION || !isValidTrim(source.duration, start, end)) invalid(field, source.kind === "photo" ? "photo duration 0.5–30 seconds" : "valid source trim, at least 0.2 seconds, source at most 180 seconds");
    if (source.kind === "photo" && [request.volume, request.mute, request.fade_in, request.fade_out].some((value) => value !== undefined)) invalid(field, "photos have no audio settings");
    if (source.kind === "video" && request.slow_zoom !== undefined) invalid(field, "slow_zoom is for photos");
    if (request.slow_zoom !== undefined && typeof request.slow_zoom !== "boolean") invalid(field, "boolean slow_zoom");
    const settings = { ...DEFAULT_CLIP_SETTINGS, ...(request.fit === undefined ? {} : { frameMode: request.fit }),
      ...(request.zoom === undefined ? {} : { zoom: request.zoom }), ...(request.pan_x === undefined ? {} : { centerX: request.pan_x }),
      ...(request.pan_y === undefined ? {} : { centerY: request.pan_y }), ...(request.volume === undefined ? {} : { volume: request.volume }),
      ...(request.mute === undefined ? {} : { muted: request.mute }), ...(request.fade_in === undefined ? {} : { fadeIn: request.fade_in }), ...(request.fade_out === undefined ? {} : { fadeOut: request.fade_out }) };
    if (!isClipSettings(settings)) invalid(field, "Studio frame/audio bounds (zoom 1–3, pan 0–1, volume 0–2, fades 0–2)");
    const defaults = defaultSpatial();
    const spatial = { crop: request.crop === undefined ? defaults.crop : request.crop, place: request.place === undefined ? defaults.place : request.place };
    if (settings.frameMode === "fill") {
      const { centerX, centerY } = clipGeometry(source, studioSize(input.aspect), settings, false, undefined, spatial);
      Object.assign(settings, { centerX, centerY });
    }
    let punchIns;
    if (request.punch_ins !== undefined) {
      if (!Array.isArray(request.punch_ins)) invalid(`${field}.punch_ins`, "an array");
      punchIns = request.punch_ins.map((row) => { keys(row, ["at", "length", "zoom"], `${field}.punch_ins`); return { start: row.at, length: row.length, zoom: row.zoom / 100 }; });
      if (!isPunchIns(punchIns, 0, source.kind === "photo" ? Number.MAX_SAFE_INTEGER : MAX_STUDIO_DURATION)) invalid(`${field}.punch_ins`, "at most 50 nonoverlapping rows, 0.5–4 seconds in 0.1 steps, zoom 110/125/140");
    }
    return { ...spatial, ...(request.track === "v1" ? { track: "v1" as const } : { track: "v2" as const, start: request.start }), id: `clip-${index}`, mediaId: `media-${index}`, label: request.path.split(/[\\/]/).at(-1)!, kind: source.kind,
      duration: source.kind === "photo" ? end - start : source.duration, inPoint: source.kind === "photo" ? 0 : start,
      outPoint: source.kind === "photo" ? end - start : end, ...(source.kind === "photo" ? { sourceStart: start } : {}),
      settings: { ...settings, ...(source.kind === "photo" ? { slowZoom: request.slow_zoom === true } : {}) }, punchIns };
  });
  for (const transition of input.transitions === undefined ? [] : input.transitions) {
    const outgoing = clips[transition.after_clip];
    const incoming = clips.slice(transition.after_clip + 1).find((clip) => clip.track === "v1");
    if (incoming === undefined) throw new Error("Validated transition has no incoming clip");
    const valid = clampTransition(transition, outgoing.outPoint - outgoing.inPoint, incoming.outPoint - incoming.inPoint);
    if (valid !== undefined) outgoing.transition = { ...valid, to: incoming.id };
  }
  const ordered = [...clips.filter((clip) => clip.track === "v1"), ...clips.filter((clip) => clip.track === "v2").sort((a, b) => {
    if (a.track !== "v2" || b.track !== "v2") throw new Error("Expected v2 clips");
    return a.start - b.start;
  })];
  const schedule = ordered.map((clip) => ({ ...clip, duration: clip.outPoint - clip.inPoint }));
  if (!validTrackSchedule(schedule)) {
    const index = schedule.findIndex((_, index) => !validTrackSchedule(schedule.slice(0, index + 1)));
    invalid(`clips.${clips.indexOf(ordered[index])}.start`, "nonoverlapping v2 intervals");
  }
  if (timelineDuration(ordered) > MAX_STUDIO_DURATION + STUDIO_TIME_TOLERANCE) invalid("clips", "maximum end across both tracks at most 180 seconds after crossfades");
  return ordered;
}
export function editDocument(input: EditInput, media: StudioMedia[]): StudioState {
  return { ...initialStudioState, aspect: input.aspect, aspectChosen: true, media, clips: mapClips(input, media.map((item) => ({ ...item.source, kind: item.kind, duration: item.kind === "photo" ? 3 : item.source.duration }))),
    captions: input.captions === undefined ? null : { style: input.captions.style, position: input.captions.position, size: input.captions.size } };
}
export function correctTranscript(words: CaptionWord[], corrections: { from: string; to: string }[]) {
  for (const correction of corrections) {
    const tokens = correction.from.trim().split(/\s+/).map((word) => word.toLowerCase());
    for (let index = 0; index <= words.length - tokens.length; index++) {
      if (!tokens.every((token, offset) => words[index + offset].text.toLowerCase() === token)) continue;
      words = replaceCaptionWords(words, words.slice(index, index + tokens.length).map((word) => word.id), correction.to);
      index += correction.to.trim().split(/\s+/).filter(Boolean).length - 1;
    }
  }
  return words;
}
