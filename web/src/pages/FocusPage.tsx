import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, Lock, Pause, Play, RotateCcw, Smartphone, Square, Timer, TreePine, UserX, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import { Meadow, PlantScene, TREE_SPECIES, TreeComponent, type TreeSpeciesKey } from '@/components/trees';
import { IsometricForest } from '@/components/IsometricForest';
import { createSessionClock, type SessionClock } from '@/lib/focus/session-clock';
import { createPresenceTracker, DEFAULT_PRESENCE } from '@/lib/focus/presence';
import { createPhoneGuard, DEFAULT_PHONE_GUARD } from '@/lib/focus/phone-guard';
import { appendLog, clearLog, loadLog, loadPrefs, savePrefs, type MonitorPrefs } from '@/lib/focus/local-store';
import { useFocusMonitor, type MonitorSample } from '@/lib/focus/useFocusMonitor';
import { playBeep, primeAudio } from '@/lib/focus/alerts';
import { FocusPlanner, formatMinutes, type FocusTask } from './focus/FocusPlanner';
import { MonitorPanel } from './focus/MonitorPanel';

type FocusSession = {
  id: string; user_id: string; task_id: string | null; task_title: string | null;
  tree_species: string; duration_seconds: number; actual_seconds: number;
  mode: 'timer' | 'stopwatch'; status: 'completed' | 'abandoned' | 'in_progress';
  started_at: string; completed_at: string | null; created_at: string;
};
type TimerState = 'idle' | 'running' | 'paused' | 'completed' | 'abandoned';
type PausedBy = 'user' | 'away' | 'penalty' | null;
type Banner = { kind: 'phone' | 'penalty' | 'away' | 'back'; text: string } | null;

const DURATION_PRESETS = [
  { label: '15m', seconds: 15 * 60 }, { label: '25m', seconds: 25 * 60 },
  { label: '45m', seconds: 45 * 60 }, { label: '60m', seconds: 60 * 60 },
];
const TAB_ABANDON_SECONDS = 10;

function formatClock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function localMidnightIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

interface RunInfo {
  id: string; startedAt: string; title: string; taskId: string | null;
  plannedSeconds: number; monitored: boolean;
  awayCount: number; awaySeconds: number; awayStartedAt: number | null;
  phoneWarnings: number; penalties: number;
}

