import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountStatus, credentials } from "./auth.js";
import { templateTitle } from "../vendor/web/src/lib/template-config.ts";
import { api, track } from "./api.js";
import { ToolError } from "./errors.js";
import { destination, inputFile, publishFile } from "./files.js";
import { authorize, bundle, configurationUrl, outputConfiguration, resolveConfiguration, supportedAspects, type Configured } from "./overlays.js";
import { browserStatus, ffmpegVersion, hyperframesCli, run } from "./processes.js";
import { closestVideoAspect, compositeSize, overlayStartLimit, pictureSize, type Probe } from "./own-video.js";

export type Format = "mp4" | "mov" | "webm";
export type Artifact = { path: string; mime_type: string; bytes: number; duration_seconds: number };
export type RenderInput = { configuration: string; format?: Format; output_dir?: string; output_path?: string; video_path?: string; start_seconds?: number };
export type Update = (state: "downloading_browser" | "downloading_speech_model" | "preparing_captions" | "placing_captions" | "rendering" | "compositing" | "preparing_people_model" | "preparing_people_masks", progress: number) => void;
export async function recordHistory(config: Configured, free: boolean): Promise<string[]> {
  try {
    if (free && !(await accountStatus()).pro) return [];
    const stored = await credentials();
    if (stored === undefined) throw new Error("Connection disappeared");
    const { family, config: draft } = config.studio;
    await api("/api/account/exports", {
      title: templateTitle(family, draft.values), templateName: family.name, templateHref: config.configuration,
    }, stored.token);
    return [];
  } catch { return ["Your file is saved, but Modisign could not record account history."]; }
}

