import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { ToolError } from "./errors.js";

const require = createRequire(import.meta.url);
export const hyperframesCli = join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");
export const rendererEnv: NodeJS.ProcessEnv = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", NO_COLOR: "1" };
delete rendererEnv.HYPERFRAMES_FFMPEG_PATH;
delete rendererEnv.HYPERFRAMES_FFPROBE_PATH;
delete rendererEnv.HYPERFRAMES_BROWSER_PATH;
delete rendererEnv.PRODUCER_HEADLESS_SHELL_PATH;
export function installFfmpeg(os = process.platform) {
  return os === "darwin" ? "brew install ffmpeg" : os === "win32" ? "winget install Gyan.FFmpeg" : "sudo apt install ffmpeg";
}
export async function run(executable: string, args: string[], options: { signal?: AbortSignal; cwd?: string; onOutput?: (chunk: string) => void; timeout?: number } = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeout ?? 10 * 60_000), ...(options.signal === undefined ? [] : [options.signal])]);
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: rendererEnv, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let killTimer: NodeJS.Timeout | undefined;
    function terminate() {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* Process may have already exited. */ }
        killTimer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Group already exited. */ } }, 2000);
        killTimer.unref();
      }
    }
    signal.addEventListener("abort", terminate, { once: true });
    function capture(chunk: Buffer) {
      const value = chunk.toString("utf8");
      output = (output + value).slice(-64 * 1024);
      options.onOutput?.(value);
    }
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    child.on("error", (error) => { signal.removeEventListener("abort", terminate); reject(error); });
    child.on("close", (code) => {
      signal.removeEventListener("abort", terminate);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (signal.aborted) { reject(signal.reason); return; }
      if (code !== 0) { reject(new ToolError(`${executable === process.execPath ? "The renderer" : executable} failed (exit ${code}). Run modisign-mcp doctor and retry.`)); return; }
      resolve(output);
    });
    if (signal.aborted) terminate();
  });
}
export async function ffmpegVersion(signal?: AbortSignal) {
  try { return (await run("ffmpeg", ["-version"], { signal, timeout: 10_000 })).split("\n")[0]; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new ToolError(`FFmpeg is missing. Install it with: ${installFfmpeg()}`, { reason: "ffmpeg_missing", install_command: installFfmpeg() });
    throw error;
  }
}
type BrowserSelection = { kind: "system"; paths: string[]; commands: string[] } | { kind: "managed"; binary: string; version: string };
export function browserSelection(source: string, os = process.platform, arch = process.arch, hostRelease = release(), home = homedir()): BrowserSelection {
  // HyperFrames 0.8.80's downloadBrowser uses system Chromium on Linux ARM64.
  if (os === "linux" && arch === "arm64") return { kind: "system", paths: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"], commands: ["google-chrome", "chromium"] };
  if (os !== "darwin" && os !== "win32" && os !== "linux") throw new ToolError(`Unsupported render browser platform: ${os} ${arch}.`);
  const oldMac = os === "darwin" && Number.parseInt(hostRelease, 10) < 22;
  const version = source.match(oldMac ? /MACOS_12_CHROME_VERSION = "([\d.]+)"/ : /\bCHROME_VERSION = "([\d.]+)"/);
  if (version === null) throw new ToolError("The private render browser setup could not be read. Run modisign-mcp doctor.");
  const releaseParts = hostRelease.split(".");
  const [major, minor, patch] = releaseParts.map((value) => Number.parseInt(value, 10));
  const windows11 = releaseParts.length > 2 && (major > 10 || (major === 10 && minor > 0) || (major === 10 && minor === 0 && patch >= 22000));
  const platform = os === "darwin" ? arch === "arm64" ? "mac_arm" : "mac" : os === "win32" ? arch === "x64" || (arch === "arm64" && windows11) ? "win64" : "win32" : "linux";
  const folder = platform === "mac_arm" ? "mac-arm64" : platform === "mac" ? "mac-x64" : platform === "linux" ? "linux64" : platform;
  const binary = join(home, ".cache", "hyperframes", "chrome", "chrome-headless-shell", `${platform}-${version[1]}`, `chrome-headless-shell-${folder}`, os === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
  return { kind: "managed", binary, version: version[1] };
}
export async function browserStatus(signal?: AbortSignal): Promise<{ kind: BrowserSelection["kind"]; present: boolean; message: string; binary?: string }> {
  signal?.throwIfAborted();
  const source = await readFile(join(dirname(hyperframesCli), "..", "dist", "cli.js"), "utf8");
  const selection = browserSelection(source);
  if (selection.kind === "system") {
    let binary: string | undefined;
    for (const path of selection.paths) {
      try { await access(path); binary = path; break; }
      catch { signal?.throwIfAborted(); }
    }
    if (binary === undefined) for (const command of selection.commands) {
      try {
        binary = (await run("which", [command], { signal, timeout: 5000 })).split(/\r?\n/).map((value) => value.trim()).find((value) => value.length > 0);
        if (binary !== undefined) break;
      } catch { signal?.throwIfAborted(); }
    }
    let present = false;
    if (binary !== undefined) {
      try { present = (await run(binary, ["--version"], { signal, timeout: 10_000 })).trim().length > 0; }
      catch { signal?.throwIfAborted(); }
    }
    return { kind: "system", present, ...(present ? { binary } : {}), message: present ? "Chromium is ready." : "Modisign requires Chromium on Linux ARM64. Install it with: sudo apt install chromium" };
  }
  let present = false;
  try { await access(selection.binary); present = (await run(selection.binary, ["--version"], { signal, timeout: 10_000 })).includes(selection.version); }
  catch { signal?.throwIfAborted(); }
  return { kind: "managed", present, ...(present ? { binary: selection.binary } : {}), message: present ? "The private render browser is ready." : "Modisign will download a private render browser on first render (about 100 MB)." };
}
