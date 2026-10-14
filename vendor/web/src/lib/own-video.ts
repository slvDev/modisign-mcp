// generated from the Modisign monorepo, do not edit
import type { TemplateOptions } from "@/lib/hrefs";

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

export async function readOwnVideo(file: File, signal: AbortSignal, maxDuration = 60): Promise<OwnVideo> {
  if (typeof VideoDecoder === "undefined") throw new Error("Your browser cannot decode video for this feature. Use a recent Chrome, Edge or Safari.");
  const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = await import("mediabunny");
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const url = URL.createObjectURL(file);
  const preview = document.createElement("video");
  preview.muted = true;
  preview.preload = "auto";
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("This video could not be opened within 15 seconds.")), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        preview.onloadeddata = null;
        preview.onerror = null;
        if (error === undefined) resolve();
        else reject(error);
      };
      const aborted = () => finish(new DOMException("Canceled", "AbortError"));
      signal.addEventListener("abort", aborted, { once: true });
      preview.onloadeddata = () => finish();
      preview.onerror = () => finish(new Error("This browser cannot decode this video. Try an H.264 MP4."));
      preview.src = url;
    });
    await loaded;
    signal.throwIfAborted();
    const { duration, videoWidth: width, videoHeight: height } = preview;
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) throw new Error("This video has no readable duration or picture.");
    if (duration > maxDuration) throw new Error(`Choose a video no longer than ${maxDuration} seconds.`);
    const track = await input.getPrimaryVideoTrack();
    if (track === null || !(await track.canDecode())) throw new Error("This browser cannot decode this video for export. Try an H.264 MP4.");
    const sample = await new VideoSampleSink(track).getSample(await track.getFirstTimestamp());
    if (sample === null) throw new Error("This video has no decodable frames.");
    sample.close();
    signal.throwIfAborted();
    return { file, url, duration, width, height };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (signal.aborted || error instanceof Error && /^(Choose|This|Your)/.test(error.message)) throw error;
    throw new Error("This browser cannot read this video. Try an H.264 MP4.");
  } finally {
    preview.removeAttribute("src");
    preview.load();
    input.dispose();
  }
}
