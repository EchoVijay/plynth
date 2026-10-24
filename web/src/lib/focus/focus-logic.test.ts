import { describe, expect, it } from 'vitest';
import { createPresenceTracker } from './presence';
import { createPhoneGuard } from './phone-guard';
import { createSessionClock } from './session-clock';
import { appendLog, clearLog, DEFAULT_PREFS, loadLog, loadPrefs, savePrefs, summarizeLog, type MonitorLogEntry } from './local-store';

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('presence tracker', () => {
  it('stays present through short gaps', () => {
    const p = createPresenceTracker({ awayAfterMs: 6000, backAfterMs: 1500 }, 0);
    for (let t = 0; t <= 5000; t += 500) expect(p.update(false, t).away).toBe(false);
  });

  it('flags away after the grace period, once', () => {
    const p = createPresenceTracker({ awayAfterMs: 6000, backAfterMs: 1500 }, 0);
    let left = 0;
    for (let t = 500; t <= 12000; t += 500) if (p.update(false, t).event === 'left') left++;
    expect(left).toBe(1);
    expect(p.away).toBe(true);
  });

  it('only returns after the user is seen continuously', () => {
    const p = createPresenceTracker({ awayAfterMs: 2000, backAfterMs: 1500 }, 0);
    for (let t = 500; t <= 3000; t += 500) p.update(false, t);
    expect(p.away).toBe(true);
    expect(p.update(true, 3500).away).toBe(true);
    p.update(false, 4000); // flicker resets the return window
    expect(p.update(true, 4500).away).toBe(true);
    expect(p.update(true, 5500).away).toBe(true);
    const r = p.update(true, 6100);
    expect(r.event).toBe('returned');
    expect(r.away).toBe(false);
  });

  it('reports how long the user has been away', () => {
    const p = createPresenceTracker({ awayAfterMs: 2000, backAfterMs: 1000 }, 0);
    p.update(true, 1000);
    p.update(false, 3500);
    expect(p.update(false, 11000).awayForMs).toBe(10000);
  });
});

describe('phone guard', () => {
  const cfg = { confirmMs: 2000, gapMs: 1000, rearmAbsentMs: 3000, nagMs: 20000, maxWarnings: 3, penaltySeconds: 600 };

  function feed(g: ReturnType<typeof createPhoneGuard>, from: number, to: number, seen: boolean, step = 500) {
    const ev = [];
    for (let t = from; t <= to; t += step) { const e = g.update(seen, t); if (e) ev.push({ t, e }); }
    return ev;
  }

  it('ignores a phone seen only briefly', () => {
    const g = createPhoneGuard(cfg);
    expect(feed(g, 0, 1500, true)).toHaveLength(0);
  });

  it('warns after sustained use and counts 1, 2, 3', () => {
    const g = createPhoneGuard(cfg);
    const w: number[] = [];
    let t = 0;
    for (let i = 0; i < 3; i++) {
      for (const { e } of feed(g, t, t + 2500, true)) if (e.type === 'warning') w.push(e.n);
      t += 3000;
      feed(g, t, t + 4000, false);
      t += 4500;
    }
    expect(w).toEqual([1, 2, 3]);
  });

  it('applies the 10 minute penalty on the incident after the 3rd warning, then starts over', () => {
    const g = createPhoneGuard(cfg);
    const events: string[] = [];
    let t = 0;
    for (let i = 0; i < 5; i++) {
      for (const { e } of feed(g, t, t + 2500, true)) events.push(e.type === 'warning' ? `w${e.n}` : `p${e.seconds}`);
      t += 3000;
      feed(g, t, t + 4000, false);
      t += 4500;
    }
    expect(events).toEqual(['w1', 'w2', 'w3', 'p600', 'w1']);
  });

  it('does not re-warn every frame while the phone stays in view', () => {
    const g = createPhoneGuard(cfg);
    const ev = feed(g, 0, 15000, true);
    expect(ev).toHaveLength(1);
  });

  it('nags again if the phone never leaves', () => {
    const g = createPhoneGuard(cfg);
    const ev = feed(g, 0, 45000, true);
    expect(ev.length).toBeGreaterThanOrEqual(2);
  });

  it('tolerates detector flicker inside a single incident', () => {
    const g = createPhoneGuard(cfg);
    const ev = [];
    for (let t = 0; t <= 3000; t += 500) { const e = g.update(t % 1000 !== 0, t); if (e) ev.push(e); }
    expect(ev).toHaveLength(1);
  });
});

describe('session clock', () => {
  it('counts only running time', () => {
    const c = createSessionClock(3600);
    c.start(0);
    expect(c.elapsedSeconds(10_000)).toBe(10);
    c.pause(10_000);
    expect(c.elapsedSeconds(500_000)).toBe(10);
    c.resume(500_000);
    expect(c.elapsedSeconds(505_000)).toBe(15);
    expect(c.remainingSeconds(505_000)).toBe(3585);
  });

  it('a penalty extends the target by 10 minutes', () => {
    const c = createSessionClock(3600);
    c.start(0);
    c.addPenalty(600);
    expect(c.targetSeconds).toBe(4200);
    expect(c.penaltySeconds).toBe(600);
    expect(c.remainingSeconds(60_000)).toBe(4140);
  });

  it('stopwatch has no target, penalty is only recorded', () => {
    const c = createSessionClock(0);
    c.start(0);
    c.addPenalty(600);
    expect(c.targetSeconds).toBe(0);
    expect(c.penaltySeconds).toBe(600);
    expect(c.elapsedSeconds(90_000)).toBe(90);
  });

  it('start() resets a previous session', () => {
    const c = createSessionClock(60);
    c.start(0); c.addPenalty(600); c.pause(30_000);
    c.start(100_000);
    expect(c.targetSeconds).toBe(60);
    expect(c.elapsedSeconds(105_000)).toBe(5);
  });
});

describe('browser-local storage', () => {
  it('defaults to monitoring OFF (opt-in) and round-trips prefs', () => {
    const s = fakeStore();
    expect(loadPrefs(s).monitor).toBe(false);
    savePrefs({ ...DEFAULT_PREFS, monitor: true, phone: false }, s);
    const p = loadPrefs(s);
    expect(p.monitor).toBe(true);
    expect(p.phone).toBe(false);
    expect(p.presence).toBe(true);
  });

  it('survives corrupt data', () => {
    const s = fakeStore();
    s.setItem('plynth.focus.monitor.prefs.v1', '{nope');
    s.setItem('plynth.focus.monitor.log.v1', '"x"');
    expect(loadPrefs(s)).toEqual(DEFAULT_PREFS);
    expect(loadLog(s)).toEqual([]);
  });

  it('keeps a capped, clearable log', () => {
    const s = fakeStore();
    const e = (i: number): MonitorLogEntry => ({ id: String(i), at: '2026-10-25T00:00:00Z', task: 't', plannedSeconds: 60, awayCount: 1, awaySeconds: 30, phoneWarnings: 2, penalties: 1, penaltySeconds: 600, outcome: 'completed' });
    for (let i = 0; i < 120; i++) appendLog(e(i), s);
    expect(loadLog(s)).toHaveLength(100);
    expect(loadLog(s)[0].id).toBe('119');
    expect(summarizeLog(loadLog(s).slice(0, 2))).toEqual({ sessions: 2, awaySeconds: 60, phoneWarnings: 4, penalties: 2 });
    clearLog(s);
    expect(loadLog(s)).toEqual([]);
  });
});
