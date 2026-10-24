// generated from the Modisign monorepo, do not edit
import { DEFAULT_GROUPING, lineOverrideProblem, type CaptionGrouping, type CaptionLineOverride, type CaptionSettings, type CaptionStyleId } from "@/lib/studio-project";
import { DEFAULT_MIX_PRESET, mixAppearance, newMix, type CaptionMix, type WordAppearance } from "@/lib/caption-mix";
import { captionStyle, customizedWords, mergeLooks, timelineWords, type CaptionLine, type CaptionSize, type CaptionWord, type LineTreatment, type TimelineWord, type WordStyles } from "@/lib/captions";
import type { TimingClip } from "@/lib/video-timeline";

// A phrase is a source-owned group of consecutive spoken words; its id is stable through edits, splits and trims. `anchor` is fixed when the phrase is made (its first word's id and source start then, never a media id) and seeds every Scatter choice, so word deletions never reroll it.
export type CaptionPhrase = { id: string; anchor: string; wordIds: string[] };
export type CaptionPhrases = Record<string, CaptionPhrase[]>;
export type CaptionLineOverrides = Record<string, Record<string, CaptionLineOverride>>;
// A generated treatment of one phrase (`<media>/<phrase>`), already placed clear of the obstacles it was planned against.
export type ScatterPose = { x: number; y: number; size: number; rotation: number; style: CaptionStyleId };
export type ScatterConflict = { key: string; time: number; owner: string };
export type ScatterPlan = { revision: string; poses: Record<string, ScatterPose>; conflicts: ScatterConflict[] };
// Null clears a field; a style other than Mixed clears the mix.
export type LinePatch = { [K in keyof CaptionLineOverride]?: CaptionLineOverride[K] | null };

export const CAPTION_ANCHORS = { upper: 0.18, center: 0.5, lower: 0.7 } as const;
export const phraseKey = (mediaId: string, phraseId: string) => `${mediaId}/${phraseId}`;

export type CaptionSource = {
  clips: (TimingClip & { id: string; mediaId: string | null; kind: "video" | "photo"; inPoint: number; outPoint: number; captionEnabled?: false })[];
  transcripts: Record<string, CaptionWord[]>; wordStyles: WordStyles; captionPhrases: CaptionPhrases; lineOverrides: CaptionLineOverrides; scatterPlan: ScatterPlan | null;
};

