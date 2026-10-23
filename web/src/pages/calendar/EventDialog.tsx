import { useState } from 'react';
import { Bell, CalendarDays, Clock, MapPin, Repeat, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input, Label } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import {
  addDaysYmd, diffDaysYmd, isAllDay, MINUTES_IN_DAY, minToTime, parseYmd, toMin, ymd,
} from './schedule';
import type { NewSlot } from './TimeGrid';
import {
  CATEGORIES, COLORS, RECURRENCE_OPTIONS, REMINDER_OPTIONS, getCategory, type CalEvent,
} from './types';

export interface EventPayload {
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  event_time: string | null;
  end_date: string | null;
  end_time: string | null;
  is_all_day: boolean;
  category: string;
  recurrence: string | null;
  color: string | null;
  reminder_minutes: number[];
}

interface EventDialogProps {
  existing: CalEvent | null;
  initial: NewSlot | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: EventPayload, id?: string) => void;
  onDelete?: (event: CalEvent) => void;
}

// Minutes since 1970-01-01 in local time, used to compare date+time pairs.
const stamp = (date: string, time: string) => diffDaysYmd(date, '1970-01-01') * MINUTES_IN_DAY + toMin(time);
const fromStamp = (s: number) => ({
  date: addDaysYmd('1970-01-01', Math.floor(s / MINUTES_IN_DAY)),
  time: minToTime(((s % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY),
});

const selectClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function EventDialog({ existing, initial, saving, onClose, onSave, onDelete }: EventDialogProps) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [allDay, setAllDay] = useState(existing ? isAllDay(existing) : initial?.allDay ?? false);
  const [startDate, setStartDate] = useState(existing?.event_date ?? initial?.date ?? ymd(new Date()));
  const [startTime, setStartTime] = useState(existing?.event_time?.slice(0, 5) ?? minToTime(initial?.startMin ?? 9 * 60));
  const [endDate, setEndDate] = useState(existing ? existing.end_date ?? existing.event_date : initial?.date ?? ymd(new Date()));
  const [endTime, setEndTime] = useState(
    existing?.end_time?.slice(0, 5) ?? minToTime(Math.min(initial?.endMin ?? 10 * 60, MINUTES_IN_DAY - 1)),
  );
  const [category, setCategory] = useState(existing?.category ?? 'work');
  const [color, setColor] = useState(existing?.color ?? '');
  const [recurrence, setRecurrence] = useState(existing?.recurrence ?? '');
  const [reminders, setReminders] = useState<number[]>(existing?.reminder_minutes ?? [15]);
  const [location, setLocation] = useState(existing?.location ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');

  // Keep the event length when the start moves, like Teams does.
  const changeStartDate = (d: string) => {
    setEndDate(addDaysYmd(endDate, diffDaysYmd(d, startDate)));
    setStartDate(d);
  };
  const changeStartTime = (t: string) => {
    if (!t) return;
    const duration = stamp(endDate, endTime) - stamp(startDate, startTime);
    const end = fromStamp(stamp(startDate, t) + Math.max(duration, 15));
    setStartTime(t);
    setEndDate(end.date);
    setEndTime(end.time);
  };

  const toggleReminder = (v: number) =>
    setReminders(r => (r.includes(v) ? r.filter(x => x !== v) : [...r, v].sort((a, b) => a - b)));

  const submit = () => {
    if (!title.trim()) { toast.error('Add a title'); return; }
    if (allDay ? endDate < startDate : stamp(endDate, endTime) <= stamp(startDate, startTime)) {
      toast.error('End must be after start');
      return;
    }
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      event_date: startDate,
      event_time: allDay ? null : startTime,
      end_date: endDate !== startDate ? endDate : null,
      end_time: allDay ? null : endTime,
      is_all_day: allDay,
      category,
      recurrence: recurrence || null,
      color: color || null,
      reminder_minutes: reminders,
    }, existing?.id);
  };

  const categories = CATEGORIES.filter(c => c.pickable || c.id === category);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-indigo-500" />
            {existing ? 'Edit work block' : 'New work block'}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); submit(); }}
        >
          <Input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Add a title (e.g. Deep work: API design)"
            className="h-11 text-base"
            aria-label="Title"
          />

          <div className="flex flex-wrap gap-1.5">
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  category === c.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
                )}
              >
                <span>{c.emoji}</span>{c.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="all-day" className="flex-1">All day</Label>
            <Switch id="all-day" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <DateField value={startDate} onChange={changeStartDate} label="Start date" />
            {!allDay && (
              <Input type="time" value={startTime} onChange={e => changeStartTime(e.target.value)} className="w-32" aria-label="Start time" required />
            )}
            <DateField value={endDate} onChange={setEndDate} label="End date" min={startDate} />
            {!allDay && (
              <Input type="time" value={endTime} onChange={e => e.target.value && setEndTime(e.target.value)} className="w-32" aria-label="End time" required />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" /> Repeat</Label>
            <select value={recurrence} onChange={e => setRecurrence(e.target.value)} className={selectClass}>
              {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {existing?.recurrence && (
              <p className="text-xs text-muted-foreground">
                Changes apply to the whole series (started {format(parseYmd(existing.event_date), 'MMM d, yyyy')}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5 text-amber-500" /> Email reminders</Label>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_OPTIONS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => toggleReminder(r.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    reminders.includes(r.value)
                      ? 'border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Location</Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Office, home, library…" />
          </div>

          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setColor('')}
                className={cn('rounded-full border px-2.5 py-1 text-xs', !color ? 'border-primary text-primary' : 'border-border hover:bg-muted')}
              >
                Auto ({getCategory(category).label})
              </button>
              {Object.entries(COLORS).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(key)}
                  className={cn('h-6 w-6 rounded-full', c.swatch, color === key && 'ring-2 ring-offset-2 ring-offset-background ring-primary')}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Goals, links, things to prepare…"
              className="w-full h-20 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <DialogFooter className="sm:justify-between">
            {existing && onDelete ? (
              <Button type="button" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => onDelete(existing)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white">
                {saving ? 'Saving…' : existing ? 'Save' : 'Schedule'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DateField({ value, onChange, label, min }: { value: string; onChange: (v: string) => void; label: string; min?: string }) {
  const [open, setOpen] = useState(false);
  const date = parseYmd(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={label} className="w-full justify-start font-normal px-3">
          <CalendarDays className="h-4 w-4" /> {format(date, 'EEE, MMM d, yyyy')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          disabled={min ? { before: parseYmd(min) } : undefined}
          onSelect={d => { if (d) { onChange(ymd(d)); setOpen(false); } }}
        />
      </PopoverContent>
    </Popover>
  );
}
