// generated from the Modisign monorepo, do not edit
import type { EXPORT_STAGES, DiagnosticCode } from "../../../server/src/diagnostics";

export type ExportStage = typeof EXPORT_STAGES[number];
type Marking = { stage: ExportStage; code?: DiagnosticCode };

const markings = new WeakMap<object, Marking>();

// An error leaving `work` is marked with the stage it failed in (the innermost mark wins); `code` classifies it when it carries none.
export async function inStage<T>(stage: ExportStage, work: Promise<T>, code?: DiagnosticCode): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (typeof error === "object" && error !== null && !markings.has(error)) markings.set(error, { stage, code });
    throw error;
  }
}

export const markingOf = (error: unknown) => typeof error === "object" && error !== null ? markings.get(error) : undefined;
