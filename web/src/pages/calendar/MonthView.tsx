import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { EventChip } from './EventChip';
import { isAllDay, parseYmd, segmentsForDay, todayYmd, type Occurrence } from './schedule';
import type { NewSlot } from './TimeGrid';

const MAX_CHIPS = 3;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface MonthViewProps {
  days: string[];
  cursor: string;
  occurrences: Occurrence[];
  onCreate: (slot: NewSlot) => void;
  onSelect: (occ: Occurrence, rect: DOMRect) => void;
  onOpenDay: (date: string) => void;
}

export function MonthView({ days, cursor, occurrences, onCreate, onSelect, onOpenDay }: MonthViewProps) {
  const today = todayYmd();
  const cursorMonth = parseYmd(cursor).getMonth();

  const byDay = useMemo(() => {
    const m = new Map<string, ReturnType<typeof segmentsForDay>>();
    for (const day of days) {
      const segs = segmentsForDay(occurrences, day).sort((a, b) =>
        Number(!a.allDay) - Number(!b.allDay) || a.startMin - b.startMin);
      m.set(day, segs);
    }
    return m;
  }, [days, occurrences]);

  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const d = parseYmd(day);
          const segs = byDay.get(day) ?? [];
          const inMonth = d.getMonth() === cursorMonth;
          const isToday = day === today;
          return (
            <div
              key={day}
              onClick={() => onCreate({ date: day, startMin: 9 * 60, endMin: 10 * 60, allDay: true })}
              className={cn(
                'min-h-[96px] border-b border-l p-1 cursor-pointer hover:bg-muted/30 transition-colors',
                i % 7 === 0 && 'border-l-0',
                !inMonth && 'bg-muted/30 text-muted-foreground',
              )}
            >
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onOpenDay(day); }}
                className={cn(
                  'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium hover:bg-muted',
                  isToday && 'bg-primary text-primary-foreground hover:bg-primary',
                )}
              >
                {d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate()}
              </button>
              <div className="mt-0.5 space-y-0.5">
                {segs.slice(0, MAX_CHIPS).map(seg => (
                  <EventChip
                    key={`${seg.occ.key}|${day}`}
                    event={seg.occ.event}
                    showTime={!isAllDay(seg.occ.event)}
                    continuesBefore={seg.continuesBefore}
                    onClick={rect => onSelect(seg.occ, rect)}
                  />
                ))}
                {segs.length > MAX_CHIPS && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onOpenDay(day); }}
                    className="pl-1 text-[10px] text-muted-foreground hover:underline"
                  >
                    +{segs.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
