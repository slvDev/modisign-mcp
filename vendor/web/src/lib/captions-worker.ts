// generated from the Modisign monorepo, do not edit
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { version } from "../../../../node_modules/@huggingface/transformers/package.json";
import { SPEECH_MODEL, SPEECH_REVISION, stitchCaptionWindows, type CaptionWindow } from "./captions";
import type { AsrBackend, AsrMessage } from "./captions-asr";

env.allowLocalModels = false;
env.useBrowserCache = true;
if (new URL(self.location.href).pathname === "/captions-worker.js") env.remoteHost = `${self.location.origin}/models/`;
const wasm = env.backends.onnx.wasm;
if (wasm === undefined) throw new Error("The speech WASM runtime is unavailable");
wasm.numThreads = 1;
wasm.wasmPaths = `${self.location.origin}/speech-runtime/${version}/`;
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
// q8 Whisper decoders produce invalid text on WebGPU (transformers.js#1317).
const backend: AsrBackend = "wasm";
const send = (message: AsrMessage) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<{ pcm: Float32Array }>) => {
  try {
    if (transcriber === null) {
      send({ type: "progress", progress: { phase: "download", fraction: 0, backend } });
      const downloads = new Map<string, { loaded: number; total: number }>();
      const options = {
        revision: SPEECH_REVISION, device: backend, dtype: "q8" as const,
        progress_callback: (progress: import("@huggingface/transformers").ProgressInfo) => {
          if (progress.status === "progress") {
            downloads.set(progress.file, { loaded: progress.loaded, total: progress.total });
            const values = [...downloads.values()];
            const total = values.reduce((sum, value) => sum + value.total, 0);
            send({ type: "progress", progress: { phase: "download", fraction: total > 0 ? values.reduce((sum, value) => sum + value.loaded, 0) / Math.max(42990000, total) : 0, backend } });
          }
        },
      };
      transcriber = await pipeline<"automatic-speech-recognition">("automatic-speech-recognition", SPEECH_MODEL, options);
      send({ type: "progress", progress: { phase: "download", fraction: 1, backend } });
    }
    const { pcm } = event.data;
    const windows: CaptionWindow[] = [];
    for (let offset = 0; offset < pcm.length; offset += 24 * 16000) {
      const end = Math.min(pcm.length, offset + 28 * 16000);
      send({ type: "progress", progress: { phase: "transcribe", fraction: offset === 0 ? 0 : (offset + 2 * 16000) / pcm.length, backend } });
      const output = await transcriber(pcm.slice(offset, end), { return_timestamps: "word" });
      if (Array.isArray(output) || output.chunks === undefined) throw new Error("The speech model returned no word timestamps.");
      const last = end === pcm.length;
      windows.push({ offset: offset / 16000, duration: (end - offset) / 16000, first: offset === 0, last, chunks: output.chunks });
      send({ type: "progress", progress: { phase: "transcribe", fraction: last ? 1 : (end - 2 * 16000) / pcm.length, backend } });
      if (last) break;
    }
    send({ type: "done", words: stitchCaptionWindows(windows), backend });
  } catch (error) {
    send({ type: "error", message: `${error instanceof Error ? error.message : "Caption generation failed."} Try a shorter video in Chrome or Edge.`, backend });
  }
};
