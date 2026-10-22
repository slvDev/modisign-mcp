// generated from the Modisign monorepo, do not edit
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample, type InputVideoTrack } from "mediabunny";
import { drawClip, clipPunchInTiming, clipPivot, clipSourceStart } from "@/lib/clip-settings";
import { activePersonTitles, createPersonLayer, personParams, personTitlesOf, type PersonLayer } from "@/lib/person-layer";
import type { PersonExportMasks, PersonPicture } from "@/lib/person-masks";
import { drawLayer, layerPose } from "@/lib/studio-motion";
import { motionIsIdentity } from "@/lib/studio-project";
import { sourceOrigin, clipDuration, clipInPoint, clipStarts, timelineDuration, timelineSampler, TIMELINE_BOUNDARY_TOLERANCE, type VideoTimeline } from "@/lib/video-timeline";

export function timelineSources(timeline: VideoTimeline) {
  const inputs = timeline.clips.map((clip) => clip.kind === "photo" ? null : new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS }));
  const sources = inputs.map(async (input, index) => {
    const track = input === null ? null : await input.getPrimaryVideoTrack();
    if (input !== null && (track === null || !(await track.canDecode()))) throw new Error("This browser cannot decode a clip's picture.");
    const videoOrigin = track === null ? 0 : await track.getFirstTimestamp();
    const audioTrack = input === null ? null : await input.getPrimaryAudioTrack();
    const origin = sourceOrigin(videoOrigin, audioTrack === null ? null : await audioTrack.getFirstTimestamp());
    return { input, track, videoOrigin, sourceStart: origin + clipInPoint(timeline.clips[index]) };
  });
  return { sources, dispose: () => inputs.forEach((input) => { if (input !== null) input.dispose(); }) };
}
export type TimelineSources = ReturnType<typeof timelineSources>;

function scratchLayer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas 2D is unavailable");
  return { canvas, context };
}

