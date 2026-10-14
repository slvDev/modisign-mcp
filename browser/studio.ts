import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { readOwnVideo } from "../vendor/web/src/lib/own-video";
import { readStudioPhoto } from "../vendor/web/src/lib/studio-photo";
import { captionTranscriber, speechPcm } from "../vendor/web/src/lib/captions-asr";
import { captionLines, timelineWords } from "../vendor/web/src/lib/captions";
import { createSilenceLevels, detectClipSilences } from "../vendor/web/src/lib/studio-silences";
import { studioReducer, type StudioMedia, type StudioOverlay } from "../vendor/web/src/lib/studio-state";
import { studioTimeline } from "../vendor/web/src/lib/studio-projections";
import { clipStarts, studioSize, timelineDuration } from "../vendor/web/src/lib/video-timeline";
import { exportVideoTimeline } from "../vendor/web/src/lib/timeline-export";
import { correctTranscript, editDocument, type EditInput } from "../src/studio-request";

type BrowserRequest = { input: EditInput; media: { url: string; name: string; type: string; kind: "video" | "photo" }[]; overlays: { src: string; overlay: StudioOverlay }[]; transcriptOnly: boolean };
declare global { interface Window {
  runStudio: (request: BrowserRequest) => Promise<unknown>;
  studioProgress: (fraction: number) => Promise<void>;
  studioWrite: (base64: string) => Promise<void>;
} }
window.runStudio = async (request) => {
  const controller = new AbortController();
  const signal = controller.signal;
  const media: StudioMedia[] = [];
  const worker = request.input.captions === undefined && !request.transcriptOnly ? null : captionTranscriber(signal, () => {}, new URL("/captions-worker.js", location.origin));
  try {
    for (const [index, source] of request.media.entries()) {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("Local media could not be read");
      const file = new File([await response.blob()], source.name, { type: source.type });
      const loaded = source.kind === "photo" ? { kind: "photo" as const, source: await readStudioPhoto(file, signal) }
        : { kind: "video" as const, source: await readOwnVideo(file, signal, 180) };
      media.push({ ...loaded, id: `media-${index}`, poster: "", filmstrip: [], waveform: null, silenceLevels: null });
    }
    let state = editDocument(request.input, media);
    state.overlays = request.overlays.map((item) => item.overlay);
    for (const item of media) {
      if (item.kind === "photo") continue;
      if (worker !== null) {
        const pcm = await speechPcm(item.source.file, item.source.duration, signal);
        if (pcm !== null) {
          const transcript = await worker.transcribe(pcm);
          const corrections = request.input.captions === undefined || request.input.captions.corrections === undefined ? [] : request.input.captions.corrections;
          state.transcripts[item.id] = correctTranscript(transcript.words, corrections);
        }
      }
      if (request.input.remove_silences !== undefined) {
        const input = new Input({ source: new BlobSource(item.source.file), formats: ALL_FORMATS });
        try {
          const audio = await input.getPrimaryAudioTrack();
          const video = await input.getPrimaryVideoTrack();
          if (video === null) throw new Error("Video picture is unavailable");
          if (audio !== null) {
            if (!(await audio.canDecode())) throw new Error("This browser cannot decode clip audio");
            const origin = Math.max(0, Math.min(await video.getFirstTimestamp(), await audio.getFirstTimestamp()));
            const levels = createSilenceLevels(item.source.duration);
            for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
              await levels.add(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate, timestamp - origin, signal);
            }
            item.silenceLevels = levels.finish();
          }
        } finally { input.dispose(); }
      }
    }
    if (request.transcriptOnly) {
      const lines = captionLines(timelineWords(state.clips, state.transcripts), "clean");
      const start = request.input.clips[0].in === undefined ? 0 : request.input.clips[0].in;
      return { lines: lines.map((line) => ({ text: line.text, start: line.start + start, end: line.end + start })) };
    }
    if (request.input.remove_silences !== undefined) {
      const { sensitivity, shortest_pause } = request.input.remove_silences;
      const starts = clipStarts(state.clips);
      const ranges = (await Promise.all(state.clips.map((clip, index) => clip.kind === "photo" ? [] : detectClipSilences(media[index].silenceLevels, clip, starts[index], sensitivity, shortest_pause, signal)))).flat();
      state = studioReducer(state, { type: "remove-silences", ranges: ranges.map((range, index) => ({ ...range, newId: `silence-${index}` })) });
    }
    const longSide = request.input.quality === "720p" ? 1280 : 1920;
    const timeline = { ...studioTimeline(state), ...studioSize(state.aspect, longSide) };
    if (timelineDuration(timeline.clips) <= 0) throw new Error("Silence removal left no footage");
    const frames = state.overlays.map((overlay, index) => {
      const frame = document.createElement("iframe");
      frame.width = String(timeline.overlays[index].width); frame.height = String(timeline.overlays[index].height);
      frame.src = request.overlays[index].src; document.body.append(frame);
      timeline.overlays[index].src = frame.src;
      timeline.overlays[index].startsAt = overlay.start;
      return frame;
    });
    await window.studioProgress(0.2);
    const blob = await exportVideoTimeline(frames, timeline, { signal, onProgress: (fraction) => { void window.studioProgress(0.2 + fraction * 0.78); }, audioPolicy: "normalize", bitrate: Math.round(8_000_000 * (longSide / 1920) ** 2) });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let at = 0; at < bytes.length; at += 256 * 1024) {
      let binary = "";
      for (const byte of bytes.subarray(at, at + 256 * 1024)) binary += String.fromCharCode(byte);
      await window.studioWrite(btoa(binary));
    }
    return { duration: timelineDuration(timeline.clips), width: timeline.width, height: timeline.height, captions: timeline.captions === undefined ? 0 : timeline.captions.lines.length };
  } finally {
    if (worker !== null) worker.dispose();
    for (const item of media) URL.revokeObjectURL(item.source.url);
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  }
};
