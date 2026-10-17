// generated from the Modisign monorepo, do not edit
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import type { Aspect } from "@/lib/aspects";
import { isNiche, type Niche } from "@/lib/catalog";
import { isBackdrop, type Backdrop } from "@/lib/creator-preview";
import { isCalendarDate, latestStartedDate } from "@/lib/date-format";
import {
  assertKeys,
  type Family,
  loadFamilies,
  loadFamily,
  readRows,
  loadLooks,
} from "@/lib/families";
import { configOptions, sameTemplate, type TemplateConfig } from "@/lib/template-config";
import { findInvalidValue, findLook, isPositive, type Look, mergeValues, type Role, type Values } from "@/lib/values";

const PUBLIC_DIR = join(process.cwd(), "public");

export type Thumbnail = { poster: string; clip: string };

export type Preset = {
  id: string;
  name: string;
  niche: Niche;
  backdrop: Backdrop;
  look: string;
  duration: number;
  featured: boolean;
  // A free template: anyone downloads it as it is; changing more than background and format is Pro.
  free: boolean;
  added: string;
  values: Values;
} & ({ listed: true; thumbnail: Thumbnail } | { listed: false });

// A row's values may only set variables of the given roles.
function checkValues(where: string, family: Family, values: unknown, roles: Role[]) {
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error(`${where}: bad values`);
  const invalid = findInvalidValue(family.variables, values as Record<string, unknown>);
  if (invalid !== undefined) throw new Error(`${where}: invalid value for ${invalid}`);
  const misplaced = family.variables.find((v) => Object.hasOwn(values, v.id) && !roles.includes(v.role));
  if (misplaced) throw new Error(`${where}: ${misplaced.id} is a ${misplaced.role} variable, not ${roles.join(" or ")}`);
  return values as Values;
}

export const loadPresets = cache(async (family: Family): Promise<Preset[]> => {
  const looks = await loadLooks(family);
  const presets = await Promise.all(
    (await readRows(family, "presets")).map(async ({ where, row, id, name }): Promise<Preset> => {
      assertKeys(where, row, [
        "id",
        "family",
        "family_version",
        "name",
        "niche",
        "backdrop",
        "look",
        "duration",
        "featured",
        "listed",
        "free",
        "added",
        "values",
      ]);
      const { niche, backdrop, look, duration, featured, listed, free, added } = row;
      if (typeof niche !== "string" || !isNiche(niche)) throw new Error(`${where}: unknown niche ${niche}`);
      if (typeof backdrop !== "string" || !isBackdrop(backdrop)) throw new Error(`${where}: unknown backdrop ${backdrop}`);
      if (typeof look !== "string" || !looks.some((l) => l.id === look)) throw new Error(`${where}: unknown look ${look}`);
      if (!isPositive(duration)) throw new Error(`${where}: bad duration`);
      if (typeof featured !== "boolean") throw new Error(`${where}: bad featured`);
      if (typeof listed !== "boolean") throw new Error(`${where}: bad listed`);
      if (typeof free !== "boolean") throw new Error(`${where}: bad free`);
      if (typeof added !== "string" || !isCalendarDate(added) || added > latestStartedDate()) {
        throw new Error(`${where}: added must be a real YYYY-MM-DD date, not in the future`);
      }
      if (featured && !listed) throw new Error(`${where}: a featured preset must be listed`);
      if (free && !listed) throw new Error(`${where}: a free preset must be listed`);
      const values = checkValues(where, family, row.values, ["content", "layout", "style"]);
      const color = family.variables.find((variable) => variable.type === "color" && Object.hasOwn(values, variable.id));
      if (color !== undefined) throw new Error(`${where}: preset color ${color.id} belongs in its palette`);
      const base = { id, name, niche, backdrop, look, duration, featured, free, added, values };
      if (!listed) return { ...base, listed };
      return { ...base, listed, thumbnail: await findThumbnail(family.id, id) };
    }),
  );
  if (presets.filter((preset) => preset.free).length !== 1) throw new Error(`${family.id}: expected exactly one listed free preset`);
  // The landing gallery shows one use case per family.
  if (presets.filter((preset) => preset.featured).length > 1) throw new Error(`${family.id}: more than one featured preset`);
  // findPreset must name one preset: a like or the free flag cannot depend on file order.
  const listed = presets.filter((preset) => preset.listed).map((preset) => ({ preset, config: presetConfig(family, looks, preset) }));
  for (const [i, a] of listed.entries()) {
    const twin = listed.slice(i + 1).find((b) => sameTemplate(family.variables, a.config, b.config));
    if (twin) throw new Error(`${family.id}: presets ${a.preset.id} and ${twin.preset.id} are the same overlay`);
  }
  return presets;
});

