import { CAPTION_STYLE_IDS, PLACE_MODES } from "../vendor/web/src/lib/studio-project.js";
import { McpServer, fromJsonSchema, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { accountStatus, login, stopLogin } from "./auth.js";
import { errorResult } from "./errors.js";
import { Jobs } from "./jobs.js";
import { catalog, configure, preset } from "./overlays.js";
import { VERSION } from "./settings.js";
import type { RenderInput } from "./render.js";
import { getTranscript, type StudioInput } from "./studio.js";

type Schema = Record<string, unknown>;
const string: Schema = { type: "string", minLength: 1 };
const slug: Schema = { type: "string", pattern: "^[a-z0-9-]+$" };
const configuration: Schema = { ...string, maxLength: 2000, description: "The relative configuration URL returned by configure_overlay." };
const selection = { family: slug, preset: slug };
const object = (properties: Record<string, Schema>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
function toolResult(summary: string, content: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: "text", text: summary }], structuredContent: content, ...(isError ? { isError: true } : {}) };
}
export function startServer() {
  const jobs = new Jobs();
  const handle = serveStdio(() => {
    const server = new McpServer({ name: "modisign", version: VERSION });
    function register(name: string, description: string, schema: Schema, run: (args: Record<string, unknown>, ctx: ServerContext) => Promise<Record<string, unknown>> | Record<string, unknown>, readOnly = false) {
      server.registerTool(name, { description, inputSchema: fromJsonSchema<Record<string, unknown>>(schema), annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true } }, async (args, ctx) => {
        try {
          const result = await run(args, ctx);
          const summary = typeof result.job_id === "string" ? `Video job ${result.job_id}: ${result.state}. Use job_status to retrieve the local file.` : name === "login" ? `Open ${result.verification_url} and approve code ${result.user_code}. Sign-in continues in the background.` : name === "list_overlays" ? `Found ${(result.items as unknown[]).length} overlays.` : name === "configure_overlay" ? `Overlay configured (${result.tier}). ${result.editorUrl}` : `${name} completed. See structuredContent.`;
          return toolResult(summary, result);
        } catch (error) {
          const result = errorResult(error);
          return toolResult(String(result.error), result, true);
        }
      });
    }
    function notify(ctx: ServerContext) {
      const token = ctx.mcpReq._meta?.progressToken;
      if (typeof token !== "string" && typeof token !== "number") return undefined;
      return (job: { state: string; progress: number }) => server.server.notification({ method: "notifications/progress", params: { progressToken: token, progress: job.progress, total: 1, message: job.state } });
    }
    register("list_overlays", "Find animated overlays by topic, family or niche. Returns compact preset choices and editor links. Reuse the same filters and pass the returned next_cursor as cursor for another page.", object({ query: { type: "string", maxLength: 60 }, family: slug, niche: slug, free_only: { type: "boolean" }, cursor: string }), async (args) => {
      const page = await catalog(args);
      return { items: page.items, next_cursor: page.nextCursor };
    }, true);
    register("get_overlay", "Inspect an overlay preset's editable fields, types, allowed values and limits, looks, aspects, duration and free status before configuring it.", object(selection, ["family", "preset"]), async (args) => {
      const result = await preset(args.family as string, args.preset as string);
      return { family: args.family, preset: args.preset, fields: Object.values(result.properties).flat(), looks: result.looks, look: result.look, aspects: result.aspects, duration: result.duration, free: result.free };
    }, true);
    register("configure_overlay", "Configure an animated overlay with editable values, look, aspect, duration or background. Returns its configuration URL and free/Pro tier. Field errors list allowed inputs so you can correct and retry. Changes to free preset text generally need Pro to render.", object({ ...selection, values: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } }, look: slug, aspect: string, duration: { type: "number", exclusiveMinimum: 0 }, background: { type: "string", enum: ["green", "transparent"] } }, ["family", "preset"]), async (args) => {
      const result = await configure(args);
      return { configuration: result.configuration, tier: result.tier, editorUrl: result.editorUrl };
    });
    register("render_overlay", "Start a local animated overlay render and return job_id. MP4 uses green screen by default; MOV is transparent ProRes 4444; WebM is transparent VP9. Needs the user's FFmpeg. Free configurations need no login; others need Pro. Poll job_status for the file.", object({ configuration, format: { type: "string", enum: ["mp4", "mov", "webm"] }, output_dir: string }, ["configuration"]), (args, ctx) => jobs.start(args as RenderInput, notify(ctx), ctx.mcpReq.signal));
    register("add_overlay_to_video", "Render an overlay transparently and composite it onto one local video (up to 60 seconds) at start_seconds. Automatically selects and reauthorizes the nearest supported aspect, returned as aspect. The start must fit the overlay within the video. Returns job_id; poll job_status. Produces H.264/AAC MP4 with audio, source aspect, long side capped at 1920. Local media never uploads. Use edit_video for longer or multi-clip edits.", object({ video_path: string, configuration, start_seconds: { type: "number", minimum: 0 }, output_path: string }, ["video_path", "configuration", "start_seconds"]), (args, ctx) => jobs.start(args as RenderInput, notify(ctx), ctx.mcpReq.signal));
    const number = (minimum: number, maximum: number): Schema => ({ type: "number", minimum, maximum });
    const crop = { ...object(Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, number(0, 95)])), ["top", "right", "bottom", "left"]), description: "Percent removed from each oriented source edge; opposite sides must total at most 95. Omit for zero crop." };
    const place = { oneOf: [object({ mode: { type: "string", enum: PLACE_MODES } }, ["mode"]), object({ mode: { const: "custom" }, x: number(0, 1), y: number(0, 1), width: number(0.05, 1), height: number(0.05, 1) }, ["mode", "x", "y", "width", "height"])], description: "Destination box in the output. Custom coordinates are normalized, contained in the output. Omit for full." };
    const clip = { ...object({ path: string, track: { type: "string", enum: ["v1", "v2"], description: "Required. v1 plays in request order and supplies captions/pauses; v2 plays above it at an explicit start." }, start: { ...number(0, 180), description: "Required on v2, forbidden on v1. Timeline seconds, independent of source in/out. V2 clips cannot overlap." }, crop, place, in: number(0, 180), out: number(0, 180), fit: { type: "string", enum: ["fill", "fit"] }, zoom: number(1, 3), pan_x: number(0, 1), pan_y: number(0, 1), slow_zoom: { type: "boolean" }, volume: number(0, 2), mute: { type: "boolean" }, fade_in: number(0, 2), fade_out: number(0, 2), punch_ins: { type: "array", maxItems: 50, items: object({ at: number(0, 180), length: { ...number(0.5, 4), multipleOf: 0.1 }, zoom: { type: "number", enum: [110, 125, 140] } }, ["at", "length", "zoom"]) } }, ["path", "track"]), oneOf: [{ properties: { track: { const: "v1" }, start: false } }, { properties: { track: { const: "v2" } }, required: ["start"] }] };
    register("edit_video", "Create a local video with sequential v1 clips and nonoverlapping v2 clips above them. Every clip requires track; v2 requires start seconds, v1 forbids start. Crop uses source-edge percentages; place selects full, halves, corner picture-in-picture or a custom normalized box. Omitted crop/place mean zero crop/full. Supports trims, fill/fit, pan (0–1), zoom (1–3), photos, audio and source-second punch-ins. Up to 300 clips, maximum end 180 seconds. after_clip indexes the request array and must target v1; the incoming neighbor is the next v1, skipping v2. Transitions clamp to adjacent clip limits. Captions and pause detection use v1 only, even when muted. Removing pauses ripples both tracks and overlays; conflicting v1 transitions return an explicit error. Align sources manually; no automatic sync or drift correction. Example: put reference.mp4 on top muted, me.mp4 on the bottom, crop 5% off the sides, start together, Clean captions from my voice. Captions are made on your computer in English; optional corrections replace exact words/phrases. Specify caption style clean/boxed/minimal/karaoke/bold-keyword/word-pop/highlight-box/neon/pop-up/typewriter/outline/editorial/gradient, position upper/center/lower and size s/m/l. No overlays or unchanged free overlays with Clean/Boxed/Minimal captions export without login; other edits need Pro. 1080p default, 720p also free. Media never uploads; Studio exports never enter account history. Returns job_id; poll job_status.", object({ clips: { type: "array", minItems: 1, maxItems: 300, items: clip }, transitions: { type: "array", maxItems: 299, items: object({ after_clip: { type: "integer", minimum: 0, maximum: 298 }, type: { type: "string", enum: ["crossfade", "dip"] }, duration: number(0.2, 1) }, ["after_clip", "type", "duration"]) }, remove_silences: object({ sensitivity: { type: "string", enum: ["gentle", "normal", "strong"] }, shortest_pause: { type: "number", enum: [0.3, 0.5, 1] } }, ["sensitivity", "shortest_pause"]), overlays: { type: "array", maxItems: 100, items: object({ configuration, start: number(0, 180) }, ["configuration", "start"]) }, captions: object({ style: { type: "string", enum: CAPTION_STYLE_IDS }, position: { type: "string", enum: ["upper", "center", "lower"] }, size: { type: "string", enum: ["s", "m", "l"] }, corrections: { type: "array", maxItems: 100, items: object({ from: { ...string, maxLength: 200 }, to: { type: "string", maxLength: 200 } }, ["from", "to"]) } }, ["style", "position", "size"]), aspect: { type: "string", enum: ["9x16", "4x5", "1x1", "16x9"] }, quality: { type: "string", enum: ["1080p", "720p"] }, output_path: string }, ["clips", "aspect"]), (args, ctx) => jobs.start({ ...args, kind: "studio" } as StudioInput, notify(ctx), ctx.mcpReq.signal));
    register("get_transcript", "Transcribe English speech in one local video (up to 180 seconds) using an English speech model on your computer. Optional in/out trim seconds; returned line times are source seconds. The transcript text is returned to your assistant/provider, so call only when the user wants to review or correct it. Media and transcript are never sent to Modisign. First use downloads the speech model; later calls work offline. Use captions.corrections in edit_video to fix names/phrases.", object({ path: string, in: number(0, 180), out: number(0, 180) }, ["path"]), (args, ctx) => getTranscript(args as { path: string; in?: number; out?: number }, ctx.mcpReq.signal), true);
    register("job_status", "Check a local video job's state and progress (0–1). A done job includes the local artifact path, MIME type, bytes, duration and any history warning. Jobs last for this server process.", object({ job_id: string }, ["job_id"]), (args) => jobs.status(args.job_id as string), true);
    register("cancel_job", "Cancel a queued or running local video job and clean its temporary files. A completed artifact is retained.", object({ job_id: string }, ["job_id"]), (args) => jobs.cancel(args.job_id as string));
    register("account_status", "Check whether Modisign is signed in and has current Pro access. Anonymous free overlays work without signing in. Returns sign-in instructions when needed.", object({}), accountStatus, true);
    register("login", "Start Modisign device sign-in. Show the returned verification URL and code to the user; they sign in with Google and explicitly approve. Polling continues in the background. Use account_status to check completion. This tool never opens a browser or returns credentials.", object({}), async () => (await login()).response);
    return server;
  });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true; stopLogin(); await jobs.close(); await handle.close();
  }
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
  process.stdin.once("end", () => { void close(); });
  return handle;
}
