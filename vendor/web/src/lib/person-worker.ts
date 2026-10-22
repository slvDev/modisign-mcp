// generated from the Modisign monorepo, do not edit
// Classic worker: MediaPipe's loader uses importScripts. Built to public/person-runtime/<version>/person-worker.js by scripts/copy-person-runtime.mjs.
import { FilesetResolver, ImageSegmenter, type MPMask } from "@mediapipe/tasks-vision";
import { PERSON_MANIFEST, PERSON_MASK_BYTES, PERSON_MASK_SIZE, type PersonAsset } from "./person-manifest";
import type { PersonErrorCode, PersonFromWorker, PersonToWorker } from "./person-protocol";

const { runtime, model, output, probe } = PERSON_MANIFEST;

class WorkerFailure extends Error {
  constructor(readonly code: PersonErrorCode, message: string) { super(message); }
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<PersonToWorker>) => void) | null; postMessage: (message: PersonFromWorker, options?: { transfer: Transferable[] }) => void };
const send = (message: PersonFromWorker, transfer: Transferable[] = []) => scope.postMessage(message, { transfer });

// The exact bytes that were hashed are the bytes that run, so a swapped file cannot slip in between check and use.
async function verified(url: string, asset: PersonAsset): Promise<ArrayBuffer> {
  let response: Response;
  try { response = await fetch(url); } catch (error) { throw new WorkerFailure("asset-missing", `${asset.file} could not be fetched: ${(error as Error).message}`); }
  if (!response.ok) throw new WorkerFailure("asset-missing", `${asset.file} returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) throw new WorkerFailure("asset-corrupt", `${asset.file} is ${bytes.byteLength} bytes, expected ${asset.bytes}`);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== asset.sha256) throw new WorkerFailure("asset-corrupt", `${asset.file} has SHA-256 ${sha256}, expected ${asset.sha256}`);
  return bytes;
}

function requireEnvironment(): OffscreenCanvas {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") throw new WorkerFailure("unsupported", "This browser has no OffscreenCanvas in workers");
  if (crypto.subtle === undefined) throw new WorkerFailure("unsupported", "This page is not a secure context, so the people model cannot be verified");
  // The CPU delegate still uploads through WebGL, and a worker has no DOM canvas to fall back on.
  const context = new OffscreenCanvas(1, 1).getContext("webgl2");
  if (context === null) throw new WorkerFailure("unsupported", "This browser has no WebGL2 context in workers");
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return new OffscreenCanvas(1, 1);
}

let segmenter: ImageSegmenter | null = null;

/** Copies the person-confidence grid into a new buffer while the callback keeps it alive; the bitmap is closed on every path. */
function infer(bitmap: ImageBitmap): Uint8Array {
  const active = segmenter;
  if (active === null) throw new WorkerFailure("inference", "The people model is not initialised");
  const mask = new Uint8Array(PERSON_MASK_BYTES);
  let failure = null as WorkerFailure | null;
  try {
    if (bitmap.width !== PERSON_MASK_SIZE || bitmap.height !== PERSON_MASK_SIZE) throw new WorkerFailure("input", `Input is ${bitmap.width}x${bitmap.height}, expected ${PERSON_MASK_SIZE}x${PERSON_MASK_SIZE}`);
    active.segment(bitmap, (result) => {
      try {
        const masks: MPMask[] | undefined = result.confidenceMasks;
        if (masks === undefined || masks.length !== output.confidenceMasks) throw new WorkerFailure("shape", `Model returned ${masks === undefined ? "no" : masks.length} confidence masks, expected ${output.confidenceMasks}`);
        const person = masks[output.personIndex];
        if (person.width !== output.width || person.height !== output.height) throw new WorkerFailure("shape", `Model mask is ${person.width}x${person.height}, expected ${output.width}x${output.height}`);
        const values = person.getAsFloat32Array();
        if (values.length !== PERSON_MASK_BYTES) throw new WorkerFailure("shape", `Model mask holds ${values.length} values, expected ${PERSON_MASK_BYTES}`);
        for (let index = 0; index < PERSON_MASK_BYTES; index += 1) {
          const value = values[index];
          if (!(value >= -0.01 && value <= 1.01)) throw new WorkerFailure("shape", `Model confidence ${value} is outside 0..1`);
          mask[index] = Math.round(Math.min(1, Math.max(0, value)) * 255);
        }
      } catch (error) { failure = error as WorkerFailure; }
    });
  } finally { bitmap.close(); }
  if (failure !== null) throw failure;
  return mask;
}

function rectMean(mask: Uint8Array, rect: { x: number; y: number; width: number; height: number }): number {
  let sum = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) for (let x = rect.x; x < rect.x + rect.width; x += 1) sum += mask[y * PERSON_MASK_SIZE + x];
  return sum / (rect.width * rect.height * 255);
}

// A frame with a known person catches a model, runtime or platform that returns inverted or empty confidence.
async function checkPolarity(probeBytes: ArrayBuffer) {
  const mask = infer(await createImageBitmap(new Blob([probeBytes], { type: "image/png" })));
  const inside = rectMean(mask, probe.person);
  const outside = rectMean(mask, probe.background);
  if (inside < probe.minPerson || outside > probe.maxBackground) {
    throw new WorkerFailure("polarity", `Probe person region averages ${inside.toFixed(3)} (needs >= ${probe.minPerson}) and background ${outside.toFixed(3)} (needs <= ${probe.maxBackground})`);
  }
}

async function initialise(runtimeUrl: string, modelUrl: string) {
  const canvas = requireEnvironment();
  send({ type: "stage", stage: "runtime" });
  const pair = (await FilesetResolver.isSimdSupported()) ? runtime.simd : runtime.noSimd;
  const [loader, wasm] = await Promise.all([verified(runtimeUrl + pair.loader.file, pair.loader), verified(runtimeUrl + pair.wasm.file, pair.wasm)]);
  send({ type: "stage", stage: "model" });
  const [modelBytes, probeBytes] = await Promise.all([verified(modelUrl, model), verified(new URL(probe.file, modelUrl).href, probe)]);
  const urls = [URL.createObjectURL(new Blob([loader], { type: "text/javascript" })), URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }))];
  try {
    segmenter = await ImageSegmenter.createFromOptions(
      { wasmLoaderPath: urls[0], wasmBinaryPath: urls[1] },
      { baseOptions: { modelAssetBuffer: new Uint8Array(modelBytes), delegate: "CPU" }, runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false, canvas },
    );
  } catch (error) { throw new WorkerFailure("runtime", `The people runtime failed to start: ${(error as Error).message}`); }
  finally { for (const url of urls) URL.revokeObjectURL(url); }
  await checkPolarity(probeBytes);
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    initialise(message.runtime, message.model).then(
      () => send({ type: "ready" }),
      (error: unknown) => send({ type: "error", id: null, code: error instanceof WorkerFailure ? error.code : "runtime", message: (error as Error).message }),
    );
    return;
  }
  try {
    const mask = infer(message.bitmap);
    send({ type: "mask", id: message.id, mask: mask.buffer as ArrayBuffer }, [mask.buffer]);
  } catch (error) {
    send({ type: "error", id: message.id, code: error instanceof WorkerFailure ? error.code : "inference", message: (error as Error).message });
  }
};
