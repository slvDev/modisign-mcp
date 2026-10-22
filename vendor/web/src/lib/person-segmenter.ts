// generated from the Modisign monorepo, do not edit
import { PERSON_DEFAULT_URLS, PERSON_MASK_BYTES, PERSON_MASK_SIZE, type PersonAssetUrls } from "./person-manifest";
import type { PersonErrorCode, PersonFromWorker, PersonStage, PersonToWorker } from "./person-protocol";

export { PERSON_MASK_SIZE, type PersonAssetUrls };

export class PersonRuntimeError extends Error {
  constructor(readonly code: PersonErrorCode, message: string) {
    super(message);
    this.name = "PersonRuntimeError";
  }
}

export type PersonSegmenter = {
  // Takes ownership of `picture` (the whole oriented source picture as a 256x256 ImageBitmap, closed on every path) and resolves a fresh Uint8Array(65536) of person confidence, 0..255, row-major. One request at a time; aborting rejects at once and disposes the segmenter, and a late result is never delivered.
  segment(picture: ImageBitmap, signal: AbortSignal): Promise<Uint8Array>;
  /** Terminates the worker. Idempotent. */
  dispose(): void;
};

const canceled = () => new DOMException("Person mask generation canceled", "AbortError");
const disposed = () => new PersonRuntimeError("worker", "The people segmenter was disposed");

// Starts a dedicated worker that verifies and loads the runtime and model; aborting `signal` at any time disposes it. Failures are PersonRuntimeError; nothing falls back to the main thread or a server.
export function createPersonSegmenter(options: { signal: AbortSignal; urls?: PersonAssetUrls; onStage?: (stage: PersonStage) => void }): Promise<PersonSegmenter> {
  const { signal, onStage } = options;
  const urls = options.urls ?? PERSON_DEFAULT_URLS;
  if (signal.aborted) return Promise.reject(canceled());
  let worker: Worker;
  try { worker = new Worker(new URL(urls.worker, location.href), { type: "classic" }); } catch (error) {
    return Promise.reject(new PersonRuntimeError("worker", `The people worker could not be created: ${(error as Error).message}`));
  }
  const ready = Promise.withResolvers<PersonSegmenter>();
  let loading: typeof ready | null = ready;
  let pending: { id: number; resolve: (mask: Uint8Array) => void; reject: (error: Error) => void } | null = null;
  let closed = false;
  let sequence = 0;

  function fail(error: Error) {
    if (closed) return;
    closed = true;
    worker.terminate();
    signal.removeEventListener("abort", abort);
    loading?.reject(error);
    loading = null;
    pending?.reject(error);
    pending = null;
  }
  function abort() { fail(canceled()); }
  signal.addEventListener("abort", abort, { once: true });

  const post = (message: PersonToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  const segmenter: PersonSegmenter = {
    segment(picture, requestSignal) {
      const refuse = (error: Error) => { picture.close(); return Promise.reject(error); };
      if (closed) return refuse(disposed());
      if (pending !== null) return refuse(new Error("A person mask request is already in flight"));
      if (requestSignal.aborted) return refuse(canceled());
      const id = ++sequence;
      const mask = Promise.withResolvers<Uint8Array>();
      const onAbort = () => fail(canceled());
      const settle = <T>(finish: (value: T) => void) => (value: T) => { requestSignal.removeEventListener("abort", onAbort); finish(value); };
      pending = { id, resolve: settle(mask.resolve), reject: settle(mask.reject) };
      requestSignal.addEventListener("abort", onAbort, { once: true });
      post({ type: "segment", id, bitmap: picture }, [picture]);
      return mask.promise;
    },
    dispose: () => fail(disposed()),
  };

  worker.onmessage = (event: MessageEvent<PersonFromWorker>) => {
    if (closed) return;
    const message = event.data;
    if (message.type === "stage") onStage?.(message.stage);
    else if (message.type === "ready") { loading?.resolve(segmenter); loading = null; }
    else if (message.type === "error") {
      const error = new PersonRuntimeError(message.code, message.message);
      if (message.id === null) fail(error);
      else if (pending?.id === message.id) { const request = pending; pending = null; request.reject(error); }
    } else if (pending?.id === message.id) {
      const request = pending;
      pending = null;
      if (message.mask.byteLength === PERSON_MASK_BYTES) request.resolve(new Uint8Array(message.mask));
      else request.reject(new PersonRuntimeError("shape", `The worker returned ${message.mask.byteLength} mask bytes, expected ${PERSON_MASK_BYTES}`));
    }
  };
  worker.onerror = (event) => fail(new PersonRuntimeError("worker", `The people worker failed: ${event.message || "it could not be loaded"}`));
  worker.onmessageerror = () => fail(new PersonRuntimeError("worker", "The people worker sent a message that could not be read"));
  post({ type: "init", runtime: new URL(urls.runtime, location.href).href, model: new URL(urls.model, location.href).href });
  return ready.promise;
}
