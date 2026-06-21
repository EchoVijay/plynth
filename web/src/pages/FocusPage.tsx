import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Play, Pause, Square, RotateCcw, TreePine, Clock, Zap, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import { TreeComponent, TREE_SPECIES, type TreeSpeciesKey } from '@/components/trees';

// ---- Types ----
type FocusSession = {
  id: string; user_id: string; task_id: string | null;
  tree_species: string; duration_seconds: number; actual_seconds: number;
  mode: 'timer' | 'stopwatch'; status: 'completed' | 'abandoned' | 'in_progress';
  started_at: string; completed_at: string | null; created_at: string;
};
type TimerState = 'idle' | 'running' | 'paused' | 'completed' | 'abandoned';

// ---- Constants ----
const DURATION_PRESETS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '25m', seconds: 25 * 60 },
  { label: '45m', seconds: 45 * 60 },
  { label: '60m', seconds: 60 * 60 },
];
const ABANDON_THRESHOLD = 10; // seconds hidden before auto-abandon

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---- Main Component ----
export function FocusPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  // Timer state
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [mode, setMode] = useState<'timer' | 'stopwatch'>('timer');
  const [durationSeconds, setDurationSeconds] = useState(25 * 60);
  const [elapsed, setElapsed] = useState(0);
  const [species, setSpecies] = useState<TreeSpeciesKey>('cedar');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [customMinutes, setCustomMinutes] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);

  // Queries
  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('unlocked_trees').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });
  const unlockedTrees: string[] = profileQ.data?.unlocked_trees ?? ['cedar', 'bush'];

  const todaySessionsQ = useQuery({
    queryKey: ['focus', 'today', userId, today],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('focus_sessions')
        .select('*')
        .eq('user_id', userId!)
        .gte('started_at', today + 'T00:00:00')
        .order('started_at', { ascending: false });
      return (data ?? []) as FocusSession[];
    },
  });

  const statsQ = useQuery({
    queryKey: ['focus', 'stats', userId],
    enabled: !!userId,
    queryFn: async () => {
      // Last 30 days
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from('focus_sessions')
        .select('actual_seconds,status,started_at,tree_species')
        .eq('user_id', userId!)
        .eq('status', 'completed')
        .gte('started_at', since + 'T00:00:00');
      const sessions = data ?? [];
      const totalSec = sessions.reduce((s, r) => s + r.actual_seconds, 0);
      const totalSessions = sessions.length;
      // Count unique days
      const days = new Set(sessions.map(s => s.started_at.slice(0, 10)));
      // Species breakdown
      const bySpecies: Record<string, number> = {};
      for (const s of sessions) bySpecies[s.tree_species] = (bySpecies[s.tree_species] ?? 0) + 1;
      return { totalSec, totalSessions, uniqueDays: days.size, bySpecies };
    },
  });

  // Check for unlocks
  const totalCompleted = statsQ.data?.totalSessions ?? 0;
  useEffect(() => {
    if (!userId || !statsQ.data) return;
    const newUnlocks: string[] = [];
    for (const sp of TREE_SPECIES) {
      if (sp.unlock > 0 && sp.unlock <= totalCompleted && !unlockedTrees.includes(sp.key)) {
        newUnlocks.push(sp.key);
      }
    }
    if (newUnlocks.length > 0) {
      const updated = [...unlockedTrees, ...newUnlocks];
      supabase.from('profiles').update({ unlocked_trees: updated }).eq('user_id', userId).then(() => {
        qc.invalidateQueries({ queryKey: ['profile', userId] });
        for (const k of newUnlocks) {
          const sp = TREE_SPECIES.find(s => s.key === k);
          if (sp) toast.success(`🎉 New tree unlocked: ${sp.emoji} ${sp.name}!`);
        }
      });
    }
  }, [totalCompleted, unlockedTrees, userId]);

  // Mutations
  const startMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('focus_sessions').insert({
        user_id: userId!, tree_species: species, duration_seconds: mode === 'timer' ? durationSeconds : 0,
        mode, status: 'in_progress', started_at: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      setActiveSessionId(id);
      setTimerState('running');
      setElapsed(0);
    },
  });

  const finishMut = useMutation({
    mutationFn: async ({ status }: { status: 'completed' | 'abandoned' }) => {
      if (!activeSessionId) return;
      await supabase.from('focus_sessions').update({
        actual_seconds: elapsed, status, completed_at: new Date().toISOString(),
      }).eq('id', activeSessionId);
    },
    onSuccess: (_, { status }) => {
      setTimerState(status);
      setActiveSessionId(null);
      qc.invalidateQueries({ queryKey: ['focus'] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
      if (status === 'completed') toast.success('🌳 Focus session complete! Tree planted.');
      else toast('🥀 Session abandoned. Tree withered.');
    },
  });

  // Interval tick
  useEffect(() => {
    if (timerState !== 'running') {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setElapsed(prev => {
        const next = prev + 1;
        if (mode === 'timer' && next >= durationSeconds) {
          finishMut.mutate({ status: 'completed' });
          return durationSeconds;
        }
        return next;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerState, mode, durationSeconds]);

  // Tab visibility anti-cheat
  useEffect(() => {
    function handleVisibility() {
      if (timerState !== 'running') return;
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else {
        if (hiddenAtRef.current) {
          const awaySeconds = (Date.now() - hiddenAtRef.current) / 1000;
          hiddenAtRef.current = null;
          if (awaySeconds > ABANDON_THRESHOLD) {
            finishMut.mutate({ status: 'abandoned' });
            toast.error(`You left for ${Math.round(awaySeconds)}s — tree withered! 🥀`);
          }
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [timerState]);

  // Progress
  const progress = mode === 'timer'
    ? Math.min(elapsed / durationSeconds, 1)
    : Math.min(elapsed / 3600, 1); // stopwatch caps visual at 1h

  const remaining = mode === 'timer' ? Math.max(durationSeconds - elapsed, 0) : elapsed;

  // Handlers
  const handleStart = useCallback(() => {
    if (customMinutes) {
      const m = parseInt(customMinutes, 10);
      if (m > 0 && m <= 180) setDurationSeconds(m * 60);
    }
    startMut.mutate();
  }, [customMinutes, startMut]);

  const handlePause = () => setTimerState('paused');
  const handleResume = () => setTimerState('running');
  const handleStop = () => finishMut.mutate({ status: 'abandoned' });
  const handleComplete = () => finishMut.mutate({ status: 'completed' });

  const handleReset = () => {
    setTimerState('idle');
    setElapsed(0);
    setActiveSessionId(null);
  };

  // Today's completed sessions
  const completedToday = (todaySessionsQ.data ?? []).filter(s => s.status === 'completed');
  const todayTotalSec = completedToday.reduce((s, r) => s + r.actual_seconds, 0);

  const isIdle = timerState === 'idle' || timerState === 'completed' || timerState === 'abandoned';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Timer className="h-6 w-6 text-primary" /> Focus Timer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay focused, grow trees</p>
        </div>
        {statsQ.data && (
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><TreePine className="h-4 w-4" /> {statsQ.data.totalSessions} trees</span>
            <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {formatDuration(statsQ.data.totalSec)}</span>
          </div>
        )}
      </div>

      {/* Main Timer Card */}
      <Card className="overflow-hidden">
        <div className="relative">
          {/* Sky gradient background */}
          <div className={cn(
            'absolute inset-0 transition-all duration-1000',
            timerState === 'running'
              ? 'bg-gradient-to-b from-sky-100 via-sky-50 to-green-100 dark:from-sky-950 dark:via-sky-900 dark:to-green-950'
              : timerState === 'abandoned'
              ? 'bg-gradient-to-b from-gray-200 via-gray-100 to-gray-200 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900'
              : timerState === 'completed'
              ? 'bg-gradient-to-b from-amber-50 via-sky-50 to-green-100 dark:from-amber-950 dark:via-sky-950 dark:to-green-950'
              : 'bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950'
          )} />
          
          <CardContent className="relative p-8 flex flex-col items-center">
            {/* Tree visualization */}
            <motion.div
              className="mb-4"
              animate={{ scale: timerState === 'completed' ? [1, 1.05, 1] : 1 }}
              transition={{ duration: 0.5 }}
            >
              <TreeComponent
                species={species}
                stage={isIdle && timerState === 'idle' ? 0 : progress}
                dead={timerState === 'abandoned'}
                size={160}
              />
            </motion.div>

            {/* Timer display */}
            <motion.div
              className="text-5xl font-mono font-bold tabular-nums mb-2"
              key={timerState}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {formatTime(remaining)}
            </motion.div>

            {/* Status badge */}
            <AnimatePresence mode="wait">
              <motion.div key={timerState} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Badge variant={
                  timerState === 'running' ? 'default' :
                  timerState === 'paused' ? 'secondary' :
                  timerState === 'completed' ? 'default' :
                  timerState === 'abandoned' ? 'destructive' : 'outline'
                }>
                  {timerState === 'running' ? '🌱 Growing...' :
                   timerState === 'paused' ? '⏸ Paused' :
                   timerState === 'completed' ? '🌳 Complete!' :
                   timerState === 'abandoned' ? '🥀 Withered' :
                   mode === 'timer' ? `⏱ ${formatDuration(durationSeconds)}` : '⏱ Stopwatch'}
                </Badge>
              </motion.div>
            </AnimatePresence>

            {/* Progress ring (for timer mode) */}
            {mode === 'timer' && timerState === 'running' && (
              <svg className="absolute top-4 right-4 w-12 h-12" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3"
                  className="stroke-muted-foreground/20" />
                <motion.circle cx="24" cy="24" r="20" fill="none" strokeWidth="3"
                  className="stroke-primary" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 20}
                  strokeDashoffset={2 * Math.PI * 20 * (1 - progress)}
                  transform="rotate(-90 24 24)" />
              </svg>
            )}

            {/* Controls */}
            <div className="flex items-center gap-3 mt-6">
              {isIdle && (
                <Button onClick={handleStart} disabled={startMut.isPending} size="lg"
                  className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white gap-2 px-8">
                  <Play className="h-5 w-5" /> Start
                </Button>
              )}
              {timerState === 'running' && (
                <>
                  <Button onClick={handlePause} variant="outline" size="lg" className="gap-2">
                    <Pause className="h-5 w-5" /> Pause
                  </Button>
                  {mode === 'stopwatch' && (
                    <Button onClick={handleComplete} size="lg"
                      className="bg-gradient-to-r from-green-500 to-emerald-600 text-white gap-2">
                      <Square className="h-5 w-5" /> Done
                    </Button>
                  )}
                  <Button onClick={handleStop} variant="destructive" size="lg" className="gap-2">
                    <Square className="h-5 w-5" /> Give Up
                  </Button>
                </>
              )}
              {timerState === 'paused' && (
                <>
                  <Button onClick={handleResume} size="lg"
                    className="bg-gradient-to-r from-green-500 to-emerald-600 text-white gap-2 px-8">
                    <Play className="h-5 w-5" /> Resume
                  </Button>
                  <Button onClick={handleStop} variant="destructive" size="lg" className="gap-2">
                    <Square className="h-5 w-5" /> Give Up
                  </Button>
                </>
              )}
              {(timerState === 'completed' || timerState === 'abandoned') && (
                <Button onClick={handleReset} variant="outline" size="lg" className="gap-2">
                  <RotateCcw className="h-5 w-5" /> New Session
                </Button>
              )}
            </div>
          </CardContent>
        </div>
      </Card>

      {/* Setup row (only in idle) */}
      {isIdle && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 sm:grid-cols-2">
          {/* Mode + Duration */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Mode & Duration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'timer' ? 'default' : 'outline'}
                  onClick={() => setMode('timer')} className="gap-1.5">
                  <Timer className="h-4 w-4" /> Timer
                </Button>
                <Button size="sm" variant={mode === 'stopwatch' ? 'default' : 'outline'}
                  onClick={() => setMode('stopwatch')} className="gap-1.5">
                  <Clock className="h-4 w-4" /> Stopwatch
                </Button>
              </div>
              {/* Duration presets (timer mode) */}
              {mode === 'timer' && (
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map(p => (
                    <Button key={p.seconds} size="sm"
                      variant={durationSeconds === p.seconds ? 'default' : 'outline'}
                      onClick={() => { setDurationSeconds(p.seconds); setCustomMinutes(''); }}>
                      {p.label}
                    </Button>
                  ))}
                  <input type="number" min={1} max={180} placeholder="Custom"
                    value={customMinutes}
                    onChange={e => {
                      setCustomMinutes(e.target.value);
                      const m = parseInt(e.target.value, 10);
                      if (m > 0 && m <= 180) setDurationSeconds(m * 60);
                    }}
                    className="w-20 px-2 py-1 rounded-md border text-sm bg-background" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Species selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Choose Tree</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {TREE_SPECIES.map(sp => {
                  const locked = !unlockedTrees.includes(sp.key);
                  return (
                    <button key={sp.key}
                      disabled={locked}
                      onClick={() => setSpecies(sp.key as TreeSpeciesKey)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all',
                        species === sp.key
                          ? 'border-primary bg-primary/10 ring-1 ring-primary'
                          : locked
                          ? 'opacity-40 cursor-not-allowed border-muted'
                          : 'border-border hover:border-primary/50 cursor-pointer'
                      )}>
                      <span>{sp.emoji}</span>
                      <span>{sp.name}</span>
                      {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Complete sessions to unlock more trees! ({unlockedTrees.length}/{TREE_SPECIES.length})
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Today's Forest */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TreePine className="h-4 w-4" /> Today's Forest
              </CardTitle>
              <CardDescription>
                {completedToday.length} tree{completedToday.length !== 1 ? 's' : ''} · {formatDuration(todayTotalSec)} focused
              </CardDescription>
            </div>
            {completedToday.length >= 4 && (
              <Badge variant="default" className="bg-amber-500 text-white">
                <Zap className="h-3 w-3 mr-1" /> Productive day!
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {todaySessionsQ.isLoading ? (
            <div className="flex gap-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="w-16 h-16 rounded-lg" />)}
            </div>
          ) : completedToday.length === 0 ? (
            <EmptyState icon={TreePine} title="No trees yet today — start a focus session!" />
          ) : (
            <div className="flex flex-wrap gap-3">
              {completedToday.map((s, i) => (
                <motion.div key={s.id}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08 }}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg bg-muted/50"
                  title={`${formatDuration(s.actual_seconds)} · ${s.tree_species}`}
                >
                  <TreeComponent species={s.tree_species} stage={1} size={56} />
                  <span className="text-[10px] text-muted-foreground">{formatDuration(s.actual_seconds)}</span>
                </motion.div>
              ))}
              {/* Show abandoned trees too (smaller, gray) */}
              {(todaySessionsQ.data ?? []).filter(s => s.status === 'abandoned').map((s, i) => (
                <motion.div key={s.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5 }}
                  transition={{ delay: completedToday.length * 0.08 + i * 0.05 }}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg bg-muted/30"
                  title={`Abandoned after ${formatDuration(s.actual_seconds)}`}
                >
                  <TreeComponent species={s.tree_species} stage={Math.min(s.actual_seconds / (s.duration_seconds || 1500), 0.8)} dead size={40} />
                  <span className="text-[10px] text-muted-foreground line-through">{formatDuration(s.actual_seconds)}</span>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Card */}
      {statsQ.data && statsQ.data.totalSessions > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">30-Day Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{statsQ.data.totalSessions}</p>
                  <p className="text-xs text-muted-foreground">Sessions</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatDuration(statsQ.data.totalSec)}</p>
                  <p className="text-xs text-muted-foreground">Total Focus</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{statsQ.data.uniqueDays}</p>
                  <p className="text-xs text-muted-foreground">Active Days</p>
                </div>
              </div>
              {/* Species breakdown */}
              {Object.keys(statsQ.data.bySpecies).length > 1 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(statsQ.data.bySpecies).sort((a, b) => b[1] - a[1]).map(([sp, count]) => {
                    const info = TREE_SPECIES.find(t => t.key === sp);
                    return (
                      <Badge key={sp} variant="outline" className="gap-1">
                        {info?.emoji ?? '🌳'} {info?.name ?? sp} × {count}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
