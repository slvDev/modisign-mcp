// generated from the Modisign monorepo, do not edit
import { projectSpatial, projectTrack, DEFAULT_CLIP_SETTINGS, projectClipDuration, MOTION_CHANNELS, type LayerMotion, type StudioProject } from "../../../server/src/studio-project";
export { MAX_STUDIO_PROJECT_BYTES, defaultSpatial, projectSpatial, projectTrack, projectSchedule, isCrop, isPlace, PLACE_MODES, type Crop, type Place, type ClipSpatial, type TrackPlacement, type VideoTrack, clipSchedule, sequenceStarts, sequenceDuration, scheduleDuration, validTrackSchedule, TIMELINE_BOUNDARY_TOLERANCE, isTemplateHref, MAX_PUNCH_INS, isPunchIns, type PunchIn, CAPTION_STYLE_IDS, isCaptionSettings, type CaptionStyleId, type CaptionPlacement, type CaptionSettings, clampTransition, projectDuration, type ClipTransition, DEFAULT_CLIP_SETTINGS, isClipSettings, isPhotoDuration, MIN_PHOTO_DURATION, MAX_PHOTO_DURATION, type PhotoSettings, type ClipSettings, projectClipDuration, STUDIO_ASPECTS, MAX_STUDIO_DURATION, MAX_STUDIO_CLIPS, MIN_CLIP_DURATION, MIN_CLIP_LABEL, STUDIO_TIME_TOLERANCE, isValidTrim, isStudioProject, type ProjectClip, type StudioProject, type StudioProjectSummary, MAX_STUDIO_TEXTS, MAX_TEXT_LENGTH, TEXT_SIZES, TEXT_TIMESTAMPS, DEFAULT_TEXT_STYLE, isTextLabel, isTextStyle, isTextDuration, type TextLabel, type TextStyle, type ProjectText } from "../../../server/src/studio-project";
export { GROUPING_LIMITS, DEFAULT_GROUPING, SCATTER_GROUPING, SCATTER_SAFE_ZONES, SCATTER_INTENSITIES, LINE_SIZE, LINE_ROTATION, isCaptionGrouping, isCaptionScatter, isCaptionStyleId, isCaptionLineOverride, lineOverrideProblem, type CaptionGrouping, type CaptionScatter, type CaptionLineOverride } from "../../../server/src/studio-project";
export { MOTION_CHANNELS, MOTION_EASINGS, MOTION_RANGES, MOTION_IDENTITY, MOTION_TIME, PHOTO_MOTION_TIME, MAX_MOTION_CHANNEL_KEYS, MAX_MOTION_KEYS, isMotionEasing, isLayerMotion, motionProblem, motionKeyCount, motionIsIdentity, type MotionChannel, type MotionEasing, type MotionKey, type LayerMotion, type ProjectOverlay } from "../../../server/src/studio-project";
export { PEOPLE_MODEL, OCCLUSION_RANGES, DEFAULT_OCCLUSION, occlusionProblem, type TitleOcclusion } from "../../../server/src/studio-project";
export { REVEAL_DIRECTIONS, REVEAL_DURATION, REVEAL_MIN_SIDE, DEFAULT_TITLE_REVEAL, revealIsFull, revealProblem, isTitleReveal, type RevealRect, type TitleReveal } from "../../../server/src/studio-project";
export { SFX_PACK, SFX_RATE, SFX_CATEGORIES, SFX_ASSETS, MAX_STUDIO_SFX, SFX_OFFSET, SFX_GAIN, SFX_FADE_MAX, SFX_CUE_ID, sfxAsset, sfxDuration, isSfxOffset, sfxSettingsProblem, type SfxAsset, type SfxCategory, type SfxSettings, type ProjectSfx, type ProjectSfxAnchor } from "../../../server/src/studio-project";

// Fixed channel order, validated key order and numeric easing tuples: independent of JSONB object-key order.
function motionSignature(motion: LayerMotion | undefined) {
  return motion === undefined ? null : MOTION_CHANNELS.map((channel) => (motion[channel] ?? []).map(({ at, value, easing }) => [at, value, easing]));
}

