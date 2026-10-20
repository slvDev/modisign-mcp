// generated from the Modisign monorepo, do not edit
import { TEXT_SIZES } from "./studio-project";
import type { CaptionMeasure } from "./caption-layout";
import type { TimelineText } from "./video-timeline";

const WRAP = 0.86;
const LEADING = 1.25;
const HEIGHT_FIT = 0.9;
export type TextRect = { x: number; y: number; width: number; height: number };

// Wraps each paragraph at 86% of the output width, shrinks until no word is wider and the block fits 90% of the height, centres it on (x, y) and keeps its padded box inside the frame.
export function textLayout(title: TimelineText, width: number, height: number, measure: CaptionMeasure) {
  const face = { font: title.font, weight: title.weight, italic: title.italic };
  let size = Math.min(width, height) * TEXT_SIZES[title.size];
  let rows: string[] = [];
  function wrap() {
    const space = measure(" ", size, face);
    rows = title.paragraphs.flatMap((paragraph) => {
      const words = paragraph.split(" ");
      const lines: string[] = [];
      let used = 0;
      for (const word of words) {
        const wordWidth = measure(word, size, face);
        const next = lines.length === 0 ? wordWidth : used + space + wordWidth;
        if (lines.length > 0 && next <= width * WRAP) { lines[lines.length - 1] += ` ${word}`; used = next; }
        else { lines.push(word); used = wordWidth; }
      }
      return lines;
    });
  }
  wrap();
  const blockHeight = () => rows.length * size * LEADING + (title.backing ? size * 0.56 : 0);
  while (size > 1 && (rows.some((row) => measure(row, size, face) > width * WRAP) || blockHeight() > height * HEIGHT_FIT)) { size *= 0.9; wrap(); }
  const widths = rows.map((row) => measure(row, size, face));
  const padX = title.backing ? size * 0.45 : 0;
  const padY = title.backing ? size * 0.28 : 0;
  const box: TextRect = { x: 0, y: 0, width: Math.max(...widths) + padX * 2, height: blockHeight() };
  box.x = Math.max(0, Math.min(width - box.width, title.x * width - box.width / 2));
  box.y = Math.max(0, Math.min(height - box.height, title.y * height - box.height / 2));
  return { size, box, padX, padY, rows: rows.map((text, index) => ({ text, x: box.x + box.width / 2, y: box.y + padY + (index + 0.5) * size * LEADING })) };
}
