// generated from the Modisign monorepo, do not edit
import type { Input, InputVideoTrack, VideoCodec, VideoSample } from "mediabunny";
import type { TemplateOptions } from "@/lib/hrefs";
import { ImportError, NO_REPORT, importStage } from "@/lib/import-progress";
import { sourceOrigin } from "@/lib/video-timeline";

export type OwnVideo = {
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
};

export function transparentOverlay(options: TemplateOptions): TemplateOptions {
  return { ...options, edits: [...options.edits.filter(([key]) => key !== "background"), ["background", "transparent"]] };
}

const CODEC_NAMES: Partial<Record<VideoCodec, string>> = { avc: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1" };

export type OpenedVideo = {
  video: OwnVideo; input: Input; track: InputVideoTrack;
  // Smallest primary picture/audio timestamp: source time zero for this clip.
  origin: number; pictureStart: number;
  // The decoded first picture; the caller closes it.
  first: VideoSample;
  // Stops pending reads and releases the input.
  dispose: () => void;
};

// Reads the container's metadata with the demuxer and proves the first picture decodes with the export decoder; the returned blob URL belongs to the caller.
export async function openOwnVideo(file: File, signal: AbortSignal, maxDuration = 60, report = NO_REPORT): Promise<OpenedVideo> {
  if (typeof VideoDecoder === "undefined") throw new ImportError("can’t be opened because this browser cannot decode video. Update your browser. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later.");
  report.stage("reading");
  const { ALL_FORMATS, BlobSource, Input, UnsupportedInputFormatError, VideoSampleSink } = await import("mediabunny");
  signal.throwIfAborted();
  const source = new BlobSource(file);
  source.on("read", () => report.activity());
  const input = new Input({ source, formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  const dispose = () => { signal.removeEventListener("abort", abort); input.dispose(); };
  let first: VideoSample | null = null;
  try {
    const metadata = await importStage(report, signal, "reading", async () => {
      try {
        const track = await input.getPrimaryVideoTrack();
        if (track === null) throw new ImportError("has no readable video picture. The file may be audio-only or incomplete. Choose another copy.");
        const audio = await input.getPrimaryAudioTrack();
        const pictureStart = await track.getFirstTimestamp();
        const origin = sourceOrigin(pictureStart, audio === null ? null : await audio.getFirstTimestamp());
        const duration = await input.computeDuration(audio === null ? [track] : [track, audio]) - origin;
        const width = track.displayWidth;
        const height = track.displayHeight;
        if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) throw new ImportError("has no readable duration or picture. Choose another copy.");
        if (duration > maxDuration) throw new ImportError(`is ${duration.toFixed(1)} seconds. Choose a video up to ${maxDuration} seconds.`);
        return { track, pictureStart, origin, duration, width, height };
      } catch (error) {
        if (error instanceof UnsupportedInputFormatError) throw new ImportError("isn’t a video format this browser can read. Choose an MP4, MOV or WebM video.");
        throw error;
      }
    });
    const { track, pictureStart, origin, duration, width, height } = metadata;
    first = await importStage(report, signal, "checking", async () => {
      if (!(await track.canDecode())) {
        const codec = track.codec === null ? undefined : CODEC_NAMES[track.codec];
        throw new ImportError(`uses ${codec === undefined ? "video" : `${codec} video`} this browser can’t edit. Update your browser or use an H.264/AAC MP4 copy.`);
      }
      const sample = await new VideoSampleSink(track).getSample(pictureStart);
      if (sample === null) throw new ImportError("has no picture this browser can decode. Try an H.264/AAC MP4 copy.");
      return sample;
    });
    return { video: { file, url: URL.createObjectURL(file), duration, width, height }, input, track, origin, pictureStart, first, dispose };
  } catch (error) {
    if (first !== null) first.close();
    dispose();
    throw error;
  }
}

export async function readOwnVideo(file: File, signal: AbortSignal, maxDuration = 60, report = NO_REPORT): Promise<OwnVideo> {
  const opened = await openOwnVideo(file, signal, maxDuration, report);
  opened.first.close();
  opened.dispose();
  return opened.video;
}
