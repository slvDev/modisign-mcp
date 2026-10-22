// generated from the Modisign monorepo, do not edit
import { sampleChannel } from "@/lib/studio-motion";
import { revealIsFull, type MotionKey, type TitleReveal } from "@/lib/studio-project";
import type { TextRect } from "@/lib/text-layout";

const progressKeys = new WeakMap<TitleReveal, MotionKey[]>();

// 0 before the reveal starts, 1 from its end on, through its own easing; `local` is title-local seconds including the animation offset.
export function revealProgress(reveal: TitleReveal, local: number) {
  let keys = progressKeys.get(reveal);
  if (keys === undefined) {
    keys = [{ at: reveal.start, value: 0, easing: reveal.easing }, { at: reveal.start + reveal.duration, value: 1, easing: "linear" }];
    progressKeys.set(reveal, keys);
  }
  return sampleChannel(keys, local, 0);
}

// The part of the title's padded box the reveal shows at `progress`: null when nothing is visible, a rectangle to clip to otherwise.
export function revealWindow(reveal: TitleReveal, box: TextRect, progress: number): TextRect | null {
  if (progress <= 0) return null;
  const x = box.x + reveal.rect.x * box.width;
  const y = box.y + reveal.rect.y * box.height;
  const width = reveal.rect.width * box.width;
  const height = reveal.rect.height * box.height;
  switch (reveal.direction) {
    case "right": return { x, y, width: width * progress, height };
    case "left": return { x: x + width * (1 - progress), y, width: width * progress, height };
    case "down": return { x, y, width, height: height * progress };
    case "up": return { x, y: y + height * (1 - progress), width, height: height * progress };
  }
}

// A fully shown reveal over the whole box draws the title exactly as a plain one.
export const revealIsOpen = (reveal: TitleReveal, progress: number) => progress >= 1 && revealIsFull(reveal.rect);
