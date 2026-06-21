import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Droplets, ChevronLeft, ChevronRight, Plus, Calendar as CalIcon,
  Sparkles, Moon, Sun, Zap, Smile, Frown, Meh, CloudRain,
  Trash2, Download, History, Edit2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import {
  type Cycle, type Phase, type Prediction,
  predictNextPeriod, getCurrentPhase, getPhaseQuote, getAvgPeriodLength,
  today, addDays, daysBetween, isDateInRange, PHASE_CONFIG,
} from '@/lib/period-utils';

// ---- Types ----
interface DayLog {
  id: string;
  log_date: string;
  flow_intensity: string | null;
  cramps: number;
  bloating: boolean;
  headache: boolean;
  breast_tenderness: boolean;
  fatigue: boolean;
  backache: boolean;
  mood: string[];
  energy_level: number | null;
  sleep_quality: number | null;
  notes: string | null;
}

const MOODS = [
  { id: 'happy', emoji: '😊', label: 'Happy' },
  { id: 'sad', emoji: '😢', label: 'Sad' },
  { id: 'anxious', emoji: '😰', label: 'Anxious' },
  { id: 'irritable', emoji: '😤', label: 'Irritable' },
  { id: 'calm', emoji: '😌', label: 'Calm' },
  { id: 'energetic', emoji: '⚡', label: 'Energetic' },
  { id: 'tired', emoji: '😴', label: 'Tired' },
];

const FLOW_LEVELS = [
  { id: 'none', label: 'None', drops: 0 },
  { id: 'spotting', label: 'Spotting', drops: 1 },
  { id: 'light', label: 'Light', drops: 2 },
  { id: 'medium', label: 'Medium', drops: 3 },
  { id: 'heavy', label: 'Heavy', drops: 4 },
];

const SYMPTOMS = [
  { id: 'cramps', label: 'Cramps', emoji: '🤕' },
  { id: 'bloating', label: 'Bloating', emoji: '🫧' },
  { id: 'headache', label: 'Headache', emoji: '🤯' },
  { id: 'breast_tenderness', label: 'Tender', emoji: '💔' },
  { id: 'fatigue', label: 'Fatigue', emoji: '😮‍💨' },
  { id: 'backache', label: 'Backache', emoji: '🦴' },
];

