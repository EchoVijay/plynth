import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, Check, Edit2, MapPin, Repeat, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { formatDuration, formatMinutes, parseYmd, segmentFor, type Occurrence } from './schedule';
import { getCategory, getColorStyle, RECURRENCE_OPTIONS, REMINDER_OPTIONS } from './types';

interface EventDetailsProps {
  occ: Occurrence;
  anchor: DOMRect;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}

const CARD_W = 340;
const MARGIN = 12;

function describeWhen(occ: Occurrence): string {
  const { event } = occ;
  const fmt = (d: string) => parseYmd(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const multi = occ.endDate > occ.startDate;
  const first = segmentFor(occ, occ.startDate)!;
  if (first.allDay) return multi ? `${fmt(occ.startDate)} – ${fmt(occ.endDate)} · All day` : `${fmt(occ.startDate)} · All day`;
  if (multi) {
    const last = segmentFor(occ, occ.endDate)!;
    return `${fmt(occ.startDate)} ${formatMinutes(first.startMin)} – ${fmt(occ.endDate)} ${formatMinutes(last.endMin)}`;
  }
  const hasEnd = !!event.end_time;
  return `${fmt(occ.startDate)} · ${formatMinutes(first.startMin)} – ${formatMinutes(first.endMin)}${hasEnd ? '' : ` (${formatDuration(first.endMin - first.startMin)})`}`;
}

export function EventDetails({ occ, anchor, onClose, onEdit, onDelete, onToggleComplete }: EventDetailsProps) {
  const { event } = occ;
  const color = getColorStyle(event);
  const cat = getCategory(event.category);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  useLayoutEffect(() => {
    if (isMobile) return;
    const h = ref.current?.offsetHeight ?? 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + 8;
    if (left + CARD_W + MARGIN > vw) left = anchor.left - CARD_W - 8;
    left = Math.min(Math.max(MARGIN, left), vw - CARD_W - MARGIN);
    const top = Math.min(Math.max(MARGIN, anchor.top), Math.max(MARGIN, vh - h - MARGIN));
    setPos({ left, top });
  }, [anchor, isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reminders = REMINDER_OPTIONS.filter(r => event.reminder_minutes.includes(r.value)).map(r => r.label);
  const repeat = RECURRENCE_OPTIONS.find(r => r.value === event.recurrence)?.label;

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={event.title}
        className={cn(
          'fixed z-50 rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden',
          isMobile ? 'inset-x-2 bottom-2' : 'transition-opacity',
          !isMobile && !pos && 'opacity-0',
        )}
        style={isMobile ? undefined : { width: CARD_W, left: pos?.left ?? 0, top: pos?.top ?? 0 }}
      >
        <div className={cn('h-1.5', color.bar)} />
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <h3 className={cn('flex-1 text-base font-semibold leading-snug break-words', event.completed && 'line-through opacity-70')}>
              {event.title}
            </h3>
            {!event.is_auto && (
              <>
                <button onClick={onEdit} aria-label="Edit" className="p-1.5 rounded hover:bg-muted"><Edit2 className="h-4 w-4" /></button>
                <button onClick={onDelete} aria-label="Delete" className="p-1.5 rounded hover:bg-muted text-red-500"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2"><CalendarClock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" /><span>{describeWhen(occ)}</span></div>
            {repeat && event.recurrence && (
              <div className="flex items-center gap-2"><Repeat className="h-4 w-4 text-muted-foreground shrink-0" /><span>{repeat}</span></div>
            )}
            {event.location && (
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground shrink-0" /><span className="break-words">{event.location}</span></div>
            )}
            {reminders.length > 0 && (
              <div className="flex items-start gap-2"><Bell className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" /><span>{reminders.join(', ')}</span></div>
            )}
            <div className="flex items-center gap-2">
              <span className={cn('h-3 w-3 rounded-sm shrink-0', color.bar)} />
              <span>{cat.emoji} {cat.label}{event.is_auto ? ' · automatic' : ''}</span>
            </div>
            {event.description && (
              <p className="whitespace-pre-wrap break-words text-muted-foreground border-t pt-2">{event.description}</p>
            )}
          </div>

          {/* Completion is stored per event, so repeating series can't be ticked off. */}
          {!event.is_auto && !event.recurrence && (
            <Button
              variant={event.completed ? 'outline' : 'default'}
              size="sm"
              onClick={onToggleComplete}
              className="w-full"
            >
              <Check className="h-4 w-4" /> {event.completed ? 'Mark as not done' : 'Mark as done'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
