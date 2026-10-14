import { hyperframesCli } from "./processes.js";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const cliUrl = pathToFileURL(join(dirname(hyperframesCli), "..", "dist", "cli.js")).href;
const start = "function createFileServer2(options) {";
const end = "\nvar readFileAsync, MIME_TYPES3,";
const replacement = `function createFileServer2(options) {
  const preHeadScripts = [HF_EARLY_STUB, RENDER_CAPTURE_MODE_SHIM, ...(options.preHeadScripts ?? [])];
  const headScripts = options.headScripts ?? [getVerifiedHyperframeRuntimeSource()];
  const bodyScripts = options.bodyScripts ?? [buildRenderModeScript(options.fps), HF_BRIDGE_SCRIPT];
  return globalThis.__modisignStandaloneServer(options, html => {
    html = injectScriptsAtHeadStart(html, preHeadScripts);
    return injectScriptsIntoHtml(html, headScripts, bodyScripts, options.stripEmbeddedRuntime ?? true);
  }).then(server => ({ ...server, addPreHeadScript: script => preHeadScripts.push(script) }));
}
`;

type Load = (url: string, context: unknown) => Promise<{ source: string | Uint8Array; [key: string]: unknown }>;
export async function load(url: string, context: unknown, nextLoad: Load) {
  const loaded = await nextLoad(url, context);
  if (url !== cliUrl) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  if (first === -1 || last === -1 || source.indexOf(start, first + start.length) !== -1) throw new Error("The renderer could not start. Reinstall @modisign/mcp and retry.");
  return { ...loaded, source: source.slice(0, first) + replacement + source.slice(last) };
}