// ==================== Main Page ====================
export function PeriodPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [logDate, setLogDate] = useState(today());
  const [showLogPeriod, setShowLogPeriod] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const logCardRef = useRef<HTMLDivElement | null>(null);

  const goToLog = (date: string) => {
    setLogDate(date);
    setTimeout(() => logCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // ---- Queries ----
  const cyclesQ = useQuery({
    queryKey: ['period-cycles', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('period_cycles').select('*')
        .eq('user_id', userId!).order('start_date', { ascending: false }).limit(24);
      return (data ?? []) as Cycle[];
    },
  });

  const logsQ = useQuery({
    queryKey: ['period-logs', userId, calMonth.year, calMonth.month],
    enabled: !!userId,
    queryFn: async () => {
      const start = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-01`;
      const endDate = new Date(calMonth.year, calMonth.month + 1, 0);
      const end = endDate.toISOString().slice(0, 10);
      const { data } = await supabase.from('period_logs').select('*')
        .eq('user_id', userId!).gte('log_date', start).lte('log_date', end);
      return (data ?? []) as DayLog[];
    },
  });

  const todayLogQ = useQuery({
    queryKey: ['period-log-day', userId, logDate],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('period_logs').select('*')
        .eq('user_id', userId!).eq('log_date', logDate).maybeSingle();
      return data as DayLog | null;
    },
  });

  // ---- Predictions ----
  const cycles = cyclesQ.data ?? [];
  const prediction = useMemo(() => predictNextPeriod(cycles), [cycles]);
  const lastCycle = cycles[0];
  const phaseInfo = useMemo(() => {
    if (!lastCycle) return null;
    const avg = prediction?.avgCycleLength ?? 28;
    return getCurrentPhase(lastCycle.start_date, avg);
  }, [lastCycle, prediction]);

  // ---- Mutations ----
  const logPeriodM = useMutation({
    mutationFn: async ({ start, end }: { start: string; end: string | null }) => {
      const { error } = await supabase.from('period_cycles').upsert({
        user_id: userId!, start_date: start, end_date: end, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,start_date' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['period-cycles', userId] });
      toast.success('Period logged! 🌸');
      setShowLogPeriod(false);
    },
  });

  const saveLogM = useMutation({
    mutationFn: async (log: Partial<DayLog>) => {
      const { error } = await supabase.from('period_logs').upsert({
        user_id: userId!, log_date: logDate, ...log, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,log_date' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['period-log-day', userId, logDate] });
      qc.invalidateQueries({ queryKey: ['period-logs', userId, calMonth.year, calMonth.month] });
      toast.success('Logged! 💕');
    },
  });

  const deleteCycleM = useMutation({
    mutationFn: async (cycleId: string) => {
      const { error } = await supabase.from('period_cycles').delete().eq('id', cycleId).eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['period-cycles', userId] });
      toast.success('Cycle deleted');
    },
  });

  const deleteLogM = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase.from('period_logs').delete().eq('id', logId).eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['period-log-day', userId, logDate] });
      qc.invalidateQueries({ queryKey: ['period-logs', userId, calMonth.year, calMonth.month] });
      toast.success('Log deleted');
    },
  });

  // ---- Export helper ----
  const handleExport = useCallback(async () => {
    if (!userId) return;
    const [{ data: allCycles }, { data: allLogs }] = await Promise.all([
      supabase.from('period_cycles').select('*').eq('user_id', userId).order('start_date', { ascending: false }),
      supabase.from('period_logs').select('*').eq('user_id', userId).order('log_date', { ascending: false }),
    ]);

    let content = '📅 PERIOD TRACKER — EXPORT\n';
    content += '═'.repeat(50) + '\n\n';

    // Cycles section
    content += '🩸 CYCLES\n' + '─'.repeat(30) + '\n';
    if (allCycles?.length) {
      for (const c of allCycles) {
        const start = new Date(c.start_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const end = c.end_date ? new Date(c.end_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Ongoing';
        const len = c.cycle_length ? `${c.cycle_length} days` : '—';
        content += `  ${start}  →  ${end}  (${len})\n`;
      }
    } else {
      content += '  No cycles logged yet.\n';
    }

    // Daily logs section
    content += '\n\n📝 DAILY LOGS\n' + '─'.repeat(30) + '\n';
    if (allLogs?.length) {
      for (const l of allLogs as DayLog[]) {
        const date = new Date(l.log_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        content += `\n  📆 ${date}\n`;
        if (l.flow_intensity && l.flow_intensity !== 'none') content += `     Flow: ${l.flow_intensity}\n`;
        if (l.mood?.length) content += `     Mood: ${l.mood.join(', ')}\n`;
        const symptoms: string[] = [];
        if (l.cramps > 0) symptoms.push('cramps');
        if (l.bloating) symptoms.push('bloating');
        if (l.headache) symptoms.push('headache');
        if (l.breast_tenderness) symptoms.push('breast tenderness');
        if (l.fatigue) symptoms.push('fatigue');
        if (l.backache) symptoms.push('backache');
        if (symptoms.length) content += `     Symptoms: ${symptoms.join(', ')}\n`;
        if (l.energy_level) content += `     Energy: ${l.energy_level}/5\n`;
        if (l.sleep_quality) content += `     Sleep: ${l.sleep_quality}/5\n`;
        if (l.notes) content += `     Notes: ${l.notes}\n`;
      }
    } else {
      content += '  No daily logs yet.\n';
    }

    content += '\n\n' + '═'.repeat(50) + '\n';
    content += `Exported on ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `period-tracker-export-${today()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded! 📄');
  }, [userId]);

  // ==================== Render ====================
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-8">
      {/* Phase Banner */}
      {phaseInfo ? (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn('rounded-2xl p-6 text-white bg-gradient-to-r shadow-lg', phaseInfo.gradient)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-80">Day {phaseInfo.dayInCycle} of your cycle</p>
              <h2 className="text-2xl font-bold mt-1">{phaseInfo.emoji} {phaseInfo.label}</h2>
              <p className="text-sm mt-2 opacity-90 max-w-md italic">"{getPhaseQuote(phaseInfo.phase)}"</p>
            </div>
            <div className="text-right">
              {prediction && prediction.daysUntilPeriod > 0 ? (
                <div>
                  <p className="text-3xl font-bold">{prediction.daysUntilPeriod}</p>
                  <p className="text-xs opacity-80">days until period</p>
                </div>
              ) : (
                <div>
                  <p className="text-lg font-semibold">On period</p>
                  <p className="text-xs opacity-80">Take care of yourself 💕</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Heart className="h-12 w-12 mx-auto text-rose-400 mb-3" />
            <h2 className="text-lg font-semibold mb-1">Welcome to Period Tracker</h2>
            <p className="text-sm text-muted-foreground mb-4">Log your first period to get started with predictions and tracking.</p>
            <Button onClick={() => setShowLogPeriod(true)} className="bg-rose-500 hover:bg-rose-600">
              <Plus className="h-4 w-4" /> Log Period
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Predictions Card */}
        {prediction && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" /> Predictions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Next period</span>
                <Badge variant="outline" className="text-rose-600 border-rose-200 bg-rose-50">
                  {new Date(prediction.nextPeriodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Fertile window</span>
                <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
                  {new Date(prediction.fertileStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(prediction.fertileEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Ovulation</span>
                <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
                  {new Date(prediction.ovulationDay).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Avg. cycle</span>
                <span className="font-medium">{prediction.avgCycleLength} days</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Regularity</span>
                <Badge variant={prediction.regularity === 'very_regular' || prediction.regularity === 'regular' ? 'default' : 'outline'}>
                  {prediction.regularity.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-medium">{prediction.confidence}%</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Phase Timeline */}
        {phaseInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Moon className="h-4 w-4 text-violet-500" /> Cycle Phases
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(['menstrual', 'follicular', 'ovulatory', 'luteal'] as Phase[]).map(p => {
                  const cfg = PHASE_CONFIG[p];
                  const isActive = phaseInfo.phase === p;
                  return (
                    <div key={p} className={cn('flex items-center gap-3 p-2 rounded-lg transition-all', isActive && 'bg-muted ring-1 ring-primary/20')}>
                      <span className="text-lg">{cfg.emoji}</span>
                      <div className="flex-1">
                        <p className={cn('text-sm font-medium', isActive && 'text-foreground')}>{cfg.label}</p>
                      </div>
                      {isActive && (
                        <Badge className={cn('bg-gradient-to-r text-white text-xs', cfg.gradient)}>
                          Day {phaseInfo.dayInPhase}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Calendar */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="p-1 rounded hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {new Date(calMonth.year, calMonth.month).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })}
            </span>
            <button onClick={() => setCalMonth(m => { const d = new Date(m.year, m.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="p-1 rounded hover:bg-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <MiniCalendar
            year={calMonth.year}
            month={calMonth.month}
            cycles={cycles}
            prediction={prediction}
            logs={logsQ.data ?? []}
            selectedDate={logDate}
            onSelectDate={(d) => setLogDate(d)}
          />
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-rose-400" /> Period</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-400" /> Fertile</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-400" /> Ovulation</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-rose-300 bg-transparent" /> Predicted</span>
          </div>
        </CardContent>
      </Card>

      {/* Daily Log */}
      <Card ref={logCardRef}>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalIcon className="h-4 w-4" /> Log for {new Date(logDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </CardTitle>
            <CardDescription>Track how you're feeling</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setLogDate(d => addDays(d, -1))} className="p-1.5 rounded hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setLogDate(today())} className="px-2 py-1 rounded text-xs font-medium hover:bg-muted">Today</button>
            <button onClick={() => setLogDate(d => addDays(d, 1))} className="p-1.5 rounded hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
            {todayLogQ.data && (
              <button
                onClick={() => { if (confirm('Delete this log entry?')) deleteLogM.mutate(todayLogQ.data!.id); }}
                className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 ml-1"
                title="Delete this log"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <DailyLogForm
            date={logDate}
            existing={todayLogQ.data ?? null}
            onSave={(log) => saveLogM.mutate(log)}
            saving={saveLogM.isPending}
          />
        </CardContent>
      </Card>

      {/* Log Period Dialog */}
      <LogPeriodDialog
        open={showLogPeriod}
        onClose={() => setShowLogPeriod(false)}
        onSave={(start, end) => logPeriodM.mutate({ start, end })}
      />

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => setShowLogPeriod(true)} variant="outline" className="text-rose-600 border-rose-200">
          <Droplets className="h-4 w-4" /> Log Period Start/End
        </Button>
        <Button onClick={handleExport} variant="outline" className="text-violet-600 border-violet-200">
          <Download className="h-4 w-4" /> Export Data
        </Button>
      </div>

      {/* History */}
      {cycles.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Cycles</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cycles.slice(0, 6).map(c => (
                <div key={c.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-muted group">
                  <span className="font-medium">
                    {new Date(c.start_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {c.end_date && ` → ${new Date(c.end_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {c.end_date ? `${c.cycle_length} days` : 'Ongoing'}
                    </span>
                    <button
                      onClick={() => { if (confirm('Delete this cycle entry?')) deleteCycleM.mutate(c.id); }}
                      className="p-1 rounded text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-opacity"
                      title="Delete cycle"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past Logs History */}
      {logsQ.data && logsQ.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-indigo-500" /> Recent Daily Logs
            </CardTitle>
            <CardDescription>Tap any date to view/edit that day's log</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logsQ.data
                .sort((a, b) => b.log_date.localeCompare(a.log_date))
                .slice(0, 10)
                .map(l => (
                <button
                  key={l.id}
                  onClick={() => goToLog(l.log_date)}
                  className={cn(
                    'w-full flex items-center justify-between text-sm p-2.5 rounded-lg border transition-all text-left',
                    logDate === l.log_date ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20">
                      {new Date(l.log_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {l.flow_intensity && l.flow_intensity !== 'none' && (
                        <Badge variant="outline" className="text-xs text-rose-600 border-rose-200 bg-rose-50">
                          {'💧'.repeat(FLOW_LEVELS.find(f => f.id === l.flow_intensity)?.drops ?? 1)}
                        </Badge>
                      )}
                      {l.mood?.slice(0, 3).map(m => (
                        <span key={m} className="text-sm">{MOODS.find(x => x.id === m)?.emoji}</span>
                      ))}
                      {(l.cramps > 0 || l.bloating || l.headache || l.fatigue || l.backache || l.breast_tenderness) && (
                        <span className="text-xs text-orange-600">🤕</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.energy_level && <span className="text-xs text-muted-foreground">⚡{l.energy_level}</span>}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ==================== Mini Calendar ====================
function MiniCalendar({ year, month, cycles, prediction, logs, selectedDate, onSelectDate }: {
  year: number; month: number; cycles: Cycle[]; prediction: Prediction | null; logs: DayLog[]; selectedDate: string; onSelectDate: (d: string) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const isPeriodDay = (date: string) => cycles.some(c => c.end_date ? isDateInRange(date, c.start_date, c.end_date) : date === c.start_date);
  const isFertile = (date: string) => prediction ? isDateInRange(date, prediction.fertileStart, prediction.fertileEnd) : false;
  const isOvulation = (date: string) => prediction?.ovulationDay === date;
  const isPredicted = (date: string) => prediction ? isDateInRange(date, prediction.nextPeriodStart, prediction.nextPeriodEnd) : false;
  const hasLog = (date: string) => logs.some(l => l.log_date === date && l.flow_intensity && l.flow_intensity !== 'none');

  return (
    <div className="grid grid-cols-7 gap-1">
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
        <div key={i} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={i} />;
        const day = parseInt(date.slice(-2));
        const isToday = date === today();
        const isSelected = date === selectedDate;
        const period = isPeriodDay(date);
        const fertile = isFertile(date);
        const ovul = isOvulation(date);
        const predicted = isPredicted(date);
        const logged = hasLog(date);

        return (
          <button
            key={i}
            onClick={() => onSelectDate(date)}
            className={cn(
              'relative aspect-square rounded-full flex items-center justify-center text-xs transition-all',
              isSelected && 'ring-2 ring-primary',
              isToday && !isSelected && 'ring-1 ring-muted-foreground/30',
              period && 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
              fertile && !period && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
              ovul && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
              predicted && !period && !fertile && 'border-2 border-dashed border-rose-300',
              !period && !fertile && !ovul && !predicted && 'hover:bg-muted',
            )}
          >
            {day}
            {logged && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-rose-500" />}
          </button>
        );
      })}
    </div>
  );
}

// ==================== Daily Log Form ====================
function DailyLogForm({ date, existing, onSave, saving }: {
  date: string; existing: DayLog | null; onSave: (log: Partial<DayLog>) => void; saving: boolean;
}) {
  const [flow, setFlow] = useState(existing?.flow_intensity || 'none');
  const [cramps, setCramps] = useState(existing?.cramps ?? 0);
  const [bloating, setBloating] = useState(existing?.bloating ?? false);
  const [headache, setHeadache] = useState(existing?.headache ?? false);
  const [breastTenderness, setBreastTenderness] = useState(existing?.breast_tenderness ?? false);
  const [fatigue, setFatigue] = useState(existing?.fatigue ?? false);
  const [backache, setBackache] = useState(existing?.backache ?? false);
  const [mood, setMood] = useState<string[]>(existing?.mood ?? []);
  const [energy, setEnergy] = useState(existing?.energy_level ?? 3);
  const [sleep, setSleep] = useState(existing?.sleep_quality ?? 3);
  const [notes, setNotes] = useState(existing?.notes ?? '');

  // Reset form when existing log changes
  useEffect(() => {
    setFlow(existing?.flow_intensity || 'none');
    setCramps(existing?.cramps ?? 0);
    setBloating(existing?.bloating ?? false);
    setHeadache(existing?.headache ?? false);
    setBreastTenderness(existing?.breast_tenderness ?? false);
    setFatigue(existing?.fatigue ?? false);
    setBackache(existing?.backache ?? false);
    setMood(existing?.mood ?? []);
    setEnergy(existing?.energy_level ?? 3);
    setSleep(existing?.sleep_quality ?? 3);
    setNotes(existing?.notes ?? '');
  }, [existing, date]);

  const toggleMood = (id: string) => setMood(m => m.includes(id) ? m.filter(x => x !== id) : [...m, id]);

  function handleSave() {
    onSave({
      flow_intensity: flow,
      cramps,
      bloating,
      headache,
      breast_tenderness: breastTenderness,
      fatigue,
      backache,
      mood,
      energy_level: energy,
      sleep_quality: sleep,
      notes: notes || null,
    });
  }

  return (
    <div className="space-y-5">
      {/* Flow */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Flow intensity</Label>
        <div className="flex gap-2 flex-wrap">
          {FLOW_LEVELS.map(f => (
            <button
              key={f.id}
              onClick={() => setFlow(f.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all',
                flow === f.id ? 'bg-rose-100 border-rose-300 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'border-border hover:bg-muted',
              )}
            >
              {f.drops > 0 && <span>{'💧'.repeat(f.drops)}</span>}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood */}
      <div>
        <Label className="text-sm font-medium mb-2 block">How are you feeling?</Label>
        <div className="flex gap-2 flex-wrap">
          {MOODS.map(m => (
            <button
              key={m.id}
              onClick={() => toggleMood(m.id)}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs border transition-all',
                mood.includes(m.id) ? 'bg-violet-100 border-violet-300 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'border-border hover:bg-muted',
              )}
            >
              <span className="text-lg">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Symptoms */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Symptoms</Label>
        <div className="flex gap-2 flex-wrap">
          {SYMPTOMS.map(s => {
            const checked = s.id === 'cramps' ? cramps > 0
              : s.id === 'bloating' ? bloating
              : s.id === 'headache' ? headache
              : s.id === 'breast_tenderness' ? breastTenderness
              : s.id === 'fatigue' ? fatigue
              : backache;
            return (
              <button
                key={s.id}
                onClick={() => {
                  if (s.id === 'cramps') setCramps(c => c > 0 ? 0 : 3);
                  else if (s.id === 'bloating') setBloating(b => !b);
                  else if (s.id === 'headache') setHeadache(h => !h);
                  else if (s.id === 'breast_tenderness') setBreastTenderness(b => !b);
                  else if (s.id === 'fatigue') setFatigue(f => !f);
                  else setBackache(b => !b);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all',
                  checked ? 'bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' : 'border-border hover:bg-muted',
                )}
              >
                <span>{s.emoji}</span> {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Energy & Sleep */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium mb-2 block">Energy ⚡</Label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setEnergy(n)}
                className={cn('w-8 h-8 rounded-full text-sm font-medium transition-all', n <= energy ? 'bg-amber-400 text-white' : 'bg-muted text-muted-foreground')}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-sm font-medium mb-2 block">Sleep 😴</Label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setSleep(n)}
                className={cn('w-8 h-8 rounded-full text-sm font-medium transition-all', n <= sleep ? 'bg-indigo-400 text-white' : 'bg-muted text-muted-foreground')}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Notes</Label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Anything else to note today..."
          className="w-full h-20 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
        />
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white">
        {saving ? 'Saving...' : '💕 Save Today\'s Log'}
      </Button>
    </div>
  );
}

// ==================== Log Period Dialog ====================
function LogPeriodDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (start: string, end: string | null) => void; }) {
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Period</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End date (leave empty if still ongoing)</Label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => onSave(start, end || null)} className="bg-rose-500 hover:bg-rose-600">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
