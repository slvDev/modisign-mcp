// generated from the Modisign monorepo, do not edit
export const SPEECH_RATE = 16000;
const WINDOW = 28 * SPEECH_RATE;
const HOP = 24 * SPEECH_RATE;

// One decoded source buffer: planar channels of `sampleRate` audio starting at `timestamp` seconds.
export type DecodedAudio = { timestamp: number; sampleRate: number; channels: Float32Array[] };
// One inference window; `samples` stays valid only until the next window is requested.
export type PcmWindow = { offset: number; duration: number; first: boolean; last: boolean; samples: Float32Array };
type Span = { start: number; end: number; first: boolean; last: boolean };
type Spill = { audio: DecodedAudio; end: number; from: number };

// Windows start every 24 s and last 28 s; the last one ends exactly at `total` samples and no empty window follows it.
export function captionWindowPlan(total: number) {
  const plan: Span[] = [];
  for (let start = 0; start < total; start += HOP) {
    const end = Math.min(total, start + WINDOW);
    plan.push({ start, end, first: start === 0, last: end === total });
    if (end === total) break;
  }
  return plan;
}

// Linear interpolation of the channel mean onto output samples [from, to) of the 16 kHz timeline that starts at `origin`; buffers never interpolate across their own edges.
function accumulate(target: Float32Array, base: number, audio: DecodedAudio, origin: number, from: number, to: number) {
  const length = audio.channels[0].length;
  for (let i = from; i < to; i++) {
    const position = Math.max(0, (origin + i / SPEECH_RATE - audio.timestamp) * audio.sampleRate);
    const first = Math.min(length - 1, Math.floor(position));
    const second = Math.min(length - 1, first + 1);
    for (const data of audio.channels) target[i - base] += (data[first] + (data[second] - data[first]) * (position - first)) / audio.channels.length;
  }
}

/**
 * Pulls decoded buffers in presentation order and yields one window at a time: nothing is pulled while the consumer works on a window.
 * Only the current window, its 4 s overlap tail for the next one and buffers still straddling the window end are held.
 * `total` is the 16 kHz sample count of the source duration; gaps and a short source stay zero.
 */
export async function* pcmWindows(source: AsyncIterable<DecodedAudio>, origin: number, total: number): AsyncGenerator<PcmWindow> {
  const plan = captionWindowPlan(total);
  if (plan.length === 0) return;
  let index = 0;
  let samples = new Float32Array(plan[0].end - plan[0].start);
  let spills: Spill[] = [];
  const addToWindow = (audio: DecodedAudio, end: number, from: number) => {
    const span = plan[index];
    accumulate(samples, span.start, audio, origin, Math.max(from, span.start), Math.min(end, span.end));
    if (end > span.end) spills.push({ audio, end, from: span.end });
  };
  const emit = (): PcmWindow => {
    const span = plan[index];
    return { offset: span.start / SPEECH_RATE, duration: (span.end - span.start) / SPEECH_RATE, first: span.first, last: span.last, samples };
  };
  const advance = () => {
    const tail = samples.subarray(HOP);
    index++;
    samples = new Float32Array(plan[index].end - plan[index].start);
    samples.set(tail);
    const pending = spills;
    spills = [];
    for (const spill of pending) addToWindow(spill.audio, spill.end, spill.from);
  };
  for await (const audio of source) {
    const start = Math.max(0, Math.ceil((audio.timestamp - origin) * SPEECH_RATE));
    const end = Math.min(total, Math.ceil((audio.timestamp - origin + audio.channels[0].length / audio.sampleRate) * SPEECH_RATE));
    // Buffers start in order, so a buffer beginning at the window end finishes that window.
    while (index < plan.length - 1 && start >= plan[index].end) {
      yield emit();
      advance();
    }
    addToWindow(audio, end, start);
  }
  while (index < plan.length - 1) {
    yield emit();
    advance();
  }
  yield emit();
}
