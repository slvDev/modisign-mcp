// generated from the Modisign monorepo, do not edit
// Pure and dependency-free: the browser reporter, the MCP bundle and Express validation share this one vocabulary.
// Diagnostics carry fixed words only: a location, a stage, a code, a build id and a few bounded numbers. No exception text.

export const DIAGNOSTIC_STAGES = {
  your_video_import: ["reading", "checking", "audio_check", "poster"],
  studio_import: ["reading", "checking", "audio_check", "poster"],
  studio_relink: ["reading", "checking", "audio_check", "poster"],
  preview: ["load", "present", "overlay_load", "overlay_present"],
  program: ["source", "picture", "play", "audio_activation"],
  timeline_images: ["decode"],
  silences: ["source_audio", "detect", "apply"],
  captions_cache: ["check", "remove"],
  caption_scatter: ["fonts", "overlays", "plan"],
  person: ["model", "masks"],
  sound: ["fetch", "verify", "decode", "audition", "play"],
  text_preview: ["fonts", "draw"],
  project: ["list", "save", "open", "delete", "catalog", "validate"],
  auth: ["session", "initiate", "callback", "sign_out"],
  device: ["review", "approve", "deny", "revoke"],
  likes: ["list", "request"],
  bookmarks: ["list", "request"],
  catalog: ["list", "request"],
  checkout: ["account_check", "load", "initialize", "open", "payment", "activation_check"],
  billing: ["portal"],
  export_history: ["request"],
  download: ["share", "file"],
  share: ["clipboard", "native_share"],
  mcp_install: ["clipboard"],
  page: ["render"],
  global: ["runtime", "rejection", "resource", "render", "chunk"],
} as const;
export type DiagnosticWhere = keyof typeof DIAGNOSTIC_STAGES;
export const DIAGNOSTIC_WHERES = Object.keys(DIAGNOSTIC_STAGES) as DiagnosticWhere[];

// Terminal export and caption records derive their location from the event name and carry only a stage and a code.
export const EXPORT_STAGES = ["frames", "video_check", "audio_check", "fonts", "composition", "decode", "audio", "masks", "encode", "finalize", "file"] as const;
export const CAPTION_STAGES = ["model", "audio", "inference", "worker"] as const;
export const CAPTION_RESULTS = ["speech", "no_speech", "no_audio"] as const;

