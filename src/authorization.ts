import { api } from "./api.js";
import { credentials } from "./auth.js";
import { readCache, writeCache } from "./cache.js";
import { denied, OfflineError, ToolError } from "./errors.js";

export async function authorizeRequest(body: Record<string, unknown>, key: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const stored = await credentials();
  try {
    const result = await api<{ allowed: boolean; tier: "free" | "pro"; reason?: string }>("/api/mcp/authorize", body, stored?.token, signal);
    if (!result.allowed) {
      if (result.reason === undefined) throw new ToolError("Authorization response has no reason.");
      throw denied(result.reason);
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
