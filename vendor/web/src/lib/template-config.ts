// generated from the Modisign monorepo, do not edit
import { type Aspect, isAspect } from "./aspects.ts";
import type { Family } from "@/lib/families";
import type { TemplateOptions } from "@/lib/hrefs";
import { changedValues, findLook, isRelevant, type Look, mergeValues, parseValues, type Values, type Variable } from "./values.ts";

export type ConfigFamily = Pick<Family, "variables" | "supported_aspects" | "default_duration">;
export type TemplateConfig = { aspect: Aspect; look: string; duration: number; values: Values };

export function templateTitle(family: Pick<Family, "name" | "variables">, values: Values): string {
  const texts = family.variables
    .filter((variable) => variable.role === "content" && variable.type === "string" && isRelevant(family.variables, values, variable))
    .map((variable) => values[variable.id])
    .filter((text) => text !== "");
  return texts.length === 0 ? family.name : texts.join(" · ");
}

export function selectTemplateLook(family: ConfigFamily, looks: Look[], config: TemplateConfig, look: string): TemplateConfig {
  const palette = findLook(looks, look).values;
  const values = Object.fromEntries(family.variables.map((variable) => [variable.id,
    variable.type === "color" && Object.hasOwn(palette, variable.id) ? palette[variable.id] : config.values[variable.id]]));
  return { ...config, look, values };
}

const CONFIG_PARAMS = ["aspect", "look", "duration"];

// Editor pages ignore unrelated query keys such as tracking parameters.
export const editorEntries = (family: ConfigFamily, entries: [string, string][]) =>
  entries.filter(([key]) =>
    CONFIG_PARAMS.includes(key) || family.variables.some((variable) => variable.id === key),
  );

export function parseTemplateConfig(family: ConfigFamily, looks: Look[], entries: [string, string][]) {
  if (looks.length === 0) throw new Error("An overlay must have at least one look");
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return undefined;
  const params = new URLSearchParams(entries);
  const aspect = params.get("aspect") ?? "9x16";
  if (!isAspect(aspect) || !family.supported_aspects.includes(aspect)) return undefined;
  const lookId = params.get("look");
  const look = lookId === null ? looks[0] : looks.find((look) => look.id === lookId);
  if (look === undefined) return undefined;
  const rawDuration = params.get("duration");
  const duration = rawDuration === null ? family.default_duration : Number(rawDuration);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const values = parseValues(
    family.variables,
    entries.filter(([key]) => !CONFIG_PARAMS.includes(key)),
  );
  if (values === undefined) return undefined;
  return { aspect, look: look.id, duration, values: mergeValues(family.variables, look.values, values) };
}

// The same clip apart from what a free template leaves open: the format, the output variables and every value neither configuration uses.
export const sameTemplate = (variables: Variable[], a: TemplateConfig, b: TemplateConfig) =>
  a.look === b.look &&
  a.duration === b.duration &&
  changedValues(variables.filter((variable) => variable.role !== "output" && (isRelevant(variables, a.values, variable) || isRelevant(variables, b.values, variable))), a.values, b.values).length === 0;

export function configOptions(family: ConfigFamily, looks: Look[], config: TemplateConfig): TemplateOptions {
  const base = mergeValues(family.variables, findLook(looks, config.look).values);
  return {
    aspect: config.aspect,
    look: config.look,
    duration: config.duration === family.default_duration ? undefined : config.duration,
    edits: changedValues(family.variables, config.values, base),
  };
}
