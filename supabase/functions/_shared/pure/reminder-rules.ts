// Scheduling rules for reminders. Pure, so they can be unit-tested without a clock or a database.

import { addDaysYmd, localParts, zonedToUtc, type LocalParts } from './tz.ts';

export const GRACE_MIN = 30;

const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export interface DueFire {
  date: string; // the local date the reminder belongs to (used as the dedupe key)
  time: string; // "HH:mm:ss" as stored in times_of_day
}

function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Which of a rule's times should fire right now, judged in the user's own timezone.
 * A time is due for up to GRACE_MIN minutes after it passes, and a reminder set for 23:50 still
 * counts as yesterday's at 00:10. The day filter is applied to the day the time belongs to.
 */
export function dueFires(now: LocalParts, times: string[], days: number[], grace = GRACE_MIN): DueFire[] {
  const out: DueFire[] = [];
  const yesterday = addDaysYmd(now.date, -1);
  for (const time of times) {
    if (!time) continue;
    const t = toMin(time);
    const candidates: [string, number][] = [[now.date, now.minutes - t], [yesterday, now.minutes + 1440 - t]];
    for (const [date, elapsed] of candidates) {
      if (elapsed >= 0 && elapsed <= grace && days.includes(dowOf(date))) {
        out.push({ date, time });
        break;
      }
    }
  }
  return out;
}

export interface CalendarFire {
  at: Date;      // when the reminder should go out
  startsAt: Date | null;
}

/** All-day events remind at 07:00 local, whole days ahead; timed events remind N minutes before the start. */
export function calendarFireTime(
  date: string, eventTime: string | null, minutesBefore: number, tz: string,
): CalendarFire {
  if (!eventTime) {
    const days = Math.floor(minutesBefore / 1440);
    return { at: zonedToUtc(addDaysYmd(date, -days), '07:00', tz), startsAt: null };
  }
  const startsAt = zonedToUtc(date, eventTime.slice(0, 5), tz);
  return { at: new Date(startsAt.getTime() - minutesBefore * 60000), startsAt };
}

/** Due once the fire time has passed, within a short window, and never after a timed event has clearly begun. */
export function calendarDue(fire: CalendarFire, now: Date, windowMin = 20): boolean {
  const late = now.getTime() - fire.at.getTime();
  if (late < 0 || late > windowMin * 60000) return false;
  if (fire.startsAt && now.getTime() > fire.startsAt.getTime() + 10 * 60000) return false;
  return true;
}

export function reminderLabel(minutes: number): string {
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)} hr`;
  const d = Math.round(minutes / 1440);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

export { localParts };
