// generated from the Modisign monorepo, do not edit
// Single source of truth for the person-segmentation assets, shared by the worker, the website client, the copy script and the MCP build. No imports.
export type PersonAsset = { readonly file: string; readonly bytes: number; readonly sha256: string };

const RUNTIME_VERSION = "0.10.21";

export const PERSON_MANIFEST = {
  id: "people-v1",
  // Bumped with any change to the 256x256 input mapping or to how the confidence grid is read, thresholded or smoothed.
  revision: "people-v1/1",
  input: { width: 256, height: 256, mapping: "whole oriented picture scaled to 256x256, no letterbox" },
  output: { confidenceMasks: 1, personIndex: 0, width: 256, height: 256, polarity: "high confidence = person" },
  runtime: {
    package: "@mediapipe/tasks-vision",
    version: RUNTIME_VERSION,
    directory: `/person-runtime/${RUNTIME_VERSION}/`,
    worker: "person-worker.js",
    simd: {
      loader: { file: "vision_wasm_internal.js", bytes: 204284, sha256: "4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb" },
      wasm: { file: "vision_wasm_internal.wasm", bytes: 9574032, sha256: "f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7" },
    },
    noSimd: {
      loader: { file: "vision_wasm_nosimd_internal.js", bytes: 204137, sha256: "927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f" },
      wasm: { file: "vision_wasm_nosimd_internal.wasm", bytes: 9448638, sha256: "3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4" },
    },
    licence: "Apache-2.0",
  },
  model: {
    directory: "/person-models/people-v1/",
    file: "selfie_segmenter.191ac952.tflite",
    bytes: 249537,
    sha256: "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b",
    upstream: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
    gcsGeneration: "1683436452886295",
    licence: "Apache-2.0",
  },
  // A 256x256 frame of a NASA video (public domain) the worker segments at start-up to prove the output means "person".
  probe: {
    file: "probe.be80a657.png",
    bytes: 168632,
    sha256: "be80a657254a434794693d988cd4ca63f0476d4c187a2aeb365f2127ffec17c5",
    person: { x: 108, y: 100, width: 40, height: 60 },
    background: { x: 8, y: 150, width: 56, height: 80 },
    minPerson: 0.6,
    maxBackground: 0.2,
  },
  notices: { directory: "/person-models/people-v1/", file: "NOTICE.txt" },
} as const;

// `runtime` is a directory URL ending in "/" holding the runtime files by manifest name; the probe sits beside `model`; `worker` must be same-origin with the page.
export type PersonAssetUrls = { readonly worker: string; readonly runtime: string; readonly model: string };

export const PERSON_MASK_SIZE = PERSON_MANIFEST.input.width;
export const PERSON_MASK_BYTES = PERSON_MASK_SIZE * PERSON_MASK_SIZE;

// Same-origin website paths; the MCP render browser passes its own loopback routes with the same file names.
export const PERSON_DEFAULT_URLS: PersonAssetUrls = {
  worker: PERSON_MANIFEST.runtime.directory + PERSON_MANIFEST.runtime.worker,
  runtime: PERSON_MANIFEST.runtime.directory,
  model: PERSON_MANIFEST.model.directory + PERSON_MANIFEST.model.file,
};
