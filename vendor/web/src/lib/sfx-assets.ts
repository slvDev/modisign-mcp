// generated from the Modisign monorepo, do not edit
import { SFX_PACK, SFX_RATE, sfxAsset, type SfxAsset } from "@/lib/studio-project";

// Planar, sample-exact 48 kHz audio of one pack sound.
export type SfxPcm = { asset: SfxAsset; frames: number; channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] };
export type SfxLoadKind = "missing" | "hash" | "corrupt";

export class SfxLoadError extends Error {
  constructor(readonly kind: SfxLoadKind, readonly asset: SfxAsset) {
    super(kind === "missing" ? `The sound "${asset.name}" could not be loaded. Check your connection and try again.`
      : `The sound "${asset.name}" is damaged or out of date. Reload the page and try again.`);
    this.name = "SfxLoadError";
  }
}

const HEADER_BYTES = 44;
const CHANNELS = 2;

// The pack is canonical PCM16 stereo 48 kHz: any other header, length or chunk layout is corrupt.
export function parseSfxWav(bytes: ArrayBuffer, asset: SfxAsset): SfxPcm {
  const corrupt = () => new SfxLoadError("corrupt", asset);
  const dataBytes = asset.frames * CHANNELS * 2;
  if (bytes.byteLength !== HEADER_BYTES + dataBytes || bytes.byteLength !== asset.bytes) throw corrupt();
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  const expected: [number, number, number][] = [[4, 32, HEADER_BYTES - 8 + dataBytes], [16, 32, 16], [20, 16, 1], [22, 16, CHANNELS], [24, 32, SFX_RATE], [28, 32, SFX_RATE * CHANNELS * 2], [32, 16, CHANNELS * 2], [34, 16, 16], [40, 32, dataBytes]];
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") throw corrupt();
  for (const [offset, bits, value] of expected) if ((bits === 32 ? view.getUint32(offset, true) : view.getUint16(offset, true)) !== value) throw corrupt();
  const left = new Float32Array(asset.frames);
  const right = new Float32Array(asset.frames);
  for (let frame = 0; frame < asset.frames; frame++) {
    left[frame] = view.getInt16(HEADER_BYTES + frame * 4, true) / 32768;
    right[frame] = view.getInt16(HEADER_BYTES + frame * 4 + 2, true) / 32768;
  }
  return { asset, frames: asset.frames, channels: [left, right] };
}

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function fetchPcm(asset: SfxAsset, signal: AbortSignal) {
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(`/sfx/${SFX_PACK}/${asset.file}`, { signal });
    if (!response.ok) throw new SfxLoadError("missing", asset);
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (signal.aborted || error instanceof SfxLoadError) throw error;
    throw new SfxLoadError("missing", asset);
  }
  signal.throwIfAborted();
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== asset.sha256) throw new SfxLoadError("hash", asset);
  signal.throwIfAborted();
  return parseSfxWav(bytes, asset);
}

// Keyed by content hash, so it can never hold more than the ten pack sounds (about 4 MB decoded).
const decoded = new Map<string, SfxPcm>();
const loading = new Map<string, { promise: Promise<SfxPcm>; waiters: number; controller: AbortController }>();

// One fetch, hash check and decode per sound; failures are not remembered, so calling again retries. A waiter that aborts leaves the shared load running for the others.
export async function loadSfxAsset(asset: SfxAsset, signal: AbortSignal = new AbortController().signal): Promise<SfxPcm> {
  signal.throwIfAborted();
  const cached = decoded.get(asset.sha256);
  if (cached !== undefined) return cached;
  let shared = loading.get(asset.sha256);
  if (shared === undefined) {
    const controller = new AbortController();
    const created = { promise: fetchPcm(asset, controller.signal).then((pcm) => { decoded.set(asset.sha256, pcm); return pcm; }), waiters: 0, controller };
    created.promise.then(() => undefined, () => undefined).then(() => { if (loading.get(asset.sha256) === created) loading.delete(asset.sha256); });
    loading.set(asset.sha256, created);
    shared = created;
  }
  const entry = shared;
  entry.waiters++;
  return new Promise<SfxPcm>((resolve, reject) => {
    let done = false;
    const leave = () => {
      done = true;
      signal.removeEventListener("abort", onAbort);
      if (--entry.waiters === 0) { entry.controller.abort(); if (loading.get(asset.sha256) === entry) loading.delete(asset.sha256); }
    };
    const onAbort = () => { if (done) return; leave(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then((pcm) => { if (!done) { leave(); resolve(pcm); } }, (error: unknown) => { if (!done) { leave(); reject(error); } });
  });
}

// The distinct pack sounds named by `ids`, by asset id; rejects with the first SfxLoadError.
export async function loadSfxAssets(ids: Iterable<string>, signal: AbortSignal) {
  const loaded = new Map<string, SfxPcm>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    const asset = sfxAsset(id);
    if (asset === undefined) throw new Error("Unknown sound");
    loaded.set(id, await loadSfxAsset(asset, signal));
  }));
  return loaded;
}

export function clearSfxAssets() {
  decoded.clear();
}