export function projectSignature(project: StudioProject) {
  return JSON.stringify([project.name, project.aspect,
    [...project.clips.filter((clip) => clip.track === undefined), ...project.clips.filter((clip) => clip.track === "v2").sort((a, b) => {
      if (a.track !== "v2" || b.track !== "v2") throw new Error("Expected V2 project clips");
      return a.start - b.start;
    })].map((clip) => {
      const settings = clip.kind === "photo" ? { ...DEFAULT_CLIP_SETTINGS, ...clip.settings } : clip.settings;
      const { crop, place } = projectSpatial(clip);
      const track = projectTrack(clip);
      return [track.track, track.track === "v2" ? track.start : null, [crop.top, crop.right, crop.bottom, crop.left], place.mode === "custom" ? [place.mode, place.x, place.y, place.width, place.height] : [place.mode], clip.label, clip.kind, clip.duration, projectClipDuration(clip), clip.kind === "photo" ? 0 : clip.inPoint, settings.frameMode, settings.centerX, settings.centerY,
        settings.zoom, clip.punchIns === undefined ? [] : [...clip.punchIns].sort((a, b) => a.start - b.start).map(({ start, length, zoom }) => [start, length, zoom]), clip.kind === "photo" ? clip.sourceStart === undefined ? 0 : clip.sourceStart : null, clip.kind === "photo" ? clip.settings.slowZoom : [settings.volume, settings.muted, settings.fadeIn, settings.fadeOut], motionSignature(clip.motion), clip.captionEnabled === false];
    }),
    project.transitions === undefined ? [] : [...project.transitions].sort((a, b) => a.cut - b.cut).map(({ cut, type, duration }) => [cut, type, duration]),
    project.overlays.map((overlay) => [overlay.family, overlay.preset, overlay.start, overlay.configuration, motionSignature(overlay.motion)]),
    project.captions === undefined ? null : [project.captions.style, project.captions.position, project.captions.size, project.captions.mix === undefined ? null : [project.captions.mix.preset, project.captions.mix.seed, project.captions.mix.palette],
      project.captions.grouping === undefined ? null : [project.captions.grouping.maxWords, project.captions.grouping.maxCharacters, project.captions.grouping.maxDuration, project.captions.grouping.pause],
      project.captions.scatter === undefined ? null : [project.captions.scatter.seed, project.captions.scatter.safeZone, project.captions.scatter.intensity, project.captions.scatter.styles]],
    project.texts === undefined ? [] : project.texts.map((title) => [title.text, title.timestamp === undefined ? null : title.timestamp, title.font, title.weight, title.italic, title.fill, title.size, title.x, title.y, title.backing, title.clip === undefined ? null : title.clip, title.start === undefined ? null : title.start, title.duration === undefined ? null : title.duration, motionSignature(title.motion), title.reveal === undefined ? null : [title.reveal.rect.x, title.reveal.rect.y, title.reveal.rect.width, title.reveal.rect.height, title.reveal.direction, title.reveal.start, title.reveal.duration, title.reveal.easing], title.occlusion === undefined ? null : [title.occlusion.clip, title.occlusion.model, title.occlusion.threshold, title.occlusion.feather, title.occlusion.smoothing], title.animationOffset === undefined ? 0 : title.animationOffset]),
    project.sfx === undefined ? [] : project.sfx.map((sound) => [sound.asset, sound.inPoint, sound.outPoint, sound.gain, sound.muted, sound.fadeIn, sound.fadeOut, sound.auto === undefined ? null : sound.auto, sound.start === undefined ? null : sound.start,
      sound.anchor === undefined ? null : sound.anchor.kind === "title-enter" ? [sound.anchor.kind, sound.anchor.text] : sound.anchor.kind === "transition" ? [sound.anchor.kind, sound.anchor.from, sound.anchor.to] : [sound.anchor.kind, sound.anchor.overlay, sound.anchor.cue], sound.offset === undefined ? 0 : sound.offset])]);
}
