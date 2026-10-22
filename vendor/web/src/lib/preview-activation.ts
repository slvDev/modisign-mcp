// generated from the Modisign monorepo, do not edit
interface Transport { activate(): Promise<void>; stop(): void; silence(): void }

let current: Transport | null = null;

// Studio's one Program preview; transport controls call `activatePreview` and `stopPreview` synchronously inside their click/key event.
export function registerPreviewActivation(transport: Transport) {
  current = transport;
  return () => { if (current === transport) current = null; };
}

export function activatePreview() {
  return current === null ? Promise.resolve() : current.activate();
}

// Halts and silences every native slot at once; never waits for rendering.
export function stopPreview() {
  if (current !== null) current.stop();
}

// An export starts: placed sounds and any audition go quiet until the transport next moves.
export function silencePreview() {
  if (current !== null) current.silence();
}
