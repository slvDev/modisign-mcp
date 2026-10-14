import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { api, track } from "./api.js";
import { ApiError, isMissing, ToolError } from "./errors.js";
import { baseUrl, configDir, osLabel } from "./settings.js";
import { windowsPrivacy } from "./credentials-privacy.js";

type Credentials = { token: string; expires_at: number; origin: string };
const credentialsPath = join(configDir, "credentials.json");
export async function credentials(): Promise<Credentials | undefined> {
  let raw: string;
  try {
    if (process.platform === "win32") {
      await access(credentialsPath);
      await windowsPrivacy(configDir, "directory", "verify");
      await windowsPrivacy(credentialsPath, "file", "verify");
    }
    raw = await readFile(credentialsPath, "utf8");
  }
  catch (error) { if (isMissing(error)) return undefined; if (error instanceof ToolError) throw error; throw new ToolError("Cannot read local credentials."); }
  let stored: Credentials;
  try { stored = JSON.parse(raw); } catch { throw new ToolError("Invalid credentials file. Run logout and login again."); }
  if (typeof stored.token !== "string" || stored.token.length === 0 || !Number.isFinite(stored.expires_at) || typeof stored.origin !== "string") throw new ToolError("Invalid credentials file. Run logout and login again.");
  if (stored.origin !== baseUrl || stored.expires_at <= Date.now()) return undefined;
  if (process.platform !== "win32") await chmod(credentialsPath, 0o600);
  return stored;
}
async function saveCredentials(token: string, expiresIn: number) {
  if (typeof token !== "string" || token.length === 0 || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new ToolError("Invalid device token response.");
  if (process.platform === "win32") await windowsPrivacy(configDir, "directory", "protect");
  else await mkdir(configDir, { recursive: true, mode: 0o700 });
  const temporary = `${credentialsPath}.${randomUUID()}`;
  let published = false;
  try {
    if (process.platform === "win32") await windowsPrivacy(temporary, "file", "create");
    await writeFile(temporary, JSON.stringify({ token, expires_at: Date.now() + expiresIn * 1000, origin: baseUrl }), { mode: 0o600, flag: process.platform === "win32" ? "r+" : "wx" });
    await rename(temporary, credentialsPath);
    published = true;
    if (process.platform === "win32") await windowsPrivacy(credentialsPath, "file", "verify");
    else await chmod(credentialsPath, 0o600);
  } catch (error) {
    if (published) await rm(credentialsPath, { force: true });
    throw error;
  } finally { await rm(temporary, { force: true }); }
}
export async function logout() {
  const pending = currentLogin;
  stopLogin();
  if (pending !== undefined) {
    try { await (await pending.flow).completion; } catch { /* An aborted code request has no credentials to save. */ }
  }
  await rm(credentialsPath, { force: true });
}
export async function accountStatus() {
  const stored = await credentials();
  if (stored === undefined) return { signed_in: false, pro: false, sign_in: "Use the login tool or run npx -y @modisign/mcp login." };
  try {
    const account = await api<{ user: { pro: boolean } }>("/api/account", undefined, stored.token);
    return { signed_in: true, pro: account.user.pro };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { signed_in: false, pro: false, sign_in: "Your connection expired or was revoked. Use login again." };
    throw error;
  }
}
type DeviceCode = { device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval: number };
type LoginFlow = { response: { verification_url: string; user_code: string; expires_in: number }; completion: Promise<{ message: string; signed_in: boolean }> };
let currentLogin: { controller: AbortController; flow: Promise<LoginFlow> } | undefined;
export function stopLogin() { if (currentLogin !== undefined) currentLogin.controller.abort(); }
export function login(): Promise<LoginFlow> {
  if (currentLogin !== undefined) return currentLogin.flow;
  const controller = new AbortController();
  const flow = beginLogin(controller).catch(async (error: unknown) => {
    currentLogin = undefined;
    await track("mcp_login", { outcome: "failure" });
    throw error;
  });
  currentLogin = { controller, flow };
  return flow;
}
async function beginLogin(controller: AbortController): Promise<LoginFlow> {
  const code = await api<DeviceCode>("/api/auth/device/code", { client_id: "modisign-mcp", label: `Modisign MCP · ${osLabel}` }, undefined, controller.signal);
  if (!Number.isFinite(code.interval) || code.interval < 5 || !Number.isFinite(code.expires_in) || code.expires_in <= 0 || typeof code.device_code !== "string" || typeof code.user_code !== "string") throw new ToolError("Invalid device code response.");
  const verification = new URL(code.verification_uri_complete);
  verification.protocol = new URL(baseUrl).protocol;
  verification.host = new URL(baseUrl).host;
  if (verification.pathname !== "/device") throw new ToolError("Invalid device verification URL.");
  const completion = poll(code, controller.signal).finally(() => { currentLogin = undefined; });
  return { response: { verification_url: verification.href, user_code: code.user_code, expires_in: code.expires_in }, completion };
}
async function poll(code: DeviceCode, signal: AbortSignal): Promise<{ message: string; signed_in: boolean }> {
  let interval = code.interval;
  const expiry = Date.now() + code.expires_in * 1000;
  let outcome: "success" | "failure" | "denied" | "expired" = "expired";
  try {
    while (Date.now() < expiry) {
      await setTimeout(interval * 1000, undefined, { signal });
      signal.throwIfAborted();
      try {
        const result = await api<{ access_token: string; expires_in: number }>("/api/auth/device/token", { client_id: "modisign-mcp", device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }, undefined, signal);
        signal.throwIfAborted();
        await saveCredentials(result.access_token, result.expires_in);
        outcome = "success"; return { message: "Signed in. Pro status is checked when you render.", signed_in: true };
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.details.error === "authorization_pending") continue;
          if (error.details.error === "slow_down" || error.status === 429) { interval += 5; continue; }
          if (error.details.error === "access_denied") { outcome = "denied"; return { message: "Sign-in denied.", signed_in: false }; }
          if (["expired_token", "invalid_grant"].includes(String(error.details.error))) return { message: "Sign-in code expired. Start login again.", signed_in: false };
        }
        outcome = "failure"; return { message: "Sign-in failed. Start login again.", signed_in: false };
      }
    }
    return { message: "Sign-in code expired. Start login again.", signed_in: false };
  } catch { outcome = "failure"; return { message: "Sign-in canceled.", signed_in: false }; }
  finally { await track("mcp_login", { outcome }); }
}
