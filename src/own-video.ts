import { ToolError } from "./errors.js";
export { closestVideoAspect, compositeSize, overlayStartLimit } from "../vendor/web/src/lib/video-placement.js";

export type Probe = { streams: { codec_type: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format: { duration: string } };

export function pictureSize(metadata: Probe) {
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  if (video === undefined || video.width === undefined || video.height === undefined || !Number.isFinite(video.width) || !Number.isFinite(video.height) || video.width <= 0 || video.height <= 0) throw new ToolError("Media has no readable picture.");
  const rotation = video.side_data_list?.find((side) => side.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  return Math.abs(rotation) % 180 === 90 ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}
