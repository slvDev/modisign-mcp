import { defaultSpatial, isCrop, isPlace, validTrackSchedule, isCaptionSettings, isClipSettings, isPhotoDuration, isPunchIns, isValidTrim, clampTransition, isTextDuration, isTextLabel, isTextStyle, DEFAULT_TEXT_STYLE, MAX_PHOTO_DURATION, MAX_STUDIO_CLIPS, MAX_STUDIO_DURATION, MAX_STUDIO_TEXTS, MAX_TEXT_LENGTH, MIN_CLIP_DURATION, MIN_CLIP_LABEL, MIN_PHOTO_DURATION, STUDIO_ASPECTS, STUDIO_TIME_TOLERANCE, TEXT_SIZES, TEXT_TIMESTAMPS, DEFAULT_CLIP_SETTINGS, type CaptionPlacement, type CaptionSettings, type TextLabel, type TextStyle, type TrackPlacement, type Crop, type Place } from "../vendor/web/src/lib/studio-project.js";
import { patchedLook, isEffectiveAppearance, CAPTION_FONTS, CAPTION_MIXES, CAPTION_MIX_PRESETS, DEFAULT_MIX_PRESET, DEFAULT_MIX_SEED, isCaptionMix, isWordAppearance, newMix, type CaptionMix, type WordAppearance } from "../vendor/web/src/lib/caption-mix.js";
import { clipGeometry } from "../vendor/web/src/lib/clip-settings.js";
import { studioSize, timelineDuration } from "../vendor/web/src/lib/video-timeline.js";
import { initialStudioState, studioReducer, type StudioClip, type StudioMedia, type StudioState } from "../vendor/web/src/lib/studio-state.js";
import { textProblem, type StudioText } from "../vendor/web/src/lib/studio-text.js";
import { PHOTO_STAMP_MESSAGE, RAPID_CLIPS, RAPID_FRAMES, RAPID_TIMESTAMPS, type RapidFrames, type RapidIntroInput } from "../vendor/web/src/lib/studio-rapid-intro.js";
import { replaceCaptionWords, type CaptionWord } from "../vendor/web/src/lib/captions.js";
import { ToolError } from "./errors.js";

export type EditClip = TrackPlacement & { path: string; crop?: Crop; place?: Place; in?: number; out?: number; fit?: "fill" | "fit"; zoom?: number; pan_x?: number; pan_y?: number; slow_zoom?: boolean; volume?: number; mute?: boolean; fade_in?: number; fade_out?: number; punch_ins?: { at: number; length: number; zoom: 110 | 125 | 140 }[] };
export type EditText = { text: string; timestamp?: TextLabel["timestamp"]; clip?: number; start?: number; duration?: number } & Partial<TextStyle>;
export type EditRapidIntro = { clips: number[]; labels: { clip: number; text: string }[]; frames_per_clip?: RapidFrames; timestamp?: RapidIntroInput["timestamp"]; mute_teasers?: boolean };
export type EditInput = { clips: EditClip[]; transitions?: { after_clip: number; type: "crossfade" | "dip"; duration: number }[];
  remove_silences?: { sensitivity: "gentle" | "normal" | "strong"; shortest_pause: 0.3 | 0.5 | 1 };
  overlays?: { configuration: string; start: number }[]; captions?: EditCaptions; texts?: EditText[]; rapid_intro?: EditRapidIntro;
  aspect: typeof STUDIO_ASPECTS[number]; quality?: "1080p" | "720p"; output_path?: string };
