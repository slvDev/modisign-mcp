import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SPEECH_FILES, SPEECH_MODEL, SPEECH_REVISION } from "../vendor/web/src/lib/captions.js";
import { speechCacheDir } from "./settings.js";
import { isMissing, ToolError } from "./errors.js";

// onDownload reports each missing file (index of total) before it is fetched.
export async function speechModel(signal: AbortSignal, onDownload: (index: number, total: number) => void) {
  const directory = join(speechCacheDir, SPEECH_REVISION);
  const routes = new Map<string, string>();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [index, file] of SPEECH_FILES.entries()) {
    signal.throwIfAborted();
    const target = join(directory, file.replaceAll("/", "-"));
    routes.set(`/models/${SPEECH_MODEL}/resolve/${SPEECH_REVISION}/${file}`, target);
    try { await readFile(target); continue; } catch (error) { if (!isMissing(error)) throw error; }
    onDownload(index, SPEECH_FILES.length);
    let url = new URL(`https://huggingface.co/${SPEECH_MODEL}/resolve/${SPEECH_REVISION}/${file}`);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (url.protocol !== "https:" || !(url.hostname === "huggingface.co" || url.hostname.endsWith(".huggingface.co") || url.hostname.endsWith(".hf.co")) || url.username !== "" || url.password !== "") throw new ToolError("Blocked speech model download origin.");
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (location === null) throw new ToolError("Speech model redirect has no destination.");
      url = new URL(location, url);
    }
    if (response === undefined || !response.ok) throw new ToolError("Speech model download failed. Connect once to download the English speech model, then retry.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 64 * 1024 * 1024) throw new ToolError("Invalid speech model file size.");
    const temporary = `${target}.${randomUUID()}`;
    try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  }
  return routes;
}
