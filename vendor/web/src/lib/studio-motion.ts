// generated from the Modisign monorepo, do not edit
import { MOTION_IDENTITY, TIMELINE_BOUNDARY_TOLERANCE, type LayerMotion, type MotionEasing, type MotionKey } from "@/lib/studio-project";

export type MotionPose = { x: number; y: number; scale: number; rotation: number; opacity: number };
// Canvas/CSS 2D matrix order: x' = a·x + c·y + e, y' = b·x + d·y + f.
export type MotionMatrix = [number, number, number, number, number, number];
export type LayerPose = { matrix: MotionMatrix | null; opacity: number };
type Point = { x: number; y: number };

const PRESETS: Record<string, [number, number, number, number]> = {
  "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
};
const SOLVE_STEPS = 32;

// CSS cubic-bezier: solve x(u) = progress by bisection (x controls within 0..1 keep x monotone), then return y(u).
function bezierEase([x1, y1, x2, y2]: [number, number, number, number]) {
  const axis = (a: number, b: number, u: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let step = 0; step < SOLVE_STEPS; step++) {
      const middle = (low + high) / 2;
      if (axis(x1, x2, middle) < progress) low = middle; else high = middle;
    }
    return axis(y1, y2, (low + high) / 2);
  };
}
// Hold keeps its left value until the next key.
export function easingCurve(easing: MotionEasing) {
  if (easing === "hold") return () => 0;
  if (easing === "linear") return (progress: number) => progress;
  return bezierEase(typeof easing === "string" ? PRESETS[easing] : easing);
}

const curves = new WeakMap<MotionKey[], ((progress: number) => number)[]>();
function segmentCurves(keys: MotionKey[]) {
  let compiled = curves.get(keys);
  if (compiled === undefined) {
    compiled = keys.map(({ easing }) => easingCurve(easing));
    curves.set(keys, compiled);
  }
  return compiled;
}

// One channel at time `at`: endpoints hold, the left key's easing owns its outgoing segment, a key's own time returns its value.
export function sampleChannel(keys: MotionKey[] | undefined, at: number, identity: number) {
  if (keys === undefined) return identity;
  if (keys.length === 1 || at <= keys[0].at + TIMELINE_BOUNDARY_TOLERANCE) return keys[0].value;
  const last = keys[keys.length - 1];
  if (at >= last.at - TIMELINE_BOUNDARY_TOLERANCE) return last.value;
  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (keys[middle].at <= at + TIMELINE_BOUNDARY_TOLERANCE) low = middle; else high = middle;
  }
  const from = keys[low];
  const to = keys[high];
  if (from.easing === "hold") return from.value;
  return from.value + (to.value - from.value) * segmentCurves(keys)[low](Math.max(0, (at - from.at) / (to.at - from.at)));
}

export function motionPose(motion: LayerMotion | undefined, at: number): MotionPose {
  if (motion === undefined) return { ...MOTION_IDENTITY };
  return { x: sampleChannel(motion.x, at, MOTION_IDENTITY.x), y: sampleChannel(motion.y, at, MOTION_IDENTITY.y), scale: sampleChannel(motion.scale, at, MOTION_IDENTITY.scale),
    rotation: sampleChannel(motion.rotation, at, MOTION_IDENTITY.rotation), opacity: sampleChannel(motion.opacity, at, MOTION_IDENTITY.opacity) };
}
export function poseIsIdentity(pose: MotionPose) {
  return pose.x === 0 && pose.y === 0 && pose.scale === 1 && pose.rotation === 0;
}

// p' = pivot + (x·W, y·H) + scale · R(rotation) · (p − pivot), rotation clockwise in a y-down plane.
export function motionMatrix(pose: MotionPose, output: { width: number; height: number }, pivot: Point): MotionMatrix {
  const radians = pose.rotation * Math.PI / 180;
  const a = pose.scale * Math.cos(radians);
  const b = pose.scale * Math.sin(radians);
  return [a, b, -b, a, pivot.x + pose.x * output.width - (a * pivot.x - b * pivot.y), pivot.y + pose.y * output.height - (b * pivot.x + a * pivot.y)];
}
// The sampled layer pose: no matrix at all for the identity transform, so untouched layers keep their exact pixels.
export function layerPose(motion: LayerMotion | undefined, at: number, output: { width: number; height: number }, pivot: Point): LayerPose {
  const pose = motionPose(motion, at);
  return { matrix: poseIsIdentity(pose) ? null : motionMatrix(pose, output, pivot), opacity: pose.opacity };
}
export function mapPoint(matrix: MotionMatrix, point: Point): Point {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}
export function inversePoint(matrix: MotionMatrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  const x = point.x - e;
  const y = point.y - f;
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}
export function cssMatrix(matrix: MotionMatrix) {
  return `matrix(${matrix.join(",")})`;
}

// Draws a finished transparent layer once, with the layer's transform and its total opacity (callers multiply transition opacity in). `size` is the layer's extent in the context's units when its raster is smaller than that.
export function drawLayer(context: CanvasRenderingContext2D, layer: CanvasImageSource, pose: LayerPose, opacity: number, operation: GlobalCompositeOperation = "source-over", size?: { width: number; height: number }) {
  context.save();
  context.globalCompositeOperation = operation;
  context.globalAlpha = opacity * pose.opacity;
  if (pose.matrix !== null) context.transform(...pose.matrix);
  if (size === undefined) context.drawImage(layer, 0, 0);
  else context.drawImage(layer, 0, 0, size.width, size.height);
  context.restore();
}