export function FocusPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [prefs, setPrefsState] = useState<MonitorPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((p: MonitorPrefs) => { setPrefsState(p); savePrefs(p); }, []);
  const [log, setLog] = useState(() => loadLog());

  const [timerState, setTimerStateRaw] = useState<TimerState>('idle');
  const stateRef = useRef<TimerState>('idle');
  const setTimerState = useCallback((s: TimerState) => { stateRef.current = s; setTimerStateRaw(s); }, []);
  const [pausedBy, setPausedByRaw] = useState<PausedBy>(null);
  const pausedByRef = useRef<PausedBy>(null);
  const setPausedBy = useCallback((p: PausedBy) => { pausedByRef.current = p; setPausedByRaw(p); }, []);

  const [mode, setMode] = useState<'timer' | 'stopwatch'>('timer');
  const [quickSeconds, setQuickSeconds] = useState(25 * 60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [species, setSpecies] = useState<TreeSpeciesKey>('cedar');
  const [activeTask, setActiveTask] = useState<FocusTask | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [banner, setBanner] = useState<Banner>(null);
  const [testing, setTesting] = useState(false);
  const [awayUi, setAwayUi] = useState(false);
  const [warningsUi, setWarningsUi] = useState(0);

  const clockRef = useRef<SessionClock>(createSessionClock(0));
  const runRef = useRef<RunInfo | null>(null);
  const finishingRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef(createPresenceTracker(DEFAULT_PRESENCE, Date.now()));
  const phoneRef = useRef(createPhoneGuard(DEFAULT_PHONE_GUARD));

  const showBanner = useCallback((b: Banner, ttl = 6000) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(b);
    if (b && ttl > 0) bannerTimer.current = setTimeout(() => setBanner(null), ttl);
  }, []);

  // ---------- Data ----------
  const profileQ = useQuery({
    queryKey: ['profile-trees', userId], enabled: !!userId,
    queryFn: async () => (await supabase.from('profiles').select('unlocked_trees').eq('user_id', userId!).maybeSingle()).data,
  });
  const unlockedTrees: string[] = profileQ.data?.unlocked_trees ?? ['cedar', 'bush'];

  const todayStart = useMemo(() => localMidnightIso(), []);
  const todaySessionsQ = useQuery({
    queryKey: ['focus', 'today', userId, todayStart], enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('focus_sessions').select('*').eq('user_id', userId!)
        .gte('started_at', todayStart).in('status', ['completed', 'abandoned']).order('started_at', { ascending: true });
      return (data ?? []) as FocusSession[];
    },
  });

  const allSessionsQ = useQuery({
    queryKey: ['focus', 'all', userId], enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('focus_sessions')
        .select('id,tree_species,actual_seconds,status,started_at,duration_seconds')
        .eq('user_id', userId!).in('status', ['completed', 'abandoned']).order('started_at', { ascending: true });
      return (data ?? []) as FocusSession[];
    },
  });

  const statsQ = useQuery({
    queryKey: ['focus', 'stats', userId], enabled: !!userId,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data } = await supabase.from('focus_sessions').select('actual_seconds,status,started_at,tree_species')
        .eq('user_id', userId!).eq('status', 'completed').gte('started_at', since);
      const rows = data ?? [];
      const bySpecies: Record<string, number> = {};
      for (const s of rows) bySpecies[s.tree_species] = (bySpecies[s.tree_species] ?? 0) + 1;
      return {
        totalSec: rows.reduce((a, r) => a + r.actual_seconds, 0), totalSessions: rows.length,
        uniqueDays: new Set(rows.map((r) => r.started_at.slice(0, 10))).size, bySpecies,
      };
    },
  });

  // Unlocks are based on every completed session, not just the last 30 days.
  const completedAll = (allSessionsQ.data ?? []).filter((s) => s.status === 'completed').length;
  useEffect(() => {
    if (!userId || !allSessionsQ.data || !profileQ.data) return;
    const fresh = TREE_SPECIES.filter((sp) => sp.unlock > 0 && sp.unlock <= completedAll && !unlockedTrees.includes(sp.key));
    if (fresh.length === 0) return;
    const updated = [...unlockedTrees, ...fresh.map((f) => f.key)];
    supabase.from('profiles').update({ unlocked_trees: updated }).eq('user_id', userId).then(() => {
      qc.invalidateQueries({ queryKey: ['profile-trees', userId] });
      for (const sp of fresh) toast.success(`🎉 New plant unlocked: ${sp.emoji} ${sp.name}!`);
    });
  }, [completedAll, unlockedTrees, userId, allSessionsQ.data, profileQ.data, qc]);

  // ---------- Session control ----------
  const clock = clockRef.current;
  const live = timerState === 'running' || timerState === 'paused';

  const pauseSession = useCallback((by: Exclude<PausedBy, null>, at = Date.now()) => {
    if (stateRef.current !== 'running') return;
    clockRef.current.pause(at);
    setPausedBy(by);
    setTimerState('paused');
    setNow(Date.now());
  }, [setPausedBy, setTimerState]);

  const resumeSession = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    const t = Date.now();
    const run = runRef.current;
    if (run?.awayStartedAt) { run.awaySeconds += Math.round((t - run.awayStartedAt) / 1000); run.awayStartedAt = null; }
    clockRef.current.resume(t);
    presenceRef.current.reset(t);
    setAwayUi(false);
    setPausedBy(null);
    setTimerState('running');
    setBanner(null);
    setNow(t);
  }, [setPausedBy, setTimerState]);

  const finish = useCallback(async (status: 'completed' | 'abandoned') => {
    const run = runRef.current;
    if (!run || finishingRef.current) return;
    finishingRef.current = true;
    const t = Date.now();
    const c = clockRef.current;
    const actual = c.elapsedSeconds(t);
    c.pause(t);
    if (run.awayStartedAt) { run.awaySeconds += Math.round((t - run.awayStartedAt) / 1000); run.awayStartedAt = null; }
    setNow(t);
    setTimerState(status);
    setPausedBy(null);
    setAwayUi(false);
    setBanner(null);
    if (status === 'completed' && prefsRef.current.sound) playBeep('done');

    if (run.monitored) {
      setLog(appendLog({
        id: run.id, at: run.startedAt, task: run.title, plannedSeconds: run.plannedSeconds,
        awayCount: run.awayCount, awaySeconds: run.awaySeconds, phoneWarnings: run.phoneWarnings,
        penalties: run.penalties, penaltySeconds: c.penaltySeconds, outcome: status,
      }));
    }

    try {
      const { error } = await supabase.from('focus_sessions').update({
        actual_seconds: actual, status, completed_at: new Date(t).toISOString(),
      }).eq('id', run.id);
      if (error) throw error;

      if (run.taskId && actual > 0) {
        const { data: task } = await supabase.from('tasks').select('focused_seconds,estimated_minutes').eq('id', run.taskId).maybeSingle();
        if (task) {
          const total = (task.focused_seconds ?? 0) + actual;
          const patch: Record<string, unknown> = { focused_seconds: total };
          if (status === 'completed' && task.estimated_minutes && total >= task.estimated_minutes * 60) {
            patch.status = 'completed'; patch.completed_at = new Date(t).toISOString();
            toast.success(`✅ "${run.title}" is done!`);
          }
          await supabase.from('tasks').update(patch).eq('id', run.taskId);
        }
      }
      if (status === 'completed') toast.success('🌳 Focus session complete! Your plant is in the garden.');
      else toast('🥀 Session ended early. The plant withered.');
    } catch (e) {
      toast.error(`Could not save the session: ${(e as Error).message}`);
    } finally {
      runRef.current = null;
      finishingRef.current = false;
      qc.invalidateQueries({ queryKey: ['focus'] });
      qc.invalidateQueries({ queryKey: ['profile-trees', userId] });
    }
  }, [qc, setPausedBy, setTimerState, userId]);

  const begin = useCallback(async (opts: { seconds: number; task: FocusTask | null }) => {
    if (!userId || starting || stateRef.current === 'running' || stateRef.current === 'paused') return;
    primeAudio();
    setStarting(true);
    const title = opts.task?.title ?? (opts.seconds > 0 ? 'Quick focus' : 'Open focus');
    const { data, error } = await supabase.from('focus_sessions').insert({
      user_id: userId, task_id: opts.task?.id ?? null, task_title: opts.task?.title ?? null,
      tree_species: species, duration_seconds: opts.seconds, mode: opts.seconds > 0 ? 'timer' : 'stopwatch',
      status: 'in_progress', started_at: new Date().toISOString(),
    }).select('id,started_at').single();
    setStarting(false);
    if (error || !data) { toast.error(error?.message ?? 'Could not start the session'); return; }

    const t = Date.now();
    clockRef.current = createSessionClock(opts.seconds);
    clockRef.current.start(t);
    presenceRef.current.reset(t);
    phoneRef.current.reset();
    runRef.current = {
      id: data.id as string, startedAt: data.started_at as string, title, taskId: opts.task?.id ?? null,
      plannedSeconds: opts.seconds, monitored: prefsRef.current.monitor,
      awayCount: 0, awaySeconds: 0, awayStartedAt: null, phoneWarnings: 0, penalties: 0,
    };
    setActiveTask(opts.task);
    setTesting(false);
    setWarningsUi(0);
    setAwayUi(false);
    setBanner(null);
    setPausedBy(null);
    setNow(t);
    setTimerState('running');
  }, [userId, starting, species, setPausedBy, setTimerState]);

  const startQuick = () => {
    let seconds = mode === 'timer' ? quickSeconds : 0;
    const custom = parseInt(customMinutes, 10);
    if (mode === 'timer' && custom > 0 && custom <= 480) seconds = custom * 60;
    void begin({ seconds, task: null });
  };
  const startTask = (task: FocusTask) => {
    const left = task.estimated_minutes * 60 - task.focused_seconds;
    const seconds = left >= 5 * 60 ? left : task.estimated_minutes * 60;
    void begin({ seconds, task });
  };

  const resetToIdle = () => {
    setTimerState('idle');
    setActiveTask(null);
    setBanner(null);
    clockRef.current = createSessionClock(0);
    setNow(Date.now());
  };

  // ---------- Timer tick ----------
  useEffect(() => {
    if (timerState !== 'running') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const c = clockRef.current;
      if (c.targetSeconds > 0 && c.remainingSeconds(t) === 0) void finish('completed');
    }, 250);
    return () => clearInterval(id);
  }, [timerState, finish]);

  // ---------- Monitor ----------
  const onSample = useCallback((s: MonitorSample) => {
    const run = runRef.current;
    const st = stateRef.current;
    const p = prefsRef.current;

    if (s.personSeen !== null) {
      const r = presenceRef.current.update(s.personSeen, s.now);
      setAwayUi(r.away);
      if (run && (st === 'running' || st === 'paused') && p.presence) {
        if (r.event === 'left' && st === 'running') {
          run.awayCount += 1;
          run.awayStartedAt = s.now - DEFAULT_PRESENCE.awayAfterMs;
          pauseSession('away', run.awayStartedAt);
          showBanner({ kind: 'away', text: 'You stepped away — timer paused. It resumes when you are back.' }, 0);
          if (p.sound) playBeep('away');
        } else if (r.event === 'returned' && pausedByRef.current === 'away') {
          resumeSession();
          showBanner({ kind: 'back', text: 'Welcome back — timer resumed.' }, 3500);
          if (p.sound) playBeep('back');
        }
      }
    }

    if (s.phoneSeen !== null && run && st === 'running' && p.phone) {
      const ev = phoneRef.current.update(s.phoneSeen, s.now);
      setWarningsUi(phoneRef.current.warnings);
      if (ev?.type === 'warning') {
        run.phoneWarnings += 1;
        showBanner({ kind: 'phone', text: `Put the phone away — warning ${ev.n} of ${ev.of}.` });
        toast.warning(`📵 Phone detected — warning ${ev.n}/${ev.of}`);
        if (p.sound) playBeep('warning');
      } else if (ev?.type === 'penalty') {
        run.penalties += 1;
        clockRef.current.addPenalty(ev.seconds);
        pauseSession('penalty');
        setWarningsUi(0);
        showBanner({ kind: 'penalty', text: `Phone used again: +${ev.seconds / 60} min added. Timer stopped until you press Resume.` }, 0);
        toast.error(`📵 +${ev.seconds / 60} minute penalty. Timer stopped.`);
        if (p.sound) playBeep('penalty');
      }
    }
  }, [pauseSession, resumeSession, showBanner]);

  const cameraOn = prefs.monitor && (live || testing);
  const mon = useFocusMonitor({
    cameraOn,
    detectPresence: prefs.monitor && prefs.presence,
    detectPhone: prefs.monitor && prefs.phone,
    onSample,
  });

  useEffect(() => {
    if (mon.status === 'denied' || mon.status === 'nocamera') {
      setTesting(false);
      toast.error(mon.error ?? 'Camera unavailable');
    }
  }, [mon.status, mon.error]);

  // Turning presence checks (or the whole monitor) off must never leave a session stuck in "away".
  useEffect(() => {
    if ((!prefs.monitor || !prefs.presence) && pausedByRef.current === 'away') resumeSession();
    if (!prefs.monitor || !prefs.presence) setAwayUi(false);
    if (!prefs.monitor) setTesting(false);
  }, [prefs.monitor, prefs.presence, resumeSession]);

  // ---------- Browser niceties ----------
  useEffect(() => {
    if (!live) return;
    const prev = document.title;
    const c = clockRef.current;
    const remaining = c.targetSeconds > 0 ? c.remainingSeconds(now) : c.elapsedSeconds(now);
    document.title = `${timerState === 'paused' ? '⏸' : '🌱'} ${formatClock(remaining)} · Focus`;
    return () => { document.title = prev; };
  }, [live, now, timerState]);

  useEffect(() => {
    if (timerState !== 'running') return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => { navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined); };
    acquire();
    const onVis = () => { if (!document.hidden) acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => undefined); };
  }, [timerState]);

  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [live]);

  useEffect(() => {
    const onVis = () => {
      if (stateRef.current !== 'running' || !prefsRef.current.strictTab) return;
      if (document.hidden) { hiddenAtRef.current = Date.now(); return; }
      if (hiddenAtRef.current) {
        const away = (Date.now() - hiddenAtRef.current) / 1000;
        hiddenAtRef.current = null;
        if (away > TAB_ABANDON_SECONDS) {
          toast.error(`You left this tab for ${Math.round(away)}s — the plant withered 🥀`);
          void finish('abandoned');
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [finish]);

  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  // ---------- Derived ----------
  const target = clock.targetSeconds;
  const elapsed = clock.elapsedSeconds(now);
  const idleTarget = mode === 'timer' ? quickSeconds : 0;
  const shownTarget = timerState === 'idle' ? idleTarget : target;
  // Eased so a sprout shows within the first minute instead of staying a seed for ages.
  const rawProgress = timerState === 'idle' ? 0
    : target > 0 ? Math.min(elapsed / target, 1) : Math.min(elapsed / 3600, 1);
  const progress = rawProgress === 0 || rawProgress === 1 ? rawProgress : Math.max(0.05, Math.pow(rawProgress, 0.62));
  const display = timerState === 'idle' ? idleTarget
    : target > 0 ? clock.remainingSeconds(now) : elapsed;

  const sessions = todaySessionsQ.data ?? [];
  const completedToday = sessions.filter((s) => s.status === 'completed');
  const todayTotalSec = completedToday.reduce((a, r) => a + r.actual_seconds, 0);
  const isIdle = timerState === 'idle' || timerState === 'completed' || timerState === 'abandoned';
  const sceneState = timerState === 'abandoned' ? 'withered' : timerState;

  const meadowPlants = sessions.map((s) => ({
    id: s.id, species: s.tree_species, dead: s.status === 'abandoned',
    label: `${s.task_title ?? 'Focus'} · ${formatDuration(s.actual_seconds)}`,
  }));

  const bannerStyle: Record<NonNullable<Banner>['kind'], string> = {
    phone: 'bg-amber-500 text-white', penalty: 'bg-red-600 text-white',
    away: 'bg-sky-600 text-white', back: 'bg-emerald-600 text-white',
  };
  const runTitle = runRef.current?.title ?? activeTask?.title ?? null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Timer className="h-6 w-6 text-primary" /> Focus</h1>
          <p className="text-sm text-muted-foreground mt-1">Plan your work, stay on it, and grow a garden</p>
        </div>
        {statsQ.data && (
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><TreePine className="h-4 w-4" /> {completedAll} plants</span>
            <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {formatDuration(statsQ.data.totalSec)} (30d)</span>
          </div>
        )}
      </div>

      {/* Hero: growing plant + timer */}
      <Card className="overflow-hidden">
        <PlantScene state={sceneState} progress={progress} species={species} height={300}>
          {banner && (
            <div className="absolute inset-x-0 top-3 flex justify-center px-3">
              <motion.div
                key={banner.text} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className={cn('flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium shadow-lg', bannerStyle[banner.kind])}
                role="status"
              >
                {banner.kind === 'away' ? <UserX className="h-4 w-4" /> : banner.kind === 'phone' ? <Smartphone className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {banner.text}
              </motion.div>
            </div>
          )}
        </PlantScene>

        <CardContent className="flex flex-col items-center gap-3 pb-7 pt-5">
          {runTitle && !isIdle && (
            <Badge variant="secondary" className="max-w-full truncate text-sm">{runTitle}</Badge>
          )}
          <motion.div
            key={timerState + (pausedBy ?? '')} initial={{ opacity: 0.4, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="text-6xl font-mono font-bold tabular-nums tracking-tight"
          >
            {formatClock(display)}
          </motion.div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant={timerState === 'abandoned' ? 'destructive' : timerState === 'paused' ? 'warning' : timerState === 'idle' ? 'outline' : 'default'}>
              {timerState === 'running' ? '🌱 Growing…'
                : timerState === 'paused' ? (pausedBy === 'away' ? '⏸ Paused · you are away' : pausedBy === 'penalty' ? '⛔ Stopped · penalty' : '⏸ Paused')
                : timerState === 'completed' ? '🌳 Complete!'
                : timerState === 'abandoned' ? '🥀 Withered'
                : shownTarget > 0 ? `⏱ ${formatMinutes(Math.round(shownTarget / 60))}` : '⏱ Stopwatch'}
            </Badge>
            {clock.penaltySeconds > 0 && live && (
              <Badge variant="destructive">+{Math.round(clock.penaltySeconds / 60)} min penalty</Badge>
            )}
            {live && prefs.monitor && prefs.phone && (
              <Badge variant="outline" className="gap-1"><Smartphone className="h-3 w-3" /> {warningsUi}/{DEFAULT_PHONE_GUARD.maxWarnings}</Badge>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            {timerState === 'idle' && (
              <Button onClick={startQuick} disabled={starting} size="lg"
                className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 px-8 text-white hover:from-green-600 hover:to-emerald-700">
                <Play className="h-5 w-5" /> {mode === 'timer' ? `Start ${formatMinutes(Math.round(quickSeconds / 60))} session` : 'Start stopwatch'}
              </Button>
            )}
            {timerState === 'running' && (
              <>
                <Button onClick={() => pauseSession('user')} variant="outline" size="lg" className="gap-2"><Pause className="h-5 w-5" /> Pause</Button>
                {target === 0 && (
                  <Button onClick={() => void finish('completed')} size="lg" className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white"><Square className="h-5 w-5" /> Done</Button>
                )}
                <Button onClick={() => void finish('abandoned')} variant="destructive" size="lg" className="gap-2"><Square className="h-5 w-5" /> Give up</Button>
              </>
            )}
            {timerState === 'paused' && (
              <>
                <Button onClick={resumeSession} size="lg" className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 px-8 text-white">
                  <Play className="h-5 w-5" /> {pausedBy === 'penalty' ? 'Resume (penalty added)' : 'Resume'}
                </Button>
                <Button onClick={() => void finish('abandoned')} variant="destructive" size="lg" className="gap-2"><Square className="h-5 w-5" /> Give up</Button>
              </>
            )}
            {(timerState === 'completed' || timerState === 'abandoned') && (
              <Button onClick={resetToIdle} variant="outline" size="lg" className="gap-2"><RotateCcw className="h-5 w-5" /> New session</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan + monitor */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {isIdle && userId && (
            <>
              <FocusPlanner userId={userId} activeTaskId={null} busy={starting || timerState !== 'idle'} onStart={startTask} />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Quick session</CardTitle>
                  <CardDescription>No task needed — just a timer or a stopwatch.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant={mode === 'timer' ? 'default' : 'outline'} onClick={() => setMode('timer')} className="gap-1.5"><Timer className="h-4 w-4" /> Timer</Button>
                    <Button size="sm" variant={mode === 'stopwatch' ? 'default' : 'outline'} onClick={() => setMode('stopwatch')} className="gap-1.5"><Clock className="h-4 w-4" /> Stopwatch</Button>
                  </div>
                  {mode === 'timer' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {DURATION_PRESETS.map((p) => (
                        <Button key={p.seconds} size="sm" variant={quickSeconds === p.seconds && !customMinutes ? 'default' : 'outline'}
                          onClick={() => { setQuickSeconds(p.seconds); setCustomMinutes(''); }}>{p.label}</Button>
                      ))}
                      <input type="number" min={1} max={480} placeholder="Custom min" value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        className="w-28 rounded-md border bg-background px-2 py-1 text-sm" aria-label="Custom minutes" />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Choose your plant</CardTitle>
                  <CardDescription>{unlockedTrees.length}/{TREE_SPECIES.length} unlocked · finish sessions to grow a bigger collection</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {TREE_SPECIES.map((sp) => {
                      const locked = !unlockedTrees.includes(sp.key);
                      return (
                        <button key={sp.key} type="button" disabled={locked} onClick={() => setSpecies(sp.key as TreeSpeciesKey)}
                          title={locked ? `Unlocks after ${sp.unlock} completed sessions` : sp.blurb}
                          className={cn(
                            'relative flex flex-col items-center rounded-xl border p-2 text-xs transition-all',
                            species === sp.key ? 'border-primary bg-primary/10 ring-1 ring-primary' : locked ? 'cursor-not-allowed border-muted' : 'hover:-translate-y-0.5 hover:border-primary/50',
                          )}>
                          <div className={cn(locked && 'opacity-30 grayscale')}>
                            <TreeComponent species={sp.key} stage={1} size={64} animate={!locked && species === sp.key} />
                          </div>
                          <span className="font-medium">{sp.name}</span>
                          {locked && <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-2.5 w-2.5" /> {sp.unlock} sessions</span>}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          {!isIdle && (
            <Card><CardContent className="py-5 text-sm text-muted-foreground">
              Stay with it. {prefs.monitor ? 'Monitoring is on — keep this tab visible so the camera can see you.' : 'Turn on Monitor to get auto-pause and phone warnings.'}
            </CardContent></Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <MonitorPanel
            prefs={prefs} onPrefs={setPrefs}
            status={mon.status} error={mon.error} videoRef={mon.videoRef}
            cameraLive={!!mon.stream} sessionActive={live}
            away={awayUi} personSeen={mon.personSeen} phoneSeen={mon.phoneSeen}
            warnings={warningsUi} maxWarnings={DEFAULT_PHONE_GUARD.maxWarnings}
            testing={testing} onToggleTest={() => setTesting((v) => !v)}
            log={log} onClearLog={() => { clearLog(); setLog([]); toast.success('Monitor history cleared from this device'); }}
          />
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="mt-0.5" checked={prefs.strictTab} onChange={(e) => setPrefs({ ...prefs, strictTab: e.target.checked })} />
            <span>Strict mode: leaving this tab for more than {TAB_ABANDON_SECONDS}s withers the plant.</span>
          </label>
        </div>
      </div>

      {/* Today's garden */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><TreePine className="h-4 w-4" /> Today's garden</CardTitle>
              <CardDescription>
                {completedToday.length} plant{completedToday.length !== 1 ? 's' : ''} · {formatDuration(todayTotalSec)} focused
              </CardDescription>
            </div>
            {completedToday.length >= 4 && (
              <Badge variant="default" className="bg-amber-500 text-white"><Zap className="mr-1 h-3 w-3" /> Productive day!</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {todaySessionsQ.isLoading
            ? <div className="flex gap-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-16 rounded-lg" />)}</div>
            : <Meadow plants={meadowPlants} emptyHint="Plant your first one — start a focus session!" />}
        </CardContent>
      </Card>

      {allSessionsQ.data && completedAll > 0 && (
        <IsometricForest sessions={allSessionsQ.data.filter((s) => s.status === 'completed')} />
      )}

      {statsQ.data && statsQ.data.totalSessions > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">30-day stats</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-2xl font-bold">{statsQ.data.totalSessions}</p><p className="text-xs text-muted-foreground">Sessions</p></div>
              <div><p className="text-2xl font-bold">{formatDuration(statsQ.data.totalSec)}</p><p className="text-xs text-muted-foreground">Total focus</p></div>
              <div><p className="text-2xl font-bold">{statsQ.data.uniqueDays}</p><p className="text-xs text-muted-foreground">Active days</p></div>
            </div>
            {Object.keys(statsQ.data.bySpecies).length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(statsQ.data.bySpecies).sort((a, b) => b[1] - a[1]).map(([sp, count]) => {
                  const info = TREE_SPECIES.find((t) => t.key === sp);
                  return <Badge key={sp} variant="outline" className="gap-1">{info?.emoji ?? '🌳'} {info?.name ?? sp} × {count}</Badge>;
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
