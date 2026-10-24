// Expands calendar events (including repeating ones) into dated occurrences. Pure UTC date math on
// yyyy-MM-dd strings, so it never depends on the server's timezone.

export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEventLike {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  end_date: string | null;
  end_time: string | null;
  is_all_day?: boolean | null;
  recurrence: string | null;
}

export interface Occurrence<T extends CalendarEventLike = CalendarEventLike> {
  event: T;
  date: string;     // the day this occurrence starts
  endDate: string;  // last day it covers
}

const DAY = 86400000;

function parse(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}
function fmt(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
export function diffDays(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  return Math.round((Date.UTC(x.y, x.m - 1, x.d) - Date.UTC(y.y, y.m - 1, y.d)) / DAY);
}
export function addDays(ymd: string, n: number): string {
  const { y, m, d } = parse(ymd);
  return fmt(Date.UTC(y, m - 1, d + n));
}
// Month arithmetic clamps to the last day (Jan 31 + 1 month = Feb 28/29), matching the web calendar.
function addMonths(ymd: string, n: number): string {
  const { y, m, d } = parse(ymd);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fmt(Date.UTC(ty, tm, Math.min(d, last)));
}

function nth(event: CalendarEventLike, n: number): string {
  switch (event.recurrence) {
    case 'daily': return addDays(event.event_date, n);
    case 'weekly': return addDays(event.event_date, 7 * n);
    case 'monthly': return addMonths(event.event_date, n);
    case 'yearly': return addMonths(event.event_date, 12 * n);
    default: return event.event_date;
  }
}

export function expandCalendar<T extends CalendarEventLike>(events: T[], from: string, to: string): Occurrence<T>[] {
  const out: Occurrence<T>[] = [];
  for (const event of events) {
    const span = event.end_date ? Math.max(0, diffDays(event.end_date, event.event_date)) : 0;
    const push = (date: string) => {
      const endDate = addDays(date, span);
      if (date <= to && endDate >= from) out.push({ event, date, endDate });
    };
    if (!event.recurrence) { push(event.event_date); continue; }
    if (event.event_date > to) continue;

    const gap = Math.max(0, diffDays(from, event.event_date) - span);
    let n = 0;
    if (event.recurrence === 'daily') n = gap;
    else if (event.recurrence === 'weekly') n = Math.floor(gap / 7);
    else if (event.recurrence === 'monthly') n = Math.max(0, Math.floor(gap / 31) - 1);
    else if (event.recurrence === 'yearly') n = Math.max(0, Math.floor(gap / 366) - 1);

    for (let guard = 0; guard < 800; guard++, n++) {
      const date = nth(event, n);
      if (date > to) break;
      push(date);
    }
  }
  return out.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.event.event_time ?? '').localeCompare(b.event.event_time ?? ''));
}

export function isAllDayEvent(e: CalendarEventLike): boolean {
  return !!e.is_all_day || !e.event_time;
}
