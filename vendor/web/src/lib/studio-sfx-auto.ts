// generated from the Modisign monorepo, do not edit
import { hash32 } from "@/lib/hash32";
import { SFX_OFFSET, SFX_PACK, SFX_RATE, SFX_ASSETS, type SfxAsset, type SfxCategory } from "@/lib/studio-project";
import { clipStarts, cutTransition, timelineDuration } from "@/lib/video-timeline";
import { motionPose } from "@/lib/studio-motion";
import { textSpan } from "@/lib/studio-text";
import { newSfx, sfxEvent, sfxPlacement, sfxPlacements, type SfxAnchor, type SfxOwners, type StudioSfx } from "@/lib/studio-sfx";
import { activeCues } from "@/lib/values";
import { required } from "@/lib/studio-state";

export const AUTO_EVENTS = ["title", "transition", "cta-tap"] as const;
export const AUTO_INTENSITIES = ["subtle", "normal"] as const;
export const AUTO_TITLE_SOUNDS = ["pop", "typing", "sparkle"] as const;
export type AutoEventKind = typeof AUTO_EVENTS[number];
export type AutoSfxOptions = { events: AutoEventKind[]; seed: number; intensity: typeof AUTO_INTENSITIES[number]; titleSound: typeof AUTO_TITLE_SOUNDS[number] };
export const DEFAULT_AUTO_SFX_OPTIONS: AutoSfxOptions = { events: [...AUTO_EVENTS], seed: 58, intensity: "normal", titleSound: "pop" };
export type AutoSfxState = SfxOwners & { sfx: StudioSfx[] };
// `unselectedReason` says why a row is off by default; `warnings` never unselect it. Skipped events have no row.
export type AutoSfxCandidate = { key: string; kind: AutoEventKind; owner: string; reason: string; eventTime: number; start: number; end: number; head: number; tail: number; sfx: StudioSfx; selected: boolean; unselectedReason: string | null; warnings: string[] };
export type AutoSfxExclusion = { key: string; kind: AutoEventKind; owner: string; reason: string };
export type AutoSfxReview = { options: AutoSfxOptions; revision: string; candidates: AutoSfxCandidate[]; exclusions: AutoSfxExclusion[]; replace: string[] };
export type AutoSfxAction = { type: "apply-auto-sfx"; rows: StudioSfx[]; replace: string[]; revision: string };

export const AUTO_SFX_SPACING = 0.25;
export const AUTO_SFX_STALE = "The edit changed since these suggestions were made. Review the updated suggestions.";
const PRIORITY: Record<AutoEventKind, number> = { "cta-tap": 0, transition: 1, title: 2 };
const KEY_ASSET = "ugc-typing-02";
const INTENSITY = { subtle: 0.7, normal: 1 };
const TITLE_CATEGORY: Record<AutoSfxOptions["titleSound"], SfxCategory> = { pop: "pop", typing: "typing", sparkle: "sparkle" };

const seconds = (value: number) => `${value.toFixed(2)} s`;

export function autoEventKey(anchor: SfxAnchor) {
  if (anchor.kind === "title-enter") return `title:${anchor.textId}`;
  return anchor.kind === "transition" ? `transition:${anchor.fromClipId}:${anchor.toClipId}` : `cta-tap:${anchor.overlayId}:${anchor.cue}`;
}

// Everything a review reads, so a review built before an edit can be told from one built after it.
export function autoSfxRevision(state: AutoSfxState) {
  const { clips, texts, overlays, sfx } = state;
  const starts = clipStarts(clips);
  return hash32(JSON.stringify([clips.map((clip, index) => [clip.id, clip.track, clip.kind, clip.label, clip.inPoint, clip.outPoint, starts[index], clip.transition]),
    texts.map((title) => [title.id, title.text, title.timing, title.motion, title.reveal, title.animationOffset]),
    overlays.map((overlay) => [overlay.id, overlay.start, overlay.config, overlay.motion]), sfx])).toString(16);
}

type Pending = { key: string; kind: AutoEventKind; owner: string; reason: string; anchor: SfxAnchor; pool: SfxAsset[]; hidden: string | null; check: (time: number) => string[] };

