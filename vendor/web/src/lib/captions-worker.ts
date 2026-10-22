// generated from the Modisign monorepo, do not edit
import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from "@huggingface/transformers";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample } from "mediabunny";
import { version } from "../../../../node_modules/@huggingface/transformers/package.json";
import { sourceOrigin } from "@/lib/video-timeline";
import { ASR_BACKEND, SPEECH_MODEL, SPEECH_REVISION, stitchCaptionWindows, type CaptionWindow } from "./captions";
import { pcmWindows, SPEECH_RATE, type DecodedAudio } from "./captions-windows";
import type { AsrMessage, AsrRequest } from "./captions-asr";
import type { MarkDetail } from "./media-diagnostics";

env.allowLocalModels = false;
env.useBrowserCache = true;
if (new URL(self.location.href).pathname === "/captions-worker.js") env.remoteHost = `${self.location.origin}/models/`;
const wasm = env.backends.onnx.wasm;
if (wasm === undefined) throw new Error("The speech WASM runtime is unavailable");
wasm.numThreads = 1;
// Both files are named: a directory prefix still lets ORT pick the Asyncify/JSEP build.
const RUNTIME_FILES = { mjs: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" } as const;
const runtimeBase = `${self.location.origin}/speech-runtime/${version}/`;
wasm.wasmPaths = { mjs: runtimeBase + RUNTIME_FILES.mjs, wasm: runtimeBase + RUNTIME_FILES.wasm };

const AUDIO_UNSUPPORTED = "This browser cannot decode the audio needed for captions. Update your browser. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later.";
const FAILED = { audio: "Audio preparation failed", model: "Speech model failed to load", inference: "Transcription failed" } as const;
const PROGRESS_INTERVAL_MS = 250;
const FIRST_WINDOW_SECONDS = 28;
const OVERLAP_SECONDS = 2;

class AudioUnsupported extends Error {}

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let debug = false;
let openInputs = 0;
const send = (message: AsrMessage) => self.postMessage(message);
function phase(name: string, detail: MarkDetail | null = null) {
  if (debug) send({ type: "phase", name, state: "start", detail });
  return (outcome: MarkDetail | null = null) => { if (debug) send({ type: "phase", name, state: "end", detail: outcome }); };
}
function inputsChanged(change: number) {
  openInputs += change;
  if (debug) send({ type: "inputs", open: openInputs });
}

// What the browser actually fetched for the ORT runtime, so a JSEP build can never hide behind the configured names.
function loadedRuntime(): MarkDetail {
  const files = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .map((entry) => ({ name: new URL(entry.name).pathname.split("/").pop() as string, bytes: entry.decodedBodySize }))
    .filter(({ name }) => name.startsWith("ort-wasm"));
  const binary = files.find(({ name }) => name.endsWith(".wasm"));
  return {
    files: files.map(({ name }) => name).join(" "), wasmBytes: binary === undefined ? null : binary.bytes,
    variant: files.length === 0 ? "unobserved" : files.some(({ name }) => name.includes(".jsep")) ? "jsep" : "plain",
  };
}

const reportCapabilities = () => {
  if (!debug) return;
  send({ type: "mark", name: "capabilities", detail: {
    backend: ASR_BACKEND, ort: env.backends.onnx.versions?.web ?? null, threads: wasm.numThreads ?? null, proxy: wasm.proxy ?? null, simd: wasm.simd ?? null,
    configuredMjs: RUNTIME_FILES.mjs, configuredWasm: RUNTIME_FILES.wasm,
    audioDecoder: typeof AudioDecoder !== "undefined", sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined", crossOriginIsolated: self.crossOriginIsolated,
  } });
};

async function loadModel(id: number) {
  if (transcriber !== null) return transcriber;
  const end = phase("model:load");
  const report = (fraction: number | null) => send({ type: "progress", id, progress: { phase: "model", fraction } });
  report(null);
  const downloads = new Map<string, { loaded: number; total: number }>();
  const options = {
    revision: SPEECH_REVISION, device: ASR_BACKEND, dtype: "q8" as const,
    progress_callback: (progress: ProgressInfo) => {
      if (progress.status === "progress") {
        downloads.set(progress.file, { loaded: progress.loaded, total: progress.total });
        const values = [...downloads.values()];
        const total = values.reduce((sum, value) => sum + value.total, 0);
        report(total > 0 ? values.reduce((sum, value) => sum + value.loaded, 0) / Math.max(42990000, total) : null);
      }
    },
  };
  transcriber = await pipeline<"automatic-speech-recognition">("automatic-speech-recognition", SPEECH_MODEL, options);
  report(1);
  end();
  if (debug) send({ type: "mark", name: "model:ready", detail: loadedRuntime() });
  return transcriber;
}

// Planar mono-or-more f32 copy of one decoded sample; the sample is closed before anything else happens.
function planes(sample: AudioSample): DecodedAudio {
  try {
    const channels = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
      const data = new Float32Array(sample.numberOfFrames);
      sample.copyTo(data, { planeIndex, format: "f32-planar" });
      return data;
    });
    return { timestamp: sample.timestamp, sampleRate: sample.sampleRate, channels };
  } finally { sample.close(); }
}

