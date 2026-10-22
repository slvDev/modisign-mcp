// generated from the Modisign monorepo, do not edit
// Messages and error codes shared by person-segmenter.ts (page side) and person-worker.ts. Type-only, so the worker bundle stays free of page code.
export type PersonErrorCode =
  | "unsupported" // no OffscreenCanvas/WebGL2/secure context in the worker
  | "asset-missing" // an asset could not be fetched
  | "asset-corrupt" // an asset's length or SHA-256 differs from the manifest
  | "runtime" // the runtime or model failed to start
  | "input" // the picture is not 256x256
  | "shape" // the model output is not the manifest's contract
  | "polarity" // the probe person was not marked as person
  | "inference"
  | "worker"; // the worker could not be created or crashed

export type PersonStage = "runtime" | "model";

export type PersonToWorker =
  | { type: "init"; runtime: string; model: string }
  | { type: "segment"; id: number; bitmap: ImageBitmap };

export type PersonFromWorker =
  | { type: "stage"; stage: PersonStage }
  | { type: "ready" }
  | { type: "mask"; id: number; mask: ArrayBuffer }
  | { type: "error"; id: number | null; code: PersonErrorCode; message: string };
