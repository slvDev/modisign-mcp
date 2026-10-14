// generated from the Modisign monorepo, do not edit
import type { Aspect } from "@/lib/aspects";
import type { FamilyId } from "@/lib/family-ids";

export type TemplateOptions = {
  aspect: Aspect;
  look: string;
  duration?: number;
  edits: [string, string][];
};

function templateQuery({ aspect, look, duration, edits }: TemplateOptions) {
  const params = new URLSearchParams([["aspect", aspect], ["look", look]]);
  if (duration !== undefined) params.set("duration", String(duration));
  for (const [key, value] of edits) params.set(key, value);
  return params.toString();
}

export const previewHref = (family: FamilyId, options: TemplateOptions) =>
  `/preview/${family}?${templateQuery(options)}`;

export const editorHref = (family: FamilyId, options: TemplateOptions) =>
  `/overlays/${family}?${templateQuery(options)}`;

// A page's searchParams as entries, repeated keys included.
export const searchEntries = (params: Record<string, string | string[] | undefined>) =>
  Object.entries(params).flatMap(([key, value]) => [value ?? []].flat().map((item): [string, string] => [key, item]));
