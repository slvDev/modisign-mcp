// generated from the Modisign monorepo, do not edit
export type DiagnosticArea = "picker" | "import" | "commit" | "preview" | "native" | "audio" | "analysis" | "asr" | "lifecycle" | "resource" | "compare" | "measure";
export type MarkDetail = Record<string, string | number | boolean | null>;
export type DiagnosticRecord = { id: number; at: number; area: DiagnosticArea; name: string; detail: MarkDetail | null };
export type PendingPhase = { id: number; at: number; area: DiagnosticArea; name: string };
export type DiagnosticsSnapshot = { records: readonly DiagnosticRecord[]; pinned: readonly DiagnosticRecord[]; pinnedDropped: number; pending: readonly PendingPhase[] };

const LIMIT = 200;
// The first semantic milestones survive the rolling tail.
const PIN_LIMIT = 128;
let enabled: boolean | null = null;
let records: DiagnosticRecord[] = [];
let pinned: DiagnosticRecord[] = [];
let pinnedDropped = 0;
const pinnedOnce = new Set<string>();
const pending = new Map<number, PendingPhase>();
let snapshot: DiagnosticsSnapshot = { records, pinned, pinnedDropped, pending: [] };
let nextId = 1;
const listeners = new Set<() => void>();
const snapshots = new Map<string, () => MarkDetail>();
const aliases = new WeakMap<object, string>();
const fileNames = new Map<string, string>();
let nextAlias = 1;

// Opt-in per page load through `?debug=media`; read once, so the project opener stripping the query later does not turn it off.
export function diagnosticsEnabled() {
  if (typeof location === "undefined") return false;
  if (enabled === null) enabled = new URLSearchParams(location.search).get("debug") === "media";
  return enabled;
}

function publish() {
  snapshot = { records, pinned, pinnedDropped, pending: [...pending.values()] };
  listeners.forEach((listener) => listener());
}

// A local alias (`file-1`) stands in for a File everywhere a report would otherwise name it; allocated per File identity, and only while diagnostics are on so ordinary sessions retain no file names.
export function fileAlias(file: File) {
  if (!diagnosticsEnabled()) return "off";
  let alias = aliases.get(file);
  if (alias === undefined) {
    alias = `file-${nextAlias++}`;
    aliases.set(file, alias);
    fileNames.set(file.name, alias);
  }
  return alias;
}

export function redact(text: string) {
  let result = text.replace(/blob:[^\s"')]+/g, "blob:…");
  for (const [name, alias] of fileNames) if (name !== "") result = result.split(name).join(alias);
  return result;
}

export function errorDetail(error: unknown): MarkDetail {
  if (error instanceof Error) return { error: error.name, message: redact(error.message) };
  if (typeof MediaError !== "undefined" && error instanceof MediaError) return { error: "MediaError", code: error.code, message: redact(error.message) };
  return { error: "unknown", message: redact(String(error)) };
}

// `pin` keeps the record in the bounded early segment as well as the rolling tail.
export function mark(area: DiagnosticArea, name: string, detail: MarkDetail | null = null, pin = false) {
  if (!diagnosticsEnabled()) return;
  const clean = detail === null ? null : Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, typeof value === "string" ? redact(value) : value]));
  const record = { id: nextId++, at: Math.round(performance.now() * 10) / 10, area, name, detail: clean };
  records = [...records.slice(1 - LIMIT), record];
  if (pin) {
    if (pinned.length < PIN_LIMIT) pinned = [...pinned, record];
    else pinnedDropped++;
  }
  publish();
}

// Pins the first occurrence of a milestone per key (for example per file and generation); later repeats only roll through the tail.
export function milestone(key: string, area: DiagnosticArea, name: string, detail: MarkDetail | null = null) {
  if (!diagnosticsEnabled()) return;
  const first = !pinnedOnce.has(key);
  pinnedOnce.add(key);
  mark(area, name, detail, first);
}

// Marks the start of a stage now and its end (or failure) through the returned function, so the report shows both the last completed and the pending stage.
export function phase(area: DiagnosticArea, name: string, detail: MarkDetail | null = null, pin = false): (outcome?: MarkDetail | null) => void {
  if (!diagnosticsEnabled()) return () => {};
  const id = nextId++;
  const startedAt = performance.now();
  pending.set(id, { id, at: startedAt, area, name });
  mark(area, `${name}:start`, detail, pin);
  return (outcome: MarkDetail | null = null) => {
    if (!pending.delete(id)) return;
    mark(area, `${name}:end`, { ms: Math.round(performance.now() - startedAt), ...outcome }, pin);
  };
}

// A live reading (slot state, resource counts) taken when a report is built or the panel refreshes.
export function registerSnapshot(label: string, read: () => MarkDetail) {
  if (!diagnosticsEnabled()) return () => {};
  snapshots.set(label, read);
  return () => { snapshots.delete(label); };
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const diagnosticsSnapshot = () => snapshot;

export function clearDiagnostics() {
  records = [];
  pinned = [];
  pinnedDropped = 0;
  pinnedOnce.clear();
  pending.clear();
  publish();
}

export function readSnapshots() {
  return Object.fromEntries([...snapshots].map(([label, read]) => {
    try { return [label, read()]; } catch (error) { return [label, errorDetail(error)]; }
  }));
}

function apiPresence() {
  const video = typeof HTMLVideoElement === "undefined" ? null : HTMLVideoElement.prototype;
  return {
    secureContext: isSecureContext,
    VideoDecoder: typeof VideoDecoder !== "undefined", AudioDecoder: typeof AudioDecoder !== "undefined", AudioEncoder: typeof AudioEncoder !== "undefined",
    requestVideoFrameCallback: video !== null && "requestVideoFrameCallback" in video,
    AudioContext: typeof AudioContext !== "undefined", Worker: typeof Worker !== "undefined", OffscreenCanvas: typeof OffscreenCanvas !== "undefined",
    performanceMemory: "memory" in performance, hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

// Manual export only: nothing here is sent anywhere, and files appear as local aliases.
export function diagnosticsReport(device: string) {
  return JSON.stringify({
    device: redact(device), userAgent: navigator.userAgent, apis: apiPresence(), visibility: document.visibilityState,
    snapshots: readSnapshots(), pending: snapshot.pending.map(({ area, name, at }) => ({ area, name, startedAt: Math.round(at) })),
    pinned: snapshot.pinned, pinnedDropped: snapshot.pinnedDropped, records: snapshot.records.filter((record) => !snapshot.pinned.includes(record)),
  }, null, 1);
}
