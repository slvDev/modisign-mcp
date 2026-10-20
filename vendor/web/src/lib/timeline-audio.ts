// generated from the Modisign monorepo, do not edit
import { aacPriming, STUDIO_AAC_CONFIG } from "@/lib/aac-timing";
import { clipStarts, clipDuration, timelineDuration, timelineSampler, type VideoTimeline } from "@/lib/video-timeline";
import type { TimelineSources } from "@/lib/timeline-sequence";
import { AudioBufferSink, AudioSample, AudioSampleSink, AudioSampleSource, EncodedAudioPacketSource,
  EncodedPacket, EncodedPacketSink, Quality, canEncodeAudio, type Input } from "mediabunny";

const AUDIO_RATE = 48_000;
export type TimelineAudioPolicy = "normalize" | "preserve";

// Normalized exports always carry AAC, even for photo-only or silent sequences.
export async function requireNormalizedAudioEncoding() {
  if (!(await canEncodeAudio("aac", { sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 192_000 }))) {
    throw new Error("This browser cannot encode the AAC audio Studio exports need. Update your browser. On iPhone and iPad, use Safari with iOS or iPadOS 26 or later.");
  }
}

export async function createTimelineAudio(input: Input | null, policy: TimelineAudioPolicy, duration?: number): Promise<{
  source: AudioSampleSource | EncodedAudioPacketSource | null;
  samples?: AudioWriter;
  finish?: () => Promise<void>;
  dispose?: () => void;
  append?: (input: Input | null, origin: number, offset: number, duration: number, signal: AbortSignal) => Promise<void>;
}> {
  if (policy === "normalize") {
    await requireNormalizedAudioEncoding();
    if (duration === undefined) throw new Error("Normalized audio requires a timeline duration");
    return normalizedAudio(duration);
  }
  if (input === null) throw new Error("Preserved audio requires video media");
  const track = await input.getPrimaryAudioTrack();
  if (track === null) return { source: null, append: async () => {} };
  if (await track.getCodec() === "aac") {
    const config = await track.getDecoderConfig();
    if (config === null) throw new Error("This video's AAC configuration is unreadable.");
    const source = new EncodedAudioPacketSource("aac");
    return { source, append: async (_input: Input | null, origin: number, offset: number, duration: number, signal: AbortSignal) => {
      for await (const packet of new EncodedPacketSink(track).packets()) {
        signal.throwIfAborted();
        if (packet.timestamp >= origin + duration) break;
        await source.add(packet.clone({ timestamp: offset + packet.timestamp - origin }), { decoderConfig: config });
      }
    } };
  }
  const sampleRate = await track.getSampleRate();
  const numberOfChannels = await track.getNumberOfChannels();
  const quality = new Quality("high");
  if (!(await track.canDecode()) || !(await canEncodeAudio("aac", { sampleRate, numberOfChannels, quality }))) {
    throw new Error("This browser cannot export this video's audio to AAC. Try an H.264/AAC MP4 in a recent Chrome or Edge.");
  }
  const source = new AudioSampleSource({ codec: "aac", quality });
  return { source, append: async (_input: Input | null, origin: number, offset: number, duration: number, signal: AbortSignal) => {
    for await (const sample of new AudioSampleSink(track).samples(origin, origin + duration)) {
      try {
        signal.throwIfAborted();
        const start = Math.max(0, Math.round((origin - sample.timestamp) * sample.sampleRate));
        const end = Math.min(sample.numberOfFrames, Math.round((origin + duration - sample.timestamp) * sample.sampleRate));
        if (start >= end) continue;
        const trimmed = sample.trim(start, end);
        try {
          trimmed.setTimestamp(offset + Math.max(0, trimmed.timestamp - origin));
          await source.add(trimmed);
        } finally { trimmed.close(); }
      } finally { sample.close(); }
    }
  } };
}

function audioValue(buffer: AudioBuffer, first: number, second: number, fraction: number, channel: number) {
  const samples = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
  let value = samples[first] + (samples[second] - samples[first]) * fraction;
  for (let extra = 2; extra < buffer.numberOfChannels; extra++) {
    const samples = buffer.getChannelData(extra);
    value += Math.SQRT1_2 * (samples[first] + (samples[second] - samples[first]) * fraction);
  }
  return value / (1 + Math.SQRT1_2 * Math.max(0, buffer.numberOfChannels - 2));
}

