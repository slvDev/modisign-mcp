import { STUDIO_ASSETS } from "./studio-assets.mjs";
import ts from "typescript";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const monorepo = resolve(root, "..");
const header = "// generated from the Modisign monorepo, do not edit\n";
const [option, destination] = process.argv.slice(2);
if (option !== undefined && option !== "--check" && option !== "--output") throw new Error("Use --check or --output <directory>.");
if (option === "--output" && destination === undefined) throw new Error("A mirror output directory is required.");
const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, join(root, "tsconfig.json"));
const program = ts.createProgram([...parsed.fileNames, join(monorepo, "web/src/lib/captions-worker.ts")], parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (diagnostics.length !== 0) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n",
}));
const files = new Map();
for (const source of program.getSourceFiles()) {
  const path = relative(monorepo, source.fileName);
  if (path.includes("node_modules/") || path.startsWith("mcp/")) continue;
  if (!path.startsWith("web/src/lib/") && !path.startsWith("server/src/")) throw new Error(`Unapproved shared source: ${path}`);
  files.set(path, header + source.text.replaceAll("../../node_modules/@huggingface/transformers/package.json", "../../../../node_modules/@huggingface/transformers/package.json"));
}
if (files.size === 0) throw new Error("No shared source dependencies found; run from the monorepo.");
async function paths(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await paths(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected vendor entry: ${path}`);
  }
  return result.sort();
}
async function checkVendor(directory) {
  const actual = await paths(directory);
  const expected = [...files.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Vendor file list is stale; run npm run mirror:generate.");
  for (const [path, content] of files) {
    if (await readFile(join(directory, path), "utf8") !== content) throw new Error(`Stale vendor/${path}; run npm run mirror:generate.`);
  }
}
if (option === "--check") {
  await checkVendor(join(root, "vendor"));
  console.log(`Vendor is fresh: ${files.size} transitive source files.`);
} else {
  const output = option === "--output" ? resolve(destination) : root;
  if (option === "--output") {
    if (output === root || output === monorepo || output.startsWith(`${root}/`)) throw new Error("Mirror output must be outside mcp/.");
    await mkdir(output, { recursive: true });
    if ((await readdir(output)).length !== 0) throw new Error("Mirror output must be empty.");
    const sourceFolders = {
      src: (path) => path.endsWith(".ts"),
      browser: (path) => path.endsWith(".ts") || STUDIO_ASSETS.includes(path),
      tests: (path) => path.endsWith(".test.mjs"),
      scripts: (path) => ["build.mjs", "studio-assets.mjs", "mirror-source.mjs", "mirror.sh"].includes(path),
      skills: (path) => path === "modisign/SKILL.md",
    };
    for (const [folder, include] of Object.entries(sourceFolders)) {
      for (const path of await paths(join(root, folder))) {
        if (!include(path)) continue;
        const file = join(folder, path);
        await mkdir(dirname(join(output, file)), { recursive: true });
        await cp(join(root, file), join(output, file));
      }
    }
    for (const path of ["README.md", "TECHNICAL.md", "LICENSE", "NOTICE", "server.json", "package.json", "tsconfig.json"]) {
      await cp(join(root, path), join(output, path));
    }
    for (const folder of ["src", "browser"]) {
      for (const path of await paths(join(output, folder))) {
        if (!path.endsWith(".ts")) continue;
        const file = join(output, folder, path);
        await writeFile(file, (await readFile(file, "utf8")).replaceAll("../../web/src/", "../vendor/web/src/"));
      }
    }
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    delete packageJson.scripts["mirror:generate"];
    delete packageJson.scripts["mirror:check"];
    await writeFile(join(output, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
    const tsconfig = config.config;
    tsconfig.compilerOptions.paths["@/*"] = ["./vendor/web/src/*"];
    await writeFile(join(output, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
    await cp(join(root, "mirror-package-lock.json"), join(output, "package-lock.json"));
    await writeFile(join(output, ".gitignore"), "node_modules/\ndist/\n*.tgz\n");
  }
  const vendor = join(output, "vendor");
  await rm(vendor, { recursive: true, force: true });
  for (const [path, content] of files) {
    const file = join(vendor, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await checkVendor(vendor);
  console.log(`Generated ${files.size} transitive source files in ${vendor}.`);
}
