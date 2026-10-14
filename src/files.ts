import { link, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { outputDir } from "./settings.js";
import { isMissing, ToolError } from "./errors.js";

export function numberedOutput(path: string, number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Output number must be positive.");
  const extension = extname(path);
  return number === 1 ? path : join(dirname(path), `${basename(path, extension)}-${number}${extension}`);
}
export function destination(family: string, format: string, directory = outputDir, explicit?: string) {
  if (explicit !== undefined) {
    if (extname(explicit).toLowerCase() !== `.${format}`) throw new ToolError(`Output path must end in .${format}.`);
    return resolve(explicit);
  }
  return resolve(directory, `${family}.${format}`);
}
export async function publishFile(temporary: string, desired: string) {
  await mkdir(dirname(desired), { recursive: true });
  for (let n = 1; n <= 10_000; n++) {
    const target = numberedOutput(desired, n);
    try { await link(temporary, target); await rm(temporary); return target; }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "EEXIST") continue; throw error; }
  }
  throw new ToolError("Too many output name collisions. Choose a different output directory.");
}
export async function inputFile(path: string) {
  const absolute = resolve(path);
  try { if (!(await stat(absolute)).isFile()) throw new ToolError("Media path must point to a regular file."); }
  catch (error) { if (isMissing(error)) throw new ToolError("Media path does not exist."); throw error; }
  return absolute;
}
