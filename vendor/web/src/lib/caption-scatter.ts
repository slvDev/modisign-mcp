// generated from the Modisign monorepo, do not edit
import type { Aspect } from "@/lib/aspects";
import { captionLayout, type CaptionMeasure } from "@/lib/caption-layout";
import { LINE_SIZE, type CaptionScatter, type CaptionStyleId } from "@/lib/studio-project";
import { captionCues, captionLines, groupingOf, phraseKey, phrasesFor, scatterMix, type CaptionSource, type ScatterConflict, type ScatterPlan, type ScatterPose } from "@/lib/caption-lines";
import { mixAppearance, type CaptionMix } from "@/lib/caption-mix";
import { mergeLooks, type CaptionLine, type CaptionSettings, type LineTreatment, type TimelineWord } from "@/lib/captions";
import { rasterSizes, sampleRange, sampleTime, type ObstacleField } from "@/lib/caption-obstacles";
import { hash32 } from "@/lib/hash32";
import { clipTime } from "@/lib/studio-projections";
import { timelineTexts, type StudioText } from "@/lib/studio-text";
import type { StudioClip, StudioOverlay } from "@/lib/studio-state";

export type ScatterStage = "fonts" | "overlays" | "plan";
// A failure of one preparation stage; the UI reports it under that stage's fixed words and shows `message`.
export class ScatterError extends Error {
  constructor(readonly stage: ScatterStage, readonly reason: unknown) { super(reason instanceof Error ? reason.message : "Caption placement failed"); }
}
export type ScatterStatus = "off" | "unplanned" | "current" | "stale";
// What a plan is certified against: the caption inputs plus everything that can sit in front of them.
export type ScatterState = CaptionSource & { captions: CaptionSettings | null; overlays: StudioOverlay[]; texts: StudioText[]; clips: StudioClip[]; aspect: Aspect };
// One spoken phrase of a source: every occurrence on the timeline, and its whole text (trims cut words from an occurrence, never from the footprint, so a trim cannot move a phrase) unstyled by any treatment so one subject serves every candidate style. `key` owns the pose in the plan (it holds the transient media id); `identity` is the phrase's anchor, what every random choice hashes; `previous` is its predecessor's anchor in source order.
export type ScatterSubject = { key: string; identity: string; previous: string | null; lines: CaptionLine[]; words: TimelineWord[] };

// Every projected phrase occurrence in source order, as the planner sees it: manual word looks kept, line treatments and any plan dropped.
export function scatterSubjects(state: ScatterState): ScatterSubject[] {
  if (state.captions === null) throw new Error("Scatter needs caption settings");
  const grouping = groupingOf(state.captions);
  const lines = captionLines({ ...state, scatterPlan: null, lineOverrides: {} }, { style: "clean", position: state.captions.position, size: state.captions.size, grouping });
  const subjects = new Map<string, ScatterSubject>();
  for (const line of lines) {
    const { mediaId, phraseId } = line.owner;
    const key = phraseKey(mediaId, phraseId);
    const known = subjects.get(key);
    if (known !== undefined) { known.lines.push(line); continue; }
    const phrases = phrasesFor(state, mediaId, grouping);
    const index = phrases.findIndex((phrase) => phrase.id === phraseId);
    const ids = new Set(phrases[index].wordIds);
    const words = state.transcripts[mediaId].filter((word) => ids.has(word.id)).map((word): TimelineWord => {
      const look = state.wordStyles[mediaId] === undefined ? undefined : state.wordStyles[mediaId][word.id];
      return { ...word, id: `${line.owner.clipId}/${word.id}`, mediaId, clipId: line.owner.clipId, sourceId: word.id, ...(look === undefined ? {} : { look }) };
    });
    subjects.set(key, { key, identity: phrases[index].anchor, previous: index > 0 ? phrases[index - 1].anchor : null, lines: [line], words });
  }
  return [...subjects.values()];
}
// A pure hash of the data a plan depends on (never selection or playhead): the recipe, grouping, aspect, every phrase occurrence with its words and manual looks, overlays with configuration/start/motion and resolved titles.
export function scatterRevision(state: ScatterState): string {
  if (state.captions === null || state.captions.scatter === undefined) throw new Error("A Scatter revision needs a Scatter recipe");
  const phrases = scatterSubjects(state).map((subject) => [subject.key, subject.previous, subject.words.map((word) => [word.sourceId, word.text, word.look]), subject.lines.map((line) => [line.id, line.start, line.end, line.words.map((word) => [word.sourceId, word.start, word.end])])]);
  const titles = timelineTexts(state.texts, state.clips).map((title, index) => [state.texts[index].id, title]);
  const overlays = state.overlays.map((overlay) => [overlay.id, overlay.family.id, overlay.config, overlay.start, overlay.motion]);
  return hash32(JSON.stringify([state.captions.scatter, groupingOf(state.captions), state.aspect, phrases, overlays, titles])).toString(16);
}

