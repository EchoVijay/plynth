import { describe, expect, it } from 'vitest';
import {
  buildAutoEvents, buildMovePatch, expandOccurrences, getRange, layoutSegments, minToTime, navigate,
  plannedMinutes, rangeLabel, segmentFor, segmentsForDay, toMin,
} from './schedule';
import type { CalEvent } from './types';

function ev(p: Partial<CalEvent> & { id: string }): CalEvent {
  return {
    title: p.id, description: null, location: null, event_date: '2026-10-21', event_time: null,
    end_date: null, end_time: null, is_all_day: false, completed: false, category: 'work',
    recurrence: null, color: null, reminder_minutes: [], is_auto: false, source_type: null, ...p,
  };
}

describe('ranges', () => {
  it('week starts on Sunday', () => {
    const r = getRange('week', '2026-10-24'); // Saturday
    expect(r.start).toBe('2026-10-18');
    expect(r.end).toBe('2026-10-24');
    expect(r.days).toHaveLength(7);
  });

  it('work week is Monday to Friday', () => {
    const r = getRange('workweek', '2026-10-21');
    expect(r.days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('month grid covers whole weeks', () => {
    const r = getRange('month', '2026-10-15');
    expect(r.start).toBe('2026-09-27');
    expect(r.days.length % 7).toBe(0);
    expect(r.days).toContain('2026-10-31');
  });

  it('navigates by view unit', () => {
    expect(navigate('day', '2026-10-24', 1)).toBe('2026-10-25');
    expect(navigate('week', '2026-10-24', -1)).toBe('2026-10-17');
    expect(navigate('month', '2026-01-31', 1)).toBe('2026-02-28');
  });

  it('labels ranges like Teams', () => {
    expect(rangeLabel('week', getRange('week', '2026-10-21'), '2026-10-21')).toBe('October 18 – 24, 2026');
    expect(rangeLabel('week', getRange('week', '2026-09-30'), '2026-09-30')).toBe('Sep 27 – Oct 3, 2026');
  });
});

describe('time helpers', () => {
  it('round-trips minutes', () => {
    expect(toMin('09:30:00')).toBe(570);
    expect(minToTime(570)).toBe('09:30');
    expect(minToTime(1440)).toBe('23:59');
  });
});

describe('recurrence expansion', () => {
  it('returns single events only inside the range', () => {
    const events = [ev({ id: 'a' }), ev({ id: 'b', event_date: '2026-11-30' })];
    expect(expandOccurrences(events, '2026-10-18', '2026-10-24').map(o => o.event.id)).toEqual(['a']);
  });

  it('expands weekly events that started long ago', () => {
    const e = ev({ id: 'w', event_date: '2025-01-06', recurrence: 'weekly' }); // Mondays
    const occ = expandOccurrences([e], '2026-10-18', '2026-10-31');
    expect(occ.map(o => o.startDate)).toEqual(['2026-10-19', '2026-10-26']);
  });

  it('expands daily, monthly and yearly events', () => {
    const daily = expandOccurrences([ev({ id: 'd', recurrence: 'daily' })], '2026-10-18', '2026-10-24');
    expect(daily).toHaveLength(4); // 21..24
    const monthly = expandOccurrences([ev({ id: 'm', event_date: '2026-01-31', recurrence: 'monthly' })], '2026-02-01', '2026-02-28');
    expect(monthly.map(o => o.startDate)).toEqual(['2026-02-28']);
    const yearly = expandOccurrences([ev({ id: 'y', event_date: '2000-10-22', recurrence: 'yearly' })], '2026-10-18', '2026-10-24');
    expect(yearly.map(o => o.startDate)).toEqual(['2026-10-22']);
  });

  it('does not show a recurring event before it starts', () => {
    const e = ev({ id: 'f', event_date: '2026-11-01', recurrence: 'daily' });
    expect(expandOccurrences([e], '2026-10-18', '2026-10-24')).toHaveLength(0);
  });

  it('includes multi-day events that overlap the range', () => {
    const e = ev({ id: 'x', event_date: '2026-10-16', end_date: '2026-10-19', event_time: '10:00' });
    expect(expandOccurrences([e], '2026-10-18', '2026-10-24')).toHaveLength(1);
  });
});

describe('segments', () => {
  it('defaults to one hour when there is no end time', () => {
    const occ = expandOccurrences([ev({ id: 'a', event_time: '09:00' })], '2026-10-21', '2026-10-21')[0];
    const seg = segmentFor(occ, '2026-10-21')!;
    expect([seg.startMin, seg.endMin]).toEqual([540, 600]);
  });

  it('treats untimed and all-day events as all-day', () => {
    const occs = expandOccurrences([ev({ id: 'a' }), ev({ id: 'b', event_time: '09:00', is_all_day: true })], '2026-10-21', '2026-10-21');
    expect(occs.every(o => segmentFor(o, '2026-10-21')!.allDay)).toBe(true);
  });

  it('clips multi-day timed events per day', () => {
    const e = ev({ id: 'm', event_date: '2026-10-21', event_time: '22:00', end_date: '2026-10-23', end_time: '08:00' });
    const occs = expandOccurrences([e], '2026-10-21', '2026-10-23');
    const [d1, d2, d3] = ['2026-10-21', '2026-10-22', '2026-10-23'].map(d => segmentsForDay(occs, d)[0]);
    expect([d1.startMin, d1.endMin]).toEqual([1320, 1440]);
    expect([d2.startMin, d2.endMin]).toEqual([0, 1440]);
    expect([d3.startMin, d3.endMin]).toEqual([0, 480]);
  });

  it('sums planned work minutes ignoring all-day and auto events', () => {
    const occs = expandOccurrences([
      ev({ id: 'a', event_time: '09:00', end_time: '10:30' }),
      ev({ id: 'b' }),
      ev({ id: 'c', event_time: '12:00', is_auto: true }),
    ], '2026-10-21', '2026-10-21');
    expect(plannedMinutes(occs, ['2026-10-21'])).toBe(90);
  });
});

describe('layout', () => {
  const seg = (id: string, s: string, e: string) => {
    const occ = expandOccurrences([ev({ id, event_time: s, end_time: e })], '2026-10-21', '2026-10-21')[0];
    return segmentFor(occ, '2026-10-21')!;
  };

  it('puts overlapping blocks side by side', () => {
    const out = layoutSegments([seg('a', '09:00', '10:00'), seg('b', '09:30', '10:30'), seg('c', '11:00', '12:00')]);
    const by = Object.fromEntries(out.map(o => [o.occ.event.id, o]));
    expect([by.a.col, by.a.cols]).toEqual([0, 2]);
    expect([by.b.col, by.b.cols]).toEqual([1, 2]);
    expect([by.c.col, by.c.cols]).toEqual([0, 1]);
  });

  it('reuses a free column inside a cluster', () => {
    const out = layoutSegments([seg('a', '09:00', '11:00'), seg('b', '09:00', '10:00'), seg('c', '10:00', '11:00')]);
    const by = Object.fromEntries(out.map(o => [o.occ.event.id, o]));
    expect(by.c.col).toBe(by.b.col);
    expect(by.a.cols).toBe(2);
  });
});

describe('moving', () => {
  it('shifts the series by the day delta and sets the new time', () => {
    const e = ev({ id: 'r', event_date: '2026-10-05', recurrence: 'weekly', event_time: '09:00' });
    const patch = buildMovePatch(e, '2026-10-19', { date: '2026-10-20', startMin: 600, endMin: 660 });
    expect(patch).toMatchObject({ event_date: '2026-10-06', event_time: '10:00', end_time: '11:00', end_date: null });
  });
});

describe('auto events', () => {
  it('creates EMI events clamped to month length', () => {
    const out = buildAutoEvents([{ id: 'l', name: 'Car', emi_amount: 1000, emi_due_day: 31 }], [], '2026-02-01', '2026-02-28');
    expect(out.map(o => o.event_date)).toEqual(['2026-02-28']);
  });

  it('predicts periods from cycle history', () => {
    const cycles = [{ start_date: '2026-10-01' }, { start_date: '2026-09-03' }, { start_date: '2026-08-06' }];
    const out = buildAutoEvents([], cycles, '2026-10-25', '2026-11-05');
    expect(out.map(o => o.event_date)).toEqual(['2026-10-29']);
  });
});
