import { api } from "./api.js";
import { bundle, previewHtml, readCache, writeCache } from "./cache.js";
import { authorizeRequest } from "./authorization.js";
import { isTemplateHref } from "../vendor/web/src/lib/studio-project.js";
import { ToolError } from "./errors.js";
import type { StudioOverlay } from "../vendor/web/src/lib/studio-state.js";

export type Relevance = { relevant: string[]; irrelevant: string[] };
export type ActiveCue = { id: string; kind: string; at: number };
export type Configured = { configuration: string; tier: "free" | "pro"; editorUrl: string; relevance: Relevance; activeCues: ActiveCue[]; studio: Pick<StudioOverlay, "family" | "preset" | "config">; render: {
  compositionUrl: string; variables: Record<string, string | number | boolean>; duration: number; width: number; height: number; background: string;
} };
export type CatalogItem = { family: string; preset: string; name: string; niche: string; free: boolean; poster: string; editorUrl: string };
type Catalog = { items: CatalogItem[]; nextCursor: string | null };
export type Field = { id: string; label: string; type: string; value: unknown; relevant: boolean; [key: string]: unknown };
export type Preset = { cues: unknown[]; properties: Record<string, Field[]>; looks: { id: string; name: string }[]; aspects: string[]; look: string; duration: number; free: boolean };
export async function catalog(filters: Record<string, unknown>, signal?: AbortSignal): Promise<Catalog> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key === "free_only" ? "free" : key, String(value));
  const result = await api<Catalog>(`/api/mcp/catalog?${params}`, undefined, undefined, signal);
  return { items: result.items.map(({ family, preset, name, niche, free, poster, editorUrl }) => ({ family, preset, name, niche, free, poster, editorUrl })), nextCursor: result.nextCursor };
}
export const preset = (family: string, id: string, signal?: AbortSignal) => api<Preset>(`/api/mcp/preset?${new URLSearchParams({ family, preset: id })}`, undefined, undefined, signal);
// inactiveEdits belongs to this request, not to the cached configuration.
export async function configure(input: Record<string, unknown>, signal?: AbortSignal) {
  const { inactiveEdits, ...configured } = await api<Configured & { inactiveEdits: string[] }>("/api/mcp/configure", input, undefined, signal);
  await writeCache(`configuration:${configured.configuration}`, configured);
  return { configured, inactiveEdits };
}
export function configurationUrl(configuration: string) {
  if (!isTemplateHref(configuration)) throw new ToolError("Use the configuration URL returned by configure_overlay.", { field: "configuration" });
  return new URL(configuration, "https://modisign.app");
}
export function outputConfiguration(configuration: string, format: "mp4" | "mov" | "webm") {
  const url = configurationUrl(configuration);
  if (format !== "mp4") url.searchParams.set("background", "transparent");
  else if (url.searchParams.get("background") === "transparent") url.searchParams.set("background", "green");
  return `${url.pathname}?${url.searchParams}`;
}
export async function authorize(configuration: string, signal?: AbortSignal) {
  configurationUrl(configuration);
  return authorizeRequest({ configuration }, `free-authorization:${configuration}`, signal);
}
function validConfigured(value: unknown): value is Configured {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!record(value) || !isTemplateHref(value.configuration) || (value.tier !== "free" && value.tier !== "pro") || typeof value.editorUrl !== "string"
    || !record(value.relevance) || !Array.isArray(value.relevance.relevant) || !Array.isArray(value.relevance.irrelevant) || !Array.isArray(value.activeCues) || !record(value.render) || !record(value.studio)) return false;
  const { render, studio } = value;
  if (typeof render.compositionUrl !== "string" || !record(render.variables) || typeof render.background !== "string"
    || ![render.duration, render.width, render.height].every((number) => typeof number === "number" && Number.isFinite(number) && number > 0)) return false;
  if (!record(studio.family) || !record(studio.preset) || !record(studio.config)) return false;
  const { family, preset, config } = studio;
  return typeof family.id === "string" && typeof family.name === "string" && Array.isArray(family.variables) && Array.isArray(family.cues)
    && Array.isArray(family.supported_aspects) && typeof family.default_duration === "number" && Array.isArray(family.looks) && Array.isArray(family.freeConfigs)
    && typeof preset.id === "string" && typeof preset.family === "string" && typeof preset.href === "string"
    && typeof config.aspect === "string" && typeof config.look === "string" && typeof config.duration === "number" && record(config.values);
}
export async function resolveConfiguration(configuration: string, signal: AbortSignal): Promise<Configured> {
  const cached = await readCache(`configuration:${configuration}`, validConfigured);
  if (cached !== undefined) return cached;
  const url = configurationUrl(configuration);
  const family = url.pathname.slice("/overlays/".length);
  const page = await catalog({ family }, signal);
  if (page.items.length === 0) throw new ToolError("Overlay family has no listed presets.");
  const schema = await preset(family, page.items[0].preset, signal);
  const html = await previewHtml(configuration, signal);
  const variablesMatch = html.match(/window\.__hfVariables=(\{[^<]*\})<\/script>/);
  const durationMatch = html.match(/id="root"[^>]*data-duration="([\d.]+)"/);
  if (variablesMatch === null || durationMatch === null) throw new ToolError("Unsupported composition metadata.");
  const variables = JSON.parse(variablesMatch[1]) as Record<string, unknown>;
  const values = Object.fromEntries(Object.values(schema.properties).flat().map(({ id }) => [id, variables[id]]));
  const look = url.searchParams.get("look"), aspect = url.searchParams.get("aspect");
  const { configured: result } = await configure({ family, preset: page.items[0].preset, values, ...(look === null ? {} : { look }), ...(aspect === null ? {} : { aspect }), duration: Number(durationMatch[1]), background: variables.background }, signal);
  await writeCache(`configuration:${configuration}`, result);
  return result;
}
export async function supportedAspects(family: string, signal: AbortSignal) {
  const cached = await readCache<string[]>(`aspects:${family}`);
  if (cached !== undefined) return cached;
  const page = await catalog({ family }, signal);
  if (page.items.length === 0) throw new ToolError("Overlay family has no listed presets.");
  const schema = await preset(family, page.items[0].preset, signal);
  await writeCache(`aspects:${family}`, schema.aspects);
  return schema.aspects;
}
export { bundle };
