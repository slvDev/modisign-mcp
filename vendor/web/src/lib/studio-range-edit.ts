// generated from the Modisign monorepo, do not edit
import { clipStarts, cutTransition } from "@/lib/video-timeline";
import { clipSourceStart } from "@/lib/clip-settings";
import { MAX_STUDIO_CLIPS, MIN_CLIP_DURATION, MIN_PHOTO_DURATION, STUDIO_TIME_TOLERANCE } from "@/lib/studio-project";
import type { StudioClip } from "@/lib/studio-state";
import type { ClipSilence, SilenceRange } from "@/lib/studio-silences";

export function synchronizedRanges(clips: StudioClip[], ranges: ClipSilence[]) {
  const starts = clipStarts(clips);
  const intervals = ranges.map((range) => {
    const index = clips.findIndex((clip) => clip.id === range.clipId);
    if (index < 0) throw new Error("Silence clip is missing");
    const clip = clips[index];
    if (clip.track !== "v1" || clip.kind !== "video" || !Number.isFinite(range.start) || !Number.isFinite(range.end)
      || range.start < clip.inPoint || range.end > clip.outPoint || range.end <= range.start) throw new Error("Silences must come from trimmed V1 videos");
    return { start: starts[index] + range.start - clip.inPoint, end: starts[index] + range.end - clip.inPoint };
  }).sort((a, b) => a.start - b.start);
  const union: SilenceRange[] = [];
  for (const range of intervals) {
    const last = union.at(-1);
    if (last !== undefined && range.start <= last.end + STUDIO_TIME_TOLERANCE) last.end = Math.max(last.end, range.end);
    else union.push({ ...range });
  }
  for (const [index, clip] of clips.entries()) {
    const transition = cutTransition(clips, index);
    if (transition === undefined) continue;
    const end = starts[index] + clip.outPoint - clip.inPoint;
    const window = transition.type === "crossfade" ? { start: end - transition.duration, end }
      : { start: end - transition.duration / 2, end: end + transition.duration / 2 };
    if (union.some((range) => range.start < window.end && range.end > window.start)) throw new Error(`Remove the V1 transition after “${clip.label}” before removing these silences.`);
  }
  function warp(time: number) {
    return time - union.reduce((removed, range) => removed + Math.max(0, Math.min(time, range.end) - range.start), 0);
  }
  const retained: StudioClip[] = [];
  const expected = new Map<string, number>();
  const replacements = new Map<string, string>();
  for (const [index, clip] of clips.entries()) {
    const start = starts[index];
    const end = start + clip.outPoint - clip.inPoint;
    const fragments: SilenceRange[] = [];
    let at = start;
    for (const range of union) {
      if (range.end <= at || range.start >= end) continue;
      if (range.start > at) fragments.push({ start: at, end: Math.min(end, range.start) });
      at = Math.min(end, Math.max(at, range.end));
    }
    if (at < end) fragments.push({ start: at, end });
    const pieces = fragments.map((range, part): StudioClip => {
      const duration = range.end - range.start;
      const minimum = clip.kind === "photo" ? MIN_PHOTO_DURATION : MIN_CLIP_DURATION;
      if (duration < minimum - STUDIO_TIME_TOLERANCE) throw new Error(`Silence removal leaves a ${clip.kind} shorter than ${minimum} seconds.`);
      const sourceStart = clipSourceStart(clip) + range.start - start;
      const id = part === 0 ? clip.id : crypto.randomUUID();
      expected.set(id, warp(range.start));
      const next = fragments[part + 1];
      const nextSource = next === undefined ? Infinity : clipSourceStart(clip) + next.start - start;
      return { ...clip, id, ...(clip.track === "v2" ? { track: "v2" as const, start: warp(range.start) } : { track: "v1" as const }),
        ...(clip.kind === "photo" ? { duration, inPoint: 0, outPoint: duration, sourceStart } : { inPoint: sourceStart, outPoint: sourceStart + duration }),
        punchIns: clip.punchIns === undefined ? undefined : clip.punchIns.filter((row) => (part === 0 || row.start >= sourceStart) && row.start < nextSource),
        transition: part === fragments.length - 1 ? clip.transition : undefined };
    });
    if (pieces.length > 0) replacements.set(clip.id, pieces[0].id);
    retained.push(...pieces);
  }
  if (retained.length > MAX_STUDIO_CLIPS) throw new Error("Silence removal would exceed 300 clips.");
  const result = retained.map((clip) => {
    if (clip.transition === undefined) return clip;
    const to = replacements.get(clip.transition.to);
    if (to === undefined) throw new Error(`Remove the V1 transition after “${clip.label}” before removing these silences.`);
    return { ...clip, transition: { ...clip.transition, to } };
  });
  const resultStarts = clipStarts(result);
  for (const [index, clip] of result.entries()) {
    const transition = cutTransition(result, index);
    if (clip.transition !== undefined && (transition === undefined || transition.duration !== clip.transition.duration)) throw new Error(`Silence removal would shorten the V1 transition after “${clip.label}”. Remove that transition first.`);
    const start = expected.get(clip.id);
    if (start === undefined || Math.abs(resultStarts[index] - start) > STUDIO_TIME_TOLERANCE) {
      const affected = result.slice(0, index + 1).filter((item) => item.transition !== undefined).at(-1);
      if (affected === undefined) throw new Error("Silence removal could not preserve clip alignment.");
      throw new Error(`Remove the V1 transition after “${affected.label}” before removing these silences.`);
    }
  }
  return { clips: result, warp };
}
