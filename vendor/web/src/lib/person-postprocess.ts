// generated from the Modisign monorepo, do not edit
import { PERSON_MASK_BYTES, PERSON_MASK_SIZE } from "./person-manifest";
import type { PersonParams } from "./person-masks";

// Every consumer shares these constants. Mask pixel (x, y) is the cell [x, x + 1) / 256 of the whole oriented picture, sampled at its centre; values are person confidence or alpha, 0..255.
// A predecessor is used only when its picture starts at most this many seconds before the current one.
export const PERSON_MAX_GAP = 0.25;
// Neighbours whose confidence differs from the current by more than 38/255 (0.15) are ignored for that pixel.
const GATE = 38;
// Half-width of the soft step around the threshold, in confidence units: alpha is 0 below threshold - BAND, 1 above threshold + BAND and a smoothstep between.
const BAND = 0.1;

const smoothstep = (value: number) => value <= 0 ? 0 : value >= 1 ? 1 : value * value * (3 - 2 * value);

// Tent kernel: weight(d) = 1 - |d| / (feather + 1) for |d| <= ceil(feather); feather 0 is the identity, 1 is [1 2 1] / 4. Borders replicate.
function tent(feather: number) {
  const radius = Math.ceil(feather);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, index) => Math.max(0, 1 - Math.abs(index - radius) / (feather + 1)));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return { radius, weights: weights.map((weight) => weight / sum) };
}

function blur(values: Float32Array, feather: number) {
  const { radius, weights } = tent(feather);
  if (radius === 0) return values;
  const size = PERSON_MASK_SIZE;
  const across = new Float32Array(values.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let total = 0;
      for (let tap = -radius; tap <= radius; tap++) total += values[y * size + Math.min(size - 1, Math.max(0, x + tap))] * weights[tap + radius];
      across[y * size + x] = total;
    }
  }
  const down = new Float32Array(values.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let total = 0;
      for (let tap = -radius; tap <= radius; tap++) total += across[Math.min(size - 1, Math.max(0, y + tap)) * size + x] * weights[tap + radius];
      down[y * size + x] = total;
    }
  }
  return down;
}

// The final 256x256 alpha of one picture from its raw confidence and the raw masks of up to two preceding pictures (null when missing): gated-mean smoothing, soft threshold, tent feather, quantized once. Pure and deterministic.
export function personAlpha(current: Uint8Array, previous: readonly (Uint8Array | null)[], params: PersonParams): Uint8Array {
  if (current.length !== PERSON_MASK_BYTES) throw new Error(`A person mask has ${current.length} bytes, expected ${PERSON_MASK_BYTES}`);
  const neighbours = previous.filter((mask): mask is Uint8Array => mask !== null);
  for (const mask of neighbours) if (mask.length !== PERSON_MASK_BYTES) throw new Error(`A person mask has ${mask.length} bytes, expected ${PERSON_MASK_BYTES}`);
  const low = params.threshold - BAND;
  const scale = 1 / (2 * BAND);
  const stepped = new Float32Array(PERSON_MASK_BYTES);
  for (let index = 0; index < PERSON_MASK_BYTES; index++) {
    const value = current[index];
    let sum = 0;
    let accepted = 0;
    for (const mask of neighbours) {
      if (Math.abs(mask[index] - value) <= GATE) { sum += mask[index]; accepted++; }
    }
    const smoothed = accepted === 0 ? value : (1 - params.smoothing) * value + params.smoothing * (sum / accepted);
    stepped[index] = smoothstep((smoothed / 255 - low) * scale);
  }
  const feathered = blur(stepped, params.feather);
  const alpha = new Uint8Array(PERSON_MASK_BYTES);
  for (let index = 0; index < PERSON_MASK_BYTES; index++) alpha[index] = Math.round(feathered[index] * 255);
  return alpha;
}
