// generated from the Modisign monorepo, do not edit
import { isNiche, isSort, MAX_QUERY_LENGTH, type Niche, NICHES, type Sort } from "@/lib/catalog";
import { loadFamilies, SLUG, loadLooks } from "@/lib/families";
import { type FamilyId, isFamilyId } from "@/lib/family-ids";
import { editorHref } from "@/lib/hrefs";
import { loadPresets, presetConfig, type StudioStill, type Thumbnail } from "@/lib/presets";
import { serverUrl } from "@/lib/server-url";
import { configOptions } from "@/lib/template-config";
import { CONTROL_CHARS } from "@/lib/values";
import type { StudioFamily } from "@/lib/studio-state";

export async function loadFamilyNames() {
  return (await loadFamilies()).map(({ id, name }) => ({ id, name }));
}

export async function loadStudioFamilies(): Promise<StudioFamily[]> {
  return Promise.all((await loadFamilies()).map(async (family) => {
    const looks = await loadLooks(family);
    const presets = await loadPresets(family);
    const { id, name, variables, cues, supported_aspects, default_duration } = family;
    return { id, name, variables, cues, supported_aspects, default_duration, looks,
      freeConfigs: presets.filter((preset) => preset.listed && preset.free).map((preset) => presetConfig(family, looks, preset)) };
  }));
}

const CATALOG_PAGE_SIZE = 24;

export type CatalogFilters = { type?: FamilyId; niche?: Niche; q?: string; sort?: Sort };
type CatalogQuery = CatalogFilters & { cursor?: string };

const CATALOG_PARAMS: Record<keyof CatalogQuery, (value: string, params: URLSearchParams) => boolean> = {
  type: isFamilyId,
  niche: isNiche,
  q: (q) => q !== "" && q === q.trim() && q.length <= MAX_QUERY_LENGTH && !CONTROL_CHARS.test(q),
  sort: isSort,
  // A cursor belongs to one order.
  cursor: (cursor, params) => decodeCursor(cursor, params.get("sort")) !== undefined,
};

const isCatalogParam = (key: string): key is keyof CatalogQuery => Object.hasOwn(CATALOG_PARAMS, key);

// Undefined when a key is unknown or repeated, or holds a value its filter rejects.
export function parseCatalogQuery(params: URLSearchParams): CatalogQuery | undefined {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return undefined;
  for (const [key, value] of params) {
    if (!isCatalogParam(key) || !CATALOG_PARAMS[key](value, params)) return undefined;
  }
  return Object.fromEntries(params) as CatalogQuery;
}

