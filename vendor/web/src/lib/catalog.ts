// generated from the Modisign monorepo, do not edit
import type { CatalogFilters } from "@/lib/catalog-query";

// Kept apart from families.ts, which reads the filesystem, so the catalog filters can import these.
export const NICHES = {
  career: "Career",
  entertainment: "Entertainment",
  finance: "Finance",
  fitness: "Fitness",
  food: "Food",
  gaming: "Gaming",
  health: "Health",
  lifestyle: "Lifestyle",
  tech: "Tech",
} as const;
export type Niche = keyof typeof NICHES;

export const isNiche = (id: string): id is Niche => Object.hasOwn(NICHES, id);

export const MAX_QUERY_LENGTH = 60;

// Only "likes" needs the API for counts.
export const SORTS = { new: "Newest", likes: "Most liked" } as const;
export type Sort = keyof typeof SORTS;
export const isSort = (id: string): id is Sort => Object.hasOwn(SORTS, id);

export const CATALOG_FILTER_KEYS = ["type", "niche", "q", "sort"] as const satisfies readonly (keyof CatalogFilters)[];

// Fixed key order, so one filter set always has one URL.
export function catalogParams(filters: CatalogFilters) {
  const params = new URLSearchParams();
  for (const key of CATALOG_FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  return params;
}

export function catalogHref(filters: CatalogFilters) {
  const query = catalogParams(filters).toString();
  return `/overlays${query === "" ? "" : `?${query}`}`;
}
