import { randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { ToolError } from "./errors.js";

export function isolatedBrowserArguments(proxy: string) {
  return [
    `--proxy-server=${proxy}`, "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--disable-quic",
    "--disable-background-networking", "--dns-prefetch-disable",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
}

export async function renderProxy(exactPaths: Iterable<string>, userAgent = `Modisign/${randomBytes(32).toString("hex")}`) {
  const paths = new Set(exactPaths);
  let origin: string | undefined;
  const server = createServer((incoming, outgoing) => {
    let url: URL;
    try {
      if (incoming.url === undefined) throw new Error("Missing request URL");
      url = new URL(incoming.url);
    } catch { outgoing.writeHead(403).end(); return; }
    if (incoming.headers["user-agent"] !== userAgent || url.origin !== origin || url.username !== "" || url.password !== "" || url.search !== "" || incoming.method !== "GET" || !paths.has(url.pathname)) {
      outgoing.writeHead(403).end(); return;
    }
    // Only the host's first page.goto can authorize a server; page scripts cannot change it.
    const upstream = request({ hostname: "127.0.0.1", port: url.port, path: url.pathname, method: "GET", headers: incoming.headers }, (response) => {
      if (response.statusCode !== 200 && response.statusCode !== 206) { response.resume(); outgoing.writeHead(403).end(); return; }
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    outgoing.on("close", () => upstream.destroy());
    upstream.end();
  });
  server.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new ToolError("Cannot establish render network isolation.");
  server.unref();
  return {
    url: `http://127.0.0.1:${address.port}`,
    userAgent,
    allowNavigation(raw: string) {
      const url = new URL(raw);
      if (url.protocol === "data:" || url.protocol === "about:") return;
      if (url.protocol !== "http:" || url.hostname !== "localhost" || url.port === "" || url.pathname !== "/index.html" || url.search !== "" || url.username !== "" || url.password !== "") throw new ToolError("Blocked render navigation outside the cached composition.");
      if (origin !== undefined && origin !== url.origin) throw new ToolError("Blocked render server change.");
      origin = url.origin;
    },
    close() { server.closeAllConnections(); server.close(); },
  };
}