// Newest rounds restart for each date; other orders use the whole filtered cohort.
type Key = { family: string; id: string; sortKey: number; round: number };
const compareKeys = (a: Key, b: Key) =>
  b.sortKey - a.sortKey || a.round - b.round || (a.family !== b.family ? (a.family < b.family ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const encodeCursor = ({ family, id, sortKey, round }: Key, sort: Sort | null | undefined) =>
  Buffer.from([family, id, ...(sort === "new" ? ["new", sortKey, round] : sort === "likes" ? [sortKey, round] : ["default", round])].join("/")).toString("base64url");

function decodeCursor(cursor: string, sort: string | null | undefined): Key | undefined {
  if (sort !== null && sort !== undefined && !isSort(sort)) return undefined;
  const [family, id, ...rest] = Buffer.from(cursor, "base64url").toString().split("/");
  if (rest.length !== (sort === "new" ? 3 : 2)
    || (sort === "new" ? rest[0] !== "new" : sort !== "likes" && rest[0] !== "default")
    || !isFamilyId(family) || id === undefined || !SLUG.test(id)) return undefined;
  const key = { family, id, sortKey: sort === "new" ? Number(rest[1]) : sort === "likes" ? Number(rest[0]) : 0, round: Number(rest[sort === "new" ? 2 : 1]) };
  if (!Number.isSafeInteger(key.sortKey) || (sort === "likes" && key.sortKey < 0)) return undefined;
  if (!Number.isSafeInteger(key.round) || key.round < 0) return undefined;
  // Base64 decoding skips stray characters, so only the canonical spelling is accepted.
  return encodeCursor(key, sort) === cursor ? key : undefined;
}

function interleaveFamilies(matches: Key[]) {
  matches.sort(compareKeys);
  let previous: Key | undefined;
  for (const match of matches) {
    match.round = previous !== undefined && match.sortKey === previous.sortKey && match.family === previous.family ? previous.round + 1 : 0;
    previous = match;
  }
  matches.sort(compareKeys);
}

// Most liked must fail when counts are unavailable rather than change the order.
async function loadLikeCounts(): Promise<Record<string, number>> {
  const response = await fetch(`${serverUrl}/api/likes`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`/api/likes answered ${response.status}`);
  return (await response.json()).counts;
}

export type CatalogItem = {
  family: FamilyId;
  familyName: string;
  id: string;
  name: string;
  niche: Niche;
  href: string;
  free: boolean;
  added: string;
  options: ReturnType<typeof configOptions>;
  duration: number;
} & Thumbnail & { studioStill: StudioStill };

// Listed presets in compareKeys order; every word of q must appear in the name, niche, family name or text values.
export async function listPresets({ type, niche, q, sort, cursor, free, paginate = true }: CatalogQuery & { free?: boolean; paginate?: boolean }) {
  const after = cursor === undefined ? undefined : decodeCursor(cursor, sort);
  const words = q === undefined ? [] : q.toLowerCase().split(/\s+/);
  const counts = sort === "likes" ? await loadLikeCounts() : {};

  const matches: (Key & { item: CatalogItem })[] = [];
  for (const family of await loadFamilies()) {
    if (type !== undefined && family.id !== type) continue;
    const looks = await loadLooks(family);
    for (const preset of await loadPresets(family)) {
      if (!preset.listed) continue;
      if (free !== undefined && preset.free !== free) continue;
      if (niche !== undefined && preset.niche !== niche) continue;
      const texts = family.variables
        .filter((variable) => variable.type === "string" && Object.hasOwn(preset.values, variable.id))
        .map((variable) => preset.values[variable.id]);
      const text = [preset.name, preset.niche, family.name, ...texts].join(" ").toLowerCase();
      if (!words.every((word) => text.includes(word))) continue;
      const config = presetConfig(family, looks, preset);
      const options = configOptions(family, looks, config);
      matches.push({
        family: family.id,
        id: preset.id,
        sortKey: sort === "new" ? Date.parse(preset.added) : 0,
        round: 0,
        item: {
          family: family.id,
          familyName: family.name,
          id: preset.id,
          name: preset.name,
          niche: preset.niche,
          href: editorHref(family.id, options),
          options,
          duration: config.duration,
          free: preset.free,
          added: preset.added,
          ...preset.thumbnail,
          studioStill: preset.studioStill,
        },
      });
    }
  }
  interleaveFamilies(matches);
  if (sort === "likes") {
    for (const match of matches) {
      match.sortKey = counts[`${match.family}/${match.id}`] ?? 0;
    }
    matches.sort(compareKeys);
  }
  const rest = matches.filter((item) => after === undefined || compareKeys(item, after) > 0);
  const page = paginate ? rest.slice(0, CATALOG_PAGE_SIZE) : rest;
  const last = page[page.length - 1];
  return {
    items: page.map((match) => match.item),
    nextCursor: paginate && rest.length > CATALOG_PAGE_SIZE ? encodeCursor(last, sort) : null,
  };
}

// Filter values that match at least one listed preset, so the filter bar never offers an empty result.
export async function loadCatalogFacets() {
  const presets = (await Promise.all((await loadFamilies()).map(loadPresets))).flat().filter((preset) => preset.listed);
  const niches = new Set(presets.map((preset) => preset.niche));
  return { niches: (Object.keys(NICHES) as Niche[]).filter((niche) => niches.has(niche)), count: presets.length };
}
