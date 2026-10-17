// generated from the Modisign monorepo, do not edit
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { cache } from "react";
import { ASPECTS, type Aspect, isAspect } from "@/lib/aspects";
import { FAMILY_IDS, type FamilyId } from "@/lib/family-ids";
import { isPositive, type Variable, type Look, type Values } from "@/lib/values";
import { validateTemplatePalettes, validateVariables } from "../../../server/src/template-values";

// Families live outside the Next app so the renderer and the site share one source.
export const TEMPLATES_DIR = join(process.cwd(), "..", "templates");

const ASSET_TYPES = new Map([[".png", "image/png"]]);

export type Family = {
  id: FamilyId;
  name: string;
  tagline: string;
  version: number;
  supported_aspects: Aspect[];
  default_duration: number;
  html: string;
  variables: Variable[];
};

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertKeys(where: string, row: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(row).sort().join();
  if (actual !== [...keys].sort().join()) throw new Error(`${where}: expected keys ${keys.join()}, got ${actual}`);
}

export async function readJson(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${path}: not an object`);
  return parsed as Record<string, unknown>;
}

// Replaces the single static attribute the renderer reads at compile time; zero or several matches mean a broken family.
function replaceOnce(html: string, pattern: RegExp, replacement: string) {
  const matches = html.match(new RegExp(pattern, "g"));
  if (matches?.length !== 1) throw new Error(`Expected one ${pattern} in family HTML, found ${matches?.length ?? 0}`);
  return html.replace(pattern, replacement);
}

const ROOT_DURATION = /(<div\b[^>]*\sid="root"[^>]*\sdata-duration=")([\d.]+)"/;

// Cached per request: metadata, the page and the catalog loaders ask for the same family.
export const loadFamily = cache(async (id: FamilyId): Promise<Family> => {
  const dir = join(TEMPLATES_DIR, id);
  const row = await readJson(join(dir, "family.json"));
  const where = `${id}/family.json`;
  assertKeys(where, row, [
    "id",
    "name",
    "tagline",
    "version",
    "supported_aspects",
    "default_duration",
    "poster_time",
  ]);
  const { name, tagline, version, supported_aspects, default_duration, poster_time } = row;
  if (row.id !== id) throw new Error(`${where}: id is ${row.id}`);
  if (typeof name !== "string" || !name) throw new Error(`${where}: bad name`);
  if (typeof tagline !== "string" || !tagline) throw new Error(`${where}: bad tagline`);
  if (!Number.isInteger(version) || !isPositive(version)) throw new Error(`${where}: bad version`);
  if (
    !Array.isArray(supported_aspects) ||
    !supported_aspects.every((aspect) => typeof aspect === "string" && isAspect(aspect)) ||
    new Set(supported_aspects).size !== supported_aspects.length ||
    !supported_aspects.includes("9x16")
  ) {
    throw new Error(`${where}: supported_aspects must be distinct known aspects including 9x16`);
  }
  if (!isPositive(default_duration)) throw new Error(`${where}: bad default_duration`);
  if (!isPositive(poster_time) || poster_time >= default_duration) throw new Error(`${where}: bad poster_time`);

  const html = await readFile(join(dir, "index.html"), "utf8");
  const declared = /data-composition-variables='([^']*)'/.exec(html);
  if (!declared) throw new Error(`${id} declares no variables`);
  const variables: Variable[] = JSON.parse(declared[1]);
  validateVariables(id, variables);
  if (Number(ROOT_DURATION.exec(html)?.[2]) !== default_duration) {
    throw new Error(`${id}: root data-duration must equal default_duration`);
  }

  const family = { id, name, tagline, version, supported_aspects, default_duration, html, variables };
  await loadLooks(family);
  return family;
});

export async function readRows(family: Family, kind: "looks" | "presets") {
  const dir = join(TEMPLATES_DIR, family.id, kind);
  // Sorted because readdir order depends on the filesystem, and the site lists rows in this order.
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => {
      const row = await readJson(join(dir, file));
      const where = `${family.id}/${kind}/${file}`;
      const { id, name } = row;
      if (typeof id !== "string" || !SLUG.test(id) || id !== file.slice(0, -".json".length)) {
        throw new Error(`${where}: id must be a lowercase slug matching the file name`);
      }
      if (row.family !== family.id || row.family_version !== family.version) {
        throw new Error(`${where}: pinned to ${row.family}@${row.family_version}, not ${family.id}@${family.version}`);
      }
      if (typeof name !== "string" || !name) throw new Error(`${where}: bad name`);
      return { where, row, id, name };
    }),
  );
}

export const loadLooks = cache(async (family: Family): Promise<Look[]> => {
  const rows = await readRows(family, "looks");
  validateTemplatePalettes(family.id, family.variables, rows.map(({ id, row }) => ({ id, values: row.values })));
  const looks = rows.map(({ where, row, id, name }) => {
    assertKeys(where, row, ["id", "family", "family_version", "name", "values"]);
    const values = row.values as Values;
    const misplaced = family.variables.find((variable) => Object.hasOwn(values, variable.id) && variable.role !== "style");
    if (misplaced !== undefined) throw new Error(`${where}: ${misplaced.id} is not a style variable`);
    return { id, name, values, accent: values.accent as string };
  });
  if (looks.length === 0) throw new Error(`${family.id} has no looks`);
  return looks;
});

export const loadFamilies = () => Promise.all(FAMILY_IDS.map(loadFamily));

// Serve-time transform: canvas size and root duration are read before scripts run, so a variable cannot set them.
export function serveHtml(family: Family, aspect: Aspect, duration: number) {
  const { width, height } = ASPECTS[aspect];
  let html = replaceOnce(
    family.html,
    /<meta name="viewport" content="width=\d+, height=\d+" \/>/,
    `<meta name="viewport" content="width=${width}, height=${height}" />`,
  );
  html = replaceOnce(html, /data-width="\d+"/, `data-width="${width}"`);
  html = replaceOnce(html, /data-height="\d+"/, `data-height="${height}"`);
  const rootDuration = ROOT_DURATION.exec(html);
  if (rootDuration === null) throw new Error(`${family.id}: root declares no duration`);
  return replaceOnce(html, ROOT_DURATION, `${rootDuration[1]}${duration}"`);
}

export async function readAsset(family: FamilyId, file: string) {
  const dir = join(TEMPLATES_DIR, family, "assets");
  const type = ASSET_TYPES.get(extname(file));
  if (type === undefined) return undefined;
  // A family without assets has no directory.
  const listing = await readdir(dir).catch((error: NodeJS.ErrnoException): string[] => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  // The name must be an exact entry of the listing, so it cannot climb out of the directory.
  if (!listing.includes(file)) return undefined;
  return { body: await readFile(join(dir, file)), type };
}
