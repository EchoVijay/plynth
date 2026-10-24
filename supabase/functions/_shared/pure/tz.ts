// Timezone helpers shared by the edge functions. Everything here is derived from Intl, no DST tables.

export interface LocalParts {
  date: string;     // yyyy-MM-dd in the zone
  minutes: number;  // minutes since local midnight
  dow: number;      // 0 = Sunday
}

const FALLBACK_TZ = 'Asia/Kolkata';

function validTz(tz: string | null | undefined): string {
  if (!tz) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

export function localParts(tz: string | null | undefined, at: Date): LocalParts {
  const zone = validTz(tz);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const m: Record<string, string> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') m[p.type] = p.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m.weekday);
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(m.hour) * 60 + Number(m.minute), dow };
}

/** Offset of the zone from UTC at an instant, in minutes (Asia/Kolkata = +330). */
export function tzOffsetMinutes(tz: string | null | undefined, at: Date): number {
  const p = localParts(tz, at);
  const [y, mo, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, 0, p.minutes);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant at which the wall clock in `tz` reads `date` `time` ("HH:mm" or "HH:mm:ss"). */
export function zonedToUtc(date: string, time: string, tz: string | null | undefined): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - tzOffsetMinutes(tz, new Date(wall)) * 60000;
  // One refinement handles offsets that change between the guess and the real instant (DST edges).
  guess = wall - tzOffsetMinutes(tz, new Date(guess)) * 60000;
  return new Date(guess);
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function greetingFor(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function formatClock(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
