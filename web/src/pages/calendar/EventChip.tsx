import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeStr } from './schedule';
import { getCategory, getColorStyle, type CalEvent } from './types';

interface EventChipProps {
  event: CalEvent;
  showTime?: boolean;
  continuesBefore?: boolean;
  onClick?: (rect: DOMRect) => void;
  className?: string;
}

export function EventChip({ event, showTime, continuesBefore, onClick, className }: EventChipProps) {
  const color = getColorStyle(event);
  const cat = getCategory(event.category);
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick?.(e.currentTarget.getBoundingClientRect()); }}
      title={event.title}
      className={cn(
        'relative w-full flex items-center gap-1 rounded px-1.5 py-0.5 pl-2 text-left text-[11px] leading-tight overflow-hidden',
        'hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        color.block, color.text,
        event.is_auto && 'border border-dashed border-foreground/30',
        event.completed && 'opacity-60',
        className,
      )}
    >
      {!continuesBefore && <span className={cn('absolute left-0 inset-y-0 w-1', color.bar)} />}
      {event.completed && <Check className="h-3 w-3 shrink-0" />}
      {showTime && event.event_time && !event.is_all_day && (
        <span className="shrink-0 opacity-70">{formatTimeStr(event.event_time)}</span>
      )}
      <span className={cn('truncate font-medium', event.completed && 'line-through')}>
        {event.is_auto ? `${cat.emoji} ` : ''}{event.title}
      </span>
    </button>
  );
}
