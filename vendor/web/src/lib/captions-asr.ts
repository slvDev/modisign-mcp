// generated from the Modisign monorepo, do not edit
import { DiagnosticError, type CAPTION_STAGES, type DiagnosticCode } from "../../../server/src/diagnostics";
import { SPEECH_FILES, SPEECH_MODEL, SPEECH_REVISION, type CaptionWord } from "./captions";
import { diagnosticsEnabled, mark, phase, registerSnapshot, type MarkDetail } from "./media-diagnostics";

const MODEL_CACHE = "transformers-cache";
// `fraction` is null until the download reports bytes; audio and transcribe progress is source seconds `seconds` of `total`.
export type AsrProgress = { phase: "model"; fraction: number | null } | { phase: "audio" | "transcribe"; seconds: number; total: number };
export type AsrRequest = { type: "transcribe"; id: number; file: File; duration: number; debug: boolean };
export type AsrMessage =
  | { type: "progress"; id: number; progress: AsrProgress }
  | { type: "done"; id: number; words: CaptionWord[]; audio: boolean }
  | { type: "error"; id: number; message: string; stage: typeof CAPTION_STAGES[number]; code: DiagnosticCode }
  | { type: "mark"; name: string; detail: MarkDetail | null }
  | { type: "phase"; name: string; state: "start" | "end"; detail: MarkDetail | null }
  | { type: "inputs"; open: number };
export type AsrResult = { words: CaptionWord[]; audio: boolean };
export type CaptionTranscriber = { dispose: () => void; transcribe: (file: File, duration: number) => Promise<AsrResult> };
export async function modelCacheState() {
  if (!(await caches.has(MODEL_CACHE))) return { complete: false, present: false };
  const keys = await (await caches.open(MODEL_CACHE)).keys();
  const prefix = `https://huggingface.co/${SPEECH_MODEL}/resolve/${SPEECH_REVISION}/`;
  const complete = SPEECH_FILES.every((file) => keys.some((key) => key.url === prefix + file));
  return { complete, present: keys.length > 0 };
}
export async function removeModel() { await caches.delete(MODEL_CACHE); }

// Open Mediabunny inputs live in the worker, which reports them while diagnostics are on.
const liveWorkers = new Set<{ inputs: number }>();
let snapshotRegistered = false;

/**
 * One dedicated worker per job: it decodes the File's audio itself, loads the model once and answers one clip at a time.
 * `audio` is false for a file without an audio track. Aborting or `dispose` terminates the worker and ignores anything it still sends.
 */
export function captionTranscriber(signal: AbortSignal, onProgress: (progress: AsrProgress) => void, workerUrl?: URL): CaptionTranscriber {
  const worker = workerUrl === undefined
    ? new Worker(new URL("./captions-worker.ts", import.meta.url), { type: "module" })
    : new Worker(workerUrl, { type: "module" });
  const live = { inputs: 0 };
  const open = new Map<string, (outcome?: MarkDetail | null) => void>();
  let sequence = 0;
  let closed = false;
  let failure: Error | null = null;
  let pending: { id: number; resolve: (result: AsrResult) => void; reject: (error: Error) => void } | null = null;
  liveWorkers.add(live);
  if (!snapshotRegistered && diagnosticsEnabled()) {
    snapshotRegistered = true;
    registerSnapshot("asr", () => ({ workers: liveWorkers.size, inputs: [...liveWorkers].reduce((sum, worker) => sum + worker.inputs, 0) }));
  }
  mark("asr", "worker:create");
  function dispose() {
    if (closed) return;
    closed = true;
    worker.terminate();
    signal.removeEventListener("abort", abort);
    liveWorkers.delete(live);
    for (const end of open.values()) end({ outcome: "terminated" });
    open.clear();
    mark("asr", "worker:dispose");
  }
  function abort() {
    dispose();
    if (pending !== null) { pending.reject(new DOMException("Caption generation canceled", "AbortError")); pending = null; }
  }
  signal.addEventListener("abort", abort, { once: true });
  worker.onmessage = (event: MessageEvent<AsrMessage>) => {
    if (closed) return;
    const message = event.data;
    if (message.type === "mark") mark("asr", `worker:${message.name}`, message.detail);
    else if (message.type === "inputs") live.inputs = message.open;
    else if (message.type === "phase") {
      if (message.state === "start") open.set(message.name, phase("asr", `worker:${message.name}`, message.detail));
      else { const end = open.get(message.name); open.delete(message.name); if (end !== undefined) end(message.detail); }
    } else if (pending !== null && message.id === pending.id) {
      if (message.type === "progress") onProgress(message.progress);
      else {
        const request = pending;
        pending = null;
        if (message.type === "done") request.resolve({ words: message.words, audio: message.audio });
        else request.reject(new DiagnosticError(message.message, message.code, message.stage));
      }
    }
  };
  worker.onerror = (event) => {
    failure = new DiagnosticError(event.message, "worker_failed", "worker");
    if (pending !== null) { pending.reject(failure); pending = null; }
    dispose();
  };
  return { dispose, transcribe: (file: File, duration: number) => {
    signal.throwIfAborted();
    if (failure !== null) throw failure;
    if (closed) throw new Error("Speech worker is closed");
    if (pending !== null) throw new Error("Speech worker is already transcribing");
    return new Promise<AsrResult>((resolve, reject) => {
      const id = ++sequence;
      pending = { id, resolve, reject };
      worker.postMessage({ type: "transcribe", id, file, duration, debug: diagnosticsEnabled() } satisfies AsrRequest);
    });
  } };
}