function pending(state: AutoSfxState, options: AutoSfxOptions, exclusions: AutoSfxExclusion[]) {
  const items: Pending[] = [];
  const pool = (category: SfxCategory) => SFX_ASSETS.filter((asset) => asset.category === category);
  if (options.events.includes("title")) {
    for (const title of state.texts) {
      const shown = title.text.length > 24 ? `${title.text.slice(0, 24)}...` : title.text;
      const anchor: SfxAnchor = { kind: "title-enter", textId: title.id };
      const origin = title.animationOffset === undefined ? 0 : title.animationOffset;
      // A split or silence fragment gets its own copy of a title (`<clip>/<title>` id); its entrance is offered, not preselected.
      items.push({ key: autoEventKey(anchor), kind: "title", owner: shown === "" ? "Title" : `Title "${shown}"`, reason: "Title appears", anchor, pool: pool(TITLE_CATEGORY[options.titleSound]), hidden: title.id.includes("/") ? "This title continues across a split, so it is not preselected." : null,
        check: (time) => {
          const pose = motionPose(title.motion, time - textSpan(title, state.clips).start + origin);
          if (Math.abs(pose.x) >= 0.5 || Math.abs(pose.y) >= 0.5) return ["Check timing: this title starts off screen, so its sound may not match what you see."];
          return pose.x === 0 && pose.y === 0 && pose.scale === 1 && pose.rotation === 0 ? [] : ["Check timing: this title moves or scales as it appears."];
        } });
    }
  }
  if (options.events.includes("transition")) {
    state.clips.forEach((clip, index) => {
      const transition = cutTransition(state.clips, index);
      if (transition === undefined || clip.transition === undefined) return;
      const anchor: SfxAnchor = { kind: "transition", fromClipId: clip.id, toClipId: clip.transition.to };
      items.push({ key: autoEventKey(anchor), kind: "transition", owner: `${transition.type === "crossfade" ? "Crossfade" : "Dip to black"}, ${clip.label} to ${required(state.clips, clip.transition.to).label}`,
        reason: transition.type === "crossfade" ? "Crossfade midpoint" : "Dip cut point", anchor, pool: pool("whoosh"), hidden: null, check: () => [] });
    });
  }
  if (options.events.includes("cta-tap")) {
    for (const overlay of state.overlays) {
      const cues = activeCues(overlay.family.cues, overlay.config.values, overlay.family.variables, overlay.config.duration);
      if (cues.length === 0) exclusions.push({ key: `cta-tap:${overlay.id}`, kind: "cta-tap", owner: `${overlay.family.name} overlay`, reason: "This overlay has no tap or key press to match, so no sound is placed." });
      for (const cue of cues) {
        const anchor: SfxAnchor = { kind: "overlay-cue", overlayId: overlay.id, cue: cue.id };
        items.push({ key: autoEventKey(anchor), kind: "cta-tap", owner: `${overlay.family.name} ${cue.kind === "key-press" ? "key press" : "tap"}`, reason: cue.kind === "key-press" ? "Key press lands" : "Tap lands", anchor,
          pool: cue.kind === "key-press" ? SFX_ASSETS.filter((asset) => asset.id === KEY_ASSET) : pool("click"),
          hidden: motionPose(overlay.motion, cue.at).opacity > 0 ? null : "Hidden: this overlay is fully transparent at this moment.", check: () => [] });
      }
    }
  }
  return items;
}