async function* decoded(sink: AudioSampleSink, origin: number, duration: number): AsyncGenerator<DecodedAudio> {
  for await (const sample of sink.samples(origin, origin + duration)) {
    if (sample.numberOfFrames === 0) sample.close();
    else yield planes(sample);
  }
}

async function transcribe({ id, file, duration }: AsrRequest) {
  let stage: keyof typeof FAILED = "audio";
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  inputsChanged(1);
  try {
    const opened = phase("audio:open");
    const audio = await input.getPrimaryAudioTrack();
    if (audio === null) { opened({ audio: false }); send({ type: "done", id, words: [], audio: false }); return; }
    if (!(await audio.canDecode())) throw new AudioUnsupported(AUDIO_UNSUPPORTED);
    const video = await input.getPrimaryVideoTrack();
    if (video === null) throw new Error("This video has no picture.");
    const origin = sourceOrigin(await video.getFirstTimestamp(), await audio.getFirstTimestamp());
    opened({ audio: true, duration });
    stage = "model";
    const model = await loadModel(id);
    stage = "audio";
    const firstWindow = Math.min(duration, FIRST_WINDOW_SECONDS);
    let preparing = true;
    let reportedAt = 0;
    const source = async function* () {
      send({ type: "progress", id, progress: { phase: "audio", seconds: 0, total: firstWindow } });
      for await (const buffer of decoded(new AudioSampleSink(audio), origin, duration)) {
        const now = performance.now();
        if (preparing && now - reportedAt >= PROGRESS_INTERVAL_MS) {
          reportedAt = now;
          const reached = buffer.timestamp - origin + buffer.channels[0].length / buffer.sampleRate;
          send({ type: "progress", id, progress: { phase: "audio", seconds: Math.min(firstWindow, Math.max(0, reached)), total: firstWindow } });
        }
        yield buffer;
      }
    };
    const windows: CaptionWindow[] = [];
    let covered = 0;
    let prepared = phase("window:audio", { index: 0 });
    for await (const part of pcmWindows(source(), origin, Math.ceil(duration * SPEECH_RATE))) {
      const detail = { index: windows.length, offset: part.offset, seconds: part.duration, samples: part.samples.length };
      preparing = false;
      prepared(detail);
      stage = "inference";
      send({ type: "progress", id, progress: { phase: "transcribe", seconds: covered, total: duration } });
      const run = phase("window:transcribe", detail);
      const output = await model(part.samples, { return_timestamps: "word" });
      if (Array.isArray(output) || output.chunks === undefined) throw new Error("The speech model returned no word timestamps.");
      run({ chunks: output.chunks.length });
      windows.push({ offset: part.offset, duration: part.duration, first: part.first, last: part.last, chunks: output.chunks });
      covered = part.last ? duration : part.offset + part.duration - OVERLAP_SECONDS;
      send({ type: "progress", id, progress: { phase: "transcribe", seconds: covered, total: duration } });
      if (!part.last) { stage = "audio"; prepared = phase("window:audio", { index: windows.length }); }
    }
    const stitched = phase("stitch", { windows: windows.length });
    const words = stitchCaptionWindows(windows);
    stitched({ words: words.length });
    if (debug) send({ type: "mark", name: "result", detail: { windows: windows.length, words: words.length } });
    send({ type: "done", id, words, audio: true });
  } catch (error) {
    if (error instanceof AudioUnsupported) { send({ type: "error", id, message: error.message }); return; }
    const reason = error instanceof Error && error.message !== "" ? error.message : "Caption generation failed.";
    send({ type: "error", id, message: `${FAILED[stage]}: ${reason}${/[.!?]$/.test(reason) ? "" : "."} Try a shorter source video or use Studio on a computer.` });
  } finally {
    input.dispose();
    inputsChanged(-1);
  }
}

self.onmessage = (event: MessageEvent<AsrRequest>) => {
  debug = event.data.debug;
  reportCapabilities();
  void transcribe(event.data);
};
