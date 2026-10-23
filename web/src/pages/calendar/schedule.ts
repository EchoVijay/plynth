import {
  addDays, addMonths, addYears, differenceInCalendarDays, endOfMonth, format, parse, startOfMonth,
} from 'date-fns';
import type { CalEvent, ViewMode } from './types';

export const MINUTES_IN_DAY = 24 * 60;
export const DEFAULT_DURATION = 60;
const MIN_VISUAL_DURATION = 30;
const AUTO_EVENT_BASE: Omit<CalEvent, 'id' | 'title' | 'description' | 'event_date' | 'category' | 'source_type'> = {
  location: null, event_time: null, end_date: null, end_time: null, is_all_day: true, completed: false,
  recurrence: null, color: null, reminder_minutes: [], is_auto: true,
};

// ---------- date helpers (all "yyyy-MM-dd" strings are local dates) ----------
export function ymd(d: Date): string { return format(d, 'yyyy-MM-dd'); }
export function parseYmd(s: string): Date { return parse(s, 'yyyy-MM-dd', new Date()); }
export function todayYmd(): string { return ymd(new Date()); }
export function addDaysYmd(s: string, n: number): string { return ymd(addDays(parseYmd(s), n)); }
export function diffDaysYmd(a: string, b: string): number { return differenceInCalendarDays(parseYmd(a), parseYmd(b)); }

export function toMin(t: string): number {
  const [h, m] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

export function minToTime(min: number): string {
  const c = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(min)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.min(MINUTES_IN_DAY, min));
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

export function formatTimeStr(t: string | null): string {
  return t ? formatMinutes(toMin(t)) : '';
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------- ranges & navigation ----------
export interface DateRange {
  start: string;
  end: string;
  days: string[];
}

export const AGENDA_DAYS = 30;

function daysBetween(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysYmd(start, i));
}

export function weekStart(date: string): string {
  return addDaysYmd(date, -parseYmd(date).getDay());
}

export function getRange(view: ViewMode, cursor: string): DateRange {
  let start: string;
  let count: number;
  switch (view) {
    case 'day':
      start = cursor; count = 1; break;
    case 'workweek':
      start = addDaysYmd(weekStart(cursor), 1); count = 5; break;
    case 'week':
      start = weekStart(cursor); count = 7; break;
    case 'agenda':
      start = cursor; count = AGENDA_DAYS; break;
    case 'month': {
      const first = startOfMonth(parseYmd(cursor));
      start = weekStart(ymd(first));
      const weeks = Math.ceil((differenceInCalendarDays(endOfMonth(first), parseYmd(start)) + 1) / 7);
      count = weeks * 7;
      break;
    }
  }
  const days = daysBetween(start, count);
  return { start, end: days[days.length - 1], days };
}

export function navigate(view: ViewMode, cursor: string, dir: 1 | -1): string {
  const d = parseYmd(cursor);
  switch (view) {
    case 'day': return ymd(addDays(d, dir));
    case 'workweek':
    case 'week': return ymd(addDays(d, 7 * dir));
    case 'agenda': return ymd(addDays(d, AGENDA_DAYS * dir));
    case 'month': return ymd(addMonths(d, dir));
  }
}

export function rangeLabel(view: ViewMode, range: DateRange, cursor: string): string {
  const s = parseYmd(range.start);
  const e = parseYmd(range.end);
  if (view === 'day') return format(s, 'EEEE, MMMM d, yyyy');
  if (view === 'month') return format(parseYmd(cursor), 'MMMM yyyy');
  if (s.getFullYear() !== e.getFullYear()) return `${format(s, 'MMM d, yyyy')} – ${format(e, 'MMM d, yyyy')}`;
  if (s.getMonth() !== e.getMonth()) return `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`;
  return `${format(s, 'MMMM d')} – ${format(e, 'd, yyyy')}`;
}

// ---------- occurrences (recurrence expansion) ----------
export interface Occurrence {
  key: string;
  event: CalEvent;
  startDate: string;
  endDate: string;
}

function spanOf(event: CalEvent): number {
  if (!event.end_date) return 0;
  return Math.max(0, diffDaysYmd(event.end_date, event.event_date));
}

function nthOccurrence(event: CalEvent, n: number): string {
  const base = parseYmd(event.event_date);
  switch (event.recurrence) {
    case 'daily': return ymd(addDays(base, n));
    case 'weekly': return ymd(addDays(base, 7 * n));
    case 'monthly': return ymd(addMonths(base, n));
    case 'yearly': return ymd(addYears(base, n));
    default: return event.event_date;
  }
}

export function expandOccurrences(events: CalEvent[], rangeStart: string, rangeEnd: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    const span = spanOf(event);
    const push = (startDate: string) => {
      const endDate = addDaysYmd(startDate, span);
      if (startDate <= rangeEnd && endDate >= rangeStart) {
        out.push({ key: `${event.id}@${startDate}`, event, startDate, endDate });
      }
    };

    if (!event.recurrence) { push(event.event_date); continue; }
    if (event.event_date > rangeEnd) continue;

    // Skip straight to the first occurrence that could reach the range.
    const gap = Math.max(0, diffDaysYmd(rangeStart, event.event_date) - span);
    let n = 0;
    if (event.recurrence === 'daily') n = gap;
    else if (event.recurrence === 'weekly') n = Math.floor(gap / 7);
    else if (event.recurrence === 'monthly') n = Math.max(0, Math.floor(gap / 31) - 1);
    else if (event.recurrence === 'yearly') n = Math.max(0, Math.floor(gap / 366) - 1);

    for (let guard = 0; guard < 800; guard++, n++) {
      const startDate = nthOccurrence(event, n);
      if (startDate > rangeEnd) break;
      push(startDate);
    }
  }
  return out;
}

