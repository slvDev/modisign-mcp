import { build } from "esbuild";
import { cp, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";

// The one build step for the person runtime, shared by the website (scripts/copy-person-runtime.mjs) and the MCP package build and its public mirror.
// `web` holds src/lib (web/ or the mirror's vendor/web/); `source` is the installed @mediapipe/tasks-vision directory; `noticeSource` holds NOTICE.txt and licenses/.
export async function personManifest(web) {
  // The manifest is TypeScript with no imports: bundle it in memory instead of relying on the host's Node type stripping.
  const bundled = await build({ entryPoints: [`${web}src/lib/person-manifest.ts`], bundle: true, write: false, format: "esm", platform: "neutral" });
  return (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)).PERSON_MANIFEST;
}

// Rebuilds `target` (a directory named by the runtime version) with the verified wasm/loader files, the worker and the runtime notices.
export async function buildPersonRuntime({ web, source, noticeSource, target }) {
  const { runtime, notices } = await personManifest(web);
  const { version } = JSON.parse(await readFile(`${source}/package.json`, "utf8"));
  if (version !== runtime.version) throw new Error(`Installed ${runtime.package} is ${version}, the person manifest pins ${runtime.version}`);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const asset of [runtime.simd.loader, runtime.simd.wasm, runtime.noSimd.loader, runtime.noSimd.wasm]) {
    const bytes = await readFile(`${source}/wasm/${asset.file}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== asset.bytes || sha256 !== asset.sha256) throw new Error(`${asset.file} is ${bytes.length} bytes with SHA-256 ${sha256}; the person manifest expects ${asset.bytes} and ${asset.sha256}`);
    await copyFile(`${source}/wasm/${asset.file}`, `${target}/${asset.file}`);
  }
  await build({ entryPoints: [`${web}src/lib/person-worker.ts`], outfile: `${target}/${runtime.worker}`, bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true,
    banner: { js: `/* Modisign person worker. Bundles the ${runtime.package} ${runtime.version} JavaScript API (Apache-2.0); see NOTICE.txt beside it. */` } });
  // The notices travel with the runtime they describe.
  await copyFile(`${noticeSource}/${notices.file}`, `${target}/${notices.file}`);
  await cp(`${noticeSource}/licenses`, `${target}/licenses`, { recursive: true });
  return { runtime, notices };
}
