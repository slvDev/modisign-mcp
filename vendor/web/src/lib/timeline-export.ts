// generated from the Modisign monorepo, do not edit
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";
import { drawCaptions, loadCaptionFonts } from "@/lib/caption-render";
import { drawTexts, loadTextFonts } from "@/lib/text-render";
import { compositionCapture } from "@/lib/composition-capture";
import { createTimelineAudio, mixTimelineAudio, requireNormalizedAudioEncoding, type TimelineAudioPolicy } from "@/lib/timeline-audio";
import { timelineSources, renderTimelineSequence, renderNativeClip } from "@/lib/timeline-sequence";
import { clipDuration, timelineDuration, TIMELINE_BOUNDARY_TOLERANCE, type VideoTimeline } from "@/lib/video-timeline";

export async function exportVideoTimeline(frames: HTMLIFrameElement[], timeline: VideoTimeline, options: {
  signal: AbortSignal; onProgress: (fraction: number) => void; audioPolicy: TimelineAudioPolicy; bitrate?: number;
}) {
  const failure = new AbortController();
  const signal = AbortSignal.any([options.signal, failure.signal]);
  const { onProgress } = options;
  const { clips, overlays, width, height, frameRate } = timeline;
  const bitrate = options.bitrate === undefined ? 8_000_000 : options.bitrate;
  const duration = timelineDuration(clips);
  if (duration <= 0 || frames.length !== overlays.length) throw new Error("The video timeline is incomplete");
  if (options.audioPolicy === "preserve" && clips.length !== 1) throw new Error("Preserved audio requires a single clip");
  if (!(await canEncodeVideo("avc", { width, height, bitrate }))) {
    throw new Error("This browser cannot export H.264 MP4 here. Update your browser or try a recent Chrome, Edge or Safari on a computer. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later.");
  }
  if (options.audioPolicy === "normalize") await requireNormalizedAudioEncoding();
  if (timeline.captions !== undefined) await loadCaptionFonts(timeline.captions.lines, timeline.captions.style);
  if (timeline.texts !== undefined) await loadTextFonts(timeline.texts);
  const captures = await Promise.all(overlays.map((overlay, index) => compositionCapture(frames[index], overlay.width, overlay.height, signal)));
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const rendering = canvas.getContext("2d", { alpha: false });
  if (rendering === null) throw new Error("Canvas 2D is unavailable");
  const context = rendering;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const video = new CanvasSource(canvas, { codec: "avc", quality: new Quality({ bitrate }), latencyMode: "quality" });
  output.addVideoTrack(video, frameRate === undefined ? {} : { frameRate });
  const sources = timelineSources(timeline);
  async function finishFrame(time: number, length: number) {
    signal.throwIfAborted();
    for (let index = 0; index < overlays.length; index++) {
      const overlay = overlays[index];
      if (time < overlay.startsAt || time >= overlay.startsAt + overlay.duration - TIMELINE_BOUNDARY_TOLERANCE) continue;
      const local = time - overlay.startsAt;
      const image = await captures[index](local);
      const overlayHeight = overlay.height * width / overlay.width;
      context.drawImage(image, 0, (height - overlayHeight) / 2, width, overlayHeight);
    }
    if (timeline.texts !== undefined) drawTexts(context, timeline.texts, time, width, height);
    if (timeline.captions !== undefined) drawCaptions(context, timeline.captions.lines, timeline.captions.style, time, width, height, timeline.captions);
    await video.add(time, length);
    onProgress(Math.min(0.99, (time + length) / duration));
  }
  let audio: Awaited<ReturnType<typeof createTimelineAudio>> | null = null;
  try {
    const media = await Promise.all(sources.sources);
    signal.throwIfAborted();
    audio = await createTimelineAudio(media[0].input, options.audioPolicy, duration);
    if (audio.source !== null) output.addAudioTrack(audio.source);
    await output.start();
    const render = frameRate === undefined ? renderNativeClip(timeline, sources, context, signal, finishFrame)
      : renderTimelineSequence(timeline, sources, context, signal, finishFrame);
    const tasks = [render, options.audioPolicy === "normalize"
      ? (() => {
        if (audio === null || audio.samples === undefined) throw new Error("Normalized audio is unavailable");
        return mixTimelineAudio(timeline, sources, audio.samples, signal);
      })()
      : (() => {
        if (audio.append === undefined) throw new Error("Preserved audio is unavailable");
        return audio.append(media[0].input, media[0].sourceStart, 0, clipDuration(clips[0]), signal);
      })()];
    try { await Promise.all(tasks); }
    catch (error) { failure.abort(); await Promise.allSettled(tasks); throw error; }
    signal.throwIfAborted();
    if (audio.finish !== undefined) await audio.finish();
    video.close();
    if (audio.source !== null) audio.source.close();
    await output.finalize();
    signal.throwIfAborted();
    if (target.buffer === null) throw new Error("Encoder produced no output buffer");
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
