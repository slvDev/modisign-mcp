// generated from the Modisign monorepo, do not edit
import { SFX_PACK, STUDIO_TIME_TOLERANCE, TIMELINE_BOUNDARY_TOLERANCE, isSfxOffset, sfxAsset, sfxDuration, sfxSettingsProblem, type ProjectSfx, type ProjectSfxAnchor, type SfxAsset, type SfxSettings } from "@/lib/studio-project";
import { cutTransition, clipStarts, timelineDuration, type TimelineSfx } from "@/lib/video-timeline";
import { sampleChannel } from "@/lib/studio-motion";
import { revealProgress } from "@/lib/title-reveal";
import { textSpan } from "@/lib/studio-text";
import { activeCues } from "@/lib/values";
import type { StudioState } from "@/lib/studio-state";

export type SfxAnchor = { kind: "title-enter"; textId: string } | { kind: "transition"; fromClipId: string; toClipId: string } | { kind: "overlay-cue"; overlayId: string; cue: string };
// A sound starts at an absolute post-overlap time or follows an event, `offset` seconds away; `auto` marks rows the event builder manages.
export type SfxTiming = { start: number } | { anchor: SfxAnchor; offset: number };
export type StudioSfx = SfxSettings & { id: string; timing: SfxTiming; auto?: typeof SFX_PACK };
export type SfxPatch = Partial<Omit<StudioSfx, "id">>;
export type SfxOwners = Pick<StudioState, "clips" | "overlays" | "texts">;
export type SfxEvent = { time: number } | { problem: string };
// A sound laid on the edit: `start` is its resolved, uncropped start; `head`/`tail` are the seconds the output boundaries cut off.
export type SfxPlacement = { sfx: StudioSfx; asset: SfxAsset; start: number; length: number; head: number; tail: number; inactive: string | null };

export function newSfx(id: string, assetId: string, start: number): StudioSfx {
  const asset = sfxAsset(assetId);
  if (asset === undefined) throw new Error("Unknown sound");
  return { id, asset: asset.id, inPoint: 0, outPoint: sfxDuration(asset), gain: asset.defaultGain, muted: false, fadeIn: 0, fadeOut: 0, timing: { start } };
}

// The first moment a title can be seen: its start, or the first 30 fps frame after it where its opacity is positive and its reveal has started.
function titleEnter(title: SfxOwners["texts"][number], clips: SfxOwners["clips"]): SfxEvent {
  const { start, end } = textSpan(title, clips);
  const opacity = title.motion === undefined ? undefined : title.motion.opacity;
  if (opacity === undefined && title.reveal === undefined) return { time: start };
  const origin = title.animationOffset === undefined ? 0 : title.animationOffset;
  const { reveal } = title;
  const visible = (time: number) => (opacity === undefined || sampleChannel(opacity, time - start + origin, 1) > 0) && (reveal === undefined || revealProgress(reveal, time - start + origin) > 0);
  if (visible(start)) return { time: start };
  for (let frame = Math.ceil(start * 30 + 1e-6); frame / 30 < end - TIMELINE_BOUNDARY_TOLERANCE; frame++) if (visible(frame / 30)) return { time: frame / 30 };
  return { problem: "This title is never visible." };
}

// The moment an anchor refers to on the current edit, or why it cannot exist.
export function sfxEvent(anchor: SfxAnchor, owners: SfxOwners): SfxEvent {
  if (anchor.kind === "title-enter") {
    const title = owners.texts.find((item) => item.id === anchor.textId);
    return title === undefined ? { problem: "This sound's title was removed." } : titleEnter(title, owners.clips);
  }
  if (anchor.kind === "transition") {
    const from = owners.clips.findIndex((clip) => clip.id === anchor.fromClipId);
    const to = owners.clips.findIndex((clip) => clip.id === anchor.toClipId);
    const transition = from < 0 || to < 0 ? undefined : cutTransition(owners.clips, from);
    if (transition === undefined || owners.clips[from].transition === undefined || owners.clips[from].transition.to !== anchor.toClipId) return { problem: "This sound's transition was removed." };
    // A crossfade's event is the middle of its overlap, a dip's the black cut point.
    return { time: clipStarts(owners.clips)[to] + (transition.type === "crossfade" ? transition.duration / 2 : 0) };
  }
  const overlay = owners.overlays.find((item) => item.id === anchor.overlayId);
  if (overlay === undefined) return { problem: "This sound's overlay was removed." };
  const cue = activeCues(overlay.family.cues, overlay.config.values, overlay.family.variables, overlay.config.duration).find((item) => item.id === anchor.cue);
  return cue === undefined ? { problem: "This overlay no longer has that tap." } : { time: overlay.start + cue.at };
}