export type MediaInfo = { kind: "video" | "photo"; duration: number; width: number; height: number };
export type WordStyleRequest = { clip: number; from: number; to: number; appearance: WordAppearance };
export type EditCaptions = CaptionPlacement & { style: CaptionSettings["style"]; mix?: { preset: CaptionMix["preset"]; seed?: number; palette?: string[] }; word_styles?: WordStyleRequest[]; corrections?: { from: string; to: string }[] };
function invalid(field: string, allowed: string): never { throw new ToolError(`Invalid ${field}: ${allowed}.`, { field, allowed }); }
function keys(value: unknown, allowed: string[], field: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid(field, "an object with supported fields only");
}
export function validateEdit(input: EditInput) {
  keys(input, ["clips", "transitions", "remove_silences", "overlays", "captions", "texts", "rapid_intro", "aspect", "quality", "output_path"], "request");
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
    keys(input.captions, ["style", "position", "size", "mix", "word_styles", "corrections"], "captions");
    const { style, position, size, mix, word_styles: wordStyles, corrections } = input.captions;
    if (mix !== undefined && style !== "mixed") invalid("captions.mix", "only with style mixed");
    if (!isCaptionSettings({ style, position, size, ...(style === "mixed" ? { mix: requestMix(mix) } : {}) })) invalid("captions", "a supported style, upper/center/lower position and s/m/l size");
    if (wordStyles !== undefined) {
      if (!Array.isArray(wordStyles) || wordStyles.length > 100) invalid("captions.word_styles", "at most 100 word ranges");
      for (const [index, item] of wordStyles.entries()) {
        const field = `captions.word_styles.${index}`;
        keys(item, ["clip", "from", "to", "appearance"], field);
        if (!Number.isInteger(item.clip) || item.clip < 0 || item.clip >= input.clips.length || input.clips[item.clip].track !== "v1") invalid(`${field}.clip`, "a request index of a v1 clip");
        if (!Number.isFinite(item.from) || !Number.isFinite(item.to) || item.from < 0 || item.to > MAX_STUDIO_DURATION || item.from >= item.to) invalid(field, "from and to in source seconds, 0 to 180, from before to");
        if (!isWordAppearance(item.appearance)) invalid(`${field}.appearance`, APPEARANCE_RULE);
      }
    }
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
  if (input.texts !== undefined) {
    if (!Array.isArray(input.texts) || input.texts.length > MAX_STUDIO_TEXTS) invalid("texts", `at most ${MAX_STUDIO_TEXTS} titles`);
    for (const [index, request] of input.texts.entries()) validateText(request, `texts.${index}`, input.clips);
  }
  if (input.rapid_intro !== undefined) validateRapidIntro(input.rapid_intro, input.clips);
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
    if (source.kind === "photo" ? !Number.isFinite(start) || start < 0 || !isPhotoDuration(end - start) : !Number.isFinite(source.duration) || source.duration > MAX_STUDIO_DURATION || !isValidTrim(source.duration, start, end)) invalid(field, source.kind === "photo" ? `photo duration ${MIN_PHOTO_DURATION.toFixed(1)}–${MAX_PHOTO_DURATION} seconds` : `valid source trim of at least ${MIN_CLIP_LABEL}, source at most ${MAX_STUDIO_DURATION} seconds`);
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
const APPEARANCE_RULE = `at least one of font (${Object.entries(CAPTION_FONTS).map(([id, font]) => `${id}: weights ${font.weights.join("/")}${font.italic ? ", italic" : ""}`).join("; ")}; weight and italic need font), fill and highlight as #RRGGBB (highlight false removes one), tracking −0.08 to 0.3, leading 1 to 2, underline true or false`;
// A mix with no seed or palette takes the shared showcase seed and the preset's own palette, so one request is reproducible.
function requestMix(mix: unknown): CaptionMix {
  if (mix === undefined) return newMix(DEFAULT_MIX_PRESET, DEFAULT_MIX_SEED);
  keys(mix, ["preset", "seed", "palette"], "captions.mix");
  const { preset, seed, palette } = mix;
  if (!CAPTION_MIX_PRESETS.some((id) => id === preset)) invalid("captions.mix.preset", CAPTION_MIX_PRESETS.join(" or "));
  const recipe = newMix(preset as CaptionMix["preset"], seed === undefined ? DEFAULT_MIX_SEED : seed as number, palette === undefined ? CAPTION_MIXES[preset as CaptionMix["preset"]].palette : palette as string[]);
  if (!isCaptionMix(recipe)) invalid("captions.mix", "a seed from 0 to 4294967295 and a palette of 2–4 #RRGGBB colors");
  return recipe;
}
const FACE_RULE = `font, weight and italic must name a bundled face (${Object.entries(CAPTION_FONTS).map(([id, font]) => `${id}: weights ${font.weights.join("/")}${font.italic ? ", italic" : ""}`).join("; ")}); omitted weight is ${DEFAULT_TEXT_STYLE.weight} and omitted italic is false`;
const STYLE_RULES: Record<string, string> = { fill: "a #RRGGBB color", size: Object.keys(TEXT_SIZES).join(", "), x: "a fraction from 0 to 1", y: "a fraction from 0 to 1", backing: "true or false" };
const FACE_KEYS = ["font", "weight", "italic"];
function v1Index(value: unknown, clips: EditClip[]): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < clips.length && clips[value].track === "v1"; }
// Defaults come only from the shared contract, applied once in mapTexts.
function validateText(request: unknown, field: string, clips: EditClip[]) {
  keys(request, ["text", "timestamp", "clip", "start", "duration", ...Object.keys(DEFAULT_TEXT_STYLE)], field);
  const { text, timestamp, clip, start, duration } = request;
  if (typeof text !== "string") invalid(`${field}.text`, "a string");
  if (timestamp !== undefined && !TEXT_TIMESTAMPS.some((kind) => kind === timestamp)) invalid(`${field}.timestamp`, TEXT_TIMESTAMPS.join(" or "));
  if (!isTextLabel({ text, timestamp })) invalid(`${field}.text`, `1–${MAX_TEXT_LENGTH} characters, empty only with a timestamp`);
  if (clip !== undefined) {
    if (!v1Index(clip, clips)) invalid(`${field}.clip`, "a request index of a v1 clip");
    for (const name of ["start", "duration"]) if (Object.hasOwn(request, name)) invalid(`${field}.${name}`, "forbidden with clip; a clip title follows its clip");
  } else {
    if (timestamp !== undefined) invalid(`${field}.timestamp`, "only with clip");
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) invalid(`${field}.start`, "required nonnegative timeline seconds without clip");
    if (!isTextDuration(duration)) invalid(`${field}.duration`, `required seconds from ${MIN_CLIP_DURATION.toFixed(1)} to ${MAX_STUDIO_DURATION} without clip`);
  }
  const given = Object.keys(DEFAULT_TEXT_STYLE).filter((name) => Object.hasOwn(request, name));
  const picked = (names: string[]) => Object.fromEntries(given.filter((name) => names.includes(name)).map((name) => [name, request[name]]));
  const face = given.filter((name) => FACE_KEYS.includes(name));
  if (face.length > 0 && !isTextStyle({ ...DEFAULT_TEXT_STYLE, ...picked(face) })) invalid(`${field}.${face[0]}`, FACE_RULE);
  for (const name of given.filter((key) => !FACE_KEYS.includes(key))) if (!isTextStyle({ ...DEFAULT_TEXT_STYLE, ...picked([name]) })) invalid(`${field}.${name}`, STYLE_RULES[name]);
}
function validateRapidIntro(request: unknown, clips: EditClip[]) {
  keys(request, ["clips", "frames_per_clip", "labels", "timestamp", "mute_teasers"], "rapid_intro");
  const { clips: chosen, labels, frames_per_clip: frames, timestamp, mute_teasers: mute } = request;
  if (!Array.isArray(chosen) || chosen.length < RAPID_CLIPS.min || chosen.length > RAPID_CLIPS.max || !chosen.every((index) => v1Index(index, clips)) || new Set(chosen).size !== chosen.length) invalid("rapid_intro.clips", `${RAPID_CLIPS.min} to ${RAPID_CLIPS.max} unique request indices of v1 clips, in teaser order`);
  if (frames !== undefined && !RAPID_FRAMES.some((count) => count === frames)) invalid("rapid_intro.frames_per_clip", RAPID_FRAMES.join(", "));
  if (timestamp !== undefined && !RAPID_TIMESTAMPS.some((kind) => kind === timestamp)) invalid("rapid_intro.timestamp", RAPID_TIMESTAMPS.join(", "));
  if (mute !== undefined && typeof mute !== "boolean") invalid("rapid_intro.mute_teasers", "true or false");
  if (!Array.isArray(labels) || labels.length !== chosen.length) invalid("rapid_intro.labels", "one label for each chosen clip");
  const named = new Set<unknown>();
  for (const [index, label] of labels.entries()) {
    const field = `rapid_intro.labels.${index}`;
    keys(label, ["clip", "text"], field);
    if (!chosen.some((index) => index === label.clip) || named.has(label.clip)) invalid(`${field}.clip`, "a unique clip chosen in rapid_intro.clips");
    named.add(label.clip);
    if (typeof label.text !== "string" || label.text.length > MAX_TEXT_LENGTH || (label.text === "" && timestamp === "none")) invalid(`${field}.text`, `a description of up to ${MAX_TEXT_LENGTH} characters; empty only with a source or timeline timestamp`);
  }
}
// Titles are checked against the mapped timeline with the engine's own rule; explicit starts are pre-intro timeline seconds.
export function mapTexts(input: EditInput, clips: StudioClip[]): StudioText[] {
  const total = timelineDuration(clips);
  return (input.texts === undefined ? [] : input.texts).map((request, index) => {
    const { text, timestamp, clip, start, duration, ...style } = request;
    const timing = clip !== undefined ? { clipId: `clip-${clip}` } : typeof start === "number" && typeof duration === "number" ? { start, duration } : undefined;
    if (timing === undefined) throw new Error("Validated explicit title has no timing");
    const title: StudioText = { ...DEFAULT_TEXT_STYLE, ...style, id: `text-${index}`, text, ...(timestamp === undefined ? {} : { timestamp }), timing };
    const problem = textProblem(title, clips, total);
    if (problem !== null) invalid(`texts.${index}`, problem.replace(/\.$/, ""));
    return title;
  });
}
export function editDocument(input: EditInput, media: StudioMedia[]): StudioState {
  const clips = mapClips(input, media.map((item) => ({ ...item.source, kind: item.kind, duration: item.kind === "photo" ? 3 : item.source.duration })));
  return { ...initialStudioState, aspect: input.aspect, aspectChosen: true, media, clips, texts: mapTexts(input, clips),
    captions: input.captions === undefined ? null : { style: input.captions.style, position: input.captions.position, size: input.captions.size, ...(input.captions.style === "mixed" ? { mix: requestMix(input.captions.mix) } : {}) } };
}
const RAPID_DEFAULTS = { frames: 5, timestamp: "source", muteTeasers: true } as const;
const stampOf = (request: EditRapidIntro) => request.timestamp === undefined ? RAPID_DEFAULTS.timestamp : request.timestamp;
// What does not depend on silence removal: a photo has no source stamp. The duration, count and size checks run on the real result.
export function checkRapidIntroStructure(request: EditRapidIntro, clips: StudioState["clips"]) {
  if (stampOf(request) === "source" && request.clips.some((index) => clips.some((clip) => clip.id === `clip-${index}` && clip.kind === "photo"))) throw new ToolError(`Rapid intro was not built: ${PHOTO_STAMP_MESSAGE}`, { field: "rapid_intro.timestamp" });
}
// Runs the engine's rapid-intro action (fresh ids, request-index clip ids); a refusal changes nothing and becomes an error naming the cause.
export function applyRapidIntro(state: StudioState, request: EditRapidIntro): StudioState {
  const entries = request.clips.map((index) => {
    const label = request.labels.find((item) => item.clip === index);
    if (label === undefined) throw new Error("Validated rapid intro has no label");
    if (!state.clips.some((clip) => clip.id === `clip-${index}`)) throw new ToolError(`Rapid intro was not built: clip ${index} has no footage left after silence removal.`, { field: "rapid_intro.clips" });
    return { clipId: `clip-${index}`, teaserId: `teaser-${crypto.randomUUID()}`, text: label.text };
  });
  const next = studioReducer(state, { type: "rapid-intro", entries, labelIds: entries.map(() => `label-${crypto.randomUUID()}`),
    frames: request.frames_per_clip === undefined ? RAPID_DEFAULTS.frames : request.frames_per_clip, timestamp: stampOf(request),
    muteTeasers: request.mute_teasers === undefined ? RAPID_DEFAULTS.muteTeasers : request.mute_teasers });
  if (next.clips === state.clips) throw new ToolError(`Rapid intro was not built: ${next.message}`, { field: "rapid_intro" });
  return next;
}
// Selectors name a request v1 clip and source seconds; a word is chosen by its midpoint within the clip's own trim, after transcription and corrections.
// Per clip, every interval between selector boundaries gets its covering selectors merged in request order (the reducer's own reduction); the request is customized when any merged look has an effect, before any word is known.
export function selectorsCustomized(selectors: WordStyleRequest[]) {
  return selectors.some((selector) => {
    const edges = [...new Set(selectors.filter((other) => other.clip === selector.clip).flatMap((other) => [other.from, other.to]))].sort((a, b) => a - b);
    return edges.slice(0, -1).some((from, index) => {
      const covering = selectors.filter((other) => other.clip === selector.clip && other.from <= from && other.to >= edges[index + 1]);
      if (covering.length === 0) return false;
      let look: WordAppearance | undefined;
      for (const other of covering) look = patchedLook(look, other.appearance);
      return look !== undefined && isEffectiveAppearance(look);
    });
  });
}
export function applyWordStyles(state: StudioState, selectors: WordStyleRequest[]) {
  return selectors.reduce((next, selector, index) => {
    const field = `captions.word_styles.${index}`;
    const clip = next.clips.find((item) => item.id === `clip-${selector.clip}`);
    if (clip === undefined || clip.track !== "v1" || clip.kind !== "video" || clip.mediaId === null) invalid(`${field}.clip`, "a v1 video clip");
    const words = next.transcripts[clip.mediaId];
    const from = Math.max(selector.from, clip.inPoint);
    const to = Math.min(selector.to, clip.outPoint);
    const ids = words === undefined ? [] : words.filter((word) => (word.start + word.end) / 2 >= from && (word.start + word.end) / 2 < to).map((word) => word.id);
    if (ids.length === 0) invalid(field, `spoken words between source seconds ${selector.from} and ${selector.to} of that clip`);
    return studioReducer(next, { type: "style-caption-words", mediaId: clip.mediaId, wordIds: ids, patch: selector.appearance });
  }, state);
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
