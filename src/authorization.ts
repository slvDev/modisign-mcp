import { api } from "./api.js";
import { credentials } from "./auth.js";
import { readCache, writeCache } from "./cache.js";
import { denied, OfflineError, ToolError } from "./errors.js";

// Names what the request uses so a denial says which part needs Pro, from the fixed booleans already sent for authorization.
function proSubject(body: Record<string, unknown>) {
  if (body.kind !== "studio") return "This overlay configuration";
  const used = [["titleEffects", "a title effect (reveal or behind person)"], ["captionCustomized", "custom caption word styles"], ["overlayMotionCustomized", "motion on a catalog overlay"]].filter(([key]) => body[key] === true).map(([, label]) => label);
  return used.length === 0 ? "This edit's overlay configuration or caption style" : `This edit uses ${used.join(", ")}, which`;
}
export async function authorizeRequest(body: Record<string, unknown>, key: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const stored = await credentials();
  try {
    const result = await api<{ allowed: boolean; tier: "free" | "pro"; reason?: string }>("/api/mcp/authorize", body, stored?.token, signal);
    if (!result.allowed) {
      if (result.reason === undefined) throw new ToolError("Authorization response has no reason.");
      throw denied(result.reason, proSubject(body));
    }
    if (result.tier === "free") await writeCache(key, { allowed: true });
    signal?.throwIfAborted();
    return result.tier;
  } catch (error) {
    if (error instanceof OfflineError && (await readCache<{ allowed: boolean }>(key))?.allowed === true) {
      signal?.throwIfAborted();
      return "free";
    }
    throw error;
  }
}
