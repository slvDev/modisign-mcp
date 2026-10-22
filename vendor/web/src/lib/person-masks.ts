// generated from the Modisign monorepo, do not edit
// The contract between the mask store (preparation, inference, smoothing) and every frame drawer (Program, export): a drawer only ever asks for a finished alpha of one exact source picture.

// The title's quality fields; the preset itself (model, runtime, preprocess) is `PEOPLE_MODEL`.
export type PersonParams = { threshold: number; feather: number; smoothing: number };

// One exact source picture of an owner clip: the File and the picture's container presentation time in seconds (0 for a photo, which has one picture).
export type PersonPicture = { file: File; time: number };

export interface PersonMasks {
  // The final 256x256 person alpha (0..255, row-major, smoothed, thresholded, feathered) of this exact picture, or null when it or a predecessor it smooths with is not prepared. A pure lookup that never infers: safe in any frame loop.
  alpha(picture: PersonPicture, params: PersonParams): Uint8Array | null;
  // True exactly when `alpha` is non-null for any params: the raw mask and every preceding picture it smooths with are held. Cheap and never derives, so a playback loop asks it instead of `alpha`.
  ready(picture: PersonPicture): boolean;
}

// What export adds: it may wait for inference of the picture it is about to draw.
export interface PersonExportMasks extends PersonMasks {
  // Resolves once `alpha(picture, params)` is non-null; infers the missing pictures (and their predecessors) from the owner's source in bounded windows.
  ensure(picture: PersonPicture, params: PersonParams, signal: AbortSignal): Promise<void>;
}
