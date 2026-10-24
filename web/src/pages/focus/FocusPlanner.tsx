import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, ListPlus, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export interface FocusTask {
  id: string;
  title: string;
  estimated_minutes: number;
  focused_seconds: number;
  status: string;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${m} min`;
  return h ? `${h} h` : `${m} min`;
}

const QUICK = [
  { label: '15 min', m: 15 }, { label: '30 min', m: 30 }, { label: '45 min', m: 45 },
  { label: '1 h', m: 60 }, { label: '1 h 30', m: 90 }, { label: '2 h', m: 120 },
];

function localYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  userId: string;
  activeTaskId: string | null;
  busy: boolean;
  onStart: (task: FocusTask) => void;
}

export function FocusPlanner({ userId, activeTaskId, busy, onStart }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('1');
  const [mins, setMins] = useState('0');

  const tasksQ = useQuery({
    queryKey: ['focus', 'tasks', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks')
        .select('id,title,estimated_minutes,focused_seconds,status')
        .eq('user_id', userId).not('estimated_minutes', 'is', null)
        .in('status', ['pending', 'in_progress'])
        .order('created_at', { ascending: true }).limit(50);
      if (error) throw error;
      return (data ?? []) as FocusTask[];
    },
  });

  const totalMinutes = Math.max(0, parseInt(hours || '0', 10) || 0) * 60 + Math.max(0, parseInt(mins || '0', 10) || 0);
  const valid = title.trim().length > 0 && totalMinutes >= 1 && totalMinutes <= 1440;

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks').insert({
        user_id: userId, title: title.trim(), estimated_minutes: totalMinutes,
        due_date: localYmd(), status: 'pending', priority: 'medium',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      qc.invalidateQueries({ queryKey: ['focus', 'tasks', userId] });
      toast.success('Task added to your focus plan');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doneMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks')
        .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['focus', 'tasks', userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['focus', 'tasks', userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = tasksQ.data ?? [];
  const plannedMin = tasks.reduce((s, t) => s + t.estimated_minutes, 0);
  const doneMin = tasks.reduce((s, t) => s + Math.min(t.estimated_minutes, Math.floor(t.focused_seconds / 60)), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ListPlus className="h-4 w-4 text-primary" /> Focus plan</CardTitle>
        <CardDescription>
          {tasks.length === 0
            ? 'Add what you want to work on and for how long, then press Start.'
            : `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${formatMinutes(plannedMin)} planned · ${formatMinutes(doneMin)} done`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (valid && !addMut.isPending) addMut.mutate(); }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
              placeholder="What will you work on? e.g. Learn Python" aria-label="Task name" className="flex-1"
            />
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} className="w-16 text-center" aria-label="Hours" />
              <span className="text-xs text-muted-foreground">h</span>
              <Input type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} className="w-16 text-center" aria-label="Minutes" />
              <span className="text-xs text-muted-foreground">min</span>
              <Button type="submit" disabled={!valid || addMut.isPending} className="gap-1.5">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.m} type="button"
                onClick={() => { setHours(String(Math.floor(q.m / 60))); setMins(String(q.m % 60)); }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  totalMinutes === q.m ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50',
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </form>

        {tasksQ.isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
        ) : tasks.length === 0 ? null : (
          <ul className="space-y-2">
            {tasks.map((t) => {
              const pct = Math.min(100, Math.round((t.focused_seconds / (t.estimated_minutes * 60)) * 100));
              const active = t.id === activeTaskId;
              return (
                <li key={t.id} className={cn('rounded-lg border p-3 transition-colors', active && 'border-primary bg-primary/5')}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" /> {formatMinutes(t.estimated_minutes)}
                        {t.focused_seconds > 0 && <span>· {formatMinutes(Math.floor(t.focused_seconds / 60))} focused</span>}
                        {active && <Badge variant="default" className="ml-1">In progress</Badge>}
                      </p>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => onStart(t)} className="gap-1.5">
                      <Play className="h-3.5 w-3.5" /> {t.focused_seconds > 0 ? 'Continue' : 'Start'}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Mark done" aria-label="Mark done" onClick={() => doneMut.mutate(t.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Delete" aria-label="Delete task" onClick={() => delMut.mutate(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-green-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
