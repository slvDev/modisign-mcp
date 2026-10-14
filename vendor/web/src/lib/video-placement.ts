// generated from the Modisign monorepo, do not edit
export type PictureSize = { width: number; height: number };

export function closestVideoAspect<T extends string>(video: PictureSize, aspects: readonly T[]): T {
  const [first] = aspects;
  if (first === undefined) throw new Error("Overlay family has no supported aspects.");
  const distance = (aspect: T) => {
    const match = /^(\d+)x(\d+)$/.exec(aspect);
    if (match === null || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error("Invalid supported overlay aspect.");
    return Math.abs(Math.log((Number(match[1]) / Number(match[2])) / (video.width / video.height)));
  };
  return aspects.reduce((closest, aspect) => distance(aspect) < distance(closest) ? aspect : closest, first);
}

export function compositeSize(video: PictureSize) {
  const scale = Math.min(1, 1920 / Math.max(video.width, video.height));
  // H.264 requires even dimensions; rounding changes the ratio by at most one pixel.
  return { width: Math.max(2, Math.round(video.width * scale / 2) * 2), height: Math.max(2, Math.round(video.height * scale / 2) * 2) };
}

export function overlayStartLimit(videoDuration: number, overlayDuration: number) {
  return Math.floor(Math.max(0, videoDuration - overlayDuration) * 10) / 10;
}
