// Presence tracking for focus sessions. Pure: takes "was a person seen in this frame" samples and
// decides when the user has left or come back, with hysteresis so a blink, a head turn or a
// dropped frame never pauses the timer.

export interface PresenceConfig {
  /** No person seen for this long => the user is away. */
  awayAfterMs: number;
  /** A person seen continuously for this long after being away => the user is back. */
  backAfterMs: number;
}

export const DEFAULT_PRESENCE: PresenceConfig = { awayAfterMs: 6000, backAfterMs: 1500 };

export type PresenceEvent = 'left' | 'returned' | null;

export interface PresenceTracker {
  update(seen: boolean, now: number): { away: boolean; event: PresenceEvent; awayForMs: number };
  reset(now: number): void;
  readonly away: boolean;
}

export function createPresenceTracker(cfg: PresenceConfig = DEFAULT_PRESENCE, start = 0): PresenceTracker {
  let away = false;
  let lastSeen = start;
  let awaySince = 0;
  let backSince: number | null = null;

  return {
    get away() { return away; },
    reset(now) { away = false; lastSeen = now; backSince = null; awaySince = 0; },
    update(seen, now) {
      let event: PresenceEvent = null;
      if (seen) {
        lastSeen = now;
        if (away) {
          if (backSince === null) backSince = now;
          if (now - backSince >= cfg.backAfterMs) {
            away = false; backSince = null; event = 'returned';
          }
        }
      } else {
        backSince = null;
        if (!away && now - lastSeen >= cfg.awayAfterMs) {
          away = true; awaySince = lastSeen; event = 'left';
        }
      }
      return { away, event, awayForMs: away ? now - awaySince : 0 };
    },
  };
}
