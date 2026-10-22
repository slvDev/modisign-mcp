// generated from the Modisign monorepo, do not edit
import { PERSON_MASK_BYTES } from "./person-manifest";
import { PERSON_PRECEDING, pictureKey } from "./person-store";

export const EXPORT_WINDOW_MAX = 120;
const EDGE = 1e-6;

function lastAtOrBefore(times: readonly number[], value: number) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

// Indices (into the sorted presentation times of a source) of the pictures a visible span [start, end) shows: the one on screen at `start` through the last one starting before `end`.
export function coveringPictures(times: readonly number[], start: number, end: number) {
  if (times.length === 0) throw new Error("The source has no pictures");
  const first = Math.max(0, lastAtOrBefore(times, start + EDGE));
  return { first, last: Math.max(first, lastAtOrBefore(times, end - EDGE)) };
}

// The first picture whose raw mask picture `first` needs as smoothing context.
export const contextFirst = (first: number) => Math.max(0, first - PERSON_PRECEDING);

// Times of the pictures a picture smooths with, nearest first.
export function precedingTimes(times: readonly number[], index: number) {
  return times.slice(contextFirst(index), index).reverse();
}

// The exact picture with this presentation time; throws when the source has none.
export function pictureIndex(times: readonly number[], time: number) {
  const index = lastAtOrBefore(times, time + EDGE);
  if (index < 0 || pictureKey(times[index]) !== pictureKey(time)) throw new Error(`The source has no picture at ${time} s`);
  return index;
}

// Export infers at most a quarter of the budget (and 120 pictures) per window, starting two pictures before the requested one.
export function exportWindow(times: readonly number[], index: number, budget: number) {
  const size = Math.min(EXPORT_WINDOW_MAX, Math.floor(budget / 4 / PERSON_MASK_BYTES));
  const first = contextFirst(index);
  return { first, last: Math.min(times.length - 1, first + size - 1) };
}