// The proposed sounds for the chosen events plus every event that gets none and why. Reads the document, changes nothing.
export function buildAutoSfx(state: AutoSfxState, options: AutoSfxOptions): AutoSfxReview {
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error("The seed is a whole number from 0 to 4294967295");
  const total = timelineDuration(state.clips);
  const exclusions: AutoSfxExclusion[] = [];
  const managed = state.sfx.filter((sound) => sound.auto !== undefined);
  const others = state.sfx.filter((sound) => sound.auto === undefined);
  const reserved = new Set(others.flatMap((sound) => "anchor" in sound.timing ? [autoEventKey(sound.timing.anchor)] : []));
  const taken = new Set(state.sfx.map((sound) => sound.id));
  const existing = sfxPlacements({ ...state, sfx: others }).filter(({ sfx, inactive }) => inactive === null && !sfx.muted && sfx.gain > 0);
  const found: AutoSfxCandidate[] = [];
  for (const item of pending(state, options, exclusions)) {
    const skip = (reason: string) => exclusions.push({ key: item.key, kind: item.kind, owner: item.owner, reason });
    if (reserved.has(item.key)) { skip("Already has an edited sound."); continue; }
    const event = sfxEvent(item.anchor, state);
    if ("problem" in event) { skip(event.problem); continue; }
    const asset = item.pool[hash32(`${options.seed}:${item.key}`) % item.pool.length];
    // A managed row keeps its id across rebuilds, so an unchanged set compares equal after splits and reorders.
    const prior = managed.find((sound) => "anchor" in sound.timing && autoEventKey(sound.timing.anchor) === item.key);
    let id = prior === undefined ? `auto-${item.key}` : prior.id;
    for (let copy = 2; prior === undefined && taken.has(id); copy++) id = `auto-${item.key}~${copy}`;
    taken.add(id);
    const base = newSfx(id, asset.id, 0);
    // The sound's attack meets the event, wherever the trimmed sound starts.
    const offset = Math.min(SFX_OFFSET.max, Math.max(SFX_OFFSET.min, -(asset.syncSample / SFX_RATE - base.inPoint)));
    const sfx: StudioSfx = { ...base, gain: Math.round(asset.defaultGain * INTENSITY[options.intensity] * 1e4) / 1e4, timing: { anchor: item.anchor, offset }, auto: SFX_PACK };
    const placement = sfxPlacement(sfx, state, total);
    if (placement.inactive !== null) { skip("The sound would fall outside the edit."); continue; }
    const collision = existing.some((other) => other.start < event.time + AUTO_SFX_SPACING && other.start + other.length > event.time - AUTO_SFX_SPACING);
    found.push({ key: item.key, kind: item.kind, owner: item.owner, reason: item.reason, eventTime: event.time, start: placement.start, end: placement.start + placement.length, head: placement.head, tail: placement.tail, sfx,
      selected: false, unselectedReason: item.hidden !== null ? item.hidden : collision ? "Another sound already plays within 0.25 s of this event." : null,
      warnings: [...item.check(event.time), ...(placement.head > 0 ? [`The first ${seconds(placement.head)} fall before the start of the edit and are cut off.`] : []),
        ...(placement.tail > 0 ? [`The last ${seconds(placement.tail)} fall after the end of the edit and are cut off.`] : [])] });
  }
  const chosen: AutoSfxCandidate[] = [];
  for (const candidate of [...found].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.eventTime - b.eventTime || a.key.localeCompare(b.key))) {
    if (candidate.unselectedReason !== null) continue;
    const winner = chosen.find((other) => Math.abs(other.eventTime - candidate.eventTime) < AUTO_SFX_SPACING - 1e-6);
    if (winner === undefined) chosen.push(candidate);
    else candidate.unselectedReason = `Within 0.25 s of ${winner.owner} (${winner.reason.toLowerCase()}), which comes first.`;
  }
  for (const candidate of chosen) candidate.selected = true;
  found.sort((a, b) => a.eventTime - b.eventTime || a.key.localeCompare(b.key));
  return { options, revision: autoSfxRevision(state), candidates: found, exclusions, replace: managed.map((sound) => sound.id) };
}

// The reducer action for the chosen rows (every default-selected one without `keys`); the managed set becomes exactly these rows.
export function autoSfxAction(review: AutoSfxReview, keys?: ReadonlySet<string>): AutoSfxAction {
  return { type: "apply-auto-sfx", rows: review.candidates.filter((candidate) => keys === undefined ? candidate.selected : keys.has(candidate.key)).map((candidate) => candidate.sfx), replace: review.replace, revision: review.revision };
}

// Replaced rows keep their place when the same id comes back, so an unchanged set returns the very same array.
export function appliedAutoSfx(sounds: StudioSfx[], rows: StudioSfx[], replace: readonly string[]) {
  const dropped = new Set(replace);
  for (const row of rows) if (row.auto === undefined || !("anchor" in row.timing)) throw new Error("Automatic sounds are linked to an event");
  for (const id of dropped) if (sounds.find((sound) => sound.id === id)?.auto === undefined) throw new Error("Only automatic sounds can be replaced");
  const incoming = new Map(rows.map((row) => [row.id, row]));
  if (incoming.size !== rows.length) throw new Error("Sound ids must be unique");
  const placed = new Set<string>();
  const next = sounds.flatMap((sound) => {
    if (!dropped.has(sound.id)) return [sound];
    const row = incoming.get(sound.id);
    if (row === undefined) return [];
    placed.add(sound.id);
    return [row];
  });
  for (const row of rows) if (!placed.has(row.id)) next.push(row);
  if (new Set(next.map((sound) => sound.id)).size !== next.length) throw new Error("Sound ids must be unique");
  return JSON.stringify(next) === JSON.stringify(sounds) ? sounds : next;
}