// `masks` is required whenever a title has a person effect; it may wait for inference before an owner's picture is drawn.
export async function renderTimelineSequence(timeline: VideoTimeline, sources: TimelineSources,
  context: CanvasRenderingContext2D, signal: AbortSignal, draw: (time: number, duration: number) => Promise<void>, masks?: PersonExportMasks) {
  const { clips, width, height, frameRate } = timeline;
  if (frameRate === undefined) throw new Error("Sequence rendering requires a frame rate");
  const rate = frameRate;
  const starts = clipStarts(clips);
  const sampleAt = timelineSampler(clips, starts);
  const duration = timelineDuration(clips);
  const people = personTitlesOf(timeline.texts);
  if (people.length > 0 && masks === undefined) throw new Error("Titles behind a person need their masks");
  const { canvas: layer, context: layerContext } = scratchLayer(width, height);
  let person: PersonLayer | null = null;
  const pictures = new Map<number, HTMLImageElement>();
  const iterators = new Map<number, AsyncGenerator<VideoSample | null>>();
  function timestamps(index: number) {
    return (function* () {
      const first = Math.ceil((starts[index] - TIMELINE_BOUNDARY_TOLERANCE) * rate);
      const last = Math.ceil((starts[index] + clipDuration(clips[index]) - TIMELINE_BOUNDARY_TOLERANCE) * rate);
      for (let frame = first; frame < last; frame++) yield Math.max(0, frame / rate - starts[index]);
    })();
  }
  try {
    for (let frame = 0; frame < Math.ceil((duration - TIMELINE_BOUNDARY_TOLERANCE) * frameRate); frame++) {
      signal.throwIfAborted();
      const time = frame / frameRate;
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "black";
      context.fillRect(0, 0, width, height);
      const visible = sampleAt(time);
      for (const index of pictures.keys()) if (!visible.some((item) => item.index === index)) pictures.delete(index);
      for (const [index, iterator] of iterators) if (!visible.some((item) => item.index === index)) {
        await iterator.return(null); iterators.delete(index);
      }
      for (const item of visible) {
        const clip = clips[item.index];
        layerContext.clearRect(0, 0, width, height);
        let picture: PersonPicture | null = null;
        if (clip.kind === "photo") {
          let photo = pictures.get(item.index);
          if (photo === undefined) { photo = new Image(); photo.src = clip.url; await photo.decode(); pictures.set(item.index, photo); }
          const decoded = photo;
          picture = { file: clip.file, time: 0 };
          drawClip(layerContext, clip, { width, height }, clip.settings,
            (rect, source) => layerContext.drawImage(decoded, source.x, source.y, source.width, source.height, rect.x, rect.y, rect.width, rect.height), clip, { time: item.time, duration: clipDuration(clip) }, clipPunchInTiming(clip, item.time));
        } else {
          const source = await sources.sources[item.index];
          if (source.track === null) throw new Error("Video frames are unavailable");
          let iterator = iterators.get(item.index);
          if (iterator === undefined) {
            iterator = samples(source.track, source.sourceStart, timestamps(item.index));
            iterators.set(item.index, iterator);
          }
          const result = await iterator.next();
          if (result.done) throw new Error("A clip has no frame at the requested time");
          const sample = result.value;
          if (sample !== null) picture = { file: clip.file, time: sample.timestamp };
          if (sample === null && source.sourceStart + item.time >= source.videoOrigin) throw new Error("A clip has no frame at the requested time");
          try {
            if (sample !== null) drawClip(layerContext, clip, { width, height }, clip.settings,
              (rect, source) => sample.draw(layerContext, source.x, source.y, source.width, source.height, rect.x, rect.y, rect.width, rect.height), clip, undefined, clipPunchInTiming(clip, item.time));
          } finally { if (sample !== null) sample.close(); }
        }
        const pose = layerPose(clip.motion, clipSourceStart(clip) + item.time, { width, height }, clipPivot(clip, { width, height }));
        const operation = clip.track === "v1" ? "lighter" : "source-over";
        const attached = picture === null || masks === undefined ? [] : activePersonTitles(people, item.index, time);
        if (picture === null || masks === undefined || attached.length === 0) { drawLayer(context, layer, pose, item.opacity, operation); continue; }
        for (const title of attached) await masks.ensure(picture, personParams(title), signal);
        if (person === null) { person = createPersonLayer(); person.resize({ width, height }, { width, height }); }
        const owned = person.compose({ index: item.index, clip, clipTime: item.time, matrix: pose.matrix, footage: layer, picture }, attached, time, masks);
        if (owned.omitted.length > 0) throw new Error("A person alpha is missing after its masks were prepared");
        // The group is faded once, here, by the owner's motion and transition opacity.
        drawLayer(context, owned.group, { matrix: null, opacity: pose.opacity }, item.opacity, operation, { width, height });
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      await draw(time, Math.min(1 / frameRate, duration - time));
    }
  } finally {
    await Promise.allSettled([...iterators.values()].map((iterator) => iterator.return(null)));
    if (person !== null) person.dispose();
    layer.width = 0; layer.height = 0;
  }
}
async function* samples(track: InputVideoTrack, sourceStart: number, times: Generator<number>) {
  function* timestamps() { for (const time of times) yield sourceStart + time; }
  yield* new VideoSampleSink(track).samplesAtTimestamps(timestamps());
}

export async function renderNativeClip(timeline: VideoTimeline, sources: TimelineSources,
  context: CanvasRenderingContext2D, signal: AbortSignal, draw: (time: number, duration: number) => Promise<void>) {
  if (timeline.clips.length !== 1) throw new Error("Native frame timing requires a single clip");
  const clip = timeline.clips[0];
  if (clip.track !== "v1" || clip.startsAt !== 0) throw new Error("Native frame timing requires V1 at time zero");
  const { width, height } = timeline;
  const source = await sources.sources[0];
  if (source.track === null) throw new Error("Native frame timing requires video media");
  const duration = clipDuration(clip);
  const isolated = motionIsIdentity(clip.motion) ? null : scratchLayer(width, height);
  const target = isolated === null ? context : isolated.context;
  async function picture(sample: VideoSample | null, time: number, length: number) {
    signal.throwIfAborted();
    context.fillStyle = "black"; context.fillRect(0, 0, width, height);
    if (isolated !== null) isolated.context.clearRect(0, 0, width, height);
    if (sample !== null) drawClip(target, clip, { width, height }, clip.settings,
      (rect, source) => sample.draw(target, source.x, source.y, source.width, source.height, rect.x, rect.y, rect.width, rect.height), clip, undefined, clipPunchInTiming(clip, time));
    if (isolated !== null) drawLayer(context, isolated.canvas, layerPose(clip.motion, clipSourceStart(clip) + time, { width, height }, clipPivot(clip, { width, height })), 1, "lighter");
    await draw(time, length);
  }
  try {
    const gap = Math.min(duration, Math.max(0, source.videoOrigin - source.sourceStart));
    for (let time = 0; time < gap - TIMELINE_BOUNDARY_TOLERANCE; time += 1 / 30) await picture(null, time, Math.min(1 / 30, gap - time));
    for await (const sample of new VideoSampleSink(source.track).samples(source.sourceStart, source.sourceStart + duration)) {
      try {
        const time = Math.max(0, sample.timestamp - source.sourceStart);
        const end = Math.min(duration, sample.timestamp + sample.duration - source.sourceStart);
        if (end <= time) continue;
        if (sample.timestamp >= source.sourceStart + duration - TIMELINE_BOUNDARY_TOLERANCE) break;
        await picture(sample, time, end - time);
      } finally { sample.close(); }
    }
  } finally {
    if (isolated !== null) { isolated.canvas.width = 0; isolated.canvas.height = 0; }
  }
}