// ---------- per-day segments ----------
export interface DaySegment {
  occ: Occurrence;
  day: string;
  allDay: boolean;
  startMin: number;
  endMin: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function isAllDay(event: CalEvent): boolean {
  return event.is_all_day || !event.event_time;
}

export function segmentFor(occ: Occurrence, day: string): DaySegment | null {
  if (day < occ.startDate || day > occ.endDate) return null;
  const { event } = occ;
  const continuesBefore = day > occ.startDate;
  const continuesAfter = day < occ.endDate;

  if (isAllDay(event)) {
    return { occ, day, allDay: true, startMin: 0, endMin: MINUTES_IN_DAY, continuesBefore, continuesAfter };
  }

  const start = toMin(event.event_time!);
  const multiDay = occ.endDate > occ.startDate;
  let startMin = continuesBefore ? 0 : start;
  let endMin: number;
  if (continuesAfter) endMin = MINUTES_IN_DAY;
  else if (event.end_time) endMin = toMin(event.end_time);
  else endMin = multiDay ? start : start + DEFAULT_DURATION;
  if (!multiDay && endMin <= startMin) endMin = startMin + DEFAULT_DURATION;
  endMin = Math.min(MINUTES_IN_DAY, Math.max(endMin, startMin + 15));
  startMin = Math.min(startMin, MINUTES_IN_DAY - 15);
  return { occ, day, allDay: false, startMin, endMin, continuesBefore, continuesAfter };
}

export function segmentsForDay(occurrences: Occurrence[], day: string): DaySegment[] {
  const out: DaySegment[] = [];
  for (const occ of occurrences) {
    const seg = segmentFor(occ, day);
    if (seg) out.push(seg);
  }
  return out;
}

export interface LaidOutSegment extends DaySegment {
  col: number;
  cols: number;
  visualEnd: number;
}

// Side-by-side layout for overlapping blocks, grouped into independent clusters.
export function layoutSegments(segs: DaySegment[]): LaidOutSegment[] {
  const sorted = segs
    .map(s => ({ ...s, visualEnd: Math.max(s.endMin, s.startMin + MIN_VISUAL_DURATION), col: 0, cols: 1 }))
    .sort((a, b) => a.startMin - b.startMin || b.visualEnd - a.visualEnd);

  const result: LaidOutSegment[] = [];
  let cluster: LaidOutSegment[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const s of cluster) s.cols = colEnds.length;
    result.push(...cluster);
    cluster = [];
    colEnds = [];
  };

