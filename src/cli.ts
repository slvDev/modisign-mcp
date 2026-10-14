#!/usr/bin/env node
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { api } from "./api.js";
import { accountStatus, login, logout, stopLogin } from "./auth.js";
import { errorResult } from "./errors.js";
import { Jobs } from "./jobs.js";
import { configure } from "./overlays.js";
import { browserStatus, ffmpegVersion, run } from "./processes.js";
import { startServer } from "./server.js";
import { baseUrl } from "./settings.js";

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ is required.");
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) { startServer(); return; }
  if (command === "login" && args.length === 0) {
    const flow = await login();
    console.error(`Sign in: ${flow.response.verification_url}\nCode: ${flow.response.user_code}`);
    try {
      if (process.platform === "darwin") await run("open", [flow.response.verification_url], { timeout: 10_000 });
      else if (process.platform === "win32") await run("rundll32.exe", ["url.dll,FileProtocolHandler", flow.response.verification_url], { timeout: 10_000 });
      else await run("xdg-open", [flow.response.verification_url], { timeout: 10_000 });
    } catch { console.error("Open the sign-in URL above in your browser."); }
    process.once("SIGINT", stopLogin); process.once("SIGTERM", stopLogin);
    try {
      const result = await flow.completion;
      console.error(result.message);
      if (!result.signed_in) process.exitCode = 1;
    } finally { process.removeListener("SIGINT", stopLogin); process.removeListener("SIGTERM", stopLogin); }
    return;
  }
  if (command === "logout" && args.length === 0) { await logout(); console.error("Local credentials deleted. Revoke the connection on https://modisign.app/account to invalidate its token."); return; }
  if (command === "status" && args.length === 0) { console.log(JSON.stringify(await accountStatus(), null, 2)); return; }
  if (command === "doctor" && args.length === 0) {
    const check = async (work: () => Promise<unknown>) => { try { return await work(); } catch (error) { return errorResult(error); } };
    const [ffmpeg, browser, reachable, account] = await Promise.all([check(ffmpegVersion), check(async () => { const status = await browserStatus(); return { ...status, ...(status.kind === "managed" && status.binary !== undefined ? { binary: "a private render browser" } : {}) }; }), check(async () => { await api("/api/mcp/catalog"); return true; }), check(accountStatus)]);
    console.log(JSON.stringify({ node: process.version, node_ok: Number(process.versions.node.split(".")[0]) >= 22, ffmpeg, browser, base_url: baseUrl, reachable, account }, null, 2)); return;
  }
  if (command === "render") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { aspect: { type: "string" }, background: { type: "string" }, out: { type: "string" } } });
    if (positionals.length !== 1 || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(positionals[0])) throw new Error("Usage: modisign-mcp render <family>/<preset> [--aspect 16x9] [--background green|transparent] [--out file.mp4|file.mov|file.webm]");
    const [family, preset] = positionals[0].split("/");
    if (values.background === "transparent" && values.out?.endsWith(".mp4")) throw new Error("MP4 cannot carry transparency. Choose --out overlay.mov or overlay.webm.");
    const config = await configure({ family, preset, ...(values.aspect === undefined ? {} : { aspect: values.aspect }), ...(values.background === undefined ? {} : { background: values.background }) });
    const format = values.out?.endsWith(".mov") ? "mov" : values.out?.endsWith(".webm") ? "webm" : values.background === "transparent" && values.out === undefined ? "mov" : "mp4";
    const jobs = new Jobs();
    const job = await jobs.start({ configuration: config.configuration, format, output_path: values.out });
    const stop = () => jobs.cancel(job.job_id);
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      while (true) {
        const current = jobs.status(job.job_id);
        if (current.state === "done") { console.log(JSON.stringify(current, null, 2)); return; }
        if (current.state === "failed" || current.state === "canceled") { console.error(JSON.stringify(current)); process.exitCode = 1; return; }
        await setTimeout(500);
      }
    } finally { await jobs.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
  throw new Error("Usage: modisign-mcp [login|logout|status|doctor|render <family>/<preset>]");
}
main().catch((error: unknown) => {
  const safe = errorResult(error);
  console.error(error instanceof Error && !("details" in error) ? error.message : safe.error);
  process.exitCode = 1;
});
