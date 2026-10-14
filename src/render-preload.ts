import { createRequire, register } from "node:module";
import { pathToFileURL } from "node:url";
import { hyperframesCli } from "./processes.js";
import { isolatedBrowserArguments } from "./render-isolation.js";
import { prepareStandaloneRender } from "./standalone-render.js";
import { RENDERER_VERSION } from "./settings.js";

type Page = { setUserAgent(userAgent: string): Promise<void>; goto(url: string, ...args: unknown[]): Promise<unknown> };
type Browser = { newPage(...args: unknown[]): Promise<Page> };
type Launcher = { launch(options: { args?: string[]; [key: string]: unknown }): Promise<Browser> };

const renderIndex = process.argv.indexOf("render");
if (renderIndex === -1 || process.argv[renderIndex + 1] === undefined) throw new Error("Isolation requires a cached render directory.");
const require = createRequire(hyperframesCli);
if (require("hyperframes/package.json").version !== RENDERER_VERSION) throw new Error("The renderer is incompatible with this package. Reinstall @modisign/mcp and retry.");
const render = await prepareStandaloneRender(process.argv[renderIndex + 1], process.cwd());
render.restrictListeners();
process.argv[renderIndex + 1] = render.directory;
let proxy: Awaited<ReturnType<typeof render.serve>> | undefined;
const host = globalThis as typeof globalThis & { __modisignStandaloneServer: (options: { projectDir: string; compiledDir: string }, transform: (html: string) => string) => Promise<NonNullable<typeof proxy>> };
host.__modisignStandaloneServer = async (options, transform) => {
  proxy = await render.serve(options.projectDir, options.compiledDir, transform);
  return proxy;
};
register(new URL("./render-loader.js", import.meta.url));
// HyperFrames' pinned CLI imports this same dependency for every browser launch.
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href) as { default: Launcher };
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (options) => {
  if (proxy === undefined) throw new Error("The renderer must be ready before the private render browser starts.");
  const server = proxy;
  const browser = await launch({ ...options, pipe: true, args: [...(options.args === undefined ? [] : options.args), ...isolatedBrowserArguments(server.proxyUrl)] });
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.setUserAgent(server.userAgent);
    const goto = page.goto.bind(page);
    page.goto = async (url, ...args) => { server.allowNavigation(url); return goto(url, ...args); };
    return page;
  };
  return browser;
};
process.once("exit", () => { if (proxy !== undefined) proxy.close(); void render.close(); });
