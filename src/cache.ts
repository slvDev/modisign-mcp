import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { baseUrl, cacheDir } from "./settings.js";
import { isMissing, OfflineError, ToolError } from "./errors.js";

const cacheKey = (value: string) => createHash("sha256").update(`${baseUrl}\n${value}`).digest("hex");
export async function readCache<T>(key: string, valid?: (value: unknown) => value is T): Promise<T | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(cacheDir, `${cacheKey(key)}.json`), "utf8"));
    if (valid !== undefined && !valid(value)) throw new Error("Invalid cache shape");
    return value as T;
  }
  catch (error) { if (isMissing(error)) return undefined; throw new ToolError("Invalid local cache. Remove the Modisign cache directory and retry."); }
}
export async function writeCache(key: string, value: unknown) {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const target = join(cacheDir, `${cacheKey(key)}.json`);
  const temporary = `${target}.${randomUUID()}`;
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}
function websiteUrl(url: string) {
  const source = new URL(url);
  if (source.origin !== "https://modisign.app" && source.origin !== baseUrl) throw new ToolError("Unexpected composition origin.");
  return new URL(`${source.pathname}${source.search}`, baseUrl);
}
type AssetKind = "html" | "css" | "script" | "asset";
function allowedSource(url: URL, kind: AssetKind) {
  if (url.origin === baseUrl) {
    if (!url.pathname.startsWith("/preview/") && !url.pathname.startsWith("/hyperframes/")) throw new ToolError("Unexpected composition asset route.");
    return;
  }
  if (url.protocol !== "https:") throw new ToolError("Asset must use HTTPS.");
  if (url.hostname === "cdn.jsdelivr.net" && kind === "script" && /^\/npm\/(?:gsap@[\d.]+\/dist\/gsap\.min\.js|@hyperframes\/core@0\.8\.80\/dist\/hyperframe\.runtime\.iife\.js)$/.test(url.pathname)) return;
  if (url.hostname === "fonts.googleapis.com" && kind === "css") return;
  if (url.hostname === "fonts.gstatic.com" && kind === "asset" && /\.(?:woff2?|ttf)$/.test(url.pathname)) return;
  throw new ToolError("Composition contains an unsupported remote dependency.");
}
const contentTypes: Record<AssetKind, RegExp> = {
  html: /^text\/html$/, css: /^text\/css$/, script: /^(?:text|application)\/(?:javascript|x-javascript)$/, asset: /^(?:image\/(?:png|jpeg|webp|avif|svg\+xml|gif)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|octet-stream|x-font-ttf)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|ogg|mp4))$/,
};
async function fetchAsset(url: URL, kind: AssetKind, signal: AbortSignal) {
  allowedSource(url, kind);
  let response: Response;
  try { response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), headers: { "User-Agent": "@modisign/mcp" } }); }
  catch (error) { signal.throwIfAborted(); throw new OfflineError(); }
  if (!response.ok) throw new ToolError(`Composition asset request failed (HTTP ${response.status}).`);
  const type = response.headers.get("content-type");
  if (type === null || !contentTypes[kind].test(type.split(";")[0].trim().toLowerCase())) throw new ToolError(`Unexpected ${kind} content type.`);
  if (response.body === null) throw new ToolError("Composition dependency has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 32 * 1024 * 1024) throw new ToolError("Composition dependency exceeds the 32 MB cache limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
export async function previewHtml(configuration: string, signal: AbortSignal) {
  const source = new URL(configuration.replace(/^\/overlays\//, "/preview/"), baseUrl);
  return (await fetchAsset(source, "html", signal)).toString("utf8");
}
export async function bundle(compositionUrl: string, signal: AbortSignal): Promise<string> {
  const url = websiteUrl(compositionUrl);
  if (!/^\/preview\/[a-z0-9-]+$/.test(url.pathname)) throw new ToolError("Invalid composition route.");
  const directory = join(cacheDir, "compositions", cacheKey(`bundle:3:${url.href}`));
  const complete = join(directory, "complete.json");
  try { await readFile(complete); return directory; } catch (error) { if (!isMissing(error)) throw error; }
  const staging = `${directory}.${randomUUID()}`;
  await mkdir(join(staging, "assets"), { recursive: true, mode: 0o700 });
  const assets = new Map<string, string>();
  async function localize(raw: string, parent: URL, kind: AssetKind, depth = 0): Promise<string> {
    if (raw.startsWith("data:") || raw.startsWith("#")) return raw;
    if (depth > 8 || assets.size >= 200) throw new ToolError("Composition dependency graph exceeds its limit.");
    const assetUrl = new URL(raw.replaceAll("&amp;", "&"), parent);
    allowedSource(assetUrl, kind);
    const known = assets.get(assetUrl.href);
    if (known !== undefined) return known;
    const extension = kind === "css" ? ".css" : kind === "script" ? ".js" : posix.extname(assetUrl.pathname);
    const familyAssetPrefix = `${url.pathname}/assets/`;
    const name = assetUrl.pathname.slice(familyAssetPrefix.length);
    const file = assetUrl.origin === baseUrl && assetUrl.pathname.startsWith(familyAssetPrefix) && /^[a-zA-Z0-9_.-]+$/.test(name)
      ? `assets/${name}` : `assets/${cacheKey(assetUrl.href)}${extension}`;
    assets.set(assetUrl.href, file);
    const bytes = await fetchAsset(assetUrl, kind, signal);
    if (kind === "css") {
      const css = await rewriteCss(bytes.toString("utf8"), assetUrl, depth + 1, true);
      await writeFile(join(staging, file), css);
    } else await writeFile(join(staging, file), bytes);
    return file;
  }
  async function rewriteCss(css: string, parent: URL, depth: number, insideAsset: boolean) {
    const matches = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g)];
    for (const match of matches) {
      const raw = match[2] === undefined ? match[4] : match[2];
      const kind = raw.includes("fonts.googleapis.com") || /\.css(?:\?|$)/.test(raw) ? "css" : "asset";
      const local = await localize(raw, parent, kind, depth);
      const relative = insideAsset && local.startsWith("assets/") ? posix.basename(local) : local;
      css = css.replace(match[0], match[2] === undefined ? `@import "${relative}"` : `url("${relative}")`);
    }
    return css;
  }
  try {
    let html = (await fetchAsset(url, "html", signal)).toString("utf8");
    const injected = html.match(/window\.__hfVariables=(\{[^<]*\})<\/script>/);
    if (injected === null) throw new ToolError("Composition is missing its merged variables.");
    const variables = JSON.parse(injected[1]) as Record<string, unknown>;
    const base = html.match(/<base\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const assetBase = base === null ? url : new URL(base[1], url);
    html = html.replace(/<base\b[^>]*>/gi, "").replace(/<link\b[^>]*rel=["'](?:preconnect|dns-prefetch)["'][^>]*>/gi, "");
    for (const match of [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]) {
      html = html.replace(match[0], match[0].replace(match[1], await rewriteCss(match[1], assetBase, 0, false)));
    }
    const tags = [...html.matchAll(/<(script|link|img|image|video|audio|source)\b[^>]*>/gi)];
    for (const [tag, name] of tags) {
      const binding = tag.match(/\bdata-var-src=["']([^"']+)["']/i);
      if (binding !== null) {
        const value = variables[binding[1]];
        if (typeof value !== "string") throw new ToolError("Composition media variable must be a string.");
        if (value.length > 0) await localize(value, assetBase, "asset");
      }
      const reference = tag.match(/\s(?:src|href)=["']([^"']+)["']/i);
      if (reference === null) continue;
      const kind: AssetKind = name.toLowerCase() === "script" ? "script" : name.toLowerCase() === "link" ? "css" : "asset";
      const local = await localize(reference[1], assetBase, kind);
      if (kind === "css") {
        const css = (await readFile(join(staging, local), "utf8")).replace(/url\("([^"/]+)"\)/g, 'url("assets/$1")');
        // HyperFrames recognizes inline font faces and avoids its own Google Fonts fetch.
        html = html.replace(tag, `<style>${css}</style>`);
      } else html = html.replace(tag, tag.replace(reference[1], local).replace(/\s+(?:integrity|crossorigin)=["'][^"']*["']/gi, ""));
    }
    // CSP supplements the host-owned proxy; cached HTML cannot loosen browser isolation.
    html = html.replace(/<head([^>]*)>/i, '<head$1><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; connect-src \'self\';">');
    await writeFile(join(staging, "index.html"), html, { mode: 0o600 });
    await writeFile(join(staging, "complete.json"), JSON.stringify({ version: 1, dependencies: assets.size }));
    await mkdir(join(cacheDir, "compositions"), { recursive: true });
    await rename(staging, directory);
    return directory;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
