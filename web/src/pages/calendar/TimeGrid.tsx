import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MapPin, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EventChip } from './EventChip';
import {
  formatMinutes, layoutSegments, MINUTES_IN_DAY, parseYmd, segmentsForDay, todayYmd,
  type DaySegment, type LaidOutSegment, type Occurrence, type TimeSlot,
} from './schedule';
import { getCategory, getColorStyle } from './types';

const HOUR_H = 56;
const SNAP = 15;
const GUTTER_PX = 56;
const MIN_DAY_COL_PX = 120;
const WORK_START = 9 * 60;
const WORK_END = 18 * 60;
const DRAG_THRESHOLD_PX = 5;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export interface NewSlot extends TimeSlot { allDay: boolean }

interface TimeGridProps {
  days: string[];
  occurrences: Occurrence[];
  selectedKey?: string | null;
  onCreate: (slot: NewSlot) => void;
  onSelect: (occ: Occurrence, rect: DOMRect) => void;
  onChangeSlot: (occ: Occurrence, slot: TimeSlot) => void;
  onOpenDay: (date: string) => void;
}

type Drag =
  | { kind: 'create'; interactive: boolean; startY: number; dayIdx: number; anchor: number; cur: number; moved: boolean }
  | { kind: 'move'; seg: DaySegment; rect: DOMRect; startX: number; startY: number; grab: number; duration: number; dayIdx: number; startMin: number; moved: boolean }
  | { kind: 'resize'; seg: DaySegment; startY: number; dayIdx: number; endMin: number; moved: boolean }
  | { kind: 'select'; seg: DaySegment; rect: DOMRect };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const floorSnap = (min: number) => Math.floor(min / SNAP) * SNAP;
const px = (min: number) => (min / 60) * HOUR_H;
const segId = (s: DaySegment) => `${s.occ.key}|${s.day}`;

function hourLabel(h: number) {
  return formatMinutes(h * 60);
}

function useNowMinutes() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return { today: todayYmd(), minutes: now.getHours() * 60 + now.getMinutes() };
}

