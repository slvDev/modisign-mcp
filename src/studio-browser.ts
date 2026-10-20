import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { version as speechRuntimeVersion } from "../node_modules/@huggingface/transformers/package.json";
import { randomBytes } from "node:crypto";
import { pinFile, pinnedStream, type PinnedFile } from "./pinned-files.js";
import { browserStatus, hyperframesCli, run } from "./processes.js";
import { isolatedBrowserArguments, renderProxy } from "./render-isolation.js";
import { ToolError } from "./errors.js";

const studioAssets = fileURLToPath(new URL("./studio/", import.meta.url));
const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".onnx": "application/octet-stream" };
export async function assetRoutes() {
  const routes = new Map<string, string>();
  for (const name of await readdir(studioAssets)) routes.set(`/${name}`, join(studioAssets, name));
  for (const extension of ["mjs", "wasm"]) routes.set(`/speech-runtime/${speechRuntimeVersion}/ort-wasm-simd-threaded.jsep.${extension}`, join(studioAssets, `ort-wasm-simd-threaded.jsep.${extension}`));
  return routes;
}
export async function studioBrowser(routes: Map<string, string>, signal: AbortSignal, update: (state: "downloading_browser" | "rendering", fraction: number) => void) {
  signal.throwIfAborted();
  const userAgent = `Modisign/${randomBytes(32).toString("hex")}`;
  const files = new Map<string, PinnedFile & { contentType: string }>();
  const pinned = new Map<string, PinnedFile>();
  const server = createServer(async (request, response) => {
    const path = request.url;
    const file = path === undefined ? undefined : files.get(path);
    if (request.headers["user-agent"] !== userAgent || request.method !== "GET" || file === undefined) { response.writeHead(403).end(); return; }
    try {
      response.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.size, "Cache-Control": "no-store" });
      const stream = pinnedStream(file);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  let launching: ReturnType<typeof puppeteer.launch> | undefined;
  let proxy: Awaited<ReturnType<typeof renderProxy>> | undefined;
  let closing: Promise<void> | undefined;
  const abort = () => { void close().catch(() => {}); };
  const close = () => {
    if (closing !== undefined) return closing;
    signal.removeEventListener("abort", abort);
    closing = (async () => {
      try {
        if (launching !== undefined) {
          const browser = await launching.catch(() => undefined);
          if (browser !== undefined) await browser.close();
        }
      } finally {
        if (proxy !== undefined) proxy.close();
        server.closeAllConnections(); server.close();
        await Promise.all([...pinned.values()].map((file) => file.handle.close()));
      }
    })();
    return closing;
  };
  try {
    for (const [path, file] of routes) {
      signal.throwIfAborted();
      let pinnedFile = pinned.get(file);
      if (pinnedFile === undefined) { pinnedFile = await pinFile(file); pinned.set(file, pinnedFile); }
      const extension = extname(file);
      files.set(path, { ...pinnedFile, contentType: Object.hasOwn(types, extension) ? types[extension] : "application/octet-stream" });
    }
    signal.throwIfAborted();
    let status = await browserStatus(signal);
    if (!status.present) {
      if (status.kind === "system") throw new ToolError(status.message, { reason: "browser_missing" });
      update("downloading_browser", 0.01);
      await run(process.execPath, [hyperframesCli, "browser", "ensure"], { signal });
      status = await browserStatus(signal);
    }
    signal.throwIfAborted();
    if (!status.present || status.binary === undefined) throw new ToolError("The private render browser is unavailable. Run modisign-mcp doctor.");
    const binary = status.binary;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Local media server did not start");
    proxy = await renderProxy(routes.keys(), userAgent);
    signal.throwIfAborted();
    const url = `http://localhost:${address.port}/index.html`;
    proxy.allowNavigation(url);
    signal.addEventListener("abort", abort, { once: true });
    signal.throwIfAborted();
    const proxyUrl = proxy.url;
    launching = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return puppeteer.launch({ executablePath: binary, pipe: true, headless: true, protocolTimeout: 10 * 60_000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", ...isolatedBrowserArguments(proxyUrl)] });
    });
    const browser = await launching;
    signal.throwIfAborted();
    const page = await browser.newPage();
    signal.throwIfAborted();
    // User-agent overrides propagate to workers without putting the secret in process arguments.
    await page.setUserAgent(userAgent);
    signal.throwIfAborted();
    page.setDefaultTimeout(10 * 60_000);
    await page.goto(url);
    await page.waitForFunction("typeof window.runStudio === 'function'");
    signal.throwIfAborted();
    update("rendering", 0.1);
    signal.throwIfAborted();
    return { page, close };
  } catch (error) { await close(); signal.throwIfAborted(); throw error; }
}