// off: no recipe; unplanned: recipe without a plan; stale: the plan was made for other inputs.
export function scatterStatus(state: ScatterState): ScatterStatus {
  if (state.captions === null || state.captions.scatter === undefined) return "off";
  if (state.scatterPlan === null) return "unplanned";
  return state.scatterPlan.revision === scatterRevision(state) ? "current" : "stale";
}

// Why an export waits for Scatter, or null: preview and export must draw the one accepted plan, so a plan that is missing or made for other inputs is refused rather than laid out again in the export alone.
export function scatterExportProblem(status: ScatterStatus) {
  if (status === "unplanned") return "Caption placement has not been prepared yet. Open Captions, choose Layout, then Scatter and place the captions, or turn Scatter off.";
  if (status === "stale") return "The edit changed after the captions were placed. Open Captions, choose Layout, then Scatter and refresh caption placement, or turn Scatter off.";
  return null;
}

type Zone = { x0: number; x1: number; y0: number; y1: number };
const inset = (margin: number): Zone => ({ x0: margin, x1: 1 - margin, y0: margin, y1: 1 - margin });
// Regions the whole rotated, padded block must stay inside, as fractions of the output. Social is Modisign's own conservative guide, not a platform specification.
export const SAFE_ZONES: Record<CaptionScatter["safeZone"], Record<Aspect, Zone>> = {
  social: { "9x16": { x0: 0.08, x1: 0.82, y0: 0.16, y1: 0.65 }, "4x5": { x0: 0.08, x1: 0.92, y0: 0.1, y1: 0.74 }, "1x1": { x0: 0.08, x1: 0.92, y0: 0.1, y1: 0.8 }, "16x9": { x0: 0.06, x1: 0.94, y0: 0.1, y1: 0.8 } },
  frame: { "9x16": inset(0.07), "4x5": inset(0.07), "1x1": inset(0.07), "16x9": inset(0.07) },
};
// Slot centres as fractions of the safe zone.
const SLOTS = [[0.3, 0.1], [0.7, 0.24], [0.3, 0.5], [0.7, 0.62], [0.5, 0.9], [0.5, 0.36]] as const;
export const SCATTER_BASE_SIZE = 0.055;
const INTENSITY = { subtle: { rotation: 3, size: 0.1 }, normal: { rotation: 6, size: 0.2 } } as const;
const SIZE_STEPS = [1, 0.85, 0.72, 0.55];
// Breathing room between a block and anything it avoids, as a fraction of the shorter side.
const CLEARANCE = 0.01;
const SHIFT_PASSES = 3;

type Rect = { x0: number; y0: number; x1: number; y1: number };
export type ScatterInput = { settings: CaptionScatter; aspect: Aspect; subjects: readonly ScatterSubject[]; obstacles: ObstacleField; measure: CaptionMeasure; revision: string };

const unit = (settings: CaptionScatter, key: string, salt: string) => hash32(`${settings.seed}:${key}:${salt}`) / 2 ** 32;
const slotOf = (settings: CaptionScatter, key: string) => hash32(`${settings.seed}:${key}:slot`) % SLOTS.length;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

// The line under a candidate treatment: a Mixed pool member recolours every word from the seed's recipe, manual looks still win.
export function treatedLine(line: CaptionLine, treatment: LineTreatment, mix: CaptionMix | undefined): CaptionLine {
  if (mix === undefined) return { ...line, treatment };
  return { ...line, treatment, words: line.words.map((word) => { const look = mergeLooks(mixAppearance(mix, word.sourceId), word.look); return look === undefined ? word : { ...word, look }; }) };
}
const memoMeasure = (measure: CaptionMeasure): CaptionMeasure => {
  const known = new Map<string, number>();
  return (text, size, face) => {
    const id = `${face.font}|${face.weight}|${face.italic}|${size}|${text}`;
    let width = known.get(id);
    if (width === undefined) { width = measure(text, size, face); known.set(id, width); }
    return width;
  };
};

