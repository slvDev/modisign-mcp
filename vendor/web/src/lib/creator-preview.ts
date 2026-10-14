// generated from the Modisign monorepo, do not edit
import type { FamilyId } from "@/lib/family-ids";
import type { Aspect } from "@/lib/aspects";
import { previewHref, type TemplateOptions } from "@/lib/hrefs";

const BACKDROPS = [
  "living-room", "bedroom", "kitchen", "home-office", "gym", "city-street", "cafe",
  "car", "podcast-studio", "workshop", "park", "gaming-room", "library",
] as const;
export type Backdrop = (typeof BACKDROPS)[number];
export const DEFAULT_BACKDROP: Backdrop = "living-room";

export function isBackdrop(value: string): value is Backdrop {
  return BACKDROPS.some((backdrop) => backdrop === value);
}

export function creatorPhotoHref(backdrop: Backdrop, aspect: Aspect) {
  return `/showcase/creators/${backdrop}-${aspect === "16x9" ? "horizontal" : "vertical"}.jpg`;
}

export function creatorPreview(family: FamilyId, options: TemplateOptions, backdrop: Backdrop) {
  const background = options.edits.find(([key]) => key === "background");
  return { src: `${previewHref(family, options)}&backdrop=${backdrop}`, footage: background === undefined ? "green" : background[1] };
}
