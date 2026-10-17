// generated from the Modisign monorepo, do not edit
export const ROLES = ["content", "style", "layout", "output"] as const;
export type Role = (typeof ROLES)[number];

// A field is relevant when any clause holds; a clause holds when every named variable matches its condition. false marks the palette-only accent.
export type Condition = Value[] | { nonEmpty: true };
export type Clause = Record<string, Condition>;
export type ShowWhen = Clause[] | false;

type Base = { id: string; label: string; role: Role; showWhen?: ShowWhen };

export type Value = string | boolean | number;
export type Values = Record<string, Value>;

export type Variable =
  | (Base & { type: "string"; default: string; maxLength?: number })
  | (Base & { type: "color"; default: string })
  | (Base & { type: "boolean"; default: boolean })
  | (Base & { type: "number"; default: number; min: number; max: number; step: number; unit: string; custom?: string; control?: "number" })
  | (Base & { type: "enum"; default: string; options: { value: string; label: string }[] });

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

const VARIABLE_TYPES = ["string", "color", "boolean", "enum", "number"];
export const isPositive = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

function validateCondition(where: string, variables: Variable[], variable: Variable, id: string, condition: unknown) {
  const controller = variables.find((v) => v.id === id);
  if (controller === undefined) throw new Error(`${where}: showWhen names unknown variable ${id}`);
  if (controller === variable) throw new Error(`${where}: showWhen cannot depend on itself`);
  if (controller.role === "output" || controller.type === "color" || (controller.type === "number" && controller.custom !== undefined)) {
    throw new Error(`${where}: showWhen controller ${id} must be a non-output string, boolean, enum or number selector`);
  }
  if (Array.isArray(condition)) {
    if (controller.type === "string") throw new Error(`${where}: showWhen on string ${id} must be {"nonEmpty":true}`);
    if (condition.length === 0 || new Set(condition).size !== condition.length || !condition.every((value) => isValidValue(controller, value))) {
      throw new Error(`${where}: showWhen values for ${id} must be distinct valid values`);
    }
  } else {
    const entries = typeof condition === "object" && condition !== null ? Object.entries(condition) : [];
    if (entries.length !== 1 || entries[0][0] !== "nonEmpty" || entries[0][1] !== true) throw new Error(`${where}: showWhen condition for ${id} must be a value list or {"nonEmpty":true}`);
    if (controller.type !== "string") throw new Error(`${where}: nonEmpty needs a string controller, not ${id}`);
    if (controller.maxLength === 0) throw new Error(`${where}: showWhen nonEmpty on ${id} can never hold (maxLength 0)`);
  }
}

function validateShowWhen(family: string, variables: Variable[], variable: Variable) {
  const where = `${family}/${variable.id}`;
  const { showWhen } = variable;
  if (showWhen === undefined) return;
  if (variable.role === "output") throw new Error(`${where}: an output variable is always relevant`);
  if (showWhen === false) {
    // The accent every palette must set is the catalog's color dot; a family may declare it without any render use.
    if (variable.type !== "color" || variable.id !== "accent") throw new Error(`${where}: showWhen false is reserved for the palette-only accent`);
    return;
  }
  if (variable.type === "number" && variable.custom !== undefined) throw new Error(`${where}: a custom number follows its owner and declares no showWhen`);
  if (!Array.isArray(showWhen) || showWhen.length === 0) throw new Error(`${where}: showWhen must be false or a nonempty list of clauses`);
  for (const clause of showWhen) {
    if (typeof clause !== "object" || clause === null || Array.isArray(clause) || Object.keys(clause).length === 0) throw new Error(`${where}: showWhen clauses must be nonempty objects`);
    for (const [id, condition] of Object.entries(clause)) validateCondition(where, variables, variable, id, condition);
  }
}

function assertNoDependencyCycle(family: string, variables: Variable[]) {
  const state = new Map<string, "visiting" | "done">();
  const visit = (variable: Variable) => {
    if (state.get(variable.id) === "done") return;
    if (state.get(variable.id) === "visiting") throw new Error(`${family}/${variable.id}: showWhen dependencies form a cycle`);
    state.set(variable.id, "visiting");
    for (const id of Array.isArray(variable.showWhen) ? variable.showWhen.flatMap(Object.keys) : []) {
      const dependency = variables.find((v) => v.id === id);
      if (dependency === undefined) throw new Error(`${family}/${variable.id}: unknown dependency ${id}`);
      visit(dependency);
    }
    state.set(variable.id, "done");
  };
  variables.forEach(visit);
}

// The one validator for a family's declared variables; the website, Express and the thumbnail tool all load through it.
export function validateVariables(family: string, variables: Variable[]) {
  const ids = new Set<string>();
  const customEnums = new Set<string>();
  for (const variable of variables) {
    if (ids.has(variable.id)) throw new Error(`${family}: duplicate variable ${variable.id}`);
    ids.add(variable.id);
    if (!VARIABLE_TYPES.includes(variable.type)) throw new Error(`${family}: unsupported variable type ${variable.type}`);
    if (!ROLES.includes(variable.role)) throw new Error(`${family}: bad role for ${variable.id}`);
    if ("custom" in variable && variable.type !== "number") throw new Error(`${family}: custom must belong to a number`);
    if ("control" in variable && (variable.type !== "number" || variable.control !== "number")) throw new Error(`${family}: control must be "number" on a number variable (${variable.id})`);
    if (variable.type === "number" && variable.control !== undefined && variable.custom !== undefined) throw new Error(`${family}: ${variable.id} cannot be both a number entry and a custom slider`);
    if (variable.type === "number") {
      if (!Number.isFinite(variable.min) || !Number.isFinite(variable.max) || variable.min > variable.max || !isPositive(variable.step) || typeof variable.unit !== "string") {
        throw new Error(`${family}: bad number bounds, step or unit for ${variable.id}`);
      }
      if (variable.custom !== undefined) {
        const owner = variables.find((v) => v.id === variable.custom);
        if (owner === undefined || owner.type !== "enum" || !owner.options.some((option) => option.value === "custom") || customEnums.has(owner.id)) {
          throw new Error(`${family}: ${variable.id} must name an enum with a custom option and no other custom number`);
        }
        customEnums.add(owner.id);
      }
    }
    if (!isValidValue(variable, variable.default)) throw new Error(`${family}: bad default for ${variable.id}`);
  }
  for (const variable of variables) validateShowWhen(family, variables, variable);
  assertNoDependencyCycle(family, variables);
}

function holds(id: string, condition: Condition, value: Value | undefined) {
  if (value === undefined) throw new Error(`Missing value for ${id}`);
  if (Array.isArray(condition)) return condition.includes(value);
  if (typeof value !== "string") throw new Error(`${id} must be a string`);
  return value.trim() !== "";
}

// Whether the current structure can use the variable; values are the complete merged map, never a partial one.
export function isRelevant(variables: Variable[], values: Values, variable: Variable): boolean {
  if (variable.showWhen === false) return false;
  if (variable.type === "number" && variable.custom !== undefined) {
    const owner = variables.find((v) => v.id === variable.custom);
    if (owner === undefined) throw new Error(`Missing owner ${variable.custom} of ${variable.id}`);
    return values[owner.id] === "custom" && isRelevant(variables, values, owner);
  }
  if (variable.showWhen === undefined) return true;
  return variable.showWhen.some((clause) => Object.entries(clause).every(([id, condition]) => holds(id, condition, values[id])));
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
