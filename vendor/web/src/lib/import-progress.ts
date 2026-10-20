// generated from the Modisign monorepo, do not edit
import { errorDetail, phase } from "@/lib/media-diagnostics";

export type ImportStage = "reading" | "checking";
// `stage` publishes the current stage; `activity` marks real progress such as a source read.
export type ImportReport = { stage: (stage: ImportStage) => void; activity: () => void };

export const NO_REPORT: ImportReport = { stage: () => {}, activity: () => {} };
export const INACTIVITY_WARNING_MS = 30_000;
export const INACTIVITY_WARNING = "This is taking longer than usual. You can keep waiting or cancel and try again.";

// The message is a file-less reason that continues "<file name> …".
export class ImportError extends Error {}

const STAGE_REASONS: Record<ImportStage, string> = {
  reading: "couldn’t be read. The file may be incomplete. Choose it again or try another copy.",
  checking: "couldn’t be checked. The file may be damaged or use a format this browser can’t edit. Try an H.264/AAC MP4 copy.",
};

export function importReason(error: unknown, stage: ImportStage) {
  return error instanceof ImportError ? error.message : STAGE_REASONS[stage];
}

export function stageText(stage: ImportStage) {
  return `${{ reading: "Reading media", checking: "Checking video" }[stage]}…`;
}

// Runs one stage's work: publishes it, turns unexpected failures into the stage's reason and lets cancellation through untouched.
export async function importStage<T>(report: ImportReport, signal: AbortSignal, stage: ImportStage, work: () => Promise<T>): Promise<T> {
  report.stage(stage);
  const end = phase("import", stage, null, true);
  try {
    const value = await work();
    signal.throwIfAborted();
    end();
    return value;
  } catch (error) {
    end(signal.aborted ? { outcome: "canceled" } : { outcome: "failed", ...errorDetail(error) });
    signal.throwIfAborted();
    throw new ImportError(importReason(error, stage));
  }
}
