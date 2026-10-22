import { existsSync } from "node:fs";
import { cp, copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const STUDIO_ASSETS = Object.freeze([
  "index.html", "caption-fonts.css", "montserrat.woff2", "montserrat-ext.woff2", "montserrat-OFL.txt", "lora.woff2", "lora-ext.woff2", "lora-italic.woff2", "lora-italic-ext.woff2", "lora-OFL.txt",
  "roboto-mono.woff2", "roboto-mono-ext.woff2", "roboto-mono-OFL.txt", "onnxruntime-LICENSE",
]);
// The sound pack is the website's canonical `web/public/sfx/ugc-1`; a generated mirror carries the same bytes as `browser/sfx/ugc-1`.
export const SFX_PACK_PATH = "sfx/ugc-1";
export function sfxPackSource(root) {
  const mirrored = join(root, "browser", SFX_PACK_PATH);
  return existsSync(mirrored) ? mirrored : join(root, "..", "web", "public", SFX_PACK_PATH);
}
export const copySfxPack = (root, destination) => cp(sfxPackSource(root), join(destination, SFX_PACK_PATH), { recursive: true });
// The monorepo's `web/` when present, else the generated mirror's `vendor/web/`; always with a trailing slash.
export const studioWebRoot = (root) => `${existsSync(join(root, "..", "web", "src", "lib")) ? join(root, "..", "web") : join(root, "vendor", "web")}/`;

// The people model, probe and notices are the website's canonical `web/public/person-models/people-v1`; a generated mirror carries them as `browser/person-models/people-v1`.
export const PERSON_MODEL_PATH = "person-models/people-v1";
export function personModelSource(root) {
  const mirrored = join(root, "browser", PERSON_MODEL_PATH);
  return existsSync(mirrored) ? mirrored : join(root, "..", "web", "public", PERSON_MODEL_PATH);
}
export const copyPersonModelSource = (root, destination) => cp(personModelSource(root), join(destination, PERSON_MODEL_PATH), { recursive: true });
// The runtime build step is the website's `web/scripts/person-runtime.mjs`; a generated mirror carries it as `scripts/person-runtime.mjs`.
export function personRuntimeScript(root) {
  const mirrored = join(root, "scripts", "person-runtime.mjs");
  return existsSync(mirrored) ? mirrored : join(root, "..", "web", "scripts", "person-runtime.mjs");
}
// Builds dist/studio/person-runtime/<version>/ (verified wasm and loaders, classic worker, notices) with the website's own step, then copies the model, probe and notices beside it.
export async function copyPersonAssets(root, web, destination) {
  const { buildPersonRuntime, personManifest } = await import(pathToFileURL(personRuntimeScript(root)).href);
  const { runtime, model, probe, notices } = await personManifest(web);
  if (model.directory !== `/${PERSON_MODEL_PATH}/` || notices.directory !== model.directory) throw new Error(`The person manifest places the model in ${model.directory}, not /${PERSON_MODEL_PATH}/`);
  const modelSource = personModelSource(root);
  await buildPersonRuntime({ web, source: dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision")), noticeSource: modelSource, target: join(destination, runtime.directory) });
  const modelTarget = join(destination, PERSON_MODEL_PATH);
  await mkdir(modelTarget, { recursive: true });
  for (const file of [model.file, probe.file, notices.file]) await copyFile(join(modelSource, file), join(modelTarget, file));
  await cp(join(modelSource, "licenses"), join(modelTarget, "licenses"), { recursive: true });
}
