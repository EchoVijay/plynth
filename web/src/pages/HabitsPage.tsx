import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Plus, Trash2, Archive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

// ---- Constants ----
const COLORS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'pink', 'orange'] as const;
const COLOR_MAP: Record<string, string> = {
  violet: 'stroke-violet-500', blue: 'stroke-blue-500', cyan: 'stroke-cyan-500',
  emerald: 'stroke-emerald-500', amber: 'stroke-amber-500', rose: 'stroke-rose-500',
  pink: 'stroke-pink-500', orange: 'stroke-orange-500',
};
const COLOR_BG: Record<string, string> = {
  violet: 'bg-violet-500/10', blue: 'bg-blue-500/10', cyan: 'bg-cyan-500/10',
  emerald: 'bg-emerald-500/10', amber: 'bg-amber-500/10', rose: 'bg-rose-500/10',
  pink: 'bg-pink-500/10', orange: 'bg-orange-500/10',
};
const EMOJIS = ['✅', '🏋️', '📚', '🧘', '💧', '🏃', '🎨', '✍️', '🛌', '🥗', '💊', '🎵', '🧹', '💻', '🌱', '🙏'];
const FREQ_LABELS: Record<string, string> = { daily: 'Every day', weekdays: 'Mon–Fri', weekends: 'Sat–Sun', custom: 'Custom' };

type Habit = { id: string; name: string; emoji: string; frequency: string; custom_days: number[]; target_per_day: number; color: string; archived: boolean; created_at: string };
type Checkin = { id: string; habit_id: string; check_date: string; count: number };

function today(): string { return new Date().toISOString().slice(0, 10); }

function isDueToday(h: Habit): boolean {
  const dow = new Date().getDay();
  if (h.frequency === 'daily') return true;
  if (h.frequency === 'weekdays') return dow >= 1 && dow <= 5;
  if (h.frequency === 'weekends') return dow === 0 || dow === 6;
  return (h.custom_days ?? []).includes(dow);
}

function computeStreak(checkins: Checkin[], habit: Habit): { current: number; best: number } {
  if (!checkins.length) return { current: 0, best: 0 };
  const dates = new Set(checkins.filter(c => c.count >= habit.target_per_day).map(c => c.check_date));
  let current = 0;
  let best = 0;
  let streak = 0;
  const d = new Date();
  // Start from yesterday (today might not be done yet)
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const ds = d.toISOString().slice(0, 10);
    if (dates.has(ds)) {
      streak++;
      best = Math.max(best, streak);
    } else {
      if (i === 0) { /* yesterday not done, check if today is done */
        const todayDone = dates.has(today());
        if (todayDone) { streak = 1; best = Math.max(best, 1); }
      }
      if (streak > 0 && i > 0) break;
    }
    d.setDate(d.getDate() - 1);
  }
  current = streak;
  // Also check if today extends the streak
  if (dates.has(today()) && current > 0) current++;
  else if (dates.has(today()) && current === 0) current = 1;
  best = Math.max(best, current);
  return { current, best };
}

// ---- Progress Ring Component ----
function ProgressRing({ progress, size = 56, stroke = 5, color }: { progress: number; size?: number; stroke?: number; color: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(progress, 1));
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        className="stroke-muted" strokeWidth={stroke} />
      <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        className={COLOR_MAP[color] ?? 'stroke-violet-500'}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  );
}

