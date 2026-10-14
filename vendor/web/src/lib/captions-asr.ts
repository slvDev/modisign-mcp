// generated from the Modisign monorepo, do not edit
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { SPEECH_FILES, SPEECH_MODEL, SPEECH_REVISION, type CaptionWord } from "./captions";

const MODEL_CACHE = "transformers-cache";
export type AsrBackend = "wasm";
export type AsrProgress = { phase: "download" | "transcribe"; fraction: number; backend: AsrBackend };
export type AsrMessage = { type: "progress"; progress: AsrProgress } | { type: "done"; words: CaptionWord[]; backend: AsrBackend } | { type: "error"; message: string; backend: AsrBackend };
export async function modelCacheState() {
  if (!(await caches.has(MODEL_CACHE))) return { complete: false, present: false };
  const keys = await (await caches.open(MODEL_CACHE)).keys();
  const prefix = `https://huggingface.co/${SPEECH_MODEL}/resolve/${SPEECH_REVISION}/`;
  const complete = SPEECH_FILES.every((file) => keys.some((key) => key.url === prefix + file));
  return { complete, present: keys.length > 0 };
}
export async function removeModel() { await caches.delete(MODEL_CACHE); }

export function captionTranscriber(signal: AbortSignal, onProgress: (progress: AsrProgress) => void, workerUrl?: URL) {
  const worker = workerUrl === undefined
    ? new Worker(new URL("./captions-worker.ts", import.meta.url), { type: "module" })
    : new Worker(workerUrl, { type: "module" });
  let failure: Error | null = null;
  let pending: { resolve: (result: { words: CaptionWord[]; backend: AsrBackend }) => void; reject: (error: Error) => void } | null = null;
  function dispose() {
    worker.terminate();
    signal.removeEventListener("abort", abort);
  }
  function abort() {
    dispose();
    if (pending !== null) { pending.reject(new DOMException("Caption generation canceled", "AbortError")); pending = null; }
  }
  signal.addEventListener("abort", abort, { once: true });
  worker.onmessage = (event: MessageEvent<AsrMessage>) => {
    const message = event.data;
    if (message.type === "progress") onProgress(message.progress);
    else if (pending !== null) {
      if (message.type === "done") pending.resolve(message);
      else pending.reject(new Error(message.message));
      pending = null;
    }
  };
  worker.onerror = (event) => {
    failure = new Error(event.message);
    if (pending !== null) { pending.reject(failure); pending = null; }
    dispose();
  };
  return { dispose, transcribe: (pcm: Float32Array) => {
    signal.throwIfAborted();
    if (failure !== null) throw failure;
    if (pending !== null) throw new Error("Speech worker is already transcribing");
    return new Promise<{ words: CaptionWord[]; backend: AsrBackend }>((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage({ pcm }, [pcm.buffer]);
    });
  } };
}
export async function speechPcm(file: File, duration: number, signal: AbortSignal) {
  const rate = 16000;
  const pcm = new Float32Array(Math.ceil(duration * rate));
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (audio === null) return null;
    if (!(await audio.canDecode())) throw new Error("This browser cannot decode the video's audio.");
    const video = await input.getPrimaryVideoTrack();
    if (video === null) throw new Error("This video has no picture.");
    const origin = Math.max(0, Math.min(await audio.getFirstTimestamp(), await video.getFirstTimestamp()));
    for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers(origin, origin + duration)) {
      signal.throwIfAborted();
      const start = Math.max(0, Math.ceil((timestamp - origin) * rate));
      const end = Math.min(pcm.length, Math.ceil((timestamp - origin + buffer.duration) * rate));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
      for (let i = start; i < end; i++) {
        const position = Math.max(0, (origin + i / rate - timestamp) * buffer.sampleRate);
        const first = Math.min(buffer.length - 1, Math.floor(position));
        const second = Math.min(buffer.length - 1, first + 1);
        for (const data of channels) pcm[i] += (data[first] + (data[second] - data[first]) * (position - first)) / channels.length;
      }
    }
    return pcm;
  } finally { input.dispose(); }
}