export function TimeGrid({ days, occurrences, selectedKey, onCreate, onSelect, onChangeSlot, onOpenDay }: TimeGridProps) {
  const n = days.length;
  const now = useNowMinutes();
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };

  const perDay = useMemo(() => days.map(day => {
    const segs = segmentsForDay(occurrences, day);
    return {
      day,
      allDay: segs.filter(s => s.allDay),
      timed: layoutSegments(segs.filter(s => !s.allDay)),
    };
  }), [days, occurrences]);

  const segMap = useMemo(() => {
    const m = new Map<string, DaySegment>();
    for (const d of perDay) for (const s of d.timed) m.set(segId(s), s);
    return m;
  }, [perDay]);

  const hasAllDay = perDay.some(d => d.allDay.length > 0);

  // Start the view near "now" (or the morning on other days).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focus = days.includes(now.today) ? Math.max(0, now.minutes - 90) : 7 * 60 + 30;
    el.scrollTop = px(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const locate = (e: React.PointerEvent) => {
    const r = colsRef.current!.getBoundingClientRect();
    const dayIdx = clamp(Math.floor(((e.clientX - r.left) / r.width) * n), 0, n - 1);
    const min = clamp(((e.clientY - r.top) / HOUR_H) * 60, 0, MINUTES_IN_DAY);
    return { dayIdx, min };
  };

  const canDrag = (seg: DaySegment, interactive: boolean) =>
    interactive && !seg.occ.event.is_auto && seg.occ.startDate === seg.occ.endDate;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const interactive = e.pointerType !== 'touch';
    const { dayIdx, min } = locate(e);
    const segEl = target.closest<HTMLElement>('[data-seg]');
    const seg = segEl ? segMap.get(segEl.dataset.seg!) : undefined;

    if (seg && segEl) {
      const rect = segEl.getBoundingClientRect();
      if (target.closest('[data-resize]') && canDrag(seg, interactive)) {
        setDrag({ kind: 'resize', seg, startY: e.clientY, dayIdx, endMin: seg.endMin, moved: false });
      } else if (canDrag(seg, interactive)) {
        setDrag({
          kind: 'move', seg, rect, startX: e.clientX, startY: e.clientY, grab: min - seg.startMin,
          duration: seg.endMin - seg.startMin, dayIdx, startMin: seg.startMin, moved: false,
        });
      } else {
        setDrag({ kind: 'select', seg, rect });
      }
    } else {
      const anchor = floorSnap(min);
      setDrag({ kind: 'create', interactive, startY: e.clientY, dayIdx, anchor, cur: anchor, moved: false });
    }
    if (interactive) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.kind === 'select') return;
    if (d.kind === 'create' && !d.interactive) return;
    const { dayIdx, min } = locate(e);
    const farEnough = Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD_PX
      || (d.kind === 'move' && Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD_PX);
    const moved = d.moved || farEnough;

    if (d.kind === 'create') {
      setDrag({ ...d, cur: floorSnap(min), moved });
    } else if (d.kind === 'move') {
      const startMin = clamp(snap(min - d.grab), 0, MINUTES_IN_DAY - d.duration);
      setDrag({ ...d, dayIdx, startMin, moved });
    } else {
      setDrag({ ...d, endMin: clamp(snap(min), d.seg.startMin + SNAP, MINUTES_IN_DAY), moved });
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;

    if (d.kind === 'select') {
      onSelect(d.seg.occ, d.rect);
    } else if (d.kind === 'create') {
      const date = days[d.dayIdx];
      if (d.moved) {
        const lo = Math.min(d.anchor, d.cur);
        const hi = Math.max(d.anchor, d.cur) + SNAP;
        onCreate({ date, startMin: lo, endMin: Math.min(hi, MINUTES_IN_DAY), allDay: false });
      } else {
        const start = clamp(Math.floor(d.anchor / 30) * 30, 0, MINUTES_IN_DAY - 60);
        onCreate({ date, startMin: start, endMin: start + 60, allDay: false });
      }
    } else if (d.kind === 'move') {
      if (!d.moved) onSelect(d.seg.occ, d.rect);
      else onChangeSlot(d.seg.occ, { date: days[d.dayIdx], startMin: d.startMin, endMin: d.startMin + d.duration });
    } else if (d.kind === 'resize' && d.moved) {
      onChangeSlot(d.seg.occ, { date: d.seg.day, startMin: d.seg.startMin, endMin: d.endMin });
    }
  };

  const cancel = (e: React.PointerEvent<HTMLDivElement>) => {
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeySelect = (e: React.KeyboardEvent<HTMLElement>, seg: DaySegment) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(seg.occ, e.currentTarget.getBoundingClientRect());
    }
  };

  const template = `${GUTTER_PX}px repeat(${n}, minmax(0, 1fr))`;
  const workShade = `linear-gradient(to bottom, hsl(var(--muted) / 0.55) 0, hsl(var(--muted) / 0.55) ${px(WORK_START)}px, transparent ${px(WORK_START)}px, transparent ${px(WORK_END)}px, hsl(var(--muted) / 0.55) ${px(WORK_END)}px)`;
  const columnBg = [
    `linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px) 0 0 / 100% ${HOUR_H}px`,
    `linear-gradient(to bottom, hsl(var(--border) / 0.45) 1px, transparent 1px) 0 ${HOUR_H / 2}px / 100% ${HOUR_H}px`,
    workShade,
  ].join(', ');

  return (
    <div
      ref={scrollRef}
      className="border rounded-xl bg-background overflow-auto h-[calc(100dvh-17rem)] min-h-[420px]"
    >
      <div style={{ minWidth: GUTTER_PX + n * MIN_DAY_COL_PX }}>
        {/* Sticky header: day names + all-day row */}
        <div className="sticky top-0 z-40 bg-background border-b">
          <div className="grid" style={{ gridTemplateColumns: template }}>
            <div />
            {days.map(day => {
              const d = parseYmd(day);
              const isToday = day === now.today;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => n > 1 && onOpenDay(day)}
                  className={cn('border-l px-2 py-1.5 text-left', n > 1 ? 'hover:bg-muted/50' : 'cursor-default')}
                >
                  <div className={cn('text-[11px]', isToday ? 'text-primary font-semibold' : 'text-muted-foreground')}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={cn(
                    'mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg leading-none',
                    isToday ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground',
                  )}>
                    {d.getDate()}
                  </div>
                </button>
              );
            })}
          </div>
          {hasAllDay && (
            <div className="grid border-t" style={{ gridTemplateColumns: template }}>
              <div className="pr-2 pt-1.5 text-right text-[10px] text-muted-foreground">All day</div>
              {perDay.map(({ day, allDay }) => (
                <div
                  key={day}
                  onClick={() => onCreate({ date: day, startMin: 9 * 60, endMin: 10 * 60, allDay: true })}
                  className="border-l p-0.5 space-y-0.5 min-h-7 cursor-pointer hover:bg-muted/30"
                >
                  {allDay.map(seg => (
                    <EventChip
                      key={segId(seg)}
                      event={seg.occ.event}
                      continuesBefore={seg.continuesBefore}
                      onClick={rect => onSelect(seg.occ, rect)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Time grid */}
        <div className="flex" style={{ height: HOUR_H * 24 }}>
          <div className="relative shrink-0" style={{ width: GUTTER_PX }}>
            {HOURS.slice(1).map(h => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground whitespace-nowrap"
                style={{ top: h * HOUR_H }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>

          <div
            ref={colsRef}
            className="relative flex-1 grid select-none"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finish}
            onPointerCancel={cancel}
          >
            {perDay.map(({ day, timed }) => (
              <div key={day} className="relative border-l" style={{ background: columnBg }}>
                {timed.map(seg => (
                  <EventBlock
                    key={segId(seg)}
                    seg={seg}
                    id={segId(seg)}
                    selected={selectedKey === seg.occ.key}
                    dragging={!!drag && (drag.kind === 'move' || drag.kind === 'resize') && drag.moved && segId(drag.seg) === segId(seg)}
                    resizeEnd={drag?.kind === 'resize' && drag.moved && segId(drag.seg) === segId(seg) ? drag.endMin : null}
                    draggable={canDrag(seg, true)}
                    onKeyDown={e => onKeySelect(e, seg)}
                  />
                ))}
                {day === now.today && (
                  <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: px(now.minutes) }}>
                    <span className="absolute -left-1.5 -top-[5px] h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="h-0.5 bg-primary" />
                  </div>
                )}
              </div>
            ))}

            {/* Drag previews */}
            {drag?.kind === 'create' && drag.moved && (
              <Preview
                n={n} dayIdx={drag.dayIdx}
                startMin={Math.min(drag.anchor, drag.cur)}
                endMin={Math.max(drag.anchor, drag.cur) + SNAP}
                className="border-2 border-dashed border-primary bg-primary/15"
                label="New work block"
              />
            )}
            {drag?.kind === 'move' && drag.moved && (
              <Preview
                n={n} dayIdx={drag.dayIdx} startMin={drag.startMin} endMin={drag.startMin + drag.duration}
                className={cn('shadow-lg ring-2 ring-primary/50', getColorStyle(drag.seg.occ.event).block, getColorStyle(drag.seg.occ.event).text)}
                label={drag.seg.occ.event.title}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Preview({ n, dayIdx, startMin, endMin, className, label }: {
  n: number; dayIdx: number; startMin: number; endMin: number; className: string; label: string;
}) {
  return (
    <div
      className={cn('absolute z-30 pointer-events-none rounded-md px-2 py-1 text-xs overflow-hidden', className)}
      style={{
        top: px(startMin),
        height: px(endMin - startMin) - 1,
        left: `calc(${(dayIdx / n) * 100}% + 2px)`,
        width: `calc(${100 / n}% - 4px)`,
      }}
    >
      <div className="font-medium truncate">{label}</div>
      <div className="opacity-70">{formatMinutes(startMin)} – {formatMinutes(endMin)}</div>
    </div>
  );
}

function EventBlock({ seg, id, selected, dragging, resizeEnd, draggable, onKeyDown }: {
  seg: LaidOutSegment; id: string; selected: boolean; dragging: boolean; resizeEnd: number | null;
  draggable: boolean; onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const { event } = seg.occ;
  const color = getColorStyle(event);
  const cat = getCategory(event.category);
  const end = resizeEnd ?? seg.endMin;
  const duration = end - seg.startMin;
  const height = px(Math.max(duration, 15)) - 1;
  const showRange = duration >= 45 || resizeEnd !== null;
  const showLocation = duration >= 75 && !!event.location;
  const timeLabel = `${formatMinutes(seg.startMin)} – ${formatMinutes(end)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      data-seg={id}
      onKeyDown={onKeyDown}
      title={`${event.title}\n${timeLabel}${event.location ? `\n${event.location}` : ''}`}
      className={cn(
        'group absolute z-10 overflow-hidden rounded-md pl-2.5 pr-1 py-0.5 text-xs leading-snug',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        color.block, color.text,
        event.is_auto && 'border border-dashed border-foreground/30',
        event.completed && 'opacity-60',
        selected && 'ring-2 ring-primary',
        dragging && 'opacity-40',
      )}
      style={{
        top: px(seg.startMin),
        height,
        left: `calc(${(seg.col / seg.cols) * 100}% + 2px)`,
        width: `calc(${100 / seg.cols}% - 4px)`,
      }}
    >
      {!seg.continuesBefore && <span className={cn('absolute left-0 inset-y-0 w-1', color.bar)} />}
      <div className="flex items-center gap-1 min-w-0">
        {event.completed && <Check className="h-3 w-3 shrink-0" />}
        <span className={cn('font-semibold truncate', event.completed && 'line-through')}>{event.title}</span>
        {event.recurrence && duration < 45 && <Repeat className="h-3 w-3 shrink-0 opacity-60" />}
        {duration < 45 && <span className="shrink-0 opacity-70 truncate">{formatMinutes(seg.startMin)}</span>}
      </div>
      {showRange && (
        <div className="flex items-center gap-1 opacity-75 truncate">
          <span className="truncate">{timeLabel}</span>
          {event.recurrence && <Repeat className="h-3 w-3 shrink-0" />}
        </div>
      )}
      {showLocation && (
        <div className="flex items-center gap-1 opacity-75 truncate">
          <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{event.location}</span>
        </div>
      )}
      {duration >= 105 && <div className="opacity-60 truncate">{cat.emoji} {cat.label}</div>}
      {draggable && (
        <div data-resize className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />
      )}
    </div>
  );
}
