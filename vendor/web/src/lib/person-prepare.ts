// generated from the Modisign monorepo, do not edit
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, VideoSampleSink } from "mediabunny";
import { PERSON_MASK_BYTES, PERSON_MASK_SIZE, type PersonAssetUrls } from "./person-manifest";
import { createPersonJobs } from "./person-jobs";
import type { PersonExportMasks, PersonParams, PersonPicture } from "./person-masks";
import { contextFirst, coveringPictures, exportWindow, pictureIndex, precedingTimes } from "./person-plan";
import { createPersonSegmenter, type PersonSegmenter } from "./person-segmenter";
import { DESKTOP_PERSON_BUDGET, PersonBudgetError, createPersonStore, pictureKey } from "./person-store";
import { isPhotoFile } from "./studio-photo";
import { sourceOrigin } from "./video-timeline";

// A span of one owner clip in its CLIP SOURCE SECONDS (0 = the start of the media after the shared audio/video origin, like StudioClip.inPoint/outPoint); a photo has one picture whatever the span.
export type PersonRange = { file: File; kind: "video" | "photo"; start: number; end: number };
export type PersonProgress = { prepared: number; total: number };
export type PersonPrepareStage = "model" | "masks";
// A stable snapshot for useSyncExternalStore; replaced on every status change.
export type PersonStatus = { readonly version: number; readonly busy: boolean; readonly stage: PersonPrepareStage | null };
export type PersonPrepareOptions = { signal: AbortSignal; onProgress?: (progress: PersonProgress) => void; onStage?: (stage: PersonPrepareStage) => void };
export type PersonSessionOptions = { budget?: number; urls?: PersonAssetUrls };

export interface PersonSession extends PersonExportMasks {
  // Infers (once per exact picture; held pictures cost nothing) every raw mask the range needs plus two pictures of smoothing context, and pins them until `release(range)`, `clear()` or `dispose()`. Concurrent identical requests share one job that stops when the last waiter leaves; abort terminates the segmenter. Throws PersonBudgetError (naming a section that fits) when the range does not fit.
  prepare(range: PersonRange, options: PersonPrepareOptions): Promise<void>;
  // Number of pictures the range shows, from packet metadata only (no decode); caches the source's picture table.
  count(range: PersonRange, signal: AbortSignal): Promise<number>;
  // How many of the range's pictures are ready, or null until `count` or `prepare` has read this source.
  coverage(range: PersonRange): PersonProgress | null;
  // The picture shown at a clip source time (the last one starting at or before it; a photo's only picture), or null until `count` or `prepare` has read this source. No I/O.
  pictureAt(file: File, kind: "video" | "photo", sourceTime: number): PersonPicture | null;
  // Unpins a prepared range; its masks stay until evicted.
  release(range: PersonRange): void;
  // Drops the export windows' pins and terminates the people worker, unless a job runs (then a no-op). Masks stay.
  releaseRuntime(): void;
  // Drops every mask and pin and aborts running jobs. The session stays usable.
  clear(): void;
  // `clear()`, then terminates the worker and drops listeners; the session is unusable afterwards.
  dispose(): void;
  subscribe(listener: () => void): () => void;
  snapshot(): PersonStatus;
  bytes(): { raw: number; derived: number; total: number; budget: number };
}

type Index = { times: number[]; keys: Set<number>; origin: number };
type Watch = { onProgress?: (progress: PersonProgress) => void; onStage?: (stage: PersonPrepareStage) => void };
const PROGRESS_INTERVAL_MS = 100;
const MIB = 2 ** 20;

async function readIndex(file: File, kind: "video" | "photo"): Promise<Index> {
  if (kind === "photo") return { times: [0], keys: new Set([0]), origin: 0 };
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (video === null) throw new Error("Video picture is unavailable");
    const audio = await input.getPrimaryAudioTrack();
    const origin = sourceOrigin(await video.getFirstTimestamp(), audio === null ? null : await audio.getFirstTimestamp());
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) times.push(packet.timestamp);
    times.sort((a, b) => a - b);
    for (let index = 1; index < times.length; index++) if (pictureKey(times[index]) === pictureKey(times[index - 1])) throw new Error(`The source has two pictures at ${times[index]} s`);
    return { times, keys: new Set(times.map(pictureKey)), origin };
  } finally { input.dispose(); }
}

