// Phone-use guard: three warnings, then a penalty. Pure: fed "was a phone seen in this frame" samples.
//
// An "incident" is a phone seen (allowing brief detector flicker) for `confirmMs`. After an
// incident the guard is disarmed until the phone has been out of view for `rearmAbsentMs`, or
// `nagMs` has passed with it still in view, so one long phone call is not counted every frame.

export interface PhoneGuardConfig {
  confirmMs: number;
  gapMs: number;
  rearmAbsentMs: number;
  nagMs: number;
  maxWarnings: number;
  penaltySeconds: number;
}

export const DEFAULT_PHONE_GUARD: PhoneGuardConfig = {
  confirmMs: 2500,
  gapMs: 1500,
  rearmAbsentMs: 4000,
  nagMs: 20000,
  maxWarnings: 3,
  penaltySeconds: 10 * 60,
};

export type PhoneEvent =
  | { type: 'warning'; n: number; of: number }
  | { type: 'penalty'; seconds: number };

export interface PhoneGuard {
  update(seen: boolean, now: number): PhoneEvent | null;
  reset(): void;
  readonly warnings: number;
}

export function createPhoneGuard(cfg: PhoneGuardConfig = DEFAULT_PHONE_GUARD): PhoneGuard {
  let warnings = 0;
  let firstSeen: number | null = null;
  let lastSeen = -Infinity;
  let armed = true;
  let lastIncident = -Infinity;

  return {
    get warnings() { return warnings; },
    reset() { warnings = 0; firstSeen = null; lastSeen = -Infinity; armed = true; lastIncident = -Infinity; },
    update(seen, now) {
      if (seen) {
        if (firstSeen === null || now - lastSeen > cfg.gapMs) firstSeen = now;
        lastSeen = now;
      } else if (firstSeen !== null && now - lastSeen > cfg.gapMs) {
        firstSeen = null;
      }

      if (!armed) {
        const absentLongEnough = !seen && now - lastSeen >= cfg.rearmAbsentMs;
        const nag = seen && now - lastIncident >= cfg.nagMs;
        if (absentLongEnough || nag) armed = true;
      }

      if (armed && seen && firstSeen !== null && now - firstSeen >= cfg.confirmMs) {
        armed = false;
        lastIncident = now;
        if (warnings < cfg.maxWarnings) {
          warnings += 1;
          return { type: 'warning', n: warnings, of: cfg.maxWarnings };
        }
        warnings = 0;
        return { type: 'penalty', seconds: cfg.penaltySeconds };
      }
      return null;
    },
  };
}
