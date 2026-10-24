// generated from the Modisign monorepo, do not edit
import { DiagnosticError } from "../../../server/src/diagnostics";

export const READY_TIMEOUT_MS = 30_000;

export const compositionNotReady = () => new DiagnosticError("The clip did not load within 30 seconds", "composition_not_ready");