// Per occurrence, the normalized rect its drawn cues cover at both export rasters; the union over occurrences is what must fit the zone.
function footprints(subject: ScatterSubject, treatment: LineTreatment, mix: CaptionMix | undefined, aspect: Aspect, measure: CaptionMeasure) {
  const rasters = rasterSizes(aspect);
  return subject.lines.map((line) => {
    const rect: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const cue of captionCues([treatedLine({ ...line, words: subject.words }, treatment, mix)])) {
      for (const { width, height } of rasters) {
        for (const corner of captionLayout(cue, cue.start, width, height, measure).corners) {
          rect.x0 = Math.min(rect.x0, corner.x / width); rect.x1 = Math.max(rect.x1, corner.x / width);
          rect.y0 = Math.min(rect.y0, corner.y / height); rect.y1 = Math.max(rect.y1, corner.y / height);
        }
      }
    }
    return rect;
  });
}
const outsideBy = (low: number, high: number, zoneLow: number, zoneHigh: number) => low < zoneLow ? zoneLow - low : high > zoneHigh ? zoneHigh - high : 0;

// The first obstacle a footprint meets across the samples of its occurrence, with the sample time, or null.
function firstCollision(rect: Rect, line: CaptionLine, aspect: Aspect, obstacles: ObstacleField) {
  const { width, height } = rasterSizes(aspect)[0];
  const clearX = CLEARANCE * Math.min(width, height) / width;
  const clearY = CLEARANCE * Math.min(width, height) / height;
  for (const sample of sampleRange(line.start, line.end)) {
    const here = obstacles.get(sample);
    if (here === undefined) throw new Error("An obstacle sample is missing");
    for (const obstacle of here) {
      if (rect.x0 - clearX < obstacle.x1 && rect.x1 + clearX > obstacle.x0 && rect.y0 - clearY < obstacle.y1 && rect.y1 + clearY > obstacle.y0) return { time: sampleTime(sample), owner: obstacle.owner };
    }
  }
  return null;
}

// Plans one phrase: its hash-chosen style, rotation and size, then bounded slots clear of the zone edge and every obstacle (smaller sizes after the slots), or the conflict that stops it. Independent of every other phrase, so order never matters.
export function planPhrase(subject: ScatterSubject, input: Pick<ScatterInput, "settings" | "aspect" | "obstacles" | "measure">): ScatterPose | ScatterConflict {
  const { settings, aspect, obstacles } = input;
  const measure = memoMeasure(input.measure);
  const { identity } = subject;
  const style: CaptionStyleId = settings.styles[hash32(`${settings.seed}:${identity}:style`) % settings.styles.length];
  const mix = style === "mixed" ? scatterMix(settings.seed) : undefined;
  const range = INTENSITY[settings.intensity];
  const rotation = round((unit(settings, identity, "rotation") * 2 - 1) * range.rotation, 1);
  const base = round(SCATTER_BASE_SIZE * (1 + (unit(settings, identity, "size") * 2 - 1) * range.size), 4);
  const own = slotOf(settings, identity);
  const cycle = SLOTS.map((_, step) => (own + step) % SLOTS.length);
  const order = subject.previous !== null && slotOf(settings, subject.previous) === own ? [...cycle.slice(1), own] : cycle;
  const zone = SAFE_ZONES[settings.safeZone][aspect];
  const sizes = [...new Set(SIZE_STEPS.map((step) => Math.min(LINE_SIZE.max, Math.max(LINE_SIZE.min, round(base * step, 4)))))];
  let blocked: { time: number; owner: string } | null = null;
  for (const size of sizes) {
    for (const slot of order) {
      let x = round(zone.x0 + SLOTS[slot][0] * (zone.x1 - zone.x0), 4);
      let y = round(zone.y0 + SLOTS[slot][1] * (zone.y1 - zone.y0), 4);
      let rects: Rect[] = [];
      let inside = false;
      for (let pass = 0; pass < SHIFT_PASSES && !inside; pass++) {
        rects = footprints(subject, { style, ...(mix === undefined ? {} : { mix }), x, y, size, rotation }, mix, aspect, measure);
        const low = { x: Math.min(...rects.map((r) => r.x0)), y: Math.min(...rects.map((r) => r.y0)) };
        const high = { x: Math.max(...rects.map((r) => r.x1)), y: Math.max(...rects.map((r) => r.y1)) };
        const dx = outsideBy(low.x, high.x, zone.x0, zone.x1);
        const dy = outsideBy(low.y, high.y, zone.y0, zone.y1);
        if (dx === 0 && dy === 0) { inside = true; break; }
        // Rounds toward the zone so the stored pose never lands back outside.
        const toward = (value: number, delta: number) => delta > 0 ? Math.ceil(value * 1e4) / 1e4 : Math.floor(value * 1e4) / 1e4;
        if (dx !== 0) x = toward(x + dx, dx);
        if (dy !== 0) y = toward(y + dy, dy);
      }
      if (!inside) continue;
      let hit: { time: number; owner: string } | null = null;
      for (const [index, line] of subject.lines.entries()) {
        hit = firstCollision(rects[index], line, aspect, obstacles);
        if (hit !== null) break;
      }
      if (hit === null) return { x, y, size, rotation, style };
      if (blocked === null) blocked = hit;
    }
  }
  return { key: subject.key, time: blocked === null ? sampleTime(sampleRange(subject.lines[0].start, subject.lines[0].end)[0]) : blocked.time, owner: blocked === null ? "safe-zone" : blocked.owner };
}
export const isConflict = (result: ScatterPose | ScatterConflict): result is ScatterConflict => "owner" in result;

