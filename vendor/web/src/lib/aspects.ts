// generated from the Modisign monorepo, do not edit
// Kept apart from families.ts, which reads the filesystem, so client components can import the canvas sizes.
export const ASPECTS = {
  "9x16": { width: 1080, height: 1920 },
  "4x5": { width: 1080, height: 1350 },
  "1x1": { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const isAspect = (id: string): id is Aspect => Object.hasOwn(ASPECTS, id);

export const ratioLabel = (id: Aspect) => id.replace("x", ":");

export const ASPECT_NAMES: Record<Aspect, string> = {
  "9x16": "Reels",
  "4x5": "Feed",
  "1x1": "Square",
  "16x9": "Landscape",
};
