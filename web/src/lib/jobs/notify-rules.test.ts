import { describe, expect, it } from 'vitest';
import { addDaysYmd, formatClock, greetingFor, localParts, tzOffsetMinutes, zonedToUtc } from '@shared/tz.ts';
import { diffDays, expandCalendar, isAllDayEvent, type CalendarEventLike } from '@shared/calendar-expand.ts';
import { calendarDue, calendarFireTime, dueFires, reminderLabel } from '@shared/reminder-rules.ts';

describe('tz helpers', () => {
  it('reads the local wall clock in a zone', () => {
    // 2026-10-24 18:30 UTC is 00:00 the next day in India.
    const p = localParts('Asia/Kolkata', new Date('2026-10-24T18:30:00Z'));
    expect(p).toEqual({ date: '2026-10-25', minutes: 0, dow: 0 });
    expect(localParts('UTC', new Date('2026-10-24T18:30:00Z')).date).toBe('2026-10-24');
  });

  it('falls back to Asia/Kolkata for bad zones', () => {
    expect(localParts('Nope/Zone', new Date('2026-10-24T18:30:00Z')).date).toBe('2026-10-25');
    expect(localParts(null, new Date('2026-10-24T00:00:00Z')).minutes).toBe(330);
  });

  it('computes offsets and converts local wall time to UTC', () => {
    expect(tzOffsetMinutes('Asia/Kolkata', new Date('2026-10-24T00:00:00Z'))).toBe(330);
    expect(zonedToUtc('2026-10-24', '07:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-24T01:30:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-01-01', '09:00', 'America/New_York').toISOString()).toBe('2026-01-01T14:00:00.000Z');
  });

  it('adds days across month ends and formats clocks', () => {
    expect(addDaysYmd('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(formatClock('15:05:00')).toBe('3:05 PM');
    expect(formatClock('00:00')).toBe('12:00 AM');
    expect(greetingFor(8 * 60)).toBe('Good morning');
    expect(greetingFor(20 * 60)).toBe('Good evening');
  });
});

describe('dueFires', () => {
  const all = [0, 1, 2, 3, 4, 5, 6];
  const at = (date: string, minutes: number, dow: number) => ({ date, minutes, dow });

  it('fires within the grace window and not before or long after', () => {
    expect(dueFires(at('2026-10-24', 7 * 60 + 2, 6), ['07:00:00'], all)).toEqual([{ date: '2026-10-24', time: '07:00:00' }]);
    expect(dueFires(at('2026-10-24', 6 * 60 + 58, 6), ['07:00:00'], all)).toEqual([]);
    expect(dueFires(at('2026-10-24', 7 * 60 + 45, 6), ['07:00:00'], all)).toEqual([]);
  });

  it('filters by the local weekday', () => {
    expect(dueFires(at('2026-10-24', 421, 6), ['07:00:00'], [1, 2, 3, 4, 5])).toEqual([]);
    expect(dueFires(at('2026-10-26', 421, 1), ['07:00:00'], [1, 2, 3, 4, 5])).toHaveLength(1);
  });

  it('keeps a late-evening reminder that slips past midnight on its own day', () => {
    // 23:50 on Friday 2026-10-23, observed at 00:10 on Saturday: still Friday's reminder.
    const fires = dueFires(at('2026-10-24', 10, 6), ['23:50:00'], [5]);
    expect(fires).toEqual([{ date: '2026-10-23', time: '23:50:00' }]);
    expect(dueFires(at('2026-10-24', 10, 6), ['23:50:00'], [6])).toEqual([]);
  });

  it('handles several times in one rule', () => {
    const fires = dueFires(at('2026-10-24', 12 * 60 + 5, 6), ['07:00:00', '12:00:00', '21:00:00'], all);
    expect(fires.map(f => f.time)).toEqual(['12:00:00']);
  });
});

describe('calendar reminder timing', () => {
  it('reminds N minutes before a timed event, in the user zone', () => {
    const f = calendarFireTime('2026-10-24', '15:00:00', 60, 'Asia/Kolkata');
    expect(f.startsAt!.toISOString()).toBe('2026-10-24T09:30:00.000Z');
    expect(f.at.toISOString()).toBe('2026-10-24T08:30:00.000Z');
  });

  it('reminds all-day events at 07:00 local, whole days ahead', () => {
    expect(calendarFireTime('2026-10-25', null, 1440, 'Asia/Kolkata').at.toISOString()).toBe('2026-10-24T01:30:00.000Z');
    expect(calendarFireTime('2026-10-25', null, 0, 'Asia/Kolkata').at.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  it('is due shortly after the fire time but not early, not stale, not after the event began', () => {
    const f = calendarFireTime('2026-10-24', '15:00', 60, 'Asia/Kolkata'); // fire 14:00 IST = 08:30Z
    expect(calendarDue(f, new Date('2026-10-24T08:29:00Z'))).toBe(false);
    expect(calendarDue(f, new Date('2026-10-24T08:33:00Z'))).toBe(true);
    expect(calendarDue(f, new Date('2026-10-24T09:00:00Z'))).toBe(false);
    const now = calendarFireTime('2026-10-24', '15:00', 0, 'Asia/Kolkata'); // fire at start 09:30Z
    expect(calendarDue(now, new Date('2026-10-24T09:35:00Z'))).toBe(true);
  });

  it('labels reminders', () => {
    expect(reminderLabel(0)).toBe('now');
    expect(reminderLabel(15)).toBe('in 15 min');
    expect(reminderLabel(120)).toBe('in 2 hr');
    expect(reminderLabel(1440)).toBe('in 1 day');
    expect(reminderLabel(2880)).toBe('in 2 days');
  });
});

describe('expandCalendar', () => {
  const ev = (p: Partial<CalendarEventLike> & { id: string }): CalendarEventLike => ({
    title: p.id, event_date: '2026-10-21', event_time: null, end_date: null, end_time: null, recurrence: null, ...p,
  });

  it('keeps one-off events inside the range only', () => {
    const out = expandCalendar([ev({ id: 'a' }), ev({ id: 'b', event_date: '2026-12-01' })], '2026-10-20', '2026-10-26');
    expect(out.map(o => o.event.id)).toEqual(['a']);
  });

  it('expands weekly, daily, monthly and yearly repeats', () => {
    const weekly = expandCalendar([ev({ id: 'w', event_date: '2025-01-06', recurrence: 'weekly' })], '2026-10-18', '2026-10-31');
    expect(weekly.map(o => o.date)).toEqual(['2026-10-19', '2026-10-26']);
    const daily = expandCalendar([ev({ id: 'd', recurrence: 'daily' })], '2026-10-20', '2026-10-24');
    expect(daily.map(o => o.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    const monthly = expandCalendar([ev({ id: 'm', event_date: '2026-01-31', recurrence: 'monthly' })], '2026-02-01', '2026-02-28');
    expect(monthly.map(o => o.date)).toEqual(['2026-02-28']);
    const yearly = expandCalendar([ev({ id: 'y', event_date: '2000-10-22', recurrence: 'yearly' })], '2026-10-18', '2026-10-24');
    expect(yearly.map(o => o.date)).toEqual(['2026-10-22']);
  });

  it('covers multi-day events and sorts by time', () => {
    const out = expandCalendar([
      ev({ id: 'late', event_date: '2026-10-24', event_time: '15:00:00' }),
      ev({ id: 'early', event_date: '2026-10-24', event_time: '09:00:00' }),
      ev({ id: 'span', event_date: '2026-10-22', end_date: '2026-10-25' }),
    ], '2026-10-24', '2026-10-24');
    expect(out.map(o => o.event.id)).toEqual(['span', 'early', 'late']);
    expect(diffDays('2026-10-25', '2026-10-22')).toBe(3);
  });

  it('flags all-day events', () => {
    expect(isAllDayEvent(ev({ id: 'x' }))).toBe(true);
    expect(isAllDayEvent(ev({ id: 'x', event_time: '09:00:00' }))).toBe(false);
    expect(isAllDayEvent(ev({ id: 'x', event_time: '09:00:00', is_all_day: true }))).toBe(true);
  });
});
