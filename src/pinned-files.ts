import { constants } from "node:fs";
import { lstat, open, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError } from "./errors.js";
import { Readable } from "node:stream";

export async function pinFile(path: string, directory?: string) {
  const absolute = resolve(path);
  const expected = await lstat(absolute);
  if (!expected.isFile()) throw new ToolError("Media path must be a regular file without symlinks.");
  const canonical = await realpath(absolute);
  if (directory !== undefined) {
    const within = relative(directory, canonical);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new ToolError("Cached file resolves outside the render directory.");
  }
  if (canonical !== join(await realpath(dirname(absolute)), basename(absolute))) throw new ToolError("Media path must not resolve through a symlink to another file.");
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    const named = await stat(absolute);
    if (!info.isFile() || info.dev !== expected.dev || info.ino !== expected.ino || info.dev !== named.dev || info.ino !== named.ino || await realpath(absolute) !== canonical) {
      throw new ToolError("Media path changed during validation or is not a regular file.");
    }
    return { handle, size: info.size };
  } catch (error) { await handle.close(); throw error; }
}

export type PinnedFile = { handle: FileHandle; size: number };

export function pinnedStream(file: PinnedFile) {
  return Readable.from((async function* () {
    for (let position = 0; position < file.size;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, file.size - position));
      const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) throw new Error("A local file changed during rendering. Retry with the original file.");
      position += bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  })());
}
