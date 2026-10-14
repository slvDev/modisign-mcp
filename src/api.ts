import { randomUUID } from "node:crypto";
import { baseUrl } from "./settings.js";
import { ApiError, OfflineError, ToolError } from "./errors.js";

const visit = randomUUID();
export async function api<T>(path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { "Accept": "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal === undefined ? [] : [signal])]),
    });
  } catch { signal?.throwIfAborted(); throw new OfflineError(); }
  if (!response.headers.get("content-type")?.startsWith("application/json")) throw new ToolError("Modisign returned an unexpected content type.");
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, data);
  if (path.startsWith("/api/mcp/") && data.v !== 1) throw new ToolError("Unsupported Modisign API version. Update @modisign/mcp.");
  return data as T;
}
export async function track(name: "mcp_render" | "mcp_login", props: Record<string, string | boolean>) {
  if (process.env.MODISIGN_NO_TELEMETRY === "1" || process.env.DO_NOT_TRACK === "1") return;
  try {
    await fetch(new URL("/api/activity", baseUrl), { method: "POST", redirect: "error", headers: {
      "Content-Type": "application/json", Origin: baseUrl, "User-Agent": "@modisign/mcp",
    }, body: JSON.stringify({ name, visit, path: "/mcp", props }), signal: AbortSignal.timeout(3000) });
  } catch { /* Anonymous usage cannot affect a local artifact. */ }
}