// Poses in key order and conflicts in time order, so equal inputs serialize to equal bytes.
export function assemblePlan(revision: string, results: readonly (readonly [string, ScatterPose | ScatterConflict])[]): ScatterPlan {
  const sorted = [...results].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const poses: Record<string, ScatterPose> = {};
  const conflicts: ScatterConflict[] = [];
  for (const [key, result] of sorted) {
    if (isConflict(result)) conflicts.push(result);
    else poses[key] = result;
  }
  conflicts.sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1));
  return { revision, poses, conflicts };
}

export function planScatter(input: ScatterInput): ScatterPlan {
  return assemblePlan(input.revision, input.subjects.map((subject) => [subject.key, planPhrase(subject, input)] as const));
}

// A conflict in words: when, and what to move.
export function conflictText(conflict: ScatterConflict, state: Pick<ScatterState, "overlays" | "texts">) {
  const at = `No safe space at ${clipTime(conflict.time)}`;
  if (conflict.owner === "safe-zone") return `${at}: this phrase is too long for the safe zone. Shorten it, split the line or choose Frame guide.`;
  const split = conflict.owner.indexOf(":");
  const [kind, id] = [conflict.owner.slice(0, split), conflict.owner.slice(split + 1)];
  if (kind === "overlay") {
    const overlay = state.overlays.find((item) => item.id === id);
    return `${at}: move the overlay${overlay === undefined ? "" : ` "${overlay.preset.name}"`} or choose another layout.`;
  }
  const title = state.texts.find((item) => item.id === id);
  return `${at}: move the title${title === undefined ? "" : ` "${title.text.length > 24 ? `${title.text.slice(0, 24)}...` : title.text}"`} or choose another layout.`;
}

// The conflicts the creator has not accepted: a line placed fully by hand is theirs already, and with `acknowledged` the phrases the current plan already left at the default placement stay accepted.
export function unresolvedConflicts(state: Pick<ScatterState, "lineOverrides" | "scatterPlan">, conflicts: readonly ScatterConflict[], acknowledged: boolean) {
  const accepted = new Set<string>();
  for (const [mediaId, lines] of Object.entries(state.lineOverrides)) {
    for (const [phraseId, line] of Object.entries(lines)) if (line.x !== undefined && line.y !== undefined) accepted.add(phraseKey(mediaId, phraseId));
  }
  if (acknowledged && state.scatterPlan !== null) for (const conflict of state.scatterPlan.conflicts) accepted.add(conflict.key);
  return conflicts.filter((conflict) => !accepted.has(conflict.key));
}