// The reason a sound cannot exist on this edit, or null. A linked sound may lie outside the output; its owner must exist.
export function sfxProblem(sfx: StudioSfx, owners: SfxOwners) {
  const problem = sfxSettingsProblem({ ...sfx });
  if (problem !== null) return problem;
  const total = timelineDuration(owners.clips);
  const { timing } = sfx;
  if (!("anchor" in timing)) return timing.start >= 0 && timing.start < total && Number.isFinite(timing.start) ? null : "A sound must start inside the timeline.";
  if (!isSfxOffset(timing.offset)) return "A linked sound is at most 2 seconds from its event.";
  const event = sfxEvent(timing.anchor, owners);
  return "problem" in event ? event.problem : null;
}

export function sfxPlacement(sfx: StudioSfx, owners: SfxOwners, total: number): SfxPlacement {
  const asset = sfxAsset(sfx.asset);
  if (asset === undefined) throw new Error("Unknown sound");
  const length = sfx.outPoint - sfx.inPoint;
  const { timing } = sfx;
  let start = "anchor" in timing ? 0 : timing.start;
  if ("anchor" in timing) {
    const event = sfxEvent(timing.anchor, owners);
    if ("problem" in event) return { sfx, asset, start, length, head: 0, tail: 0, inactive: event.problem };
    start = event.time + timing.offset;
  }
  const head = Math.min(length, Math.max(0, -start));
  const tail = Math.min(length, Math.max(0, start + length - total));
  return { sfx, asset, start, length, head, tail, inactive: head + tail >= length - STUDIO_TIME_TOLERANCE ? "Outside the edit." : null };
}

export function sfxPlacements(state: SfxOwners & { sfx: StudioSfx[] }) {
  const total = timelineDuration(state.clips);
  return state.sfx.map((sfx) => sfxPlacement(sfx, state, total));
}

// What preview and export play: audible, active placements with their uncropped resolved start.
export function timelineSfx(state: SfxOwners & { sfx: StudioSfx[] }): TimelineSfx[] {
  return sfxPlacements(state).flatMap(({ sfx, start, inactive }) => sfx.muted || sfx.gain === 0 || inactive !== null ? []
    : [{ id: sfx.id, asset: sfx.asset, start, inPoint: sfx.inPoint, outPoint: sfx.outPoint, gain: sfx.gain, fadeIn: sfx.fadeIn, fadeOut: sfx.fadeOut }]);
}

// Gain at `local` seconds into the retained span [0, outPoint - inPoint): fades run over the retained sound itself, wherever the output boundary cuts it.
export function sfxEnvelope(sound: Pick<TimelineSfx, "inPoint" | "outPoint" | "gain" | "fadeIn" | "fadeOut">, local: number) {
  const length = sound.outPoint - sound.inPoint;
  if (local < 0 || local >= length) return 0;
  return sound.gain * (sound.fadeIn > 0 ? Math.min(1, local / sound.fadeIn) : 1) * (sound.fadeOut > 0 ? Math.min(1, (length - local) / sound.fadeOut) : 1);
}

// Absolute starts follow a time warp (silence removal, Rapid intro); linked sounds follow their owners instead.
export function movedSfx(sounds: StudioSfx[], move: (time: number) => number): StudioSfx[] {
  return sounds.map((sound) => "anchor" in sound.timing ? sound : { ...sound, timing: { start: move(sound.timing.start) } });
}

