import { homedir, platform } from "node:os";
import { isAbsolute, join } from "node:path";

export const VERSION = "0.5.0";
export const RENDERER_VERSION = "0.8.80";
export const baseUrl = new URL(process.env.MODISIGN_URL ?? "https://modisign.app").origin;
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) {
  throw new Error("MODISIGN_URL must use HTTPS (HTTP is allowed for localhost).");
}
export function configDirectory(os = platform(), home = homedir(), appdata = process.env.APPDATA) {
  if (os === "win32") {
    if (appdata === undefined) throw new Error("APPDATA is required on Windows.");
    return join(appdata, "modisign");
  }
  return join(home, ".config", "modisign");
}
export const configDir = process.env.MODISIGN_CONFIG_DIR === undefined ? configDirectory() : process.env.MODISIGN_CONFIG_DIR;
if (!isAbsolute(configDir)) throw new Error("MODISIGN_CONFIG_DIR must be an absolute local path.");
export const cacheDir = join(configDir, "cache", `v5-hf-${RENDERER_VERSION}`);
// The pinned speech model is keyed by its own revision, so a configuration cache epoch never downloads it again.
export const speechCacheDir = join(configDir, "cache", "speech");
export const outputDir = join(homedir(), platform() === "darwin" ? "Movies" : "Videos", "Modisign");
export const osLabel = platform() === "darwin" ? "macOS" : platform() === "win32" ? "Windows" : "Linux";
