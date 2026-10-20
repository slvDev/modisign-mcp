// generated from the Modisign monorepo, do not edit
import { clipStarts, cutTransition, type TimingClip } from "@/lib/video-timeline";
import type { CaptionSettings, CaptionStyleId } from "@/lib/studio-project";
import { CAPTION_FONTS, isEffectiveAppearance, mixAppearance, type CaptionFont, type WordAppearance } from "@/lib/caption-mix";
export type { CaptionStyleId, CaptionPlacement, CaptionSettings } from "@/lib/studio-project";

export const SPEECH_FILES = Object.freeze(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "preprocessor_config.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
export const SPEECH_MODEL = "Xenova/whisper-tiny.en";
export const SPEECH_REVISION = "79fb389fc764e7c395bd330e9531d9d32ada7049";
// q8 Whisper decoders produce invalid text on WebGPU (transformers.js#1317).
export const ASR_BACKEND = "wasm" as const;
export type CaptionWord = { id: string; text: string; start: number; end: number };
export type TimelineWord = CaptionWord & { mediaId: string; clipId: string; sourceId: string; look?: WordAppearance };
export type CaptionLine = { id: string; words: TimelineWord[]; text: string; start: number; end: number };
export type CaptionStyle = {
  id: CaptionStyleId; name: string; free: boolean;
  font: "sans" | "serif" | "mono"; weight: number;
  casing: "mixed" | "upper" | "lower";
  fill: string | null; activeFill: string; activeScale: number; activeItalic: boolean;
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; offset: number } | null;
  glow: boolean; gradient: boolean;
  background: "none" | "line" | "word";
  reveal: "line" | "accumulate" | "characters";
  motion: "none" | "word" | "pop";
};
const BASE_STYLE: Omit<CaptionStyle, "id" | "name" | "free"> = {
  font: "sans", weight: 800, casing: "mixed", fill: "#fff", activeFill: "#fff",
  activeScale: 1, activeItalic: false, stroke: { color: "#000", width: 0.12 },
  shadow: null, glow: false, gradient: false, background: "none", reveal: "line", motion: "none",
};
function defineStyle(id: CaptionStyleId, name: string, free: boolean, values: Partial<typeof BASE_STYLE> = {}): CaptionStyle {
  return { ...BASE_STYLE, ...values, id, name, free };
}
const SOFT_SHADOW = { color: "rgba(0,0,0,0.7)", blur: 0.16, offset: 0.04 };
export const CAPTION_STYLES: readonly CaptionStyle[] = [
  defineStyle("clean", "Clean", true),
  defineStyle("boxed", "Boxed", true, { background: "line", stroke: null }),
  defineStyle("minimal", "Minimal", true, { weight: 500, casing: "lower", fill: "#ededed", stroke: null, shadow: SOFT_SHADOW }),
  defineStyle("karaoke", "Karaoke", false, { activeFill: "#FFD60A" }),
  defineStyle("bold-keyword", "Bold keyword", false, { weight: 900, casing: "upper", activeFill: "#FFD60A", activeScale: 1.12 }),
  defineStyle("word-pop", "Word pop", false, { weight: 900, motion: "word" }),
  defineStyle("highlight-box", "Highlight box", false, { casing: "upper", background: "word", stroke: null, shadow: SOFT_SHADOW }),
  defineStyle("neon", "Neon", false, { weight: 800, stroke: null, glow: true, activeFill: "#ff69de" }),
  defineStyle("pop-up", "Pop-up", false, { reveal: "accumulate", motion: "pop" }),
  defineStyle("typewriter", "Typewriter", false, { font: "mono", weight: 500, reveal: "characters", stroke: null, shadow: SOFT_SHADOW }),
  defineStyle("outline", "Outline", false, { weight: 900, casing: "upper", fill: null, stroke: { color: "#fff", width: 0.07 }, activeFill: "#FFD60A" }),
  defineStyle("editorial", "Editorial", false, { font: "serif", weight: 600, stroke: null, shadow: SOFT_SHADOW, activeItalic: true, activeScale: 1.08, activeFill: "#FFD60A" }),
  defineStyle("gradient", "Gradient", false, { weight: 900, stroke: null, gradient: true, shadow: SOFT_SHADOW, activeScale: 1.06 }),
  defineStyle("mixed", "Mixed", false),
];
// Local per-word edits, by source media and source word id, like transcript corrections: never saved.
export type WordStyles = Record<string, Record<string, WordAppearance>>;
export const DEFAULT_LEADING = 1.35;
export const WORD_STYLES_NOTE = "Projects save the caption mix, not caption text or individual word edits.";
export type ResolvedLook = { font: CaptionFont; weight: number; italic: boolean; fill: string | null; tracking: number; leading: number; underline: boolean; highlight: string | null };
// The face group (font, weight, italic) comes from the look when it names a font, else from the style.
export function resolveLook(style: CaptionStyle, look: WordAppearance | undefined): ResolvedLook {
  const own: WordAppearance = look === undefined ? {} : look;
  const font = own.font === undefined ? style.font : own.font;
  const weight = own.font === undefined ? style.weight : own.weight !== undefined ? own.weight : own.font === style.font ? style.weight : CAPTION_FONTS[own.font].defaultWeight;
  return {
    font, weight, italic: own.italic === true, fill: own.fill === undefined ? null : own.fill,
    tracking: own.tracking === undefined ? 0 : own.tracking, leading: own.leading === undefined ? DEFAULT_LEADING : own.leading,
    underline: own.underline === true, highlight: typeof own.highlight === "string" ? own.highlight : null,
  };
}
// A manual look replaces the mix's face group as a whole; every other field overrides on its own.
function mergeLooks(base: WordAppearance | undefined, over: WordAppearance | undefined): WordAppearance | undefined {
  if (base === undefined || over === undefined) return base === undefined ? over : base;
  const { font, weight, italic, ...rest } = base;
  return { ...(over.font === undefined ? { font, weight, italic } : {}), ...rest, ...over };
}
export function styledWords(words: TimelineWord[], settings: CaptionSettings, wordStyles: WordStyles): TimelineWord[] {
  return words.map((word) => {
    const manual = wordStyles[word.mediaId] === undefined ? undefined : wordStyles[word.mediaId][word.sourceId];
    const look = mergeLooks(settings.mix === undefined ? undefined : mixAppearance(settings.mix, word.sourceId), manual);
    return look === undefined ? word : { ...word, look };
  });
}
// An underline or highlight switched off changes nothing on a style that has none, so it is not a customization.
export function customizedWords(words: readonly TimelineWord[], wordStyles: WordStyles) {
  return words.filter((word) => {
    const manual = wordStyles[word.mediaId] === undefined ? undefined : wordStyles[word.mediaId][word.sourceId];
    return manual !== undefined && isEffectiveAppearance(manual);
  });
}
export function captionStyle(id: CaptionStyleId) {
  const style = CAPTION_STYLES.find((style) => style.id === id);
  if (style === undefined) throw new Error("Unknown caption style");
  return style;
}
export function captionDisplayText(text: string, casing: CaptionStyle["casing"]) {
  return casing === "upper" ? text.toUpperCase() : casing === "lower" ? text.toLowerCase() : text;
}
export function timelineWords(clips: (TimingClip & { id: string; mediaId: string | null; kind: "video" | "photo"; inPoint: number; outPoint: number })[], transcripts: Record<string, CaptionWord[]>): TimelineWord[] {
  const result: TimelineWord[] = [];
  const starts = clipStarts(clips);
  for (const [index, clip] of clips.entries()) {
    if (clip.track !== "v1") continue;
    const offset = starts[index];
    const transition = cutTransition(clips, index);
    const endPoint = clip.outPoint - (transition !== undefined && transition.type === "crossfade" ? transition.duration : 0);
    const words = clip.kind === "photo" || clip.mediaId === null ? undefined : transcripts[clip.mediaId];
    if (words !== undefined && clip.mediaId !== null) for (const word of words) {
      const start = Math.max(word.start, clip.inPoint);
      const end = Math.min(word.end, endPoint);
      const midpoint = (word.start + word.end) / 2;
      if (end <= start || end - start < (word.end - word.start) / 2 - 1e-6) continue;
      // An exact half at a split belongs to the right clip, never both.
      if (Math.abs(end - start - (word.end - word.start) / 2) < 1e-6 && (midpoint < clip.inPoint || midpoint >= endPoint)) continue;
      result.push({ ...word, id: `${clip.id}/${word.id}`, sourceId: word.id, mediaId: clip.mediaId, clipId: clip.id, start: offset + start - clip.inPoint, end: offset + end - clip.inPoint });
    }
  }
  return result;
}
export function captionLines(words: TimelineWord[], style: CaptionStyleId): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let group: TimelineWord[] = [];
  function flush() {
    if (group.length === 0) return;
    lines.push({ id: group[0].id, words: group, text: group.map((word) => word.text).join(" "), start: group[0].start, end: group[group.length - 1].end });
    group = [];
  }
  for (const word of words) {
    const previous = group.at(-1);
    if (previous !== undefined && (style === "word-pop" || previous.clipId !== word.clipId || word.start - previous.end > 0.6 || /[.!?]["')]*$/.test(previous.text) || group.length >= 7 || group.map((item) => item.text).join(" ").length + word.text.length + 1 > 32)) flush();
    group.push(word);
  }
  flush();
  return lines;
}
export function replaceCaptionWords(words: CaptionWord[], ids: string[], text: string): CaptionWord[] {
  const selected = words.filter((word) => ids.includes(word.id));
  if (selected.length === 0) throw new Error("Caption words are missing");
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const start = selected[0].start;
  const end = selected[selected.length - 1].end;
  const characters = tokens.reduce((sum, token) => sum + token.length, 0);
  const usedIds = new Set(words.map((word) => word.id));
  let suffix = 0;
  let at = start;
  const replacement = tokens.map((token, index) => {
    const next = at + (end - start) * token.length / characters;
    let id: string;
    if (index < selected.length) id = selected[index].id;
    else {
      do { id = `${selected[0].id}:edit:${suffix++}`; } while (usedIds.has(id));
      usedIds.add(id);
    }
    const word = { id, text: token, start: at, end: next };
    at = next;
    return word;
  });
  const first = words.indexOf(selected[0]);
  return [...words.slice(0, first), ...replacement, ...words.slice(first).filter((word) => !ids.includes(word.id))];
}
export type TimestampChunk = { text: string; timestamp: [number | null, number | null] };
export type CaptionWindow = { offset: number; duration: number; first: boolean; last: boolean; chunks: TimestampChunk[] };
function repairWordTimes(chunks: TimestampChunk[], duration: number): CaptionWord[] {
  const words = chunks.filter((chunk) => chunk.text.trim() !== "").map((chunk, index) => ({ id: String(index), text: chunk.text.trim(), start: Number(chunk.timestamp[0]), end: Number(chunk.timestamp[1]), valid: chunk.timestamp[0] !== null && chunk.timestamp[1] !== null && Number.isFinite(chunk.timestamp[0]) && Number.isFinite(chunk.timestamp[1]) && Number(chunk.timestamp[0]) >= 0 && Number(chunk.timestamp[1]) > Number(chunk.timestamp[0]) && Number(chunk.timestamp[0]) < duration }));
  let boundary = 0;
  for (const word of words) if (word.valid) {
    word.start = Math.max(boundary, word.start);
    word.end = Math.min(duration, word.end);
    word.valid = word.end > word.start;
    if (word.valid) boundary = word.end;
  }
  for (let i = 0; i < words.length;) {
    if (words[i].valid) { i++; continue; }
    const first = i;
    while (i < words.length && !words[i].valid) i++;
    let start = first === 0 ? 0 : Math.min(duration, words[first - 1].end);
    let end = i === words.length ? duration : Math.max(start, Math.min(duration, words[i].start));
    if (end <= start) {
      start = first === 0 ? 0 : (words[first - 1].start + words[first - 1].end) / 2;
      end = i === words.length ? duration : (words[i].start + words[i].end) / 2;
      if (first > 0) words[first - 1].end = start;
      if (i < words.length) words[i].start = end;
    }
    const step = (end - start) / (i - first);
    for (let j = first; j < i; j++) { words[j].start = start + (j - first) * step; words[j].end = start + (j - first + 1) * step; }
  }
  let previous = 0;
  return words.flatMap(({ id, text, start, end }) => {
    start = Math.max(previous, Math.min(duration, start));
    end = Math.min(duration, Math.max(start, end));
    previous = end;
    return end > start ? [{ id, text, start, end }] : [];
  });
}
export function stitchCaptionWindows(windows: CaptionWindow[]): CaptionWord[] {
  const words: CaptionWord[] = [];
  const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const [index, window] of windows.entries()) {
    const previousWindowWords = words.slice(-7);
    for (const word of repairWordTimes(window.chunks, window.duration)) {
      const midpoint = (word.start + word.end) / 2;
      if (midpoint < (window.first ? 0 : 2) || midpoint >= (window.last ? window.duration : window.duration - 2)) continue;
      const next = { ...word, id: `${index}:${word.id}`, start: word.start + window.offset, end: word.end + window.offset };
      if (previousWindowWords.some((previous) => normalized(previous.text) === normalized(next.text) && Math.abs((previous.start + previous.end - next.start - next.end) / 2) <= 0.15)) continue;
      const previous = words.at(-1);
      if (previous !== undefined) next.start = Math.max(previous.end, next.start);
      if (next.end > next.start) words.push(next);
    }
  }
  return words;
}
function subtitleTime(seconds: number, separator: string) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
export function captionFile(lines: CaptionLine[], format: "srt" | "vtt") {
  const escape = (text: string) => text.replace(/[\r\n\u0000]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let end = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < end || Math.round(line.end * 1000) <= Math.round(line.start * 1000)) throw new Error("Caption cues must have ordered, positive times.");
    end = line.end;
  }
  return (format === "vtt" ? "WEBVTT\n\n" : "") + lines.map((line, index) => `${index + 1}\n${subtitleTime(line.start, format === "srt" ? "," : ".")} --> ${subtitleTime(line.end, format === "srt" ? "," : ".")}\n${escape(line.text)}\n`).join("\n");
}