// A transition's sounds follow it when its clips are split into fragments: the cut now lies between the last fragment of the outgoing clip and the first of the incoming one.
export function retargetedSfx(sounds: StudioSfx[], clips: SfxOwners["clips"], owners: ReadonlyMap<string, string>): StudioSfx[] {
  return sounds.map((sound) => {
    const { timing } = sound;
    if (!("anchor" in timing) || timing.anchor.kind !== "transition") return sound;
    const { fromClipId, toClipId } = timing.anchor;
    const from = clips.filter((clip) => owners.get(clip.id) === fromClipId).at(-1);
    const to = clips.find((clip) => owners.get(clip.id) === toClipId);
    return from === undefined || to === undefined || (from.id === fromClipId && to.id === toClipId) ? sound
      : { ...sound, timing: { ...timing, anchor: { kind: "transition" as const, fromClipId: from.id, toClipId: to.id } } };
  });
}

// Sounds whose owner or event is gone leave with it, and a manual start beyond a shortened output moves to where the whole sound still fits.
export function settledSfx(state: SfxOwners & { sfx: StudioSfx[] }) {
  const total = timelineDuration(state.clips);
  let dropped = 0;
  let moved = 0;
  const sfx = state.sfx.flatMap((sound): StudioSfx[] => {
    const { timing } = sound;
    if (total === 0 || ("anchor" in timing && "problem" in sfxEvent(timing.anchor, state))) { dropped++; return []; }
    if ("anchor" in timing || timing.start < total) return [sound];
    moved++;
    return [{ ...sound, timing: { start: Math.max(0, total - (sound.outPoint - sound.inPoint)) } }];
  });
  return { sfx: dropped === 0 && moved === 0 ? state.sfx : sfx, dropped, moved };
}

function indexOfId(items: readonly { id: string }[], id: string) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("A sound's owner is missing");
  return index;
}

// Saved rows refer to owners by index: titles and overlays in document order, transitions by both clip indices of the canonical (V1 then V2) clip list.
export function projectSfx(sounds: StudioSfx[], owners: SfxOwners): ProjectSfx[] {
  return sounds.map(({ asset, inPoint, outPoint, gain, muted, fadeIn, fadeOut, timing, auto }) => {
    const settings = { asset, inPoint, outPoint, gain, muted, fadeIn, fadeOut };
    const origin = auto === undefined ? {} : { auto };
    if (!("anchor" in timing)) return { ...settings, start: timing.start, ...origin };
    const { anchor, offset } = timing;
    const saved: ProjectSfxAnchor = anchor.kind === "title-enter" ? { kind: anchor.kind, text: indexOfId(owners.texts, anchor.textId) }
      : anchor.kind === "transition" ? { kind: anchor.kind, from: indexOfId(owners.clips, anchor.fromClipId), to: indexOfId(owners.clips, anchor.toClipId) }
        : { kind: anchor.kind, overlay: indexOfId(owners.overlays, anchor.overlayId), cue: anchor.cue };
    return { ...settings, anchor: saved, offset, ...origin };
  });
}

// Opening allocates fresh runtime ids for every owner first, then rebuilds each sound's reference to them.
export function documentSfx(rows: ProjectSfx[], ids: { clips: string[]; texts: string[]; overlays: string[] }): StudioSfx[] {
  return rows.map((row): StudioSfx => {
    const { asset, inPoint, outPoint, gain, muted, fadeIn, fadeOut, auto } = row;
    const sound = { id: crypto.randomUUID(), asset, inPoint, outPoint, gain, muted, fadeIn, fadeOut, ...(auto === undefined ? {} : { auto }) };
    if (row.anchor === undefined) return { ...sound, timing: { start: row.start } };
    const { anchor, offset } = row;
    const linked: SfxAnchor = anchor.kind === "title-enter" ? { kind: anchor.kind, textId: ids.texts[anchor.text] }
      : anchor.kind === "transition" ? { kind: anchor.kind, fromClipId: ids.clips[anchor.from], toClipId: ids.clips[anchor.to] }
        : { kind: anchor.kind, overlayId: ids.overlays[anchor.overlay], cue: anchor.cue };
    return { ...sound, timing: { anchor: linked, offset } };
  });
}
