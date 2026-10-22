import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Server } from "node:net";
import { pipeline } from "node:stream/promises";
import { ToolError } from "./errors.js";
import { pinFile, pinnedStream, type PinnedFile } from "./pinned-files.js";
import { cacheDir } from "./settings.js";

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };
function requireInside(root: string, path: string) {
  const within = relative(root, path);
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new ToolError("Render files must stay inside their cache or staging directory.");
}

export async function prepareStandaloneRender(directory: string, stagingParent: string) {
  requireInside(resolve(cacheDir), resolve(directory));
  const canonical = await realpath(directory);
  requireInside(await realpath(cacheDir), canonical);
  if (!(await lstat(directory)).isDirectory() || !(await lstat(join(directory, "assets"))).isDirectory()) throw new ToolError("Render cache directories must not be symlinks.");
  const files = new Map<string, PinnedFile>();
  const staging = await mkdtemp(join(stagingParent, ".render-"));
  const servers = new Set<ReturnType<typeof createServer>>();
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing !== undefined) return closing;
    closing = (async () => {
      for (const server of servers) { server.closeAllConnections(); server.close(); }
      await Promise.all([...files.values()].map(file => file.handle.close()));
      await rm(staging, { recursive: true, force: true });
    })();
    return closing;
  };
  try {
    const names = ["index.html", ...(await readdir(join(directory, "assets"))).map(name => `assets/${name}`)];
    for (const name of names) files.set(`/${name.split("/").map(encodeURIComponent).join("/")}`, await pinFile(join(directory, name), canonical));
    await mkdir(join(staging, "assets"));
    // HyperFrames compiles a private snapshot, never a cache pathname that can be swapped.
    for (const [path, file] of files) await pipeline(pinnedStream(file), createWriteStream(join(staging, decodeURIComponent(path.slice(1))), { flags: "wx", mode: 0o600 }));
    return {
      directory: staging,
      close,
      restrictListeners() {
        const listen = Server.prototype.listen;
        // Fail closed if HyperFrames bypasses the pinned server-factory hook.
        Server.prototype.listen = function (this: Server, ...args: unknown[]) {
          if (!servers.has(this as ReturnType<typeof createServer>)) throw new ToolError("Blocked an unauthenticated render listener.");
          return Reflect.apply(listen, this, args);
        };
      },
      async serve(projectDir: string, compiledDir: string, transform: (html: string) => string) {
        if (closing !== undefined || projectDir !== staging) throw new ToolError("Unexpected standalone render project.");
        // HyperFrames stages Windows captures in system temp instead of beside the output.
        const workRoot = process.platform === "win32" ? tmpdir() : stagingParent;
        // The output directory may be a symlink alias (macOS /tmp); compare canonical paths, still strictly inside the work root.
        const compiledRoot = await realpath(workRoot);
        const compiled = await realpath(compiledDir);
        requireInside(compiledRoot, compiled);
        if (basename(compiledDir) !== "compiled" || !(await lstat(compiledDir)).isDirectory()) throw new ToolError("Unexpected compiled render directory.");
        const index = await pinFile(join(compiled, "index.html"), compiledRoot);
        let rawHtml: string;
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of pinnedStream(index)) chunks.push(chunk);
          rawHtml = Buffer.concat(chunks).toString("utf8");
        } finally { await index.handle.close(); }
        const userAgent = `Modisign/${randomBytes(32).toString("hex")}`;
        let origin: string;
        const server = createServer((incoming, outgoing) => {
          let url: URL;
          try {
            if (incoming.url === undefined) throw new Error("Missing request URL");
            url = new URL(incoming.url, origin);
          } catch { outgoing.writeHead(403).end(); return; }
          const file = files.get(url.pathname);
          if (incoming.headers["user-agent"] !== userAgent || url.origin !== origin || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || incoming.method !== "GET" || file === undefined || incoming.url !== url.pathname && incoming.url !== url.href) {
            outgoing.writeHead(403).end(); return;
          }
          const extension = extname(url.pathname);
          if (url.pathname === "/index.html") {
            const html = Buffer.from(transform(rawHtml));
            outgoing.writeHead(200, { "Content-Type": "text/html", "Content-Length": html.length, "Cache-Control": "no-store" }).end(html);
            return;
          }
          outgoing.writeHead(200, { "Content-Type": Object.hasOwn(types, extension) ? types[extension] : "application/octet-stream", "Content-Length": file.size, "Cache-Control": "no-store" });
          const stream = pinnedStream(file);
          stream.on("error", () => outgoing.destroy());
          outgoing.on("close", () => stream.destroy());
          stream.pipe(outgoing);
        });
        server.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
        server.on("upgrade", (_request, socket) => socket.destroy());
        servers.add(server);
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
        const address = server.address();
        if (address === null || typeof address === "string") throw new ToolError("Cannot establish standalone render isolation.");
        origin = `http://localhost:${address.port}`;
        server.unref();
        return {
          url: origin, port: address.port, proxyUrl: `http://127.0.0.1:${address.port}`, userAgent,
          allowNavigation(raw: string) {
            const url = new URL(raw);
            if (url.protocol === "data:" || url.protocol === "about:") return;
            if (raw !== `${origin}/index.html`) throw new ToolError("Blocked render navigation outside the cached composition.");
          },
          close() { server.closeAllConnections(); server.close(); servers.delete(server); },
        };
      },
    };
  } catch (error) { await close(); throw error; }
}
