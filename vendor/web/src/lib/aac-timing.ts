// generated from the Modisign monorepo, do not edit
const RATE = 48_000;
const CHANNELS = 2;
export const STUDIO_AAC_CONFIG: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: 192_000 };
let measured: Promise<number> | undefined;

// Some AAC encoders include unreported priming in chunks timestamped at zero.
export function aacPriming() {
  if (measured === undefined) measured = measurePriming().catch((error: unknown) => { measured = undefined; throw error; });
  return measured;
}
async function measurePriming() {
  const chunks: EncodedAudioChunk[] = [];
  let configuration: AudioDecoderConfig | undefined;
  let failure: unknown;
  const encoder = new AudioEncoder({ output: (chunk, metadata) => {
    chunks.push(chunk);
    if (metadata !== undefined && metadata.decoderConfig !== undefined) configuration = metadata.decoderConfig;
  }, error: (error) => { failure = error; } });
  let decoder: AudioDecoder | undefined;
  try {
    encoder.configure(STUDIO_AAC_CONFIG);
    const frames = 8192;
    const impulse = 4096;
    const pcm = new Float32Array(frames * CHANNELS);
    pcm[impulse] = 0.75; pcm[frames + impulse] = 0.75;
    const data = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfChannels: CHANNELS, numberOfFrames: frames, timestamp: 0, data: pcm });
    try { encoder.encode(data); } finally { data.close(); }
    await encoder.flush();
    if (failure !== undefined) throw failure;
    if (configuration === undefined) throw new Error("AAC timing configuration is unavailable");
    let peak = 0;
    let time: number | undefined;
    decoder = new AudioDecoder({ output: (sample) => {
      try {
        const values = new Float32Array(sample.numberOfFrames);
        sample.copyTo(values, { planeIndex: 0, format: "f32-planar" });
        for (let index = 0; index < values.length; index++) if (Math.abs(values[index]) > peak) {
          peak = Math.abs(values[index]); time = sample.timestamp / 1e6 + index / sample.sampleRate;
        }
      } finally { sample.close(); }
    }, error: (error) => { failure = error; } });
    decoder.configure(configuration);
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
    if (failure !== undefined) throw failure;
    if (time === undefined || peak < 0.1) throw new Error("AAC timing could not be measured");
    const delay = Math.round((time - impulse / RATE) * RATE) / RATE;
    if (delay < -1 / RATE || delay > 0.1) throw new Error("AAC timing is outside the supported range");
    return Math.max(0, delay);
  } finally {
    if (encoder.state !== "closed") encoder.close();
    if (decoder !== undefined && decoder.state !== "closed") decoder.close();
  }
}
