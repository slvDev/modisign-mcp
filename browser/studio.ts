import { readOwnVideo } from "../vendor/web/src/lib/own-video";
import { ImportError } from "../vendor/web/src/lib/import-progress";
import { readStudioPhoto } from "../vendor/web/src/lib/studio-photo";
import { captionTranscriber } from "../vendor/web/src/lib/captions-asr";
import { captionLines, timelineWords } from "../vendor/web/src/lib/captions";
import { detectClipSilences } from "../vendor/web/src/lib/studio-silences";
import { analyseSourceAudio, sourceHasAudio } from "../vendor/web/src/lib/studio-source";
import { studioBudgetProblem, studioReducer, type StudioMedia, type StudioOverlay } from "../vendor/web/src/lib/studio-state";
import { mediaById, studioTimeline } from "../vendor/web/src/lib/studio-projections";
import { clipStarts, studioSize, timelineDuration } from "../vendor/web/src/lib/video-timeline";
import { exportVideoTimeline } from "../vendor/web/src/lib/timeline-export";
import { applyAutoSfx, applyRapidIntro, applyWordStyles, checkRequestedSfx, correctTranscript, editDocument, mapSfx, type EditInput } from "../src/studio-request";
import { SfxLoadError } from "../vendor/web/src/lib/sfx-assets";
import { personTitlesOf } from "../vendor/web/src/lib/person-layer";
import { createPersonSession, type PersonPrepareStage, type PersonSession } from "../vendor/web/src/lib/person-prepare";
import { PersonBudgetError } from "../vendor/web/src/lib/person-store";
import { PersonRuntimeError } from "../vendor/web/src/lib/person-segmenter";
import type { PersonErrorCode } from "../vendor/web/src/lib/person-protocol";
import { ToolError } from "../src/errors";

