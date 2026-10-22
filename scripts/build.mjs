import { STUDIO_ASSETS, copyPersonAssets, copySfxPack, studioWebRoot } from "./studio-assets.mjs";
import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = studioWebRoot(root);
const require = createRequire(import.meta.url);
const speech = dirname(dirname(require.resolve("@huggingface/transformers")));
await rm(`${root}dist`, { recursive: true, force: true });
const entries = (await readdir(`${root}src`)).filter((name) => name.endsWith(".ts")).map((name) => `${root}src/${name}`);
await build({ entryPoints: entries, outdir: `${root}dist`, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", tsconfig: `${root}tsconfig.json`,
  plugins: [{ name: "mcp-modules", setup(builder) { builder.onResolve({ filter: /^\.\/.*\.js$/ }, (args) => ({ path: args.path, external: true })); } }] });
await mkdir(`${root}dist/studio`, { recursive: true });
await build({ entryPoints: [`${root}browser/studio.ts`, `${web}src/lib/captions-worker.ts`], entryNames: "[name]", outdir: `${root}dist/studio`, bundle: true, platform: "browser", format: "esm", target: "chrome120", tsconfig: `${root}tsconfig.json` });
for (const name of STUDIO_ASSETS) await copyFile(`${root}browser/${name}`, `${root}dist/studio/${name}`);
await copySfxPack(root, `${root}dist/studio`);
await copyPersonAssets(root, web, `${root}dist/studio`);
// The ORT build Transformers.js itself imports, so its JS and WASM can never disagree.
const runtime = `${dirname(createRequire(require.resolve("@huggingface/transformers")).resolve("onnxruntime-web"))}/`;
for (const extension of ["wasm", "mjs"]) await copyFile(`${runtime}ort-wasm-simd-threaded.${extension}`, `${root}dist/studio/ort-wasm-simd-threaded.${extension}`);
await copyFile(`${speech}/LICENSE`, `${root}dist/studio/transformers-LICENSE`);
