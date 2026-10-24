// Short synthesized beeps (no audio files). The AudioContext is created lazily and should first be
// touched from a user gesture (the Start button) so browsers allow playback.

let ctx: AudioContext | null = null;

export function primeAudio(): void {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio unavailable */ }
}

export type BeepKind = 'warning' | 'penalty' | 'away' | 'back' | 'done';

const PATTERNS: Record<BeepKind, { f: number; d: number }[]> = {
  warning: [{ f: 880, d: 0.14 }, { f: 880, d: 0.14 }],
  penalty: [{ f: 440, d: 0.2 }, { f: 330, d: 0.2 }, { f: 220, d: 0.35 }],
  away: [{ f: 520, d: 0.18 }, { f: 390, d: 0.22 }],
  back: [{ f: 520, d: 0.12 }, { f: 780, d: 0.18 }],
  done: [{ f: 523, d: 0.15 }, { f: 659, d: 0.15 }, { f: 784, d: 0.3 }],
};

export function playBeep(kind: BeepKind): void {
  if (!ctx) return;
  try {
    let t = ctx.currentTime + 0.02;
    for (const { f, d } of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'penalty' ? 'sawtooth' : 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + d + 0.02);
      t += d + 0.06;
    }
  } catch { /* ignore */ }
}