export async function loadListedPreset(familyId: Family["id"], presetId: string): Promise<Extract<Preset, { listed: true }>> {
  const preset = (await loadPresets(await loadFamily(familyId))).find((item) => item.id === presetId);
  if (preset === undefined || !preset.listed) throw new Error(`Required listed preset ${familyId}/${presetId} is missing`);
  return preset;
}

// Written by scripts/thumbnails.mjs.
async function findThumbnail(family: Family["id"], id: string): Promise<Thumbnail> {
  const [poster, clip] = await Promise.all(["jpg", "mp4"].map(async (extension) => {
    const url = `/thumbnails/${family}/${id}.${extension}`;
    const content = await readFile(join(PUBLIC_DIR, url)).catch((cause: unknown) => {
      throw new Error(`Missing ${url} for a listed preset: run pnpm thumbnails`, { cause });
    });
    const version = createHash("sha256").update(content).digest("hex").slice(0, 12);
    return `${url}?v=${version}`;
  }));
  return { poster, clip };
}

export function presetConfig(family: Family, looks: Look[], preset: Preset, aspect: Aspect = "9x16"): TemplateConfig {
  return {
    aspect,
    look: preset.look,
    duration: preset.duration,
    values: mergeValues(family.variables, findLook(looks, preset.look).values, preset.values),
  };
}

// The catalog preset a configuration is, in any format and with any output setting.
export const findPreset = (family: Family, looks: Look[], presets: Preset[], config: TemplateConfig) =>
  presets.find((preset) => preset.listed && sameTemplate(family.variables, presetConfig(family, looks, preset), config));

async function loadLandingFamilies(select: (presets: Preset[], family: Family) => Preset | undefined) {
  const selected = await Promise.all(
    (await loadFamilies()).map(async (family) => {
      const presets = await loadPresets(family);
      const preset = select(presets, family);
      if (preset === undefined) return undefined;
      const looks = await loadLooks(family);
      return { family, presets, preset, looks, options: configOptions(family, looks, presetConfig(family, looks, preset)) };
    }),
  );
  return selected.filter((family) => family !== undefined);
}

// Families with the use case the landing gallery shows; a family with none featured is left out.
export async function loadFeaturedFamilies() {
  return (await loadLandingFamilies((presets) => presets.find((preset) => preset.featured)))
    .map(({ family, presets, preset, looks, options }) => ({
      id: family.id,
      name: family.name,
      tagline: family.tagline,
      preset: { id: preset.id, name: preset.name, look: preset.look, backdrop: preset.backdrop },
      looks,
      // The catalog preset the card opens under each look; a look missing here opens an edited configuration.
      lookPresets: Object.fromEntries(looks.flatMap((look) => {
        const match = findPreset(family, looks, presets, presetConfig(family, looks, { ...preset, look: look.id }));
        return match === undefined ? [] : [[look.id, { id: match.id, free: match.free, backdrop: match.backdrop }]];
      })) as Partial<Record<string, { id: string; free: boolean; backdrop: Backdrop }>>,
      options,
    }));
}

export async function loadFreeFamilies() {
  return (await loadLandingFamilies((presets, family) => {
    if (!presets.some((preset) => preset.featured)) return undefined;
    const preset = presets.find((preset) => preset.listed && preset.free);
    if (preset === undefined) throw new Error(`${family.id} has no listed free preset`);
    return preset;
  })).map(({ family, preset, options }) => ({
    id: family.id,
    name: family.name,
    tagline: family.tagline,
    backdrop: preset.backdrop,
    duration: preset.duration,
    options,
  }));
}
