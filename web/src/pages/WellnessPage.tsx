import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Droplets, Moon, Plus, Minus, Star, Settings2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine, Tooltip } from 'recharts';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { toast } from 'sonner';

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function last7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en', { weekday: 'short' });
}

function computeStreak(logs: { log_date: string; glasses: number; goal: number }[]): number {
  const sorted = [...logs].sort((a, b) => b.log_date.localeCompare(a.log_date));
  let streak = 0;
  const d = new Date();
  // start from yesterday (today may still be in progress)
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const log = sorted.find(l => l.log_date === ds);
    if (log && log.glasses >= log.goal) {
      streak++;
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  // Check if today also meets goal
  const todayStr = localToday();
  const todayLog = sorted.find(l => l.log_date === todayStr);
  if (todayLog && todayLog.glasses >= todayLog.goal) streak++;
  return streak;
}

function timeTo24(val: string): string {
  // Convert "11pm" or "11:30pm" to "23:00" etc.
  const m = val.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return val;
  let h = parseInt(m[1]);
  const min = m[2] || '00';
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function computeSleepHours(sleep: string, wake: string): number {
  const [sh, sm] = sleep.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let sleepMin = sh * 60 + sm;
  let wakeMin = wh * 60 + wm;
  if (wakeMin <= sleepMin) wakeMin += 24 * 60; // crossed midnight
  return Math.round((wakeMin - sleepMin) / 6) / 10; // 1 decimal
}

export function WellnessPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const todayStr = localToday();
  const week = last7Days();

  // --- Water ---
  const waterQ = useQuery({
    queryKey: ['water_logs', userId, week[0], week[6]],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('water_logs')
        .select('*')
        .eq('user_id', userId!)
        .gte('log_date', week[0])
        .lte('log_date', week[6])
        .order('log_date');
      return data ?? [];
    },
  });

  const todayWater = waterQ.data?.find(w => w.log_date === todayStr);
  const glasses = todayWater?.glasses ?? 0;
  const goal = todayWater?.goal ?? 8;

  const waterChartData = week.map(d => {
    const log = waterQ.data?.find(w => w.log_date === d);
    return { day: dayLabel(d), glasses: log?.glasses ?? 0, goal: log?.goal ?? goal };
  });

  const waterStreak = computeStreak(
    (waterQ.data ?? []).map(w => ({ log_date: w.log_date, glasses: w.glasses, goal: w.goal }))
  );

  const waterM = useMutation({
    mutationFn: async (delta: number) => {
      const newGlasses = Math.max(0, glasses + delta);
      const { error } = await supabase.from('water_logs').upsert(
        { user_id: userId!, log_date: todayStr, glasses: newGlasses, goal, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,log_date' }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['water_logs'] }),
  });

  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [newGoal, setNewGoal] = useState(String(goal));

  const setGoalM = useMutation({
    mutationFn: async (g: number) => {
      const { error } = await supabase.from('water_logs').upsert(
        { user_id: userId!, log_date: todayStr, glasses, goal: g, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,log_date' }
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['water_logs'] }); setShowGoalEdit(false); toast.success('Goal updated'); },
  });

  // --- Sleep ---
  const sleepQ = useQuery({
    queryKey: ['sleep_logs', userId, week[0], week[6]],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('sleep_logs')
        .select('*')
        .eq('user_id', userId!)
        .gte('log_date', week[0])
        .lte('log_date', week[6])
        .order('log_date');
      return data ?? [];
    },
  });

  const todaySleep = sleepQ.data?.find(s => s.log_date === todayStr);
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [sleepQuality, setSleepQuality] = useState(0);

  const sleepChartData = week.map(d => {
    const log = sleepQ.data?.find(s => s.log_date === d);
    return { day: dayLabel(d), hours: log?.total_hours ?? 0, quality: log?.quality ?? 0 };
  });

  const avgSleep = useMemo(() => {
    const logs = sleepQ.data?.filter(s => s.total_hours && s.total_hours > 0) ?? [];
    if (!logs.length) return { hours: 0, quality: 0 };
    return {
      hours: Math.round((logs.reduce((s, l) => s + (l.total_hours ?? 0), 0) / logs.length) * 10) / 10,
      quality: Math.round(logs.reduce((s, l) => s + (l.quality ?? 0), 0) / logs.length * 10) / 10,
    };
  }, [sleepQ.data]);

  const sleepM = useMutation({
    mutationFn: async () => {
      const st = timeTo24(sleepTime);
      const wt = timeTo24(wakeTime);
      const hours = computeSleepHours(st, wt);
      const { error } = await supabase.from('sleep_logs').upsert(
        {
          user_id: userId!,
          log_date: todayStr,
          sleep_time: st,
          wake_time: wt,
          total_hours: hours,
          quality: sleepQuality || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,log_date' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sleep_logs'] });
      toast.success('Sleep logged');
      setSleepTime(''); setWakeTime(''); setSleepQuality(0);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const progress = goal > 0 ? Math.min(glasses / goal, 1) : 0;
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - progress);

  return (
    <div className="space-y-6 pb-20">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Droplets className="h-6 w-6 text-cyan-500" /> Wellness
      </h1>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ===== WATER SECTION ===== */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5 justify-between">
                <span className="flex items-center gap-1.5"><Droplets className="h-4 w-4 text-cyan-500" /> Hydration</span>
                <button onClick={() => { setNewGoal(String(goal)); setShowGoalEdit(true); }} className="p-1 rounded hover:bg-accent text-muted-foreground">
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              {/* Progress Ring */}
              <div className="relative">
                <svg width={128} height={128} className="rotate-[-90deg]">
                  <circle cx={64} cy={64} r={54} fill="none" stroke="currentColor" strokeWidth={8} className="text-muted/30" />
                  <motion.circle
                    cx={64} cy={64} r={54} fill="none" strokeWidth={8}
                    stroke="url(#waterGrad)"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 0.6 }}
                  />
                  <defs>
                    <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#06b6d4" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold">{glasses}</span>
                  <span className="text-xs text-muted-foreground">/ {goal} glasses</span>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => waterM.mutate(-1)} disabled={glasses === 0}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Button onClick={() => waterM.mutate(1)} className="bg-cyan-600 hover:bg-cyan-700 text-white px-6">
                  <Plus className="h-4 w-4 mr-1" /> 1 Glass
                </Button>
                <Button variant="outline" size="sm" onClick={() => waterM.mutate(2)}>+2</Button>
                <Button variant="outline" size="sm" onClick={() => waterM.mutate(3)}>+3</Button>
              </div>

              {/* Streak */}
              {waterStreak > 0 && (
                <p className="text-sm text-muted-foreground">🔥 {waterStreak} day streak</p>
              )}
            </CardContent>
          </Card>

          {/* Water chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={waterChartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis hide domain={[0, 'dataMax + 2']} />
                  <ReferenceLine y={goal} stroke="#06b6d4" strokeDasharray="3 3" />
                  <Bar dataKey="glasses" radius={[4, 4, 0, 0]}>
                    {waterChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.glasses >= entry.goal ? '#06b6d4' : '#94a3b8'} />
                    ))}
                  </Bar>
                  <Tooltip />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* ===== SLEEP SECTION ===== */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Moon className="h-4 w-4 text-indigo-500" /> Sleep
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Last night summary */}
              {todaySleep ? (
                <div className="text-center p-4 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl">
                  <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                    {todaySleep.total_hours}h
                  </p>
                  <div className="flex justify-center gap-0.5 mt-1">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={cn('h-4 w-4', s <= (todaySleep.quality ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'text-muted')} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {todaySleep.sleep_time} → {todaySleep.wake_time}
                  </p>
                </div>
              ) : (
                <div className="text-center p-4 bg-muted/50 rounded-xl">
                  <p className="text-sm text-muted-foreground">No sleep logged today</p>
                </div>
              )}

              {/* Log sleep form */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Log last night's sleep</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Bed time (e.g. 11pm)" value={sleepTime} onChange={e => setSleepTime(e.target.value)} />
                  <Input placeholder="Wake time (e.g. 7am)" value={wakeTime} onChange={e => setWakeTime(e.target.value)} />
                </div>
                {/* Quality stars */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Quality</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(s => (
                      <button key={s} onClick={() => setSleepQuality(s)} className="p-1">
                        <Star className={cn('h-6 w-6 transition-colors', s <= sleepQuality ? 'fill-yellow-400 text-yellow-400' : 'text-muted hover:text-yellow-300')} />
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={() => sleepM.mutate()}
                  disabled={!sleepTime || !wakeTime || sleepM.isPending}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Log Sleep
                </Button>
              </div>

              {/* Averages */}
              {avgSleep.hours > 0 && (
                <div className="flex justify-between text-sm border-t pt-3">
                  <span className="text-muted-foreground">Avg this week</span>
                  <span className="font-medium">{avgSleep.hours}h · ⭐{avgSleep.quality}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sleep chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={sleepChartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis hide domain={[0, 12]} />
                  <ReferenceLine y={8} stroke="#6366f1" strokeDasharray="3 3" />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {sleepChartData.map((entry, i) => {
                      const q = entry.quality;
                      const color = q >= 4 ? '#22c55e' : q >= 3 ? '#eab308' : q >= 1 ? '#ef4444' : '#94a3b8';
                      return <Cell key={i} fill={color} />;
                    })}
                  </Bar>
                  <Tooltip />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Goal edit dialog */}
      <Dialog open={showGoalEdit} onOpenChange={setShowGoalEdit}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Daily Water Goal</DialogTitle></DialogHeader>
          <Input type="number" min={1} max={20} value={newGoal} onChange={e => setNewGoal(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoalEdit(false)}>Cancel</Button>
            <Button onClick={() => setGoalM.mutate(parseInt(newGoal) || 8)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
