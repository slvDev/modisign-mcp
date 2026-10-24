// generated from the Modisign monorepo, do not edit
import { DiagnosticError, type DiagnosticCode } from "../../../server/src/diagnostics";
import { errorDetail, phase } from "@/lib/media-diagnostics";

export type ImportStage = "reading" | "checking";
// The stages an import failure can name beyond the two the queue publishes.
export type ImportFailureStage = ImportStage | "audio_check" | "poster";
// `stage` publishes the current stage; `activity` marks real progress such as a source read.
export type ImportReport = { stage: (stage: ImportStage) => void; activity: () => void };

export const NO_REPORT: ImportReport = { stage: () => {}, activity: () => {} };
export const INACTIVITY_WARNING_MS = 30_000;
export const INACTIVITY_WARNING = "This is taking longer than usual. You can keep waiting or cancel and try again.";

// The message is a file-less reason that continues "<file name> …"; the code (and an optional narrower stage) is what telemetry carries.
export class ImportError extends DiagnosticError {
  declare readonly stage?: ImportFailureStage;
  constructor(message: string, code: DiagnosticCode, stage?: ImportFailureStage) { super(message, code, stage); }
}

const STAGE_CODES: Record<ImportStage, DiagnosticCode> = { reading: "import_read", checking: "import_check" };

const STAGE_REASONS: Record<ImportStage, string> = {
  reading: "couldn’t be read. The file may be incomplete. Choose it again or try another copy.",
  checking: "couldn’t be checked. The file may be damaged or use a format this browser can’t edit. Try an H.264/AAC MP4 copy.",
};

export function importReason(error: unknown, stage: ImportStage) {
  return error instanceof ImportError ? error.message : STAGE_REASONS[stage];
}

// Where a failed attempt is reported: the error's own stage when it names one, and the code for an error that carries none.
export function importFailure(error: unknown, stage: ImportStage): { stage: ImportFailureStage; fallback: DiagnosticCode } {
  return { stage: error instanceof ImportError && error.stage !== undefined ? error.stage : stage, fallback: STAGE_CODES[stage] };
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
    throw error instanceof ImportError ? error : new ImportError(importReason(error, stage), STAGE_CODES[stage]);
  }
}
