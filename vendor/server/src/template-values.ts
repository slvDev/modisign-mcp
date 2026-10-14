// generated from the Modisign monorepo, do not edit
export const ROLES = ["content", "style", "layout", "output"] as const;
export type Role = (typeof ROLES)[number];

type Base = { id: string; label: string; role: Role };

export type Variable =
  | (Base & { type: "string"; default: string; maxLength?: number })
  | (Base & { type: "color"; default: string })
  | (Base & { type: "boolean"; default: boolean })
  | (Base & { type: "number"; default: number; min: number; max: number; step: number; unit: string; custom?: string })
  | (Base & { type: "enum"; default: string; options: { value: string; label: string }[] });

export type Value = string | boolean | number;
export type Values = Record<string, Value>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isValidValue(variable: Variable, value: unknown) {
  switch (variable.type) {
    case "string":
      return (
        typeof value === "string" &&
        !CONTROL_CHARS.test(value) &&
        (variable.maxLength === undefined || Array.from(value).length <= variable.maxLength)
      );
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value);
    case "boolean":
      return typeof value === "boolean";
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < variable.min || value > variable.max) return false;
      const steps = (value - variable.min) / variable.step;
      return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) <= Number.EPSILON * Math.max(1, Math.abs(steps)) * 4;
    }
    case "enum":
      return typeof value === "string" && variable.options.some((option) => option.value === value);
  }
}

export function validateTemplatePalettes(family: string, variables: Variable[], looks: { id: string; values: unknown }[]) {
  for (const look of looks) {
    if (typeof look.values !== "object" || look.values === null || Array.isArray(look.values)) throw new Error(`${family}/${look.id}: bad palette values`);
    if (!Object.hasOwn(look.values, "accent")) throw new Error(`${family}/${look.id}: a palette must set accent`);
    for (const [key, value] of Object.entries(look.values)) {
      const variable = variables.find((variable) => variable.id === key);
      if (variable === undefined || variable.type !== "color" || !isValidValue(variable, value)) {
        throw new Error(`${family}/${look.id}: palette key ${key} must be a valid color variable`);
      }
    }
  }
}
