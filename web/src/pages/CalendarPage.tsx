import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Filter, Plus, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Switch } from '@/components/ui/Switch';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import { AgendaView } from './calendar/AgendaView';
import { EventDetails } from './calendar/EventDetails';
import { EventDialog, type EventPayload } from './calendar/EventDialog';
import { MonthView } from './calendar/MonthView';
import {
  buildAutoEvents, buildMovePatch, expandOccurrences, formatDuration, getRange, matchesQuery, navigate,
  parseYmd, plannedMinutes, rangeLabel, todayYmd, ymd, type Occurrence, type TimeSlot,
} from './calendar/schedule';
import { TimeGrid, type NewSlot } from './calendar/TimeGrid';
import { CATEGORIES, VIEW_OPTIONS, type CalEvent, type ViewMode } from './calendar/types';

const VIEW_STORAGE_KEY = 'plynth.calendar.view';

function initialView(): ViewMode {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode | null;
  if (saved && VIEW_OPTIONS.some(v => v.id === saved)) return saved;
  return window.innerWidth < 768 ? 'day' : 'week';
}

function normalize(row: Partial<CalEvent> & { id: string }): CalEvent {
  return {
    title: '', description: null, location: null, event_date: '', event_time: null, end_date: null,
    end_time: null, category: 'general', recurrence: null, color: null, source_type: null,
    ...row,
    is_all_day: row.is_all_day ?? false,
    completed: row.completed ?? false,
    reminder_minutes: row.reminder_minutes ?? [],
    is_auto: row.is_auto ?? false,
  };
}

// 'other' (Quick Capture) shares the General filter.
const filterKey = (category: string) => (category === 'other' ? 'general' : category);

