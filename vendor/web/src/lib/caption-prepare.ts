// generated from the Modisign monorepo, do not edit
import { DiagnosticError } from "../../../server/src/diagnostics";
import { compositionCapture } from "@/lib/composition-capture";
import { compositionNotReady, READY_TIMEOUT_MS } from "@/lib/composition-ready";
import { fontString, loadCaptionFonts } from "@/lib/caption-render";
import { loadTextFonts } from "@/lib/text-render";
import { ScatterError, assemblePlan, conflictText, planPhrase, scatterRevision, scatterSubjects, treatedLine, unresolvedConflicts, type ScatterStage, type ScatterState } from "@/lib/caption-scatter";
import { createInkCache, inkFromPixels, obstacleField, sampleRange, type InkCache, type OverlayDescriptor } from "@/lib/caption-obstacles";
import type { CaptionMeasure } from "@/lib/caption-layout";
import { scatterMix, type ScatterPlan } from "@/lib/caption-lines";
import { timelineOverlays } from "@/lib/studio-projections";
import { timelineTexts } from "@/lib/studio-text";

export type ScatterProgress = { text: string; fraction: number | null };
export type PreparedScatter = { plan: ScatterPlan; revision: string };

// Compact ink bounds by overlay frame, shared by every preparation of the tab and never part of undo or a project.
const inkCache = createInkCache();
function yielded() {
  const { promise, resolve } = Promise.withResolvers<void>();
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
  return promise;
}

// Resolves when a frame has loaded and rejects on abort, a failed navigation or the shared readiness deadline, so a stalled page can neither hang the job nor keep the phone's heavy-job gate held.
function frameLoaded(frame: HTMLIFrameElement, signal: AbortSignal) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => reject(compositionNotReady()), READY_TIMEOUT_MS);
  const abort = () => reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  frame.onload = () => resolve();
  frame.onerror = () => reject(new DiagnosticError("The overlay frame failed to load", "frame_load"));
  return promise.finally(() => { clearTimeout(timer); signal.removeEventListener("abort", abort); });
}

// Dedicated hidden frames, not Program's document; each captures overlay frames at their composition size exactly as the export does.
export function analysisFrames(signal: AbortSignal) {
  const frames = new Map<string, { frame: HTMLIFrameElement; capture: Promise<(time: number) => Promise<HTMLImageElement>> }>();
  const scratch = document.createElement("canvas");
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("Canvas 2D is unavailable");
  return {
    async inkAt(overlay: OverlayDescriptor, local: number) {
      let entry = frames.get(overlay.src);
      if (entry === undefined) {
        const frame = document.createElement("iframe");
        frame.width = String(overlay.width); frame.height = String(overlay.height);
        frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
        frame.style.cssText = "position:fixed;top:0;left:0;border:0;opacity:0;pointer-events:none";
        signal.throwIfAborted();
        const loaded = frameLoaded(frame, signal);
        frame.src = overlay.src; document.body.append(frame);
        entry = { frame, capture: loaded.then(() => compositionCapture(frame, overlay.width, overlay.height, signal)) };
        frames.set(overlay.src, entry);
      }
      const image = await (await entry.capture)(local);
      scratch.width = overlay.width; scratch.height = overlay.height;
      context.clearRect(0, 0, overlay.width, overlay.height);
      context.drawImage(image, 0, 0, overlay.width, overlay.height);
      image.src = "";
      return inkFromPixels(context.getImageData(0, 0, overlay.width, overlay.height).data, overlay.width, overlay.height);
    },
    dispose() {
      for (const { frame } of frames.values()) frame.remove();
      frames.clear(); scratch.width = 0; scratch.height = 0;
    },
  };
}

