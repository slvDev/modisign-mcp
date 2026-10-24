// generated from the Modisign monorepo, do not edit
import { toSvg } from "html-to-image";
import { DiagnosticError } from "../../../server/src/diagnostics";
import { compositionNotReady, READY_TIMEOUT_MS } from "@/lib/composition-ready";

const FPS = 30;

// html-to-image copies an inline SVG without the styles its children get from the stylesheet.
const SVG_STYLES = [
  "display",
  "visibility",
  "opacity",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
];

type CompositionWindow = Window & {
  __player?: {
    renderSeek: (time: number) => void | Promise<void>;
    pause: () => void;
    getTime: () => number;
  };
  __timelines?: Record<string, { pause: () => void; time: () => number }>;
};

function composition(frame: HTMLIFrameElement) {
  const view = frame.contentWindow as CompositionWindow | null;
  const doc = frame.contentDocument;
  if (view === null || doc === null) throw new DiagnosticError("Composition frame is unavailable", "frame_load");
  return { view, doc };
}

// Resolves with the paused player once the runtime, fonts and images have loaded and seeking drives the timeline.
export async function readyComposition(frame: HTMLIFrameElement, signal: AbortSignal) {
  const deadline = performance.now() + READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const { view, doc } = composition(frame);
    if (view.__player !== undefined && view.__timelines?.main !== undefined) {
      await doc.fonts.ready;
      await Promise.all(
        [...doc.images].filter((image) => image.getAttribute("src") !== null).map((image) => image.decode()),
      );
      view.__player.pause();
      view.__timelines.main.pause();
      // The runtime adopts a timeline a moment after it is registered; until then a seek moves nothing.
      await view.__player.renderSeek(1 / FPS);
      if (Math.abs(view.__timelines.main.time() - 1 / FPS) < 1e-3) {
        const root = doc.getElementById("root");
        if (root === null) throw new DiagnosticError("Composition has no root", "frame_load");
        return { player: view.__player, root, doc };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw compositionNotReady();
}

async function dataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new DiagnosticError(`Font request returned ${response.status}`, "font_load");
  const reader = new FileReader();
  const loaded = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
  });
  // A fixed type: fonts are sometimes served as text/html, which Chrome rejects inside an SVG image.
  reader.readAsDataURL(new Blob([await response.arrayBuffer()], { type: "application/octet-stream" }));
  return loaded;
}

// html-to-image's own embedding loses faces that share one file, as the weights of a variable font do.
async function embedFonts(doc: Document) {
  const linked = await Promise.all(
    [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(async (link) => {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error(`Font stylesheet returned ${response.status}`);
      return { css: await response.text(), base: link.href };
    }),
  );
  const sheets = [...linked, ...[...doc.querySelectorAll("style")].map((style) => ({ css: style.innerHTML, base: doc.baseURI }))];
  const fonts = new Map<string, Promise<string>>();
  function fontData(url: string) {
    const known = fonts.get(url);
    if (known !== undefined) return known;
    const loading = dataUrl(url);
    fonts.set(url, loading);
    return loading;
  }
  const embedded: string[] = [];
  for (const sheet of sheets) {
    const faces = sheet.css.match(/@font-face\s*\{[^}]*\}/g);
    if (faces === null) continue;
    let css = faces.join("\n");
    const urls = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)];
    for (const match of urls) {
      if (match[2].startsWith("data:")) continue;
      css = css.replaceAll(match[0], `url("${await fontData(new URL(match[2], sheet.base).href)}")`);
    }
    embedded.push(css);
  }
  return embedded.join("\n");
}

export async function compositionCapture(frame: HTMLIFrameElement, width: number, height: number, signal: AbortSignal) {
  const { player, root, doc } = await readyComposition(frame, signal);
  // Layout pixels: at browser zoom getBoundingClientRect is off by fractions of a pixel.
  if (root.offsetWidth !== width || root.offsetHeight !== height) {
    throw new DiagnosticError(`Composition is ${root.offsetWidth}×${root.offsetHeight}, not the ${width}×${height} export size`, "composition_dimensions");
  }
  const fontEmbedCSS = await embedFonts(doc);
  return async (time: number) => {
    signal.throwIfAborted();
    await player.renderSeek(time);
    const svg = await toSvg(root, { width, height, fontEmbedCSS });
    const clone = new DOMParser().parseFromString(
      decodeURIComponent(svg.slice(svg.indexOf(",") + 1)),
      "image/svg+xml",
    );
    for (const native of [root, ...root.querySelectorAll<HTMLElement>("[id]")]) {
      const copy = clone.getElementById(native.id) as HTMLElement | null;
      if (copy === null) throw new DiagnosticError(`Capture lost element ${native.id}`, "draw_failed");
      const style = window.getComputedStyle(native);
      // The library rounds font sizes and freezes inline widths, which can introduce new word breaks.
      copy.style.fontSize = style.fontSize;
      if (
        style.display === "inline-block" &&
        native.children.length === 0 &&
        native.clientHeight <= parseFloat(style.lineHeight) + 1
      ) {
        copy.style.whiteSpace = "nowrap";
      }
    }
    const drawings = clone.querySelectorAll<SVGElement>("foreignObject svg *");
    const natives = root.querySelectorAll("svg *");
    if (drawings.length !== natives.length) throw new DiagnosticError("Capture lost SVG elements", "draw_failed");
    drawings.forEach((copy, at) => {
      const style = window.getComputedStyle(natives[at]);
      for (const name of SVG_STYLES) copy.style.setProperty(name, style.getPropertyValue(name));
    });
    const captured = new Image();
    captured.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    // Image.decode is sufficient; html-to-image's canvas helper waits for a potentially throttled animation frame.
    await captured.decode();
    signal.throwIfAborted();
    return captured;
  };
}