const SENTENCE_END = /[.!?]["')]*$/;
// ASR numbers word ids from zero in every source, so the start tells sources apart.
const anchorOf = (word: CaptionWord) => `${word.id}@${word.start.toFixed(3)}`;
// Consecutive words fill a phrase until the grouping's pause, word, character, duration or sentence limit; the id of a phrase is its first word's id.
export function groupPhrases(words: readonly CaptionWord[], grouping: CaptionGrouping): CaptionPhrase[] {
  const phrases: CaptionPhrase[] = [];
  let group: CaptionWord[] = [];
  const flush = () => { if (group.length > 0) phrases.push({ id: group[0].id, anchor: anchorOf(group[0]), wordIds: group.map(({ id }) => id) }); group = []; };
  for (const word of words) {
    const previous = group.at(-1);
    if (previous !== undefined && (word.start - previous.end > grouping.pause || SENTENCE_END.test(previous.text) || group.length >= grouping.maxWords
      || group.map(({ text }) => text).join(" ").length + word.text.length + 1 > grouping.maxCharacters || word.end - group[0].start > grouping.maxDuration)) flush();
    group.push(word);
  }
  flush();
  return phrases;
}
export const groupingOf = (settings: CaptionSettings): CaptionGrouping => settings.grouping === undefined ? DEFAULT_GROUPING : settings.grouping;
// Stored membership, else the grouping of the transcript; the reducer stores it with the transcript, so only documents built outside it derive.
export function phrasesFor(source: Pick<CaptionSource, "transcripts" | "captionPhrases">, mediaId: string, grouping: CaptionGrouping): CaptionPhrase[] {
  const stored = source.captionPhrases[mediaId];
  if (stored !== undefined) return stored;
  const words = source.transcripts[mediaId];
  if (words === undefined) throw new Error("Transcript is missing");
  return groupPhrases(words, grouping);
}

// The mix a Scatter pool member of Mixed uses, one recipe per seed.
export const scatterMix = (seed: number): CaptionMix => newMix(DEFAULT_MIX_PRESET, seed);
// Global defaults, then the generated pose, then the line's own fields; a style never inherits another style's mix.
export function resolveTreatment(settings: CaptionSettings, override: CaptionLineOverride | undefined, pose: ScatterPose | undefined): LineTreatment {
  const own: CaptionLineOverride = override === undefined ? {} : override;
  const style = own.style !== undefined ? own.style : pose !== undefined ? pose.style : settings.style;
  let mix: CaptionMix | undefined;
  if (style === "mixed") {
    if (own.style === "mixed") mix = own.mix;
    else if (pose !== undefined && settings.scatter !== undefined) mix = scatterMix(settings.scatter.seed);
    else mix = settings.mix;
    if (mix === undefined) throw new Error("A Mixed line needs a mix");
  }
  const size: CaptionSize = own.size !== undefined ? own.size : pose !== undefined ? pose.size : settings.size;
  return {
    style, ...(mix === undefined ? {} : { mix }),
    x: own.x !== undefined ? own.x : pose !== undefined ? pose.x : 0.5,
    y: own.y !== undefined ? own.y : pose !== undefined ? pose.y : CAPTION_ANCHORS[settings.position],
    size, rotation: own.rotation !== undefined ? own.rotation : pose !== undefined ? pose.rotation : 0,
  };
}

const manualLook = (wordStyles: WordStyles, word: TimelineWord): WordAppearance | undefined => wordStyles[word.mediaId] === undefined ? undefined : wordStyles[word.mediaId][word.sourceId];

// Every speech phrase as it appears on the post-overlap timeline: one line per phrase and clip it survives in, styled by its own treatment and word edits.
export function captionLines(source: CaptionSource, settings: CaptionSettings): CaptionLine[] {
  const grouping = groupingOf(settings);
  const words = timelineWords(source.clips, source.transcripts);
  const owners = new Map<string, Map<string, string>>();
  const phraseOf = (word: TimelineWord) => {
    let ids = owners.get(word.mediaId);
    if (ids === undefined) {
      ids = new Map(phrasesFor(source, word.mediaId, grouping).flatMap((phrase) => phrase.wordIds.map((id): [string, string] => [id, phrase.id])));
      owners.set(word.mediaId, ids);
    }
    const phraseId = ids.get(word.sourceId);
    if (phraseId === undefined) throw new Error("A caption word has no phrase");
    return phraseId;
  };
  const lines: CaptionLine[] = [];
  let group: TimelineWord[] = [];
  let phraseId = "";
  const flush = () => {
    if (group.length === 0) return;
    const { mediaId, clipId } = group[0];
    const overrides = source.lineOverrides[mediaId];
    const treatment = resolveTreatment(settings, overrides === undefined ? undefined : overrides[phraseId], source.scatterPlan === null ? undefined : source.scatterPlan.poses[phraseKey(mediaId, phraseId)]);
    const mixed = treatment.mix === undefined ? undefined : treatment.mix;
    const styled = group.map((word) => {
      const look = mergeLooks(mixed === undefined ? undefined : mixAppearance(mixed, word.sourceId), manualLook(source.wordStyles, word));
      return look === undefined ? word : { ...word, look };
    });
    lines.push({ id: `${clipId}/${phraseId}`, owner: { mediaId, phraseId, clipId }, words: styled, text: styled.map((word) => word.text).join(" "), start: styled[0].start, end: styled[styled.length - 1].end, treatment });
    group = [];
  };
  for (const word of words) {
    const id = phraseOf(word);
    if (group.length > 0 && (group[0].clipId !== word.clipId || id !== phraseId)) flush();
    phraseId = id;
    group.push(word);
  }
  flush();
  return lines;
}
// What is drawn: Word pop shows its phrase one word at a time, every cue keeping its phrase's owner and treatment.
export function captionCues(lines: readonly CaptionLine[]): CaptionLine[] {
  return lines.flatMap((line) => captionStyle(line.treatment.style).motion === "word"
    ? line.words.map((word, index): CaptionLine => ({ ...line, id: `${line.id}#${index}`, words: [word], text: word.text, start: word.start, end: word.end }))
    : [line]);
}
// A line with no phrase behind it, for a sample or a test: the words are styled by the caller.
export function lineOf(words: TimelineWord[], treatment: LineTreatment, phraseId = words[0].sourceId): CaptionLine {
  const { mediaId, clipId } = words[0];
  return { id: `${clipId}/${phraseId}`, owner: { mediaId, phraseId, clipId }, words, text: words.map((word) => word.text).join(" "), start: words[0].start, end: words[words.length - 1].end, treatment };
}

// A style is Pro work when it is expressive and not the base style the export is already classified by.
export const expressiveStyle = (style: CaptionStyleId, base: CaptionStyleId) => style !== base && !captionStyle(style).free;
// Pro work beyond the base style: a manually styled word, a line in an expressive style the base style is not, or a Scatter pool with one.
export function captionCustomized(lines: readonly CaptionLine[], settings: CaptionSettings, wordStyles: WordStyles) {
  const expressive = (style: CaptionStyleId) => expressiveStyle(style, settings.style);
  return customizedWords(lines.flatMap((line) => line.words), wordStyles).length > 0
    || lines.some((line) => expressive(line.treatment.style))
    || (settings.scatter !== undefined && settings.scatter.styles.some(expressive));
}

// ---- Authoring edits (pure; the reducer applies them) ----

const inOrder = (ids: Iterable<string>, order: readonly CaptionWord[]) => { const set = new Set(ids); return order.filter((word) => set.has(word.id)).map((word) => word.id); };
// Text edits keep the phrase: new words join the phrase of the first replaced word, dropped ids leave every phrase, empty phrases vanish.
export function phrasesAfterEdit(phrases: readonly CaptionPhrase[], before: readonly CaptionWord[], after: readonly CaptionWord[], replacedIds: readonly string[]): CaptionPhrase[] {
  const known = new Set(before.map((word) => word.id));
  const added = after.filter((word) => !known.has(word.id)).map((word) => word.id);
  const anchor = phrases.find((phrase) => phrase.wordIds.some((id) => replacedIds.includes(id)));
  return phrases.flatMap((phrase) => {
    const ids = inOrder([...phrase.wordIds, ...(phrase === anchor ? added : [])], after);
    return ids.length === 0 ? [] : [{ ...phrase, wordIds: ids }];
  });
}
export function phrasesAfterDelete(phrases: readonly CaptionPhrase[], deletedIds: readonly string[]): CaptionPhrase[] {
  return phrases.flatMap((phrase) => {
    const wordIds = phrase.wordIds.filter((id) => !deletedIds.includes(id));
    return wordIds.length === 0 ? [] : [{ ...phrase, wordIds }];
  });
}
// The word becomes the first of a new phrase with its own anchor; both halves keep their words in order.
export function splitPhrase(phrases: readonly CaptionPhrase[], words: readonly CaptionWord[], phraseId: string, wordId: string, newId: string): CaptionPhrase[] | string {
  const index = phrases.findIndex((phrase) => phrase.id === phraseId);
  if (index < 0) return "That caption line no longer exists.";
  if (phrases.some((phrase) => phrase.id === newId)) throw new Error("A caption line with this id already exists");
  const at = phrases[index].wordIds.indexOf(wordId);
  if (at <= 0) return "Choose a word after the first word to split the line there.";
  const word = words.find(({ id }) => id === wordId);
  if (word === undefined) throw new Error("A caption phrase word is missing from its transcript");
  return [...phrases.slice(0, index), { ...phrases[index], wordIds: phrases[index].wordIds.slice(0, at) }, { id: newId, anchor: anchorOf(word), wordIds: phrases[index].wordIds.slice(at) }, ...phrases.slice(index + 1)];
}
// The next phrase of the same source joins this one; the first keeps its id and anchor.
export function joinPhrases(phrases: readonly CaptionPhrase[], phraseId: string): { phrases: CaptionPhrase[]; removed: string } | string {
  const index = phrases.findIndex((phrase) => phrase.id === phraseId);
  if (index < 0) return "That caption line no longer exists.";
  if (index === phrases.length - 1) return "There is no later line from this video to join.";
  const next = phrases[index + 1];
  return { removed: next.id, phrases: [...phrases.slice(0, index), { ...phrases[index], wordIds: [...phrases[index].wordIds, ...next.wordIds] }, ...phrases.slice(index + 2)] };
}
// Keeps overrides only for phrases that still exist.
export function prunedLineOverrides(overrides: CaptionLineOverrides, phrases: CaptionPhrases): CaptionLineOverrides {
  return Object.fromEntries(Object.entries(overrides).flatMap(([mediaId, lines]) => {
    const kept = Object.entries(lines).filter(([id]) => phrases[mediaId] !== undefined && phrases[mediaId].some((phrase) => phrase.id === id));
    return kept.length === 0 ? [] : [[mediaId, Object.fromEntries(kept)]];
  }));
}
// The one reduction of line patches, used by the reducer and by MCP selectors; a problem is returned, never thrown.
export function patchedLine(existing: CaptionLineOverride | undefined, patch: LinePatch): CaptionLineOverride | undefined | string {
  const next: Record<string, unknown> = { ...existing };
  if (Object.hasOwn(patch, "style")) delete next.mix;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  if (next.rotation === 0) delete next.rotation;
  if (Object.keys(next).length === 0) return undefined;
  const problem = lineOverrideProblem(next);
  return problem === null ? next as CaptionLineOverride : problem.message;
}
