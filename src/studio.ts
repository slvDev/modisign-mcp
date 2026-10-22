import { appendFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { authorizeRequest } from "./authorization.js";
import { track } from "./api.js";
import { ToolError } from "./errors.js";
import { destination, inputFile, publishFile } from "./files.js";
import { bundle, configurationUrl, resolveConfiguration } from "./overlays.js";
import { pictureSize } from "./own-video.js";
import { probe, type Artifact, type Update } from "./render.js";
import { validateEdit, mapClips, mapTexts, mapSfx, applyRapidIntro, checkRapidIntroStructure, selectorsCustomized, type EditInput, type MediaInfo } from "./studio-request.js";
import { assetRoutes, personRoutes, studioBrowser } from "./studio-browser.js";
import { speechModel } from "./studio-model.js";
import { timelineDuration } from "../vendor/web/src/lib/video-timeline.js";
import { initialStudioState, type StudioOverlay } from "../vendor/web/src/lib/studio-state.js";
import { motionIsIdentity } from "../vendor/web/src/lib/studio-project.js";
import { titleEffectsOn } from "../vendor/web/src/lib/studio-text.js";

export type StudioInput = EditInput & { kind: "studio" };
const PERSON_STATES = { model: "preparing_people_model", masks: "preparing_people_masks" } as const;
// Only fixed ids and booleans leave the machine: curves, times, text and paths never do.
const authorizationBody = (input: EditInput) => ({ kind: "studio", configurations: input.overlays === undefined ? [] : input.overlays.map((overlay) => overlay.configuration),
  overlayMotionCustomized: input.overlays !== undefined && input.overlays.some((overlay) => !motionIsIdentity(overlay.motion)),
  captionStyle: input.captions === undefined ? null : input.captions.style,
  captionCustomized: input.captions !== undefined && input.captions.word_styles !== undefined && selectorsCustomized(input.captions.word_styles),
  titleEffects: input.texts !== undefined && titleEffectsOn(input.texts) });
async function authorizeStudio(input: EditInput, signal?: AbortSignal) {
  const body = authorizationBody(input);
  const key = `free-studio-authorization:${JSON.stringify(body)}`;
  return authorizeRequest(body, key, signal);
}
function editInput(input: StudioInput): EditInput { const { kind: _kind, ...edit } = input; return edit; }
async function localMedia(input: EditInput, signal?: AbortSignal) {
  const media = [];
  for (const clip of input.clips) {
    if (!isAbsolute(clip.path)) throw new ToolError("Media paths must be absolute.", { field: "clips.path" });
    const path = await inputFile(clip.path);
    const extension = extname(path).toLowerCase();
    if ([".heic", ".heif"].includes(extension)) throw new ToolError("HEIC is not supported. Use JPEG, PNG, WebP or AVIF.");
    const photo = [".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension);
    const metadata = await probe(path, signal);
    const info: MediaInfo = { kind: photo ? "photo" : "video", duration: photo ? 3 : Number(metadata.format.duration), ...pictureSize(metadata) };
    media.push({ path, info, type: photo ? extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : `image/${extension.slice(1)}` : "video/mp4" });
  }
  return media;
}
export async function validateStudio(input: StudioInput, signal?: AbortSignal) {
  const edit = editInput(input);
  validateEdit(edit);
  if (edit.output_path !== undefined && (!isAbsolute(edit.output_path) || extname(edit.output_path).toLowerCase() !== ".mp4")) throw new ToolError("output_path must be an absolute .mp4 path.", { field: "output_path" });
  const overlays = edit.overlays === undefined ? [] : edit.overlays.map((overlay) => {
    const url = configurationUrl(overlay.configuration);
    url.searchParams.set("aspect", edit.aspect); url.searchParams.set("background", "transparent");
    return { ...overlay, configuration: `${url.pathname}?${url.searchParams}` };
  });
  const normalized = { ...edit, overlays };
  const tier = await authorizeStudio(normalized, signal);
  const media = await localMedia(normalized, signal);
  const clips = mapClips(normalized, media.map((item) => item.info));
  const total = timelineDuration(clips);
  const texts = mapTexts(normalized, clips);
  if (normalized.rapid_intro !== undefined) {
    const { rapid_intro: intro } = normalized;
    // Silence removal changes every length, so only the browser run on the edited result can judge duration and size.
    if (normalized.remove_silences === undefined) applyRapidIntro({ ...initialStudioState, aspect: normalized.aspect, clips, texts }, intro);
    else checkRapidIntroStructure(intro, clips);
  }
  const staged: StudioOverlay[] = [];
  for (const [index, overlay] of overlays.entries()) {
    const config = await resolveConfiguration(overlay.configuration, signal === undefined ? new AbortController().signal : signal);
    staged.push({ ...config.studio, id: `overlay-${index}`, start: overlay.start, clamped: false });
    if (overlay.start > Math.max(0, total - config.render.duration)) throw new ToolError("Overlay start must fit within the sequence.", { field: "overlays.start", allowed: { min: 0, max: Math.max(0, total - config.render.duration) } });
  }
  mapSfx(normalized, { clips, texts, overlays: staged });
  signal?.throwIfAborted();
  return { input: { ...normalized, kind: "studio" as const }, tier, media };
}
async function runStudioPage(edit: EditInput, media: Awaited<ReturnType<typeof localMedia>>, transcriptOnly: boolean, signal: AbortSignal, update: Update, output?: string) {
  const routes = await assetRoutes();
  const overlays = [];
  for (const [index, overlay] of (edit.overlays === undefined ? [] : edit.overlays).entries()) {
    const config = await resolveConfiguration(overlay.configuration, signal);
    const directory = await bundle(config.render.compositionUrl, signal);
    routes.set(`/overlays/${index}/index.html`, join(directory, "index.html"));
    for (const name of await readdir(join(directory, "assets"))) routes.set(`/overlays/${index}/assets/${encodeURIComponent(name)}`, join(directory, "assets", name));
    overlays.push({ src: `/overlays/${index}/index.html`, overlay: { ...config.studio, id: `overlay-${index}`, start: overlay.start, clamped: false, ...(overlay.motion === undefined ? {} : { motion: overlay.motion }) } });
  }
  const sources = media.map((item, index) => {
    const url = `/media/${index}`;
    routes.set(url, item.path);
    return { url, name: basename(item.path), type: item.type, kind: item.info.kind };
  });
  if (edit.captions !== undefined || transcriptOnly) for (const [route, path] of await speechModel(signal)) routes.set(route, path);
  if (edit.texts !== undefined && edit.texts.some((title) => title.occlusion !== undefined)) for (const [route, path] of personRoutes()) routes.set(route, path);
  const browser = await studioBrowser(routes, signal, update);
  // The person stages replace "rendering" in job_status while the people model loads or masks are made.
  let stage: typeof PERSON_STATES[keyof typeof PERSON_STATES] | null = null;
  let fraction = 0.1;
  try {
    await browser.page.exposeFunction("studioProgress", (value: number) => { fraction = value; update(stage ?? "rendering", value); });
    await browser.page.exposeFunction("studioStage", (next: keyof typeof PERSON_STATES | null) => { stage = next === null ? null : PERSON_STATES[next]; update(stage ?? "rendering", fraction); });
    await browser.page.exposeFunction("studioWrite", async (base64: string) => {
      signal.throwIfAborted();
      if (output === undefined) throw new Error("Transcript has no output file");
      await appendFile(output, Buffer.from(base64, "base64"));
    });
    const result = await browser.page.evaluate((request) => window.runStudio(request), { input: edit, media: sources, overlays, transcriptOnly });
    if (typeof result === "object" && result !== null && "error" in result) {
      const failure = result as { error: string; details: Record<string, unknown> };
      throw new ToolError(failure.error, failure.details);
    }
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ToolError) throw error;
    throw new ToolError(transcriptOnly ? "Transcription failed." : "Studio export failed.");
  } finally { await browser.close(); }
}
export async function renderStudio(input: StudioInput, signal: AbortSignal, update: Update): Promise<{ artifact: Artifact; warnings: string[] }> {
  const validated = await validateStudio(input, signal);
  const free = validated.tier === "free";
  const desired = destination("modisign-studio", "mp4", undefined, input.output_path);
  let work: string | undefined;
  try {
    await mkdir(dirname(desired), { recursive: true });
    work = await mkdtemp(join(dirname(desired), ".modisign-"));
    const output = join(work, "studio.mp4");
    await writeFile(output, "", { mode: 0o600 });
    update("rendering", 0.01);
    const result = await runStudioPage(editInput(validated.input), validated.media, false, signal, update, output) as { duration: number; warnings: string[] };
    signal.throwIfAborted();
    const path = await publishFile(output, desired);
    await track("mcp_render", { free, kind: "studio", outcome: "success" });
    return { artifact: { path, mime_type: "video/mp4", bytes: (await stat(path)).size, duration_seconds: result.duration }, warnings: result.warnings };
  } catch (error) { await track("mcp_render", { free, kind: "studio", outcome: "failure" }); throw error; }
  finally { if (work !== undefined) await rm(work, { recursive: true, force: true }); }
}
export async function getTranscript(input: { path: string; in?: number; out?: number }, signal: AbortSignal) {
  const edit: EditInput = { clips: [{ path: input.path, track: "v1", ...(input.in === undefined ? {} : { in: input.in }), ...(input.out === undefined ? {} : { out: input.out }) }], aspect: "9x16" };
  const media = await localMedia(edit, signal);
  if (media[0].info.kind !== "video") throw new ToolError("get_transcript requires a video with English speech.");
  mapClips(edit, media.map((item) => item.info));
  return await runStudioPage(edit, media, true, signal, () => {}) as Record<string, unknown>;
}