export async function probe(path: string, signal?: AbortSignal): Promise<Probe> {
  try { return JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { signal, timeout: 30_000 })) as Probe; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new ToolError("ffprobe is missing. Reinstall FFmpeg including ffprobe.");
    throw error;
  }
}
export function videoInfo(metadata: Probe, outputSize = true) {
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new ToolError("The file must contain a video with a known positive duration.");
  if (duration > 60) throw new ToolError("This video exceeds 60 seconds. Use Studio for longer or multi-clip edits: https://modisign.app/studio/edit", { reason: "video_too_long", studio_url: "https://modisign.app/studio/edit" });
  const size = pictureSize(metadata);
  return { duration, ...(outputSize ? compositeSize(size) : size) };
}
export function renderArguments(directory: string, variablesPath: string, output: string, format: Format) {
  return ["--import", fileURLToPath(new URL("./render-preload.js", import.meta.url)), hyperframesCli, "render", directory, "--variables-file", variablesPath, "--strict-variables", "--format", format, "--quality", "standard", "--workers", "1", "--fps", "30", "--output", output];
}
export function compositeArguments(video: string, overlay: string, output: string, info: { duration: number; width: number; height: number }, start: number, overlayDuration: number) {
  const end = start + overlayDuration;
  const filter = `[0:v:0]setpts=PTS-STARTPTS,scale=${info.width}:${info.height},setsar=1[base];[1:v:0]scale=${info.width}:-2,setsar=1,setpts=PTS-STARTPTS+${start}/TB[overlay];[base][overlay]overlay=x=0:y=(H-h)/2:eof_action=pass:repeatlast=0:enable='gte(t,${start})*lt(t,${end})'[out]`;
  return ["-hide_banner", "-nostdin", "-n", "-i", video, "-i", overlay, "-filter_complex", filter, "-map", "[out]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-af", "asetpts=PTS-STARTPTS", "-t", String(info.duration), "-movflags", "+faststart", "-progress", "pipe:1", output];
}
export async function validateRender(input: RenderInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const validationSignal = signal === undefined ? new AbortController().signal : signal;
  const format = input.video_path === undefined ? input.format ?? "mp4" : "mov";
  let configuration = outputConfiguration(input.configuration, format);
  let tier = await authorize(configuration, signal);
  await ffmpegVersion(signal);
  let aspect: string | undefined;
  if (input.video_path !== undefined) {
    const video = await inputFile(input.video_path);
    const info = videoInfo(await probe(video, signal), false);
    const url = configurationUrl(configuration);
    aspect = closestVideoAspect(info, await supportedAspects(url.pathname.slice("/overlays/".length), validationSignal));
    url.searchParams.set("aspect", aspect);
    configuration = `${url.pathname}?${url.searchParams}`;
    tier = await authorize(configuration, signal);
    const config = await resolveConfiguration(configuration, validationSignal);
    const limit = overlayStartLimit(info.duration, config.render.duration);
    if (input.start_seconds === undefined || !Number.isFinite(input.start_seconds) || input.start_seconds < 0 || input.start_seconds > limit) throw new ToolError(`start_seconds must be between 0 and ${limit} seconds so the overlay fits in the video.`, { field: "start_seconds", allowed: { min: 0, max: limit } });
  }
  signal?.throwIfAborted();
  return { configuration, tier, format, aspect };
}
export async function render(input: RenderInput, signal: AbortSignal, update: Update): Promise<{ artifact: Artifact; warnings: string[]; aspect?: string }> {
  const family = configurationUrl(input.configuration).pathname.slice("/overlays/".length);
  const kind = input.video_path === undefined ? "overlay" : "composite";
  const { configuration, tier, format, aspect } = await validateRender(input, signal);
  const free = tier === "free";
  let work: string | undefined;
  try {
    signal.throwIfAborted();
    const config = await resolveConfiguration(configuration, signal);
    const directory = await bundle(config.render.compositionUrl, signal);
    const desired = destination(family, kind === "composite" ? "mp4" : format, input.output_dir, input.output_path);
    await mkdir(dirname(desired), { recursive: true });
    // Staging on the output filesystem makes the final exclusive hard link atomic.
    work = await mkdtemp(join(dirname(desired), ".modisign-"));
    const variablesPath = join(work, "variables.json");
    await writeFile(variablesPath, JSON.stringify(config.render.variables), { mode: 0o600 });
    const browser = await browserStatus(signal);
    if (!browser.present) {
      if (browser.kind === "system") throw new ToolError(browser.message, { reason: "browser_missing", install_command: "sudo apt install chromium" });
      update("downloading_browser", 0.01);
      await run(process.execPath, [hyperframesCli, "browser", "ensure"], { signal, timeout: 10 * 60_000, onOutput: (chunk) => {
        for (const match of chunk.matchAll(/(\d+)%/g)) update("downloading_browser", 0.01 + Math.min(100, Number(match[1])) / 100 * 0.08);
      } });
      if (!(await browserStatus(signal)).present) throw new ToolError("The private render browser is unavailable after download. Run modisign-mcp doctor.");
    }
    update("rendering", 0.1);
    const overlay = join(work, `overlay.${format}`);
    await run(process.execPath, renderArguments(directory, variablesPath, overlay, format), { signal, cwd: work, onOutput: (chunk) => {
      for (const match of chunk.matchAll(/(\d+(?:\.\d+)?)%/g)) update("rendering", 0.1 + Math.min(100, Number(match[1])) / 100 * (kind === "composite" ? 0.6 : 0.8));
    } });
    let resultPath = overlay;
    let duration = config.render.duration;
    if (input.video_path !== undefined) {
      const video = await inputFile(input.video_path);
      const info = videoInfo(await probe(video, signal));
      if (input.start_seconds === undefined) throw new Error("Composite has no start_seconds.");
      update("compositing", 0.75);
      resultPath = join(work, "composite.mp4");
      duration = info.duration;
      await run("ffmpeg", compositeArguments(video, overlay, resultPath, info, input.start_seconds, config.render.duration), { signal, onOutput: (chunk) => {
        for (const match of chunk.matchAll(/out_time_us=(\d+)/g)) update("compositing", 0.75 + Math.min(1, Number(match[1]) / 1e6 / duration) * 0.2);
      } });
    }
    signal.throwIfAborted();
    const path = await publishFile(resultPath, desired);
    const artifact = { path, mime_type: kind === "composite" || format === "mp4" ? "video/mp4" : format === "mov" ? "video/quicktime" : "video/webm", bytes: (await stat(path)).size, duration_seconds: duration };
    const warnings = await recordHistory(config, free);
    await track("mcp_render", { family, free, kind, outcome: "success" });
    return { artifact, warnings, ...(aspect === undefined ? {} : { aspect }) };
  } catch (error) {
    // A canceled job is not a render failure.
    if (!signal.aborted) await track("mcp_render", { family, free, kind, outcome: "failure" });
    throw error;
  } finally { if (work !== undefined) await rm(work, { recursive: true, force: true }); }
}
