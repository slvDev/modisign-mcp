// generated from the Modisign monorepo, do not edit
import { isValidValue, type Value, type Values, type Variable } from "../../../server/src/template-values.ts";
export { ROLES, CONTROL_CHARS, isPositive, isRelevant, isValidValue, type Role, type Value, type Values, type Variable } from "../../../server/src/template-values.ts";

// Returns the first key that is undeclared or holds a value its variable rejects.
export function findInvalidValue(variables: Variable[], values: Record<string, unknown>) {
  return Object.keys(values).find((id) => {
    const variable = variables.find((v) => v.id === id);
    return !variable || !isValidValue(variable, values[id]);
  });
}

export function findVariable<T extends Variable["type"]>(variables: Variable[], id: string, type: T) {
  const variable = variables.find((v) => v.id === id);
  if (!variable || variable.type !== type) throw new Error(`Missing ${type} variable ${id}`);
  return variable as Extract<Variable, { type: T }>;
}

const BOOLEANS = new Map([
  ["true", true],
  ["false", false],
]);

const DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

// URL values are strings; undefined when a key is undeclared or a value is invalid.
export function parseValues(variables: Variable[], params: [string, string][]): Values | undefined {
  // fromEntries keeps a "__proto__" key as an own property, so it is rejected like any other undeclared key.
  const values = Object.fromEntries(
    params.map(([id, raw]) => {
      const variable = variables.find((v) => v.id === id);
      const value = variable?.type === "boolean" ? BOOLEANS.get(raw)
        : variable?.type === "number" ? (DECIMAL.test(raw) ? Number(raw) : undefined) : raw;
      return [id, value];
    }),
  );
  return findInvalidValue(variables, values) === undefined ? (values as Values) : undefined;
}

// Family defaults under the layers, later layers winning: look, then preset, then the user's edits.
export const mergeValues = (variables: Variable[], ...layers: Values[]): Values =>
  Object.assign(Object.fromEntries(variables.map((variable) => [variable.id, variable.default])), ...layers);

// The picker offers colors in one case, and the native color input answers in lowercase.
const sameValue = (variable: Variable, a: Value, b: Value) =>
  variable.type === "color" && typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;

// The values that differ from the base, as URL entries in declaration order.
export const changedValues = (variables: Variable[], values: Values, base: Values): [string, string][] =>
  variables
    .filter((variable) => !sameValue(variable, values[variable.id], base[variable.id]))
    .map((variable) => [variable.id, String(values[variable.id])]);

export type Look = {
  id: string;
  name: string;
  values: Values;
  // The look's dot wherever looks are offered.
  accent: string;
};

export function findLook(looks: Look[], id: string) {
  const look = looks.find((l) => l.id === id);
  if (!look) throw new Error(`No look ${id}`);
  return look;
}
