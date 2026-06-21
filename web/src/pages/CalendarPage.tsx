import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Clock, Trash2,
  Edit2, Bell, Cake, Briefcase, GraduationCap, Wallet, Receipt,
  Droplets, Pin, X, List, LayoutGrid, CalendarRange,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

// ---- Types ----
interface CalEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  end_date: string | null;
  end_time: string | null;
  category: string;
  recurrence: string | null;
  color: string | null;
  reminder_minutes: number[];
  is_auto: boolean;
  source_type: string | null;
  created_at: string;
}

type ViewMode = 'month' | 'week' | 'list';

const CATEGORIES = [
  { id: 'general', label: 'General', emoji: '📌', color: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300' },
  { id: 'birthday', label: 'Birthday', emoji: '🎂', color: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300' },
  { id: 'interview', label: 'Interview', emoji: '💼', color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' },
  { id: 'exam', label: 'Exam', emoji: '📝', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300' },
  { id: 'emi', label: 'EMI', emoji: '💰', color: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' },
  { id: 'bill', label: 'Bill', emoji: '🧾', color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300' },
  { id: 'period', label: 'Period', emoji: '🩸', color: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300' },
];

const REMINDER_OPTIONS = [
  { value: 0, label: 'At event time' },
  { value: 15, label: '15 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
];

const RECURRENCE_OPTIONS = [
  { value: '', label: 'No repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

function getCatConfig(cat: string) { return CATEGORIES.find(c => c.id === cat) ?? CATEGORIES[0]; }

function formatTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

// ==================== Main Page ====================
export function CalendarPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>('month');
  const [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showAdd, setShowAdd] = useState(false);
  const [editEvent, setEditEvent] = useState<CalEvent | null>(null);

  // ---- Query: user events for current month range ----
  const eventsQ = useQuery({
    queryKey: ['calendar-events', userId, month.year, month.month],
    enabled: !!userId,
    queryFn: async () => {
      // Fetch a wider range for recurring events visibility
      const start = `${month.year}-${String(month.month + 1).padStart(2, '0')}-01`;
      const endDate = new Date(month.year, month.month + 1, 0);
      const end = endDate.toISOString().slice(0, 10);
      const { data } = await supabase.from('calendar_events').select('*')
        .eq('user_id', userId!).gte('event_date', start).lte('event_date', end)
        .order('event_date').order('event_time');
      return (data ?? []) as CalEvent[];
    },
  });

  // ---- Query: EMI loans for auto-events ----
  const loansQ = useQuery({
    queryKey: ['loans-for-calendar', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('loans').select('id, name, emi_amount, emi_due_day')
        .eq('user_id', userId!).eq('status', 'active');
      return data ?? [];
    },
  });

  // ---- Query: Period cycles for auto-events ----
  const cyclesQ = useQuery({
    queryKey: ['period-cycles-cal', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('period_cycles').select('*')
        .eq('user_id', userId!).order('start_date', { ascending: false }).limit(12);
      return data ?? [];
    },
  });

  // ---- Compute all events for current month (real + auto) ----
  const allEvents = useMemo(() => {
    const real = eventsQ.data ?? [];
    const auto: CalEvent[] = [];
    const yr = month.year;
    const mo = month.month + 1;

    // EMI auto-events
    for (const loan of (loansQ.data ?? [])) {
      if (!loan.emi_due_day) continue;
      const day = Math.min(loan.emi_due_day, new Date(yr, mo, 0).getDate());
      const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      auto.push({
        id: `emi-${loan.id}-${dateStr}`,
        title: `EMI: ${loan.name}`,
        description: loan.emi_amount ? `₹${Number(loan.emi_amount).toLocaleString('en-IN')}` : null,
        event_date: dateStr,
        event_time: null,
        end_date: null,
        end_time: null,
        category: 'emi',
        recurrence: 'monthly',
        color: null,
        reminder_minutes: [],
        is_auto: true,
        source_type: 'emi',
        created_at: '',
      });
    }

    // Period prediction auto-events (simple: if we have cycles, predict next period for this month)
    const cycles = cyclesQ.data ?? [];
    if (cycles.length >= 2) {
      const lengths = cycles.slice(0, -1).map((c, i) => {
        const next = cycles[i + 1];
        return Math.round((new Date(c.start_date).getTime() - new Date(next.start_date).getTime()) / 86400000);
      }).filter(l => l > 18 && l < 45);
      if (lengths.length) {
        const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
        const lastStart = new Date(cycles[0].start_date);
        // Generate predictions
        let nextStart = new Date(lastStart.getTime() + avg * 86400000);
        for (let i = 0; i < 3; i++) {
          const ds = nextStart.toISOString().slice(0, 10);
          if (ds.startsWith(`${yr}-${String(mo).padStart(2, '0')}`)) {
            auto.push({
              id: `period-pred-${ds}`,
              title: 'Predicted Period',
              description: `~${avg} day cycle`,
              event_date: ds,
              event_time: null, end_date: null, end_time: null,
              category: 'period', recurrence: null, color: null,
              reminder_minutes: [], is_auto: true, source_type: 'period', created_at: '',
            });
            // Fertile window (~day 10-15 of predicted cycle)
            const fertileStart = new Date(nextStart.getTime() - (avg - 14 + 5) * 86400000);
            // Not adding as individual events to avoid clutter, just period marker
          }
          nextStart = new Date(nextStart.getTime() + avg * 86400000);
        }
      }
    }

    // Include recurring events from past months showing in current month
    // (basic: for 'yearly' recurrence, check if month/day match)
    const allCombined = [...real, ...auto];
    return allCombined;
  }, [eventsQ.data, loansQ.data, cyclesQ.data, month]);

  // Group by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of allEvents) {
      if (!map[e.event_date]) map[e.event_date] = [];
      map[e.event_date].push(e);
    }
    return map;
  }, [allEvents]);

  // ---- Mutations ----
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<CalEvent> & { id?: string }) => {
      if (data.id && !data.id.startsWith('emi-') && !data.id.startsWith('period-')) {
        const { error } = await supabase.from('calendar_events').update({
          ...data, updated_at: new Date().toISOString(),
        }).eq('id', data.id).eq('user_id', userId!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('calendar_events').insert({
          user_id: userId!, ...data,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events', userId] });
      toast.success(editEvent ? 'Event updated! ✨' : 'Event added! 🎉');
      setShowAdd(false);
      setEditEvent(null);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id).eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-events', userId] });
      toast.success('Event deleted');
    },
  });

  // ---- Selected date events ----
  const selectedEvents = eventsByDate[selectedDate] ?? [];

  // ==================== Render ====================
  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-blue-500" /> Calendar
        </h1>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className="flex rounded-lg border overflow-hidden">
            {([['month', LayoutGrid], ['week', CalendarRange], ['list', List]] as [ViewMode, any][]).map(([v, Icon]) => (
              <button key={v} onClick={() => setView(v)}
                className={cn('px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors',
                  view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                <Icon className="h-3.5 w-3.5" /> {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <Button onClick={() => { setEditEvent(null); setShowAdd(true); }} className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white">
            <Plus className="h-4 w-4" /> Event
          </Button>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => { const d = new Date(m.year, m.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="p-2 rounded-lg hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold min-w-[160px] text-center">
            {new Date(month.year, month.month).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })}
          </h2>
          <button onClick={() => setMonth(m => { const d = new Date(m.year, m.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="p-2 rounded-lg hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => { const d = new Date(); setMonth({ year: d.getFullYear(), month: d.getMonth() }); setSelectedDate(todayStr()); }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-muted">Today</button>
        </div>
        {/* Category legend */}
        <div className="hidden md:flex gap-2 flex-wrap">
          {CATEGORIES.slice(0, 5).map(c => (
            <span key={c.id} className="text-xs flex items-center gap-1 text-muted-foreground">
              <span>{c.emoji}</span>{c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Views */}
      {view === 'month' && (
        <MonthView
          year={month.year}
          month={month.month}
          eventsByDate={eventsByDate}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />
      )}
      {view === 'week' && (
        <WeekView
          selectedDate={selectedDate}
          eventsByDate={eventsByDate}
          onSelect={setSelectedDate}
        />
      )}
      {view === 'list' && (
        <ListView events={allEvents} onSelect={setSelectedDate} onEdit={e => { setEditEvent(e); setShowAdd(true); }} onDelete={id => { if (confirm('Delete this event?')) deleteMutation.mutate(id); }} />
      )}

      {/* Selected Day Panel */}
      {view !== 'list' && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </CardTitle>
            <span className="text-xs text-muted-foreground">{selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}</span>
          </CardHeader>
          <CardContent>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No events for this day</p>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map(e => (
                  <EventCard key={e.id} event={e}
                    onEdit={() => { if (!e.is_auto) { setEditEvent(e); setShowAdd(true); } }}
                    onDelete={() => { if (!e.is_auto && confirm(`Delete "${e.title}"?`)) deleteMutation.mutate(e.id); }}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <EventDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditEvent(null); }}
        existing={editEvent}
        defaultDate={selectedDate}
        onSave={(data) => saveMutation.mutate(data)}
        saving={saveMutation.isPending}
      />
    </div>
  );
}

// ==================== Month View ====================
function MonthView({ year, month, eventsByDate, selectedDate, onSelect }: {
  year: number; month: number; eventsByDate: Record<string, CalEvent[]>; selectedDate: string; onSelect: (d: string) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/50">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-[80px] border-t border-l" />;
          const day = parseInt(date.slice(-2));
          const isToday = date === todayStr();
          const isSelected = date === selectedDate;
          const dayEvents = eventsByDate[date] ?? [];

          return (
            <button
              key={i}
              onClick={() => onSelect(date)}
              className={cn(
                'min-h-[80px] border-t border-l p-1 text-left transition-colors hover:bg-muted/50 relative',
                isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium',
                isToday && 'bg-blue-500 text-white',
              )}>
                {day}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 3).map(e => {
                  const cat = getCatConfig(e.category);
                  return (
                    <div key={e.id} className={cn('text-[10px] px-1 py-0.5 rounded truncate border', cat.color)}>
                      {cat.emoji} {e.title}
                    </div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==================== Week View ====================
function WeekView({ selectedDate, eventsByDate, onSelect }: {
  selectedDate: string; eventsByDate: Record<string, CalEvent[]>; onSelect: (d: string) => void;
}) {
  // Get the week containing selectedDate (Sun-Sat)
  const sel = new Date(selectedDate + 'T00:00:00');
  const dayOfWeek = sel.getDay();
  const weekStart = new Date(sel.getTime() - dayOfWeek * 86400000);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(weekStart.getTime() + i * 86400000).toISOString().slice(0, 10));
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7">
        {days.map(date => {
          const d = new Date(date + 'T00:00:00');
          const isToday = date === todayStr();
          const isSelected = date === selectedDate;
          const dayEvents = eventsByDate[date] ?? [];

          return (
            <button key={date} onClick={() => onSelect(date)}
              className={cn('border-r last:border-r-0 p-2 min-h-[200px] text-left transition-colors hover:bg-muted/50',
                isSelected && 'bg-primary/5')}>
              <div className="text-center mb-2">
                <p className="text-[10px] text-muted-foreground uppercase">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                <p className={cn('text-sm font-semibold w-7 h-7 rounded-full inline-flex items-center justify-center',
                  isToday && 'bg-blue-500 text-white')}>
                  {d.getDate()}
                </p>
              </div>
              <div className="space-y-1">
                {dayEvents.map(e => {
                  const cat = getCatConfig(e.category);
                  return (
                    <div key={e.id} className={cn('text-[10px] px-1.5 py-1 rounded border', cat.color)}>
                      <div className="font-medium truncate">{cat.emoji} {e.title}</div>
                      {e.event_time && <div className="text-muted-foreground">{formatTime(e.event_time)}</div>}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==================== List View ====================
function ListView({ events, onSelect, onEdit, onDelete }: {
  events: CalEvent[]; onSelect: (d: string) => void; onEdit: (e: CalEvent) => void; onDelete: (id: string) => void;
}) {
  const upcoming = events
    .filter(e => e.event_date >= todayStr())
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.event_time ?? '').localeCompare(b.event_time ?? ''));

  if (!upcoming.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <CalendarDays className="h-12 w-12 mx-auto text-blue-400 mb-3" />
          <h3 className="font-semibold mb-1">No upcoming events</h3>
          <p className="text-sm text-muted-foreground">Add your first event to get started!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {upcoming.map(e => (
        <EventCard key={e.id} event={e}
          onEdit={() => { if (!e.is_auto) { onEdit(e); } onSelect(e.event_date); }}
          onDelete={() => { if (!e.is_auto && confirm(`Delete "${e.title}"?`)) onDelete(e.id); }}
          showDate
        />
      ))}
    </div>
  );
}

// ==================== Event Card ====================
function EventCard({ event, onEdit, onDelete, showDate }: { event: CalEvent; onEdit: () => void; onDelete: () => void; showDate?: boolean }) {
  const cat = getCatConfig(event.category);
  return (
    <motion.div
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn('flex items-center gap-3 p-3 rounded-lg border group transition-colors hover:bg-muted/50', cat.color)}
    >
      <span className="text-lg">{cat.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{event.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {showDate && (
            <span>{new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          )}
          {event.event_time && <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatTime(event.event_time)}</span>}
          {event.recurrence && <Badge variant="outline" className="text-[10px] px-1 py-0">🔁 {event.recurrence}</Badge>}
          {event.reminder_minutes.length > 0 && <Bell className="h-3 w-3 text-amber-500" />}
          {event.is_auto && <Badge variant="outline" className="text-[10px] px-1 py-0">auto</Badge>}
        </div>
        {event.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>}
      </div>
      {!event.is_auto && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-background"><Edit2 className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-background text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </motion.div>
  );
}

// ==================== Event Dialog ====================
function EventDialog({ open, onClose, existing, defaultDate, onSave, saving }: {
  open: boolean; onClose: () => void; existing: CalEvent | null; defaultDate: string;
  onSave: (data: any) => void; saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState('general');
  const [recurrence, setRecurrence] = useState('');
  const [reminders, setReminders] = useState<number[]>([]);

  // Reset / populate on open
  const populateForm = useCallback(() => {
    if (existing) {
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setEventDate(existing.event_date);
      setEventTime(existing.event_time?.slice(0, 5) ?? '');
      setEndDate(existing.end_date ?? '');
      setEndTime(existing.end_time?.slice(0, 5) ?? '');
      setCategory(existing.category);
      setRecurrence(existing.recurrence ?? '');
      setReminders(existing.reminder_minutes ?? []);
    } else {
      setTitle(''); setDescription(''); setEventDate(defaultDate); setEventTime('');
      setEndDate(''); setEndTime(''); setCategory('general'); setRecurrence('');
      setReminders([1440]); // default: 1 day before
    }
  }, [existing, defaultDate]);

  // Populate when dialog opens
  useMemo(() => { if (open) populateForm(); }, [open, populateForm]);

  const toggleReminder = (val: number) => {
    setReminders(r => r.includes(val) ? r.filter(x => x !== val) : [...r, val]);
  };

  const handleSubmit = () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!eventDate) { toast.error('Date is required'); return; }
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      event_date: eventDate,
      event_time: eventTime || null,
      end_date: endDate || null,
      end_time: endTime || null,
      category,
      recurrence: recurrence || null,
      reminder_minutes: reminders,
    };
    if (existing) payload.id = existing.id;
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-blue-500" />
            {existing ? 'Edit Event' : 'Add Event'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Mom's Birthday" />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>End date <span className="text-muted-foreground font-normal">(opt.)</span></Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End time <span className="text-muted-foreground font-normal">(opt.)</span></Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setCategory(c.id)}
                  className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                    category === c.id ? cn(c.color, 'ring-1 ring-primary/40') : 'border-border hover:bg-muted')}>
                  <span>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recurrence */}
          <div className="space-y-1.5">
            <Label>Repeat</Label>
            <div className="flex gap-2 flex-wrap">
              {RECURRENCE_OPTIONS.map(r => (
                <button key={r.value} onClick={() => setRecurrence(r.value)}
                  className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    recurrence === r.value ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'border-border hover:bg-muted')}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reminders */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Bell className="h-3.5 w-3.5 text-amber-500" /> Email Reminders</Label>
            <div className="flex gap-2 flex-wrap">
              {REMINDER_OPTIONS.map(r => (
                <button key={r.value} onClick={() => toggleReminder(r.value)}
                  className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                    reminders.includes(r.value)
                      ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'border-border hover:bg-muted')}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Any notes..."
              className="w-full h-16 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={saving}
            className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white">
            {saving ? 'Saving...' : existing ? '✨ Update' : '🎉 Add Event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