export function CalendarPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [view, setViewState] = useState<ViewMode>(initialView);
  const [cursor, setCursor] = useState(todayYmd);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(true);
  const [selected, setSelected] = useState<{ occ: Occurrence; rect: DOMRect } | null>(null);
  const [dialog, setDialog] = useState<{ existing: CalEvent | null; initial: NewSlot | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const range = useMemo(() => getRange(view, cursor), [view, cursor]);
  const eventsKey = ['calendar-events', userId] as const;

  const setView = (v: ViewMode) => {
    localStorage.setItem(VIEW_STORAGE_KEY, v);
    setSelected(null);
    setViewState(v);
  };
  const goTo = (date: string) => { setSelected(null); setCursor(date); };
  const openDay = (date: string) => { setCursor(date); setView('day'); };

  // ---- Data ----
  const eventsQ = useQuery({
    queryKey: [...eventsKey, range.start, range.end],
    enabled: !!userId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // Repeating events are fetched whenever they started before the range ends, then expanded client-side.
      const { data, error } = await supabase.from('calendar_events').select('*')
        .eq('user_id', userId!)
        .lte('event_date', range.end)
        .or(`event_date.gte.${range.start},recurrence.not.is.null,end_date.gte.${range.start}`);
      if (error) throw error;
      return (data ?? []).map(normalize);
    },
  });

  const loansQ = useQuery({
    queryKey: ['loans-for-calendar', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('loans').select('id, name, emi_amount, emi_due_day')
        .eq('user_id', userId!).eq('status', 'active');
      return data ?? [];
    },
  });

  const cyclesQ = useQuery({
    queryKey: ['period-cycles-cal', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('period_cycles').select('start_date')
        .eq('user_id', userId!).order('start_date', { ascending: false }).limit(12);
      return data ?? [];
    },
  });

  const occurrences = useMemo(() => {
    const auto = buildAutoEvents(loansQ.data ?? [], cyclesQ.data ?? [], range.start, range.end);
    const visible = [...(eventsQ.data ?? []), ...auto].filter(e =>
      !hidden.has(filterKey(e.category)) && (showCompleted || !e.completed) && matchesQuery(e, query));
    return expandOccurrences(visible, range.start, range.end);
  }, [eventsQ.data, loansQ.data, cyclesQ.data, range, hidden, showCompleted, query]);

  const summary = useMemo(() => {
    const items = occurrences.filter(o => !o.event.is_auto);
    return {
      count: items.length,
      done: items.filter(o => o.event.completed).length,
      planned: plannedMinutes(items, range.days),
    };
  }, [occurrences, range]);

  // ---- Mutations ----
  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from('calendar_events')
        .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId!);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: eventsKey });
      const previous = qc.getQueriesData<CalEvent[]>({ queryKey: eventsKey });
      qc.setQueriesData<CalEvent[]>({ queryKey: eventsKey }, old => old?.map(e => (e.id === id ? { ...e, ...patch } : e)));
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e.message || 'Could not update the event');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: eventsKey }),
  });

  const saveMutation = useMutation({
    mutationFn: async ({ payload, id }: { payload: EventPayload; id?: string }) => {
      if (id) {
        const { error } = await supabase.from('calendar_events')
          .update({ ...payload, reminder_sent_for: {}, updated_at: new Date().toISOString() })
          .eq('id', id).eq('user_id', userId!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('calendar_events').insert({ user_id: userId!, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: eventsKey });
      toast.success(id ? 'Work block updated' : 'Work block scheduled');
      setDialog(null);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id).eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventsKey });
      toast.success('Deleted');
      setDialog(null);
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete'),
  });

  // ---- Handlers ----
  const openCreate = (slot: NewSlot) => { setSelected(null); setDialog({ existing: null, initial: slot }); };

  const newWork = () => {
    const today = todayYmd();
    const date = range.days.includes(today) ? today : cursor;
    const hour = Math.min(21, Math.max(8, new Date().getHours() + 1));
    openCreate({ date, startMin: hour * 60, endMin: (hour + 1) * 60, allDay: false });
  };

  const changeSlot = (occ: Occurrence, slot: TimeSlot) => {
    setSelected(null);
    updateMutation.mutate({
      id: occ.event.id,
      patch: { ...buildMovePatch(occ.event, occ.startDate, slot), is_all_day: false, reminder_sent_for: {} },
    });
    if (occ.event.recurrence) toast.info('Repeating event: the whole series was moved');
  };

  const confirmDelete = (event: CalEvent) => {
    const msg = event.recurrence ? `Delete "${event.title}" and all its repeats?` : `Delete "${event.title}"?`;
    if (confirm(msg)) deleteMutation.mutate(event.id);
  };

  const toggleComplete = (event: CalEvent) => {
    setSelected(null);
    updateMutation.mutate({ id: event.id, patch: { completed: !event.completed } });
  };

  const activeFilters = hidden.size + (showCompleted ? 0 : 1);
  const isGridView = view === 'day' || view === 'week' || view === 'workweek';
  const today = todayYmd();
  const viewLabel = VIEW_OPTIONS.find(v => v.id === view)!.label;

  return (
    <div className="space-y-3 pb-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-indigo-500" /> Calendar
        </h1>
        <Button
          onClick={newWork}
          className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white"
        >
          <Plus className="h-4 w-4" /> New work block
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => goTo(today)}>
          <CalendarDays className="h-4 w-4" /> Today
        </Button>
        <div className="flex items-center">
          <button aria-label="Previous" onClick={() => goTo(navigate(view, cursor, -1))} className="p-2 rounded-lg hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button aria-label="Next" onClick={() => goTo(navigate(view, cursor, 1))} className="p-2 rounded-lg hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-base font-semibold hover:bg-muted">
              {rangeLabel(view, range, cursor)} <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={parseYmd(cursor)}
              defaultMonth={parseYmd(cursor)}
              onSelect={d => { if (d) { goTo(ymd(d)); setPickerOpen(false); } }}
            />
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search events"
              className="h-9 w-40 sm:w-48 pl-8 pr-7"
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4" /> Filter
                {activeFilters > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeFilters}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-3 space-y-3">
              <div className="space-y-1">
                {CATEGORIES.filter(c => c.id !== 'other').map(c => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.id)}
                      onChange={() => setHidden(h => {
                        const next = new Set(h);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                    />
                    <span>{c.emoji}</span> {c.label}
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span>Show completed</span>
                <Switch checked={showCompleted} onCheckedChange={setShowCompleted} aria-label="Show completed" />
              </div>
              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setHidden(new Set()); setShowCompleted(true); }}>
                  Reset filters
                </Button>
              )}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[7.5rem] justify-between">
                {viewLabel} <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              {VIEW_OPTIONS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted', v.id === view && 'font-semibold')}
                >
                  {v.label}{v.id === view && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Plan summary */}
      <p className="text-xs text-muted-foreground">
        {summary.count === 0
          ? 'Nothing planned in this range yet. Click a time slot (or drag across it) to schedule work.'
          : `${summary.count} item${summary.count === 1 ? '' : 's'} · ${formatDuration(summary.planned)} of timed work planned · ${summary.done} done`}
        {eventsQ.isFetching && ' · syncing…'}
        {eventsQ.isError && <span className="text-red-500"> · couldn't load events</span>}
      </p>

      {isGridView && (
        <TimeGrid
          days={range.days}
          occurrences={occurrences}
          selectedKey={selected?.occ.key}
          onCreate={openCreate}
          onSelect={(occ, rect) => setSelected({ occ, rect })}
          onChangeSlot={changeSlot}
          onOpenDay={openDay}
        />
      )}
      {view === 'month' && (
        <MonthView
          days={range.days}
          cursor={cursor}
          occurrences={occurrences}
          onCreate={openCreate}
          onSelect={(occ, rect) => setSelected({ occ, rect })}
          onOpenDay={openDay}
        />
      )}
      {view === 'agenda' && (
        <AgendaView
          days={range.days}
          occurrences={occurrences}
          onSelect={(occ, rect) => setSelected({ occ, rect })}
        />
      )}

      {selected && (
        <EventDetails
          occ={selected.occ}
          anchor={selected.rect}
          onClose={() => setSelected(null)}
          onEdit={() => { setDialog({ existing: selected.occ.event, initial: null }); setSelected(null); }}
          onDelete={() => confirmDelete(selected.occ.event)}
          onToggleComplete={() => toggleComplete(selected.occ.event)}
        />
      )}

      {dialog && (
        <EventDialog
          existing={dialog.existing}
          initial={dialog.initial}
          saving={saveMutation.isPending}
          onClose={() => setDialog(null)}
          onSave={(payload, id) => saveMutation.mutate({ payload, id })}
          onDelete={confirmDelete}
        />
      )}
    </div>
  );
}
