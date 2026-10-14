// generated from the Modisign monorepo, do not edit
import { DEFAULT_CLIP_SETTINGS, projectClipDuration, type StudioProject } from "../../../server/src/studio-project";
export { isTemplateHref, MAX_PUNCH_INS, isPunchIns, type PunchIn, CAPTION_STYLE_IDS, isCaptionSettings, type CaptionStyleId, type CaptionPlacement, type CaptionSettings, clampTransition, projectDuration, type ClipTransition, DEFAULT_CLIP_SETTINGS, isClipSettings, isPhotoDuration, MIN_PHOTO_DURATION, MAX_PHOTO_DURATION, type PhotoSettings, type ClipSettings, projectClipDuration, STUDIO_ASPECTS, MAX_STUDIO_DURATION, MAX_STUDIO_CLIPS, MIN_CLIP_DURATION, STUDIO_TIME_TOLERANCE, isValidTrim, isStudioProject, type StudioProject, type StudioProjectSummary } from "../../../server/src/studio-project";

export function projectSignature(project: StudioProject) {
  return JSON.stringify([project.name, project.aspect,
    project.clips.map((clip) => {
      const settings = clip.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, ...clip.settings } : clip.settings;
      return [clip.label, clip.kind, clip.duration, projectClipDuration(clip), clip.kind === "photo" ? 0 : clip.inPoint, settings.frameMode, settings.centerX, settings.centerY,
        settings.zoom, clip.punchIns === undefined ? [] : [...clip.punchIns].sort((a, b) => a.start - b.start).map(({ start, length, zoom }) => [start, length, zoom]), clip.kind === "photo" ? clip.sourceStart === undefined ? 0 : clip.sourceStart : null, clip.kind === "photo" ? clip.settings.slowZoom : [settings.volume, settings.muted, settings.fadeIn, settings.fadeOut]];
    }),
    project.transitions === undefined ? [] : [...project.transitions].sort((a, b) => a.cut - b.cut).map(({ cut, type, duration }) => [cut, type, duration]),
    project.overlays.map((overlay) => [overlay.family, overlay.preset, overlay.start, overlay.configuration]),
    project.captions === undefined ? null : [project.captions.style, project.captions.position, project.captions.size]]);
}
