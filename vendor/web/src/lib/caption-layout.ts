// generated from the Modisign monorepo, do not edit
import { captionDisplayText, captionStyle, type CaptionLine, type CaptionPlacement, type CaptionStyleId } from "./captions";

export type CaptionRect = { x: number; y: number; width: number; height: number };
export type CaptionLayoutWord = CaptionRect & { index: number; row: number; text: string; active: boolean; italic: boolean; scale: number };
export type CaptionMeasure = (text: string, size: number, italic: boolean) => number;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
export function captionCharacterCount(text: string, start: number, end: number, time: number) {
  if (time < start) return 0;
  const length = Array.from(text).length;
  return Math.min(length, 1 + Math.floor(length * clamp((time - start) / (end - start))));
}
export function captionPopScale(elapsed: number) {
  const progress = clamp(elapsed / 0.12);
  if (progress < 0.7) return 0.6 + 0.48 * (1 - (1 - progress / 0.7) ** 3);
  return 1.08 - 0.08 * ((progress - 0.7) / 0.3);
}
export function captionLayout(line: CaptionLine, styleId: CaptionStyleId, time: number, width: number, height: number, placement: CaptionPlacement, measure: CaptionMeasure) {
  const style = captionStyle(styleId);
  const texts = line.words.map(({ text }) => captionDisplayText(text, style.casing));
  const maxScale = Math.max(style.activeScale, style.motion === "pop" ? 1.08 : 1);
  let size = width * ({ s: 0.037, m: 0.048, l: 0.063 }[placement.size]) * (style.motion === "word" ? 1.6 : 1);
  let rows: number[][] = [];
  let widths: number[] = [];
  let space = 0;
  function wrap() {
    widths = texts.map((text) => Math.max(measure(text, size, false), style.activeItalic ? measure(text, size, true) : 0) * maxScale);
    space = measure(" ", size, false);
    rows = [[]];
    let used = 0;
    for (let i = 0; i < texts.length; i++) {
      const row = rows[rows.length - 1];
      const next = used + (row.length === 0 ? 0 : space) + widths[i];
      if (row.length > 0 && next > width * 0.86) { rows.push([i]); used = widths[i]; }
      else { row.push(i); used = next; }
    }
  }
  wrap();
  while (rows.length > 2 || widths.some((value) => value > width * 0.86)) { size *= 0.9; wrap(); }
  const anchor = height * ({ upper: 0.18, center: 0.5, lower: 0.7 }[placement.position]);
  const lineHeight = size * 1.35;
  const words: CaptionLayoutWord[] = [];
  rows.forEach((row, rowIndex) => {
    let x = (width - row.reduce((sum, i) => sum + widths[i], 0) - space * (row.length - 1)) / 2;
    const y = anchor + (rowIndex - (rows.length - 1) / 2) * lineHeight;
    for (const i of row) {
      const word = line.words[i];
      const active = time >= word.start && time < word.end;
      let text = texts[i];
      if (style.reveal === "accumulate" && time < word.start) text = "";
      if (style.reveal === "characters") text = Array.from(text).slice(0, captionCharacterCount(text, word.start, word.end, time)).join("");
      const scale = style.motion === "pop" ? captionPopScale(time - word.start) : style.motion === "word" ? 0.8 + 0.2 * (1 - (1 - clamp((time - line.start) / 0.08)) ** 3) : active ? style.activeScale : 1;
      words.push({ index: i, row: rowIndex, x, y: y - size / 2, width: widths[i], height: size, text, active, italic: active && style.activeItalic, scale });
      x += widths[i] + space;
    }
  });
  const lastSpoken = words.filter(({ index }) => time >= line.words[index].start).at(-1);
  let highlight: CaptionRect | null = null;
  if (style.background === "word" && lastSpoken !== undefined) {
    const previous = words[lastSpoken.index - 1];
    const progress = clamp((time - line.words[lastSpoken.index].start) / 0.09);
    const ease = 1 - (1 - progress) ** 3;
    const from = previous === undefined ? lastSpoken : previous;
    highlight = Object.fromEntries((["x", "y", "width", "height"] as const).map((key) => [key, from[key] + (lastSpoken[key] - from[key]) * ease])) as CaptionRect;
  }
  const lastVisible = words.filter(({ text }) => text !== "").at(-1);
  const caret = style.reveal === "characters" && lastVisible !== undefined && Math.floor((time - line.start) * 2) % 2 === 0 ? {
    x: lastVisible.x + measure(lastVisible.text, size, false) + size * 0.1,
    y: lastVisible.y, width: size * 0.035, height: size,
  } : null;
  return { size, lineHeight, anchor, rows, words, highlight, caret };
}