// ---- Confetti Particles ----
function Confetti({ show }: { show: boolean }) {
  if (!show) return null;
  const particles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 360;
    const distance = 30 + Math.random() * 20;
    const x = Math.cos(angle * Math.PI / 180) * distance;
    const y = Math.sin(angle * Math.PI / 180) * distance;
    const colors = ['bg-violet-400', 'bg-pink-400', 'bg-amber-400', 'bg-emerald-400', 'bg-blue-400'];
    return { x, y, color: colors[i % colors.length], delay: Math.random() * 0.1 };
  });
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {particles.map((p, i) => (
        <motion.div key={i}
          className={`absolute w-1.5 h-1.5 rounded-full ${p.color}`}
          initial={{ scale: 0, x: 0, y: 0, opacity: 1 }}
          animate={{ scale: [0, 1.2, 0], x: p.x, y: p.y, opacity: [1, 1, 0] }}
          transition={{ duration: 0.6, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

// ---- Habit Card ----
function HabitCard({ habit, checkin, streak, onCheckin, onDelete, onArchive }: {
  habit: Habit; checkin: Checkin | undefined; streak: { current: number; best: number };
  onCheckin: () => void; onDelete: () => void; onArchive: () => void;
}) {
  const count = checkin?.count ?? 0;
  const progress = count / habit.target_per_day;
  const isComplete = count >= habit.target_per_day;
  const [showConfetti, setShowConfetti] = useState(false);
  const due = isDueToday(habit);

  function handleCheckin() {
    if (!due) return;
    onCheckin();
    if (count + 1 >= habit.target_per_day && !isComplete) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 800);
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
      className={cn('relative rounded-xl border p-4 flex items-center gap-4 transition-all',
        COLOR_BG[habit.color] ?? 'bg-violet-500/10',
        !due && 'opacity-50',
        isComplete && 'ring-2 ring-emerald-400/50'
      )}>
      <Confetti show={showConfetti} />

      {/* Emoji + Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{habit.emoji}</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{habit.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-muted-foreground">{FREQ_LABELS[habit.frequency]}</span>
              {streak.current > 0 && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="flex items-center gap-0.5">
                  <Badge variant={streak.current === streak.best ? 'warning' : 'secondary'} className="text-[10px] px-1.5 py-0">
                    <Flame className="h-3 w-3 mr-0.5" />{streak.current}
                  </Badge>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Ring */}
      <div className="relative flex items-center justify-center">
        <ProgressRing progress={progress} color={habit.color} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold">{count}/{habit.target_per_day}</span>
        </div>
      </div>

      {/* Check-in Button */}
      <motion.button whileTap={{ scale: 0.9 }} onClick={handleCheckin} disabled={!due}
        className={cn('flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold transition-all shadow-md',
          isComplete ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-primary shadow-primary/30',
          !due && 'bg-muted text-muted-foreground shadow-none cursor-not-allowed'
        )}>
        {isComplete ? '✓' : '+'}
      </motion.button>

      {/* Actions (shown on hover/focus) */}
      <div className="absolute top-1 right-1 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity flex gap-0.5">
        <button onClick={onArchive} className="p-1 rounded hover:bg-background/80" title="Archive">
          <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-background/80" title="Delete">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </motion.div>
  );
}

// ---- Heatmap ----
function Heatmap({ checkins, habit }: { checkins: Checkin[]; habit: Habit }) {
  const cells = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of checkins) map.set(c.check_date, (map.get(c.check_date) ?? 0) + c.count);
    const days: { date: string; level: number }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 34); // ~5 weeks
    for (let i = 0; i < 35; i++) {
      const ds = d.toISOString().slice(0, 10);
      const count = map.get(ds) ?? 0;
      const level = count === 0 ? 0 : count >= habit.target_per_day ? 3 : count >= habit.target_per_day / 2 ? 2 : 1;
      days.push({ date: ds, level });
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [checkins, habit.target_per_day]);

  const levelColors = ['bg-muted', 'bg-emerald-200 dark:bg-emerald-900', 'bg-emerald-400 dark:bg-emerald-700', 'bg-emerald-600 dark:bg-emerald-500'];
  return (
    <div className="flex flex-wrap gap-0.5">
      {cells.map(c => (
        <div key={c.date} title={`${c.date}: ${c.level > 0 ? 'done' : 'missed'}`}
          className={cn('w-3 h-3 rounded-sm', levelColors[c.level])} />
      ))}
    </div>
  );
}

// ---- Date Strip ----
function DateStrip({ selected, onSelect }: { selected: string; onSelect: (d: string) => void }) {
  const days = useMemo(() => {
    const result: { date: string; label: string; dow: string }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
      result.push({
        date: d.toISOString().slice(0, 10),
        label: String(d.getDate()),
        dow: short[d.getDay()],
      });
      d.setDate(d.getDate() + 1);
    }
    return result;
  }, []);

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {days.map(d => {
        const isToday = d.date === today();
        const isSel = d.date === selected;
        return (
          <button key={d.date} onClick={() => onSelect(d.date)}
            className={cn('flex flex-col items-center px-3 py-2 rounded-xl min-w-[3rem] transition-all',
              isSel ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30' : 'bg-muted/50 hover:bg-muted',
              isToday && !isSel && 'ring-2 ring-primary/30'
            )}>
            <span className="text-[10px] font-medium uppercase">{d.dow}</span>
            <span className="text-lg font-bold">{d.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Add Habit Form ----
function AddHabitForm({ userId, onCreated }: { userId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✅');
  const [frequency, setFrequency] = useState('daily');
  const [target, setTarget] = useState(1);
  const [color, setColor] = useState<string>('violet');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('habits').insert({
      user_id: userId, name: name.trim(), emoji, frequency, target_per_day: Math.max(1, target), color,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Habit created!');
    onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Emoji</Label>
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map(e => (
            <motion.button key={e} type="button" whileTap={{ scale: 0.85 }}
              onClick={() => setEmoji(e)}
              className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all',
                emoji === e ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted hover:bg-muted/80'
              )}>{e}</motion.button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Read 30 min" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Frequency</Label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm">
            <option value="daily">Every day</option>
            <option value="weekdays">Mon–Fri</option>
            <option value="weekends">Sat–Sun</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Target / day</Label>
          <Input type="number" min={1} max={99} value={target} onChange={e => setTarget(Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex gap-2">
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)}
              className={cn('w-7 h-7 rounded-full transition-all',
                `bg-${c}-500`,
                color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'opacity-60 hover:opacity-100'
              )} />
          ))}
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating...' : 'Create Habit'}</Button>
      </DialogFooter>
    </form>
  );
}

// ---- Main Page ----
export function HabitsPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(today());
  const [addOpen, setAddOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const habitsQ = useQuery({
    queryKey: ['habits', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('habits').select('*').eq('user_id', userId!).order('created_at');
      return (data ?? []) as Habit[];
    },
  });

  // Fetch last 90 days of checkins for streaks
  const checkinsQ = useQuery({
    queryKey: ['habit_checkins', userId, selectedDate],
    enabled: !!userId,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 90);
      const { data } = await supabase.from('habit_checkins').select('*')
        .eq('user_id', userId!).gte('check_date', from.toISOString().slice(0, 10));
      return (data ?? []) as Checkin[];
    },
  });

  const checkinM = useMutation({
    mutationFn: async ({ habitId, date }: { habitId: string; date: string }) => {
      // Upsert: increment count or insert 1
      const existing = (checkinsQ.data ?? []).find(c => c.habit_id === habitId && c.check_date === date);
      if (existing) {
        const { error } = await supabase.from('habit_checkins')
          .update({ count: existing.count + 1 }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('habit_checkins')
          .insert({ habit_id: habitId, user_id: userId!, check_date: date, count: 1 });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habit_checkins', userId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const archiveM = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from('habits').update({ archived }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits', userId] }); toast.success('Updated'); },
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('habits').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits', userId] }); toast.success('Deleted'); },
  });

  const activeHabits = (habitsQ.data ?? []).filter(h => !h.archived);
  const archivedHabits = (habitsQ.data ?? []).filter(h => h.archived);
  const dueToday = activeHabits.filter(isDueToday);
  const completedToday = dueToday.filter(h => {
    const c = (checkinsQ.data ?? []).find(ci => ci.habit_id === h.id && ci.check_date === selectedDate);
    return (c?.count ?? 0) >= h.target_per_day;
  });

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Habits</h1>
          {completedToday.length === dueToday.length && dueToday.length > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-xl">🎉</motion.span>
          )}
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Add Habit</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Habit</DialogTitle></DialogHeader>
            <AddHabitForm userId={userId!} onCreated={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['habits', userId] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary bar */}
      {dueToday.length > 0 && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ProgressRing progress={dueToday.length ? completedToday.length / dueToday.length : 0} size={48} stroke={4} color="emerald" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Flame className="h-4 w-4 text-orange-500" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold">{completedToday.length}/{dueToday.length} done today</p>
                  <p className="text-xs text-muted-foreground">
                    {completedToday.length === dueToday.length ? 'All habits completed! 🔥' : `${dueToday.length - completedToday.length} remaining`}
                  </p>
                </div>
              </div>
              {/* Longest active streak */}
              {activeHabits.length > 0 && (() => {
                const best = Math.max(...activeHabits.map(h => computeStreak((checkinsQ.data ?? []).filter(c => c.habit_id === h.id), h).current));
                return best > 0 ? (
                  <Badge variant="warning" className="gap-1"><Flame className="h-3.5 w-3.5" />{best}-day streak</Badge>
                ) : null;
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Strip */}
      <DateStrip selected={selectedDate} onSelect={setSelectedDate} />

      {/* Habits List */}
      {habitsQ.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : activeHabits.length === 0 ? (
        <EmptyState icon={Flame} title="No habits yet" description="Create your first daily habit to start building streaks." />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {activeHabits.map(habit => {
              const checkin = (checkinsQ.data ?? []).find(c => c.habit_id === habit.id && c.check_date === selectedDate);
              const streak = computeStreak((checkinsQ.data ?? []).filter(c => c.habit_id === habit.id), habit);
              return (
                <HabitCard key={habit.id} habit={habit} checkin={checkin} streak={streak}
                  onCheckin={() => checkinM.mutate({ habitId: habit.id, date: selectedDate })}
                  onDelete={() => deleteM.mutate(habit.id)}
                  onArchive={() => archiveM.mutate({ id: habit.id, archived: true })}
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Heatmaps */}
      {activeHabits.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Activity (last 5 weeks)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {activeHabits.slice(0, 5).map(h => (
              <div key={h.id} className="flex items-center gap-3">
                <span className="w-6 text-center">{h.emoji}</span>
                <Heatmap checkins={(checkinsQ.data ?? []).filter(c => c.habit_id === h.id)} habit={h} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Archived */}
      {archivedHabits.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Archive className="h-3.5 w-3.5" /> {archivedHabits.length} archived
          </summary>
          <div className="mt-2 space-y-2">
            {archivedHabits.map(h => (
              <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <span className="text-sm">{h.emoji} {h.name}</span>
                <Button size="sm" variant="ghost" onClick={() => archiveM.mutate({ id: h.id, archived: false })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