export const DIAGNOSTIC_CODES = [
  "unexpected", "network", "http_error", "timeout", "limit", "validation", "conflict", "forbidden",
  "unsupported_video_encoder", "unsupported_aac_encoder", "unsupported_video_decoder", "unsupported_audio_decoder",
  "composition_dimensions", "composition_not_ready", "frame_load", "font_load", "draw_failed",
  "no_video_track", "no_duration", "too_long", "unsupported_format", "unsupported_codec", "no_decodable_picture",
  "unsupported_photo", "photo_damaged", "poster_failed", "relink_kind", "import_read", "import_check",
  "media_network", "media_decode", "media_unsupported", "media_aborted", "playback_blocked", "preview_stall", "metadata_stall", "load_failed", "paint_failed",
  "asset_missing", "asset_hash", "asset_corrupt", "audition_failed", "sound_play_failed",
  "scan_failed", "detect_failed", "transition_conflict",
  "model_failed", "audio_failed", "inference_failed", "worker_failed", "cache_failed",
  "person_unsupported", "person_runtime", "person_input", "person_shape", "person_polarity", "person_inference", "person_worker", "budget",
  "stale_preset", "invalid_project",
  "oauth_denied", "oauth_failed",
  "script_load", "init_failed", "open_failed", "payment_failed", "payment_error", "checkout_error", "activation_check_failed", "activation_pending",
  "clipboard_denied", "share_refused",
  "chunk_load", "resource_failed",
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
const CODES: ReadonlySet<string> = new Set(DIAGNOSTIC_CODES);
export const isDiagnosticCode = (value: unknown): value is DiagnosticCode => typeof value === "string" && CODES.has(value);

// The built-in error classes a diagnostic may name for an unclassified exception.
export const ERROR_CLASSES = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError", "DOMException", "Other"] as const;
export type ErrorClass = typeof ERROR_CLASSES[number];

// An error that already knows its fixed code (and optionally the stage it failed in); the message stays the UI's.
export class DiagnosticError extends Error {
  constructor(message: string, readonly code: DiagnosticCode, readonly stage?: string) { super(message); }
}

// The route templates a website server failure may name (the app's own routes); anything else is "/unmatched".
export const WEB_ROUTES = [
  "/", "/account", "/api/mcp/[action]", "/api/templates", "/apple-icon", "/blog", "/blog/[slug]", "/device", "/icon", "/mcp", "/opengraph-image",
  "/overlays", "/overlays/[family]", "/overlays/[family]/opengraph-image", "/preview/[family]", "/preview/[family]/assets/[file]", "/pricing",
  "/privacy", "/refund", "/robots.txt", "/sitemap.xml", "/studio", "/studio/edit", "/terms", "/unmatched",
] as const;

export const RELEASE_ID = /^[A-Za-z0-9._-]{1,40}$/;
// Next's framework-generated server error reference.
export const DIGEST = /^[A-Za-z0-9_-]{1,40}$/;
// A first-party built script or stylesheet path with its position, never a full URL or a stack.
export const SOURCE = /^[A-Za-z0-9_./~()[\]@-]{1,100}\.(?:js|css):\d{1,6}(?::\d{1,6})?$/;

type Props = Record<string, unknown>;
const COMMON = ["plan", "touch"];
const EXPORT_KEYS = ["family", "aspect", "format", "free", "own_video", "studio", "counts", "captions", "ms", "stage", "code", "release"];
const CAPTION_KEYS = ["outcome", "backend", "seconds_bucket", "stage", "code", "release", "result"];
const CLIENT_KEYS = ["where", "stage", "code", "release", "status", "digest", "source", "class"];
// Studio's export_failure is the one event beyond the ten-key limit.
export const MAX_PROPS: Record<string, number> = { export_failure: 12 };
export const DEFAULT_MAX_PROPS = 10;

const oneOf = (list: readonly string[], value: unknown) => typeof value === "string" && list.includes(value);
const onlyKeys = (props: Props, keys: readonly string[]) => Object.keys(props).every((key) => keys.includes(key) || COMMON.includes(key));
const failureProblem = (props: Props, stages: readonly string[]) =>
  !oneOf(stages, props.stage) ? "stage" : !isDiagnosticCode(props.code) ? "code" : typeof props.release !== "string" || !RELEASE_ID.test(props.release) ? "release" : null;

// The event-specific rule for the three diagnostic names; null when the props are acceptable or the name has no such rule.
export function diagnosticProblem(name: string, props: Props): string | null {
  if (name === "client_error") {
    if (!onlyKeys(props, CLIENT_KEYS)) return "keys";
    if (typeof props.where !== "string" || !Object.hasOwn(DIAGNOSTIC_STAGES, props.where)) return "where";
    const problem = failureProblem(props, DIAGNOSTIC_STAGES[props.where as DiagnosticWhere]);
    if (problem !== null) return problem;
    if (props.status !== undefined && !(Number.isInteger(props.status) && (props.status as number) >= 100 && (props.status as number) <= 599)) return "status";
    if (props.digest !== undefined && !(typeof props.digest === "string" && DIGEST.test(props.digest))) return "digest";
    if (props.source !== undefined && !(typeof props.source === "string" && SOURCE.test(props.source))) return "source";
    if (props.class !== undefined && !oneOf(ERROR_CLASSES, props.class)) return "class";
    return null;
  }
  if (name === "export_failure") return onlyKeys(props, EXPORT_KEYS) ? failureProblem(props, EXPORT_STAGES) : "keys";
  if (name === "captions") {
    if (!onlyKeys(props, CAPTION_KEYS)) return "keys";
    const present = (keys: string[]) => keys.every((key) => props[key] !== undefined);
    const absent = (keys: string[]) => keys.every((key) => props[key] === undefined);
    if (props.outcome === "error") return absent(["result"]) ? failureProblem(props, CAPTION_STAGES) : "result";
    if (!absent(["stage", "code", "release"])) return "keys";
    if (props.outcome === "done") return present(["result"]) && oneOf(CAPTION_RESULTS, props.result) ? null : "result";
    return absent(["result"]) ? null : "result";
  }
  return null;
}
