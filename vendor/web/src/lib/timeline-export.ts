// generated from the Modisign monorepo, do not edit
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";
import { DiagnosticError } from "../../../server/src/diagnostics";
import { inStage } from "@/lib/export-stage";
import { drawCaptions, loadCaptionFonts } from "@/lib/caption-render";
import { drawTexts, loadTextFonts } from "@/lib/text-render";
import { compositionCapture } from "@/lib/composition-capture";
import { personTitlesOf } from "@/lib/person-layer";
import type { PersonExportMasks } from "@/lib/person-masks";
import { layerPose } from "@/lib/studio-motion";
import { silencePreview } from "@/lib/preview-activation";
import { loadSfxAssets } from "@/lib/sfx-assets";
import { createTimelineAudio, mixTimelineAudio, requireNormalizedAudioEncoding, type TimelineAudioPolicy } from "@/lib/timeline-audio";
import { timelineSources, renderTimelineSequence, renderNativeClip } from "@/lib/timeline-sequence";
import { clipDuration, timelineDuration, TIMELINE_BOUNDARY_TOLERANCE, type VideoTimeline } from "@/lib/video-timeline";

const markMasks = (masks: PersonExportMasks): PersonExportMasks => ({
  alpha: (picture, params) => masks.alpha(picture, params),
  ready: (picture) => masks.ready(picture),
  ensure: (picture, params, signal) => inStage("masks", masks.ensure(picture, params, signal)),
});

// `masks` is required when a title has a person effect: a missing one is a setup failure, never an unmasked file.
export async function exportVideoTimeline(frames: HTMLIFrameElement[], timeline: VideoTimeline, options: {
  signal: AbortSignal; onProgress: (fraction: number) => void; audioPolicy: TimelineAudioPolicy; bitrate?: number; masks?: PersonExportMasks;
}) {
  const failure = new AbortController();
  const signal = AbortSignal.any([options.signal, failure.signal]);
  const { onProgress } = options;
  const { clips, overlays, width, height, frameRate } = timeline;
  const bitrate = options.bitrate === undefined ? 8_000_000 : options.bitrate;
  const duration = timelineDuration(clips);
  if (duration <= 0 || frames.length !== overlays.length) throw new DiagnosticError("The video timeline is incomplete", "validation", "composition");
  if (options.audioPolicy === "preserve" && clips.length !== 1) throw new DiagnosticError("Preserved audio requires a single clip", "validation", "composition");
  if (personTitlesOf(timeline.texts).length > 0) {
    if (options.masks === undefined) throw new DiagnosticError("Titles behind a person need their masks to export", "validation", "masks");
    if (frameRate === undefined) throw new DiagnosticError("Titles behind a person need the Studio frame timing", "validation", "masks");
  }
  const masks = options.masks === undefined ? undefined : markMasks(options.masks);
  const placed = timeline.sfx === undefined ? [] : timeline.sfx;
  if (options.audioPolicy === "preserve" && placed.length > 0) throw new DiagnosticError("Sounds cannot be added while preserving a clip's own audio", "validation", "audio");
  silencePreview();
  if (!(await inStage("video_check", canEncodeVideo("avc", { width, height, bitrate })))) {
    throw new DiagnosticError("This browser cannot export H.264 MP4 here. Update your browser or try a recent Chrome, Edge or Safari on a computer. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later.", "unsupported_video_encoder", "video_check");
  }
  if (options.audioPolicy === "normalize") await inStage("audio_check", requireNormalizedAudioEncoding());
  if (timeline.captions !== undefined) await inStage("fonts", loadCaptionFonts(timeline.captions.lines), "font_load");
  if (timeline.texts !== undefined) await inStage("fonts", loadTextFonts(timeline.texts), "font_load");
  const captures = await inStage("composition", Promise.all(overlays.map((overlay, index) => compositionCapture(frames[index], overlay.width, overlay.height, signal))));
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const rendering = canvas.getContext("2d", { alpha: false });
  if (rendering === null) throw new DiagnosticError("Canvas 2D is unavailable", "draw_failed", "composition");
  const context = rendering;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const video = new CanvasSource(canvas, { codec: "avc", quality: new Quality({ bitrate }), latencyMode: "quality" });
  output.addVideoTrack(video, frameRate === undefined ? {} : { frameRate });
  const sources = timelineSources(timeline);
  async function drawFrame(time: number) {
    for (let index = 0; index < overlays.length; index++) {
      const overlay = overlays[index];
      if (time < overlay.startsAt || time >= overlay.startsAt + overlay.duration - TIMELINE_BOUNDARY_TOLERANCE) continue;
      const local = time - overlay.startsAt;
      const image = await captures[index](local);
      const overlayHeight = overlay.height * width / overlay.width;
      const pose = layerPose(overlay.motion, local, { width, height }, { x: width / 2, y: height / 2 });
      // The motion matrix applies in output space around the capture's base placement, so it wraps the destination rect instead of replacing it.
      context.save();
      context.globalAlpha = pose.opacity;
      if (pose.matrix !== null) context.transform(...pose.matrix);
      context.drawImage(image, 0, (height - overlayHeight) / 2, width, overlayHeight);
      context.restore();
    }
    if (timeline.texts !== undefined) drawTexts(context, timeline.texts, time, width, height);
    if (timeline.captions !== undefined) drawCaptions(context, timeline.captions.lines, time, width, height);
  }
  async function finishFrame(time: number, length: number) {
    signal.throwIfAborted();
    await inStage("composition", drawFrame(time));
    await inStage("encode", video.add(time, length));
    onProgress(Math.min(0.99, (time + length) / duration));
  }
  let audio: Awaited<ReturnType<typeof createTimelineAudio>> | null = null;
  try {
    const media = await inStage("decode", Promise.all(sources.sources));
    signal.throwIfAborted();
    const sounds = await inStage("audio", loadSfxAssets(placed.map((sound) => sound.asset), signal));
    audio = await inStage("audio", createTimelineAudio(media[0].input, options.audioPolicy, duration));
    if (audio.source !== null) output.addAudioTrack(audio.source);
    await inStage("encode", output.start());
    const render = frameRate === undefined ? renderNativeClip(timeline, sources, context, signal, finishFrame)
      : renderTimelineSequence(timeline, sources, context, signal, finishFrame, masks);
    const tasks = [inStage("decode", render), inStage("audio", options.audioPolicy === "normalize"
      ? (() => {
        if (audio === null || audio.samples === undefined) throw new Error("Normalized audio is unavailable");
        return mixTimelineAudio(timeline, sources, audio.samples, signal, sounds);
      })()
      : (() => {
        if (audio.append === undefined) throw new Error("Preserved audio is unavailable");
        return audio.append(media[0].input, media[0].sourceStart, 0, clipDuration(clips[0]), signal);
      })())];
    try { await Promise.all(tasks); }
    catch (error) { failure.abort(); await Promise.allSettled(tasks); throw error; }
    signal.throwIfAborted();
    if (audio.finish !== undefined) await inStage("finalize", audio.finish());
    video.close();
    if (audio.source !== null) audio.source.close();
    await inStage("finalize", output.finalize());
    signal.throwIfAborted();
    if (target.buffer === null) throw new DiagnosticError("Encoder produced no output buffer", "unexpected", "finalize");
    onProgress(1);
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled") await output.cancel();
    throw error;
  } finally {
    if (audio !== null && audio.dispose !== undefined) audio.dispose();
    sources.dispose(); canvas.width = 0; canvas.height = 0;
  }
}