export function createPersonSession(options: PersonSessionOptions = {}): PersonSession {
  const budget = options.budget ?? DESKTOP_PERSON_BUDGET;
  const store = createPersonStore({ budget });
  const listeners = new Set<() => void>();
  const indexes = new WeakMap<File, Promise<Index>>();
  const resolved = new WeakMap<File, Index>();
  const ids = new WeakMap<File, number>();
  const pins = new Map<string, () => void>();
  const exportPins = new Map<File, () => void>();
  const watchers = new Map<string, Set<Watch>>();
  const states = new Map<string, { stage: PersonPrepareStage | null; progress: PersonProgress | null }>();
  let runtime: { controller: AbortController; segmenter: PersonSegmenter | null } | null = null;
  let surface: { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } | null = null;
  let stage: PersonPrepareStage | null = null;
  let status: PersonStatus = { version: 0, busy: false, stage: null };
  let disposed = false;
  let lastId = 0;

  const jobs = createPersonJobs(() => notify());
  function notify() {
    status = { version: status.version + 1, busy: jobs.busy(), stage: jobs.busy() ? stage : null };
    listeners.forEach((listener) => listener());
  }
  function idOf(file: File) {
    let id = ids.get(file);
    if (id === undefined) { id = ++lastId; ids.set(file, id); }
    return id;
  }
  function indexOf(file: File, kind: "video" | "photo") {
    let found = indexes.get(file);
    if (found === undefined) {
      found = readIndex(file, kind).then((index) => { resolved.set(file, index); return index; }, (error) => { indexes.delete(file); throw error; });
      indexes.set(file, found);
    }
    return found;
  }
  const spanOf = (range: PersonRange, index: Index) => range.kind === "photo" ? { first: 0, last: 0 } : coveringPictures(index.times, index.origin + range.start, index.origin + range.end);
  function coverageOf(file: File, times: readonly number[], first: number, last: number): PersonProgress {
    let prepared = 0;
    for (let index = first; index <= last; index++) if (store.ready({ file, time: times[index] })) prepared++;
    return { prepared, total: last - first + 1 };
  }

  function stopRuntime() {
    runtime?.controller.abort();
    runtime = null;
  }
  async function acquire(signal: AbortSignal, onStage: (next: PersonPrepareStage) => void) {
    if (runtime?.segmenter) return runtime.segmenter;
    const mine = { controller: new AbortController(), segmenter: null as PersonSegmenter | null };
    runtime = mine;
    onStage("model");
    try {
      mine.segmenter = await createPersonSegmenter({ signal: mine.controller.signal, urls: options.urls });
    } catch (error) {
      if (runtime === mine) runtime = null;
      signal.throwIfAborted();
      throw error;
    }
    signal.throwIfAborted();
    return mine.segmenter;
  }

  function reduce(draw: (context: OffscreenCanvasRenderingContext2D) => void) {
    if (surface === null) {
      const canvas = new OffscreenCanvas(PERSON_MASK_SIZE, PERSON_MASK_SIZE);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("Canvas 2D is unavailable");
      context.imageSmoothingQuality = "high";
      surface = { canvas, context };
    }
    surface.context.fillStyle = "#000";
    surface.context.fillRect(0, 0, PERSON_MASK_SIZE, PERSON_MASK_SIZE);
    draw(surface.context);
    return surface.canvas.transferToImageBitmap();
  }

  // Decodes the pictures [from, to] of one source that have no raw mask yet, one owned sample at a time, and infers them with at most one picture queued behind the one in inference.
  async function fill(file: File, kind: "video" | "photo", { times, keys }: Index, from: number, to: number, signal: AbortSignal, onStage: (next: PersonPrepareStage) => void, published: () => void) {
    const wanted = new Map<number, number>();
    for (let index = from; index <= to; index++) if (!store.has({ file, time: times[index] })) wanted.set(pictureKey(times[index]), index);
    if (wanted.size === 0) return;
    const segmenter = await acquire(signal, onStage);
    onStage("masks");
    const writer = store.writer();
    const queue: { flying: { picture: PersonPicture; index: number; mask: Promise<Uint8Array> } | null } = { flying: null };
    const publish = async (item: NonNullable<typeof queue.flying>) => {
      const raw = await item.mask;
      if (!writer.put(item.picture, raw, precedingTimes(times, item.index))) throw signal.aborted ? signal.reason : new Error("The mask store was cleared");
      published();
    };
    const submit = async (picture: PersonPicture, index: number, bitmap: ImageBitmap) => {
      try { if (queue.flying !== null) await publish(queue.flying); } catch (error) { bitmap.close(); throw error; }
      const mask = segmenter.segment(bitmap, signal);
      // Observed at creation: a cancel or worker crash while the next picture decodes is no unhandled rejection; `publish` still awaits it.
      mask.catch(() => undefined);
      queue.flying = { picture, index, mask };
    };
    try {
      if (kind === "photo") {
        const image = await createImageBitmap(file, { imageOrientation: "from-image" });
        let bitmap: ImageBitmap;
        try { signal.throwIfAborted(); bitmap = reduce((context) => context.drawImage(image, 0, 0, PERSON_MASK_SIZE, PERSON_MASK_SIZE)); } finally { image.close(); }
        await submit({ file, time: 0 }, 0, bitmap);
      } else {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (track === null) throw new Error("Video picture is unavailable");
          const firstMissing = Math.min(...wanted.values());
          const lastMissing = Math.max(...wanted.values());
          for await (const sample of new VideoSampleSink(track).samples(times[firstMissing], times[lastMissing] + 1e-6)) {
            let bitmap: ImageBitmap | null = null;
            let index: number | undefined;
            try {
              signal.throwIfAborted();
              index = wanted.get(pictureKey(sample.timestamp));
              if (index === undefined) {
                if (!keys.has(pictureKey(sample.timestamp))) throw new Error(`The decoder returned a picture at ${sample.timestamp} s that the source's packets do not list`);
                continue;
              }
              bitmap = reduce((context) => sample.draw(context, 0, 0, PERSON_MASK_SIZE, PERSON_MASK_SIZE));
            } finally { sample.close(); }
            await submit({ file, time: sample.timestamp }, index, bitmap);
          }
        } finally { input.dispose(); }
      }
      if (queue.flying !== null) await publish(queue.flying);
    } finally { writer.close(); }
    signal.throwIfAborted();
    const absent = [...wanted.values()].filter((index) => !store.has({ file, time: times[index] }));
    if (absent.length > 0) throw new Error(`The decoder returned no picture for ${absent.length} of ${wanted.size} source pictures`);
  }

  // A running job's work: its failure drops the people worker so Retry starts a fresh one, and aborting terminates it.
  async function guarded(signal: AbortSignal, work: () => Promise<void>) {
    const kill = () => stopRuntime();
    signal.addEventListener("abort", kill, { once: true });
    try { await work(); } catch (error) {
      if (!signal.aborted) stopRuntime();
      throw error;
    } finally { signal.removeEventListener("abort", kill); }
  }

  // A section holds its picture on screen at the start, every picture starting inside it and two of context: at most capacity - 3 picture starts in any window of the advised length, wherever it begins.
  function budgetAdvice(error: unknown, index: Index) {
    if (!(error instanceof PersonBudgetError)) return error;
    const starts = error.capacity - 3;
    let seconds = 0;
    if (starts >= 1 && index.times.length > starts) {
      seconds = Infinity;
      for (let at = 0; at + starts < index.times.length; at++) seconds = Math.min(seconds, index.times[at + starts] - index.times[at]);
    }
    const mib = (pictures: number) => Math.round(pictures * PERSON_MASK_BYTES / MIB * 10) / 10;
    return new PersonBudgetError(`Preparing ${error.requested} pictures needs ${mib(error.requested)} MiB of masks but only ${mib(error.capacity)} MiB (${error.capacity} pictures) is free. Choose a section of up to ${Math.floor(seconds * 100) / 100} seconds.`, error.requested, error.capacity);
  }

  // Export has no section to choose: what leaves no room is the prepared sections the session holds.
  function exportAdvice(error: unknown) {
    if (!(error instanceof PersonBudgetError)) return error;
    return new PersonBudgetError(`Exporting needs room for ${error.requested} person masks at a time but only ${error.capacity} fit next to the prepared sections. Clear the prepared masks in Behind person and export again.`, error.requested, error.capacity);
  }

  const session: PersonSession = {
    async prepare(range, { signal, onProgress, onStage }) {
      if (disposed) throw new Error("The person session was disposed");
      const key = `prepare:${idOf(range.file)}:${range.kind}:${range.start}:${range.end}`;
      const watch: Watch = { onProgress, onStage };
      let set = watchers.get(key);
      if (set === undefined) { set = new Set(); watchers.set(key, set); }
      set.add(watch);
      const seen = states.get(key);
      if (seen?.stage) onStage?.(seen.stage);
      if (seen?.progress) onProgress?.(seen.progress);
      const emit = (next: (target: Watch) => void) => watchers.get(key)?.forEach(next);
      const work = (jobSignal: AbortSignal) => guarded(jobSignal, async () => {
        states.set(key, { stage: null, progress: null });
        const state = states.get(key)!;
        const index = await indexOf(range.file, range.kind);
        jobSignal.throwIfAborted();
        const { first, last } = spanOf(range, index);
        const from = contextFirst(first);
        const pinKey = `${idOf(range.file)}:${range.kind}:${from}:${last}`;
        const total = last - first + 1;
        const report = () => { state.progress = { prepared: coverageOf(range.file, index.times, first, last).prepared, total }; emit((target) => target.onProgress?.(state.progress!)); };
        report();
        if (!pins.has(pinKey)) {
          try { pins.set(pinKey, store.pin(range.file, index.times.slice(from, last + 1))); } catch (error) { throw budgetAdvice(error, index); }
        }
        let reported = performance.now();
        try {
          await fill(range.file, range.kind, index, from, last, jobSignal, (next) => { stage = state.stage = next; emit((target) => target.onStage?.(next)); notify(); }, () => {
            const now = performance.now();
            if (now - reported >= PROGRESS_INTERVAL_MS) { reported = now; report(); }
          });
        } catch (error) { pins.get(pinKey)?.(); pins.delete(pinKey); throw error; }
        report();
      });
      try { await jobs.run(key, work, signal); } finally {
        watchers.get(key)?.delete(watch);
        if (watchers.get(key)?.size === 0) { watchers.delete(key); states.delete(key); }
      }
    },
    async count(range, signal) {
      const index = await indexOf(range.file, range.kind);
      signal.throwIfAborted();
      const { first, last } = spanOf(range, index);
      return last - first + 1;
    },
    coverage(range) {
      const index = resolved.get(range.file);
      if (index === undefined) return null;
      const { first, last } = spanOf(range, index);
      return coverageOf(range.file, index.times, first, last);
    },
    pictureAt(file, kind, sourceTime) {
      if (kind === "photo") return { file, time: 0 };
      const index = resolved.get(file);
      if (index === undefined) return null;
      const { first } = coveringPictures(index.times, index.origin + sourceTime, index.origin + sourceTime);
      return { file, time: index.times[first] };
    },
    release(range) {
      const index = resolved.get(range.file);
      if (index === undefined) return;
      const { first, last } = spanOf(range, index);
      const pinKey = `${idOf(range.file)}:${range.kind}:${contextFirst(first)}:${last}`;
      pins.get(pinKey)?.();
      pins.delete(pinKey);
    },
    releaseRuntime() {
      if (jobs.busy()) return;
      exportPins.forEach((release) => release());
      exportPins.clear();
      stopRuntime();
    },
    clear() {
      jobs.abortAll(new DOMException("Person masks were cleared", "AbortError"));
      pins.forEach((release) => release());
      pins.clear();
      exportPins.forEach((release) => release());
      exportPins.clear();
      store.clear();
      notify();
    },
    dispose() {
      session.clear();
      stopRuntime();
      disposed = true;
      listeners.clear();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => status,
    bytes: () => store.bytes(),
    alpha: (picture, params) => store.alpha(picture, params),
    ready: (picture) => store.ready(picture),
    async ensure(picture: PersonPicture, params: PersonParams, signal: AbortSignal) {
      if (disposed) throw new Error("The person session was disposed");
      if (!store.ready(picture)) {
        const kind = isPhotoFile(picture.file) ? "photo" : "video";
        const key = `window:${idOf(picture.file)}:${pictureKey(picture.time)}`;
        await jobs.run(key, (jobSignal) => guarded(jobSignal, async () => {
          const index = await indexOf(picture.file, kind);
          const at = pictureIndex(index.times, picture.time);
          const { first, last } = exportWindow(index.times, at, budget);
          exportPins.get(picture.file)?.();
          exportPins.delete(picture.file);
          try { exportPins.set(picture.file, store.pin(picture.file, index.times.slice(first, last + 1))); } catch (error) { throw exportAdvice(error); }
          await fill(picture.file, kind, index, first, last, jobSignal, (next) => { stage = next; notify(); }, () => undefined);
        }), signal);
      }
      if (store.alpha(picture, params) === null) throw new Error(`The person mask at ${picture.time} s is not available after preparing it`);
    },
  };
  return session;
}