  for (const seg of sorted) {
    if (cluster.length && seg.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex(end => end <= seg.startMin);
    if (col === -1) { col = colEnds.length; colEnds.push(seg.visualEnd); } else colEnds[col] = seg.visualEnd;
    seg.col = col;
    clusterEnd = cluster.length ? Math.max(clusterEnd, seg.visualEnd) : seg.visualEnd;
    cluster.push(seg);
  }
  flush();
  return result;
}

export function plannedMinutes(occurrences: Occurrence[], days: string[]): number {
  let total = 0;
  for (const day of days) {
    for (const seg of segmentsForDay(occurrences, day)) {
      if (!seg.allDay && !seg.occ.event.is_auto) total += seg.endMin - seg.startMin;
    }
  }
  return total;
}

// ---------- editing helpers ----------
export interface TimeSlot {
  date: string;
  startMin: number;
  endMin: number;
}

// Moving an occurrence of a repeating event shifts the whole series by the same delta.
export function buildMovePatch(event: CalEvent, occStart: string, slot: TimeSlot): Partial<CalEvent> {
  const dayDelta = diffDaysYmd(slot.date, occStart);
  return {
    event_date: addDaysYmd(event.event_date, dayDelta),
    end_date: event.end_date ? addDaysYmd(event.end_date, dayDelta) : null,
    event_time: minToTime(slot.startMin),
    end_time: minToTime(slot.endMin),
  };
}

export function matchesQuery(event: CalEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [event.title, event.location, event.description].some(v => v?.toLowerCase().includes(q));
}

// ---------- auto events (EMI due dates, predicted periods) ----------
interface LoanLike { id: string; name: string; emi_amount: number | null; emi_due_day: number | null }
interface CycleLike { start_date: string }

export function buildAutoEvents(
  loans: LoanLike[], cycles: CycleLike[], rangeStart: string, rangeEnd: string,
): CalEvent[] {
  const auto: CalEvent[] = [];

  let cursor = startOfMonth(parseYmd(rangeStart));
  const last = parseYmd(rangeEnd);
  while (cursor <= last) {
    const dim = endOfMonth(cursor).getDate();
    for (const loan of loans) {
      if (!loan.emi_due_day) continue;
      const date = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(loan.emi_due_day, dim)));
      if (date < rangeStart || date > rangeEnd) continue;
      auto.push({
        ...AUTO_EVENT_BASE,
        id: `emi-${loan.id}-${date}`,
        title: `EMI: ${loan.name}`,
        description: loan.emi_amount ? `₹${Number(loan.emi_amount).toLocaleString('en-IN')}` : null,
        event_date: date,
        category: 'emi',
        source_type: 'emi',
      });
    }
    cursor = addMonths(cursor, 1);
  }

  if (cycles.length >= 2) {
    const lengths = cycles.slice(0, -1)
      .map((c, i) => diffDaysYmd(c.start_date, cycles[i + 1].start_date))
      .filter(l => l > 18 && l < 45);
    if (lengths.length) {
      const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
      let next = addDaysYmd(cycles[0].start_date, avg);
      for (let i = 0; i < 12; i++) {
        if (next >= rangeStart && next <= rangeEnd) {
          auto.push({
            ...AUTO_EVENT_BASE,
            id: `period-pred-${next}`,
            title: 'Predicted Period',
            description: `~${avg} day cycle`,
            event_date: next,
            category: 'period',
            source_type: 'period',
          });
        }
        next = addDaysYmd(next, avg);
      }
    }
  }
  return auto;
}