// Plans caption placement for the edit as it is now: awaits every face the pool and the titles need, analyses the overlay frames (at both export rasters' bounds) and title boxes at every 30 fps sample a phrase shows in, then plans each phrase. Aborting releases every frame; nothing is cached but compact bounds. `overlays` replaces the website's preview descriptors with the caller's own sources (MCP's local proxy); `cache` is for tests.
export async function prepareScatter(state: ScatterState, options: { signal: AbortSignal; onProgress: (progress: ScatterProgress) => void; overlays?: OverlayDescriptor[]; cache?: InkCache }): Promise<PreparedScatter> {
  const { signal, onProgress } = options;
  const settings = state.captions === null ? undefined : state.captions.scatter;
  if (settings === undefined) throw new Error("Scatter needs a recipe");
  const revision = scatterRevision(state);
  const subjects = scatterSubjects(state);
  const titles = timelineTexts(state.texts, state.clips);
  const stage = async <T>(name: ScatterStage, work: Promise<T>) => { try { return await work; } catch (error) { if (signal.aborted) throw error; throw new ScatterError(name, error); } };
  onProgress({ text: "Preparing caption fonts…", fraction: null });
  await stage("fonts", Promise.all([
    loadCaptionFonts(settings.styles.flatMap((style) => subjects.map((subject) => treatedLine({ ...subject.lines[0], words: subject.words }, { style, x: 0.5, y: 0.5, size: 0.05, rotation: 0 }, style === "mixed" ? scatterMix(settings.seed) : undefined)))),
    loadTextFonts(titles),
  ]));
  signal.throwIfAborted();
  const canvas = document.createElement("canvas").getContext("2d");
  if (canvas === null) throw new ScatterError("plan", new Error("Canvas 2D is unavailable"));
  const measure: CaptionMeasure = (text, size, face) => { canvas.font = fontString(face, size); return canvas.measureText(text).width; };
  const samples = [...new Set(subjects.flatMap((subject) => subject.lines.flatMap((line) => sampleRange(line.start, line.end))))].sort((a, b) => a - b);
  const frames = analysisFrames(signal);
  try {
    let last = 0;
    const obstacles = await stage("overlays", obstacleField({
      samples, overlays: options.overlays === undefined ? timelineOverlays(state.overlays, state.aspect) : options.overlays, titles: titles.map((title, index) => ({ id: state.texts[index].id, title })), aspect: state.aspect, measure,
      inkAt: frames.inkAt, cache: options.cache === undefined ? inkCache : options.cache, signal,
      onStep: (done, total) => { const now = performance.now(); if (now - last > 100 || done === total) { last = now; onProgress({ text: `Finding space for captions · frame ${done} of ${total}`, fraction: done / total }); } },
    }));
    const results = [];
    let worked = performance.now();
    for (const [index, subject] of subjects.entries()) {
      signal.throwIfAborted();
      results.push([subject.key, await stage("plan", (async () => planPhrase(subject, { settings, aspect: state.aspect, obstacles, measure }))())] as const);
      if (performance.now() - worked > 20) { onProgress({ text: `Placing captions · ${index + 1} of ${subjects.length}`, fraction: (index + 1) / subjects.length }); await yielded(); worked = performance.now(); }
    }
    return { plan: assemblePlan(revision, results), revision };
  } finally { frames.dispose(); }
}

type PrepareOptions = Parameters<typeof prepareScatter>[1];
// The export's placement of a stale or unplanned plan: the plan to apply, or why the export must stop (phrases with no safe space the creator has not accepted; one already left at the default placement in the current plan, or placed by hand, stays accepted).
export async function placeCaptions(state: ScatterState, options: PrepareOptions): Promise<{ plan: ScatterPlan } | { problem: string }> {
  const { plan } = await prepareScatter(state, options);
  const unresolved = unresolvedConflicts(state, plan.conflicts, true);
  if (unresolved.length === 0) return { plan };
  return { problem: `${unresolved.length} caption phrase${unresolved.length === 1 ? " has" : "s have"} no safe space. ${conflictText(unresolved[0], state)} Open Captions, choose Layout, then Scatter to review ${unresolved.length === 1 ? "it" : "them"}.` };
}
