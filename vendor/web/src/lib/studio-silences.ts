// generated from the Modisign monorepo, do not edit
import { MIN_CLIP_DURATION } from "@/lib/studio-project";

export const SILENCE_WINDOW = 0.02;
export const SILENCE_PADDING = 0.12;
export const SILENCE_LEVELS = { gentle: -44, normal: -38, strong: -32 } as const;
export type SilenceSensitivity = keyof typeof SILENCE_LEVELS;
export type SilenceRange = { start: number; end: number };
export type ClipSilence = SilenceRange & { clipId: string; newId: string };

const yieldThread = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function detectClipSilences(levels: readonly number[] | null, clip: { track: "v1" | "v2"; kind: "video" | "photo"; id: string; inPoint: number; outPoint: number }, timelineStart: number, sensitivity: SilenceSensitivity, shortestPause: number, signal: AbortSignal) {
  if (clip.track !== "v1" || clip.kind !== "video") return [];
  const ranges = await detectSilences(levels, clip.inPoint, clip.outPoint, sensitivity, shortestPause, signal);
  return ranges.map((range) => ({ ...range, clipId: clip.id, timelineStart: timelineStart + range.start - clip.inPoint }));
}

export function createSilenceLevels(duration: number) {
  const sums = new Float64Array(Math.ceil(duration / SILENCE_WINDOW));
  const counts = new Uint32Array(sums.length);
  return {
    async add(channels: Float32Array[], sampleRate: number, timestamp: number, signal: AbortSignal) {
      for (let offset = 0; offset < channels[0].length; offset += 16384) {
        signal.throwIfAborted();
        const end = Math.min(offset + 16384, channels[0].length);
        for (let index = offset; index < end; index++) {
          const bin = Math.floor((timestamp + index / sampleRate) / SILENCE_WINDOW + 1e-8);
          if (bin < 0 || bin >= sums.length) continue;
          for (const channel of channels) { sums[bin] += channel[index] ** 2; counts[bin]++; }
        }
        await yieldThread();
      }
    },
    finish: () => Array.from(sums, (sum, index) => counts[index] === 0 ? 0 : Math.sqrt(sum / counts[index])),
  };
}

export async function detectSilences(levels: readonly number[] | null, inPoint: number, outPoint: number, sensitivity: SilenceSensitivity, shortestPause: number, signal: AbortSignal): Promise<SilenceRange[]> {
  signal.throwIfAborted();
  if (levels === null) return [];
  const first = Math.ceil(inPoint / SILENCE_WINDOW - 1e-8);
  const last = Math.min(levels.length, Math.floor(outPoint / SILENCE_WINDOW + 1e-8));
  const sorted = levels.slice(first, last).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const reference = sorted[Math.floor((sorted.length - 1) * 0.95)];
  const threshold = reference * 10 ** (SILENCE_LEVELS[sensitivity] / 20);
  const ranges: SilenceRange[] = [];
  let pauseStart: number | null = null;
  function finish(end: number) {
    if (pauseStart === null) return;
    const start = pauseStart;
    pauseStart = null;
    if (end - start < shortestPause - 1e-8) return;
    const paddedStart = start <= inPoint + SILENCE_WINDOW ? inPoint : start + SILENCE_PADDING;
    const paddedEnd = end >= outPoint - SILENCE_WINDOW ? outPoint : end - SILENCE_PADDING;
    if (paddedEnd > paddedStart) ranges.push({ start: paddedStart, end: paddedEnd });
  }
  for (let index = first; index < last; index++) {
    if ((index - first) % 512 === 0) { await yieldThread(); signal.throwIfAborted(); }
    const time = index * SILENCE_WINDOW;
    if (levels[index] <= threshold) { if (pauseStart === null) pauseStart = index === first ? inPoint : time; }
    else finish(time);
  }
  finish(outPoint);
  // Retained speech islands must satisfy the Studio trim contract.
  return ranges.filter((range, index) => {
    const previous = index === 0 ? inPoint : ranges[index - 1].end;
    const next = index === ranges.length - 1 ? outPoint : ranges[index + 1].start;
    return (range.start === inPoint || range.start - previous >= MIN_CLIP_DURATION - 1e-8) && (range.end === outPoint || next - range.end >= MIN_CLIP_DURATION - 1e-8);
  });
}
