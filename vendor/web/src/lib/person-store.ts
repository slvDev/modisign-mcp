// generated from the Modisign monorepo, do not edit
import { PERSON_MASK_BYTES } from "./person-manifest";
import type { PersonMasks, PersonParams, PersonPicture } from "./person-masks";
import { PERSON_MAX_GAP, personAlpha } from "./person-postprocess";

export const PERSON_PRECEDING = 2;
export const DESKTOP_PERSON_BUDGET = 64 * 2 ** 20;
export const PHONE_PERSON_BUDGET = 32 * 2 ** 20;

// A picture is identified by its File and its exact container presentation time in microseconds, never by clip, name, URL or output frame.
export const pictureKey = (time: number) => Math.round(time * 1e6);

export class PersonBudgetError extends Error {
  constructor(message: string, readonly requested: number, readonly capacity: number) {
    super(message);
    this.name = "PersonBudgetError";
  }
}

type Held = { entry: Entry; key: number; raw: Uint8Array; before: number[] };
type Entry = { id: number; raws: Map<number, Held>; pins: Map<number, number> };

export interface PersonWriter {
  // Stores one raw mask with the times of its preceding source pictures, nearest first; false when the writer is closed or the store was cleared, so an abandoned job can never publish.
  put(picture: PersonPicture, raw: Uint8Array, preceding: readonly number[]): boolean;
  close(): void;
}

export interface PersonStore extends PersonMasks {
  has(picture: PersonPicture): boolean;
  writer(): PersonWriter;
  // Protects these pictures of one File from eviction until the returned release runs; throws PersonBudgetError when the pinned set would exceed the raw capacity.
  pin(file: File, times: readonly number[]): () => void;
  // How many more distinct pictures can be pinned.
  room(): number;
  bytes(): { raw: number; derived: number; total: number; budget: number };
  clear(): void;
}

// Raw masks per File and picture, with a small derived-alpha cache; one byte budget covers both. Never serialized, never persisted.
export function createPersonStore(options: { budget: number }): PersonStore {
  const pictures = Math.floor(options.budget / PERSON_MASK_BYTES);
  const derivedSlots = Math.floor(pictures / 8);
  const rawSlots = pictures - derivedSlots;
  if (rawSlots < 3) throw new Error(`A person mask budget of ${options.budget} bytes cannot hold a picture with its context`);
  const entries = new WeakMap<File, Entry>();
  const lru = new Set<Held>();
  const derived = new Map<string, Uint8Array>();
  let epoch = 0;
  let nextId = 0;
  let pinned = 0;

  function entry(file: File) {
    let found = entries.get(file);
    if (found === undefined) { found = { id: nextId++, raws: new Map(), pins: new Map() }; entries.set(file, found); }
    return found;
  }
  const touch = (record: Held) => { lru.delete(record); lru.add(record); };
  function makeRoom() {
    while (lru.size >= rawSlots) {
      const victim = [...lru].find((record) => !record.entry.pins.has(record.key));
      if (victim === undefined) throw new Error("Every held person mask is pinned");
      lru.delete(victim);
      victim.entry.raws.delete(victim.key);
    }
  }

  const store: PersonStore = {
    has: ({ file, time }) => entries.get(file)?.raws.has(pictureKey(time)) === true,
    ready({ file, time }) {
      const record = entries.get(file)?.raws.get(pictureKey(time));
      return record !== undefined && record.before.every((key) => record.entry.raws.has(key));
    },
    alpha(picture, params: PersonParams) {
      const record = entries.get(picture.file)?.raws.get(pictureKey(picture.time));
      if (record === undefined) return null;
      const before = record.before.map((key) => record.entry.raws.get(key));
      if (before.some((held) => held === undefined)) return null;
      touch(record);
      for (const held of before) touch(held!);
      const id = `${record.entry.id}:${record.key}:${params.threshold}:${params.feather}:${params.smoothing}`;
      const cached = derived.get(id);
      if (cached !== undefined) { derived.delete(id); derived.set(id, cached); return cached; }
      const alpha = personAlpha(record.raw, before.map((held) => held!.raw), params);
      if (derivedSlots > 0) {
        if (derived.size >= derivedSlots) derived.delete(derived.keys().next().value!);
        derived.set(id, alpha);
      }
      return alpha;
    },
    writer() {
      const born = epoch;
      let open = true;
      return {
        put(picture, raw, preceding) {
          if (!open || epoch !== born) return false;
          if (raw.length !== PERSON_MASK_BYTES) throw new Error(`A person mask has ${raw.length} bytes, expected ${PERSON_MASK_BYTES}`);
          if (preceding.length > PERSON_PRECEDING) throw new Error(`A person mask smooths with at most ${PERSON_PRECEDING} preceding pictures`);
          const owner = entry(picture.file);
          const key = pictureKey(picture.time);
          const held = owner.raws.get(key);
          if (held !== undefined) { touch(held); return true; }
          makeRoom();
          const before = preceding.filter((time) => time < picture.time && picture.time - time <= PERSON_MAX_GAP).map(pictureKey);
          const record: Held = { entry: owner, key, raw, before };
          owner.raws.set(key, record);
          lru.add(record);
          return true;
        },
        close() { open = false; },
      };
    },
    pin(file, times) {
      const owner = entry(file);
      const keys = [...new Set(times.map(pictureKey))];
      const added = keys.filter((key) => !owner.pins.has(key)).length;
      if (pinned + added > rawSlots) {
        const capacity = rawSlots - pinned + keys.length - added;
        throw new PersonBudgetError(`${keys.length} person masks do not fit: at most ${capacity} can be held at once`, keys.length, capacity);
      }
      for (const key of keys) {
        const count = owner.pins.get(key) ?? 0;
        if (count === 0) pinned++;
        owner.pins.set(key, count + 1);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const key of keys) {
          const count = owner.pins.get(key)!;
          if (count === 1) { owner.pins.delete(key); pinned--; } else owner.pins.set(key, count - 1);
        }
      };
    },
    room: () => rawSlots - pinned,
    bytes() {
      const raw = lru.size * PERSON_MASK_BYTES;
      const derivedBytes = derived.size * PERSON_MASK_BYTES;
      return { raw, derived: derivedBytes, total: raw + derivedBytes, budget: options.budget };
    },
    clear() {
      epoch++;
      for (const record of lru) record.entry.raws.delete(record.key);
      lru.clear();
      derived.clear();
    },
  };
  return store;
}
