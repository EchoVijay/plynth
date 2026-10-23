import { CalendarDays, Check, Clock, MapPin, Repeat } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  formatDuration, formatMinutes, parseYmd, segmentsForDay, todayYmd, type Occurrence,
} from './schedule';
import { getCategory, getColorStyle } from './types';

interface AgendaViewProps {
  days: string[];
  occurrences: Occurrence[];
  onSelect: (occ: Occurrence, rect: DOMRect) => void;
}

export function AgendaView({ days, occurrences, onSelect }: AgendaViewProps) {
  const today = todayYmd();
  const groups = days
    .map(day => ({
      day,
      segs: segmentsForDay(occurrences, day).sort((a, b) =>
        Number(!a.allDay) - Number(!b.allDay) || a.startMin - b.startMin),
    }))
    .filter(g => g.segs.length > 0);

  if (!groups.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <CalendarDays className="h-12 w-12 mx-auto text-indigo-400 mb-3" />
          <h3 className="font-semibold mb-1">Nothing scheduled</h3>
          <p className="text-sm text-muted-foreground">Add a work block to start planning.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(({ day, segs }) => {
        const d = parseYmd(day);
        const isToday = day === today;
        return (
          <section key={day}>
            <h3 className={cn('mb-2 text-sm font-semibold', isToday && 'text-primary')}>
              {isToday ? 'Today · ' : ''}{d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <div className="space-y-1.5">
              {segs.map(seg => {
                const { event } = seg.occ;
                const color = getColorStyle(event);
                const cat = getCategory(event.category);
                return (
                  <button
                    key={`${seg.occ.key}|${day}`}
                    type="button"
                    onClick={e => onSelect(seg.occ, e.currentTarget.getBoundingClientRect())}
                    className={cn(
                      'relative w-full flex items-center gap-3 rounded-lg py-2.5 pl-4 pr-3 text-left transition hover:brightness-95',
                      color.block, color.text, event.completed && 'opacity-60',
                    )}
                  >
                    <span className={cn('absolute left-0 inset-y-0 w-1.5 rounded-l-lg', color.bar)} />
                    <div className="w-24 shrink-0 text-xs font-medium">
                      {seg.allDay ? 'All day' : formatMinutes(seg.startMin)}
                      {!seg.allDay && (
                        <div className="font-normal opacity-70">{formatDuration(seg.endMin - seg.startMin)}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn('flex items-center gap-1.5 text-sm font-semibold', event.completed && 'line-through')}>
                        {event.completed && <Check className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{event.title}</span>
                        {event.recurrence && <Repeat className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs opacity-75">
                        <span>{cat.emoji} {cat.label}</span>
                        {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{event.location}</span>}
                        {!seg.allDay && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatMinutes(seg.startMin)} – {formatMinutes(seg.endMin)}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
