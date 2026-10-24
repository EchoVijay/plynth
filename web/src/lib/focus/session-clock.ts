// Timestamp-based session clock. Counting ticks (setInterval +1) drifts and is throttled by browsers
// in background tabs, so elapsed time is derived from timestamps instead.

export interface SessionClock {
  start(now: number): void;
  pause(now: number): void;
  resume(now: number): void;
  addPenalty(seconds: number): void;
  reset(): void;
  elapsedSeconds(now: number): number;
  remainingSeconds(now: number): number;
  readonly targetSeconds: number;
  readonly penaltySeconds: number;
  readonly running: boolean;
}

/** targetSeconds = 0 means open-ended (stopwatch). */
export function createSessionClock(initialTargetSeconds: number): SessionClock {
  let target = initialTargetSeconds;
  let penalty = 0;
  let accumulated = 0;
  let since: number | null = null;

  const elapsedMs = (now: number) => accumulated + (since === null ? 0 : Math.max(0, now - since));

  return {
    get targetSeconds() { return target; },
    get penaltySeconds() { return penalty; },
    get running() { return since !== null; },
    start(now) { accumulated = 0; penalty = 0; target = initialTargetSeconds; since = now; },
    pause(now) { if (since !== null) { accumulated += Math.max(0, now - since); since = null; } },
    resume(now) { if (since === null) since = now; },
    addPenalty(seconds) { if (target > 0) target += seconds; penalty += seconds; },
    reset() { accumulated = 0; since = null; penalty = 0; target = initialTargetSeconds; },
    elapsedSeconds(now) { return Math.floor(elapsedMs(now) / 1000); },
    remainingSeconds(now) {
      return target > 0 ? Math.max(0, target - Math.floor(elapsedMs(now) / 1000)) : 0;
    },
  };
}