export async function mixTimelineAudio(timeline: VideoTimeline, sources: TimelineSources, source: AudioWriter, signal: AbortSignal) {
  const starts = clipStarts(timeline.clips);
  const sampleAt = timelineSampler(timeline.clips, starts);
  const end = Math.round(timelineDuration(timeline.clips) * AUDIO_RATE);
  type Cursor = { origin: number; buffers: ReturnType<AudioBufferSink["buffers"]>; decoded: IteratorResult<{ buffer: AudioBuffer; timestamp: number }> };
  const cursors = new Map<number, Cursor | null>();
  try {
    for (let at = 0; at < end; at += AUDIO_RATE / 2) {
      signal.throwIfAborted();
      const length = Math.min(AUDIO_RATE / 2, end - at);
      const data = new Float32Array(length * 2);
      for (let index = 0; index < length; index++) {
        const time = (at + index) / AUDIO_RATE;
        for (const item of sampleAt(time)) {
          if (item.gain === 0) continue;
          let cursor = cursors.get(item.index);
          if (cursor === undefined) {
            const media = await sources.sources[item.index];
            const track = media.input === null ? null : await media.input.getPrimaryAudioTrack();
            if (track !== null && !(await track.canDecode())) throw new Error("This browser cannot decode a clip's audio. Try an H.264/AAC MP4.");
            if (track === null) cursor = null;
            else {
              const buffers = new AudioBufferSink(track).buffers(media.sourceStart, media.sourceStart + clipDuration(timeline.clips[item.index]));
              cursor = { origin: media.sourceStart, buffers, decoded: await buffers.next() };
            }
            cursors.set(item.index, cursor);
          }
          if (cursor === null) continue;
          const local = cursor.origin + item.time;
          while (!cursor.decoded.done && local >= cursor.decoded.value.timestamp + cursor.decoded.value.buffer.duration) {
            cursor.decoded = await cursor.buffers.next(); signal.throwIfAborted();
          }
          if (cursor.decoded.done || local < cursor.decoded.value.timestamp) continue;
          const { buffer, timestamp } = cursor.decoded.value;
          const position = (local - timestamp) * buffer.sampleRate;
          const first = Math.floor(position);
          const second = Math.min(first + 1, buffer.length - 1);
          for (let channel = 0; channel < 2; channel++) data[channel * length + index] += item.gain * audioValue(buffer, first, second, position - first, channel);
        }
      }
      for (const [index, cursor] of cursors) if (cursor !== null && starts[index] + clipDuration(timeline.clips[index]) <= (at + length) / AUDIO_RATE) {
        await cursor.buffers.return(); cursors.set(index, null);
      }
      for (let index = 0; index < data.length; index++) data[index] = Math.max(-1, Math.min(1, data[index]));
      const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: AUDIO_RATE, timestamp: at / AUDIO_RATE });
      try { await source.add(sample); } finally { sample.close(); }
    }
  } finally {
    await Promise.allSettled([...cursors.values()].map((cursor) => cursor === null ? Promise.resolve() : cursor.buffers.return()));
  }
}

type AudioWriter = { add: (sample: AudioSample) => Promise<void> };
async function normalizedAudio(duration: number) {
  const priming = await aacPriming();
  const source = new EncodedAudioPacketSource("aac");
  let failure: unknown;
  let decoderConfig: AudioDecoderConfig | undefined;
  let writing = Promise.resolve();
  let queued: (() => void) | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      if (metadata !== undefined && metadata.decoderConfig !== undefined) decoderConfig = metadata.decoderConfig;
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      // Browser AAC encoders emit priming and padding outside the requested timeline.
      const start = Math.round((packet.timestamp - priming) * AUDIO_RATE) / AUDIO_RATE;
      const packetDuration = chunk.duration === null ? 1024 / AUDIO_RATE : packet.duration;
      const end = Math.min(duration, start + packetDuration);
      if (end <= 0 || start >= end) return;
      writing = writing.then(() => source.add(packet.clone({ timestamp: start, duration: end - start }), decoderConfig === undefined ? metadata : { decoderConfig })).catch((error: unknown) => { failure = error; });
    },
    error: (error) => { failure = error; if (queued !== null) queued(); },
  });
  encoder.configure(STUDIO_AAC_CONFIG);
  const samples: AudioWriter = { add: async (sample) => {
    if (failure !== undefined) throw failure;
    const data = sample.toAudioData();
    try { encoder.encode(data); } finally { data.close(); }
    if (encoder.encodeQueueSize > 4) await new Promise<void>((resolve) => { queued = resolve; encoder.addEventListener("dequeue", () => resolve(), { once: true }); });
    queued = null;
    await writing;
    if (failure !== undefined) throw failure;
  } };
  return { source, samples, finish: async () => { await encoder.flush(); await writing; if (failure !== undefined) throw failure; },
    dispose: () => { if (encoder.state !== "closed") encoder.close(); } };
}