const PERSON_FAILURES: Record<PersonErrorCode, string> = {
  unsupported: "needs a browser feature the render browser lacks",
  "asset-missing": "files could not be loaded",
  "asset-corrupt": "files failed their integrity check",
  runtime: "could not start on this computer",
  input: "was given a picture it cannot read",
  shape: "gave an output it should not",
  polarity: "failed its self-check on a test picture",
  inference: "failed while finding people",
  worker: "stopped unexpectedly",
};
type BrowserRequest = { input: EditInput; media: { url: string; name: string; type: string; kind: "video" | "photo" }[]; overlays: { src: string; overlay: StudioOverlay }[]; transcriptOnly: boolean };
declare global { interface Window {
  runStudio: (request: BrowserRequest) => Promise<unknown>;
  studioProgress: (fraction: number) => Promise<void>;
  studioStage: (stage: PersonPrepareStage | "captions" | null) => Promise<void>;
  studioWrite: (base64: string) => Promise<void>;
} }
window.runStudio = async (request) => {
  const controller = new AbortController();
  const signal = controller.signal;
  const media: StudioMedia[] = [];
  const levels = new Map<string, number[] | null>();
  const worker = request.input.captions === undefined && !request.transcriptOnly ? null : captionTranscriber(signal, () => {}, new URL("/captions-worker.js", location.origin));
  let people: PersonSession | undefined;
  try {
    for (const [index, source] of request.media.entries()) {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("Local media could not be read");
      const file = new File([await response.blob()], source.name, { type: source.type });
      let loaded;
      try {
        loaded = source.kind === "photo" ? { kind: "photo" as const, source: await readStudioPhoto(file, signal) }
          : { kind: "video" as const, source: await readOwnVideo(file, signal, 180) };
      } catch (error) {
        throw error instanceof ImportError ? new Error(`${source.name} ${error.message}`) : error;
      }
      media.push({ ...loaded, id: `media-${index}`, poster: "", hasAudio: loaded.kind === "video" && await sourceHasAudio(file, signal) });
    }
    let state = editDocument(request.input, media);
    const warnings: string[] = [];
    state.overlays = request.overlays.map((item) => item.overlay);
    state.sfx = mapSfx(request.input, state);
    // Loading the speech model and transcribing can take a while on a first run, so the host names it instead of "rendering".
    const captioned = media.filter((item) => item.kind === "video" && state.clips.some((clip) => clip.track === "v1" && clip.mediaId === item.id));
    let transcribed = 0;
    for (const item of media) {
      if (item.kind === "photo" || !state.clips.some((clip) => clip.track === "v1" && clip.mediaId === item.id)) continue;
      if (worker !== null) {
        await window.studioStage("captions");
        await window.studioProgress(0.1 + 0.1 * transcribed++ / captioned.length);
        const transcript = await worker.transcribe(item.source.file, item.source.duration);
        if (transcript.audio) {
          const corrections = request.input.captions === undefined || request.input.captions.corrections === undefined ? [] : request.input.captions.corrections;
          state.transcripts[item.id] = correctTranscript(transcript.words, corrections);
        }
      }
      if (request.input.remove_silences !== undefined) {
        const analysed = await analyseSourceAudio(item.source.file, item.source.duration, signal, () => {});
        levels.set(item.id, analysed === null ? null : analysed.levels);
      }
    }
    if (worker !== null) await window.studioStage(null);
    if (request.input.captions !== undefined && request.input.captions.word_styles !== undefined) state = applyWordStyles(state, request.input.captions.word_styles);
    if (request.transcriptOnly) {
      const lines = captionLines(timelineWords(state.clips, state.transcripts), "clean");
      const start = request.input.clips[0].in === undefined ? 0 : request.input.clips[0].in;
      return { lines: lines.map((line) => ({ text: line.text, start: line.start + start, end: line.end + start })) };
    }
    if (request.input.remove_silences !== undefined) {
      const { sensitivity, shortest_pause } = request.input.remove_silences;
      const starts = clipStarts(state.clips);
      const ranges = (await Promise.all(state.clips.map((clip, index) => {
        if (clip.track !== "v1" || clip.kind === "photo") return [];
        const found = levels.get(mediaById(state.media, clip.mediaId).id);
        if (found === undefined) throw new Error("Silence levels are missing");
        return detectClipSilences(found, clip, starts[index], sensitivity, shortest_pause, signal);
      }))).flat();
      const next = studioReducer(state, { type: "remove-silences", ranges: ranges.map((range, index) => ({ ...range, newId: `silence-${index}` })) });
      if (next.message !== null) {
        if (next.clips === state.clips) throw new ToolError(next.message);
        warnings.push(next.message);
      }
      state = next;
      checkRequestedSfx(state, request.input);
    }
    if (request.input.rapid_intro !== undefined) state = applyRapidIntro(state, request.input.rapid_intro);
    if (request.input.auto_sfx !== undefined) {
      const auto = applyAutoSfx(state, request.input.auto_sfx);
      state = auto.state;
      warnings.push(...auto.notes);
    }
    const budget = studioBudgetProblem(state);
    if (budget !== null) throw new ToolError(budget);
    const longSide = request.input.quality === "720p" ? 1280 : 1920;
    const timeline = { ...studioTimeline(state), ...studioSize(state.aspect, longSide) };
    if (timelineDuration(timeline.clips) <= 0) throw new ToolError("Silence removal left no footage");
    const frames = state.overlays.map((overlay, index) => {
      const frame = document.createElement("iframe");
      frame.width = String(timeline.overlays[index].width); frame.height = String(timeline.overlays[index].height);
      frame.src = request.overlays[index].src; document.body.append(frame);
      timeline.overlays[index].src = frame.src;
      timeline.overlays[index].startsAt = overlay.start;
      return frame;
    });
    await window.studioProgress(0.2);
    // The session exists only for a request with a person title; its stages reach the host so job_status can name them.
    if (personTitlesOf(timeline.texts).length > 0) {
      const session = createPersonSession();
      people = session;
      let stage: PersonPrepareStage | null = null;
      session.subscribe(() => { const next = session.snapshot().stage; if (next !== stage) { stage = next; void window.studioStage(next); } });
    }
    const blob = await exportVideoTimeline(frames, timeline, { signal, onProgress: (fraction) => { void window.studioProgress(0.2 + fraction * 0.78); }, audioPolicy: "normalize", bitrate: Math.round(8_000_000 * (longSide / 1920) ** 2), ...(people === undefined ? {} : { masks: people }) });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let at = 0; at < bytes.length; at += 256 * 1024) {
      let binary = "";
      for (const byte of bytes.subarray(at, at + 256 * 1024)) binary += String.fromCharCode(byte);
      await window.studioWrite(btoa(binary));
    }
    return { duration: timelineDuration(timeline.clips), width: timeline.width, height: timeline.height, captions: timeline.captions === undefined ? 0 : timeline.captions.lines.length, warnings };
  } catch (error) {
    if (error instanceof ToolError) return { error: error.message, details: error.details };
    if (error instanceof SfxLoadError) return { error: error.message, details: { field: "sfx", asset: error.asset.id } };
    if (error instanceof PersonBudgetError) return { error: error.message, details: { field: "texts.occlusion" } };
    if (error instanceof PersonRuntimeError) return { error: `The people model ${PERSON_FAILURES[error.code]}, so the title cannot go behind people.`, details: { reason: "people_model", code: error.code } };
    throw error;
  } finally {
    people?.dispose();
    if (worker !== null) worker.dispose();
    for (const item of media) URL.revokeObjectURL(item.source.url);
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  }
};
