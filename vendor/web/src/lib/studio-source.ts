// generated from the Modisign monorepo, do not edit
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type InputAudioTrack, type InputVideoTrack } from "mediabunny";
import { ImportError } from "@/lib/import-progress";
import { createSilenceLevels } from "@/lib/studio-silences";
import { sourceOrigin } from "@/lib/video-timeline";

export const FILMSTRIP_FRAMES = 8;
export const WAVEFORM_BINS = 360;
export type SourceAudio = { levels: number[]; waveform: number[] };

export function thumbnail(width: number, height: number, quality: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new ImportError("couldn’t finish preparing previews. The browser couldn’t create a preview image.");
  draw(context);
  return canvas.toDataURL("image/jpeg", quality);
}

type Source = { video: InputVideoTrack; audio: InputAudioTrack | null; pictureStart: number; origin: number };

// Opens an already imported file with the same source origin as import and export; abort disposes the input and surfaces as the abort reason.
async function withSource<T>(file: File, signal: AbortSignal, run: (source: Source) => Promise<T>) {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (video === null) throw new Error("Video picture is unavailable");
    const audio = await input.getPrimaryAudioTrack();
    const pictureStart = await video.getFirstTimestamp();
    const origin = sourceOrigin(pictureStart, audio === null ? null : await audio.getFirstTimestamp());
    return await run({ video, audio, pictureStart, origin });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}

// Whether the file has an audio track, from demuxer metadata only (MCP's counterpart of the importer's check).
export function sourceHasAudio(file: File, signal: AbortSignal) {
  return withSource(file, signal, async ({ audio }) => audio !== null);
}

// One streamed decode computes the 20 ms RMS levels and the waveform together; null when the source has no audio track. `onProgress` receives source seconds.
export function analyseSourceAudio(file: File, duration: number, signal: AbortSignal, onProgress: (seconds: number) => void) {
  return withSource(file, signal, async ({ audio, origin }): Promise<SourceAudio | null> => {
    if (audio === null) return null;
    if (!(await audio.canDecode())) throw new Error(typeof AudioDecoder === "undefined"
      ? "This browser doesn’t support the audio editing Studio needs. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later."
      : "This browser can’t decode this clip’s audio.");
    const waveform = Array.from({ length: WAVEFORM_BINS }, () => 0);
    const levels = createSilenceLevels(duration);
    for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
      signal.throwIfAborted();
      const start = timestamp - origin;
      await levels.add(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate, start, signal);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 32) {
          const bin = Math.floor((start + i / buffer.sampleRate) / duration * waveform.length);
          if (bin >= 0 && bin < waveform.length) waveform[bin] = Math.max(waveform[bin], Math.abs(data[i]));
        }
      }
      onProgress(Math.min(duration, Math.max(0, start + buffer.duration)));
    }
    onProgress(duration);
    return { levels: levels.finish(), waveform };
  });
}

// The eight 120×68 timeline tiles; source time of tile n is never before the picture's first timestamp.
export function sourceFilmstrip(file: File, duration: number, signal: AbortSignal) {
  return withSource(file, signal, async ({ video, pictureStart, origin }) => {
    const tiles: string[] = [];
    const times = Array.from({ length: FILMSTRIP_FRAMES }, (_, index) => Math.max(pictureStart, origin + index / FILMSTRIP_FRAMES * duration));
    for await (const frame of new VideoSampleSink(video).samplesAtTimestamps(times)) {
      signal.throwIfAborted();
      if (frame === null) throw new Error("A video frame could not be decoded.");
      try {
        const scale = Math.max(120 / video.displayWidth, 68 / video.displayHeight);
        tiles.push(thumbnail(120, 68, 0.65, (context) => frame.draw(context,
          (120 - video.displayWidth * scale) / 2, (68 - video.displayHeight * scale) / 2, video.displayWidth * scale, video.displayHeight * scale)));
      } finally { frame.close(); }
    }
    return tiles;
  });
}
