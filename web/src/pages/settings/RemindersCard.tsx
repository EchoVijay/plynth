import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, Copy, Plus, Send, Smartphone, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { TimePicker } from '@/components/ui/TimePicker';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Channel = 'email' | 'ntfy' | 'telegram';
const CATEGORIES: [string, string][] = [
  ['all', 'Everything (daily digest)'],
  ['calendar', "Today's schedule"],
  ['tasks', 'Tasks due'],
  ['learning', 'Learning plan'],
  ['finance', 'EMIs & renewals'],
  ['jobs', 'Job follow-ups'],
];

interface ProfileLite {
  email?: string | null;
  timezone?: string | null;
  ntfy_topic?: string | null;
  telegram_chat_id?: number | null;
}

interface LogRow {
  reminder_id: string; fired_for: string; fired_time: string; status: 'sent' | 'failed';
  delivered_via: string[]; errors: Record<string, string>; attempts: number; updated_at: string;
}

const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', ntfy: 'Push (ntfy)', telegram: 'Telegram' };

function lastRunLine(log: LogRow | undefined): { ok: boolean; text: string } | null {
  if (!log) return null;
  const when = format(parseISO(log.updated_at), 'd MMM, h:mm a');
  if (log.status === 'sent') {
    const via = log.delivered_via.map(c => CHANNEL_LABEL[c as Channel] ?? c).join(', ');
    const failed = Object.entries(log.errors ?? {}).map(([c, e]) => `${CHANNEL_LABEL[c as Channel] ?? c}: ${e}`);
    return { ok: true, text: `Last sent ${when} via ${via}${failed.length ? ` · not delivered: ${failed.join('; ')}` : ''}` };
  }
  const errs = Object.entries(log.errors ?? {}).map(([c, e]) => `${CHANNEL_LABEL[c as Channel] ?? c}: ${e}`).join('; ');
  return { ok: false, text: `Last attempt ${when} failed${errs ? ` — ${errs}` : ''}` };
}

export function RemindersCard({ profile }: { profile: ProfileLite | null | undefined }) {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const remindersQ = useQuery({
    queryKey: ['reminder_settings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('reminder_settings').select('*').eq('user_id', userId!).order('time_of_day');
      if (error) throw error;
      return data ?? [];
    },
  });

  const logsQ = useQuery({
    queryKey: ['reminder_log', userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<LogRow[]> => {
      const { data } = await supabase.from('reminder_log')
        .select('reminder_id,fired_for,fired_time,status,delivered_via,errors,attempts,updated_at')
        .order('updated_at', { ascending: false }).limit(100);
      return (data ?? []) as LogRow[];
    },
  });
  const lastByReminder = useMemo(() => {
    const m = new Map<string, LogRow>();
    for (const l of logsQ.data ?? []) if (!m.has(l.reminder_id)) m.set(l.reminder_id, l);
    return m;
  }, [logsQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminder_settings', userId] });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('reminder_settings').insert({
        user_id: userId!, category: 'calendar', channels: ['email'], time_of_day: '07:00',
        times_of_day: ['07:00:00'], days_of_week: [1, 2, 3, 4, 5], enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const updateM = useMutation({
    mutationFn: async (patch: any) => {
      const { id, ...fields } = patch;
      // Keep the legacy single-time column in step for older readers.
      if (Array.isArray(fields.times_of_day) && fields.times_of_day.length) fields.time_of_day = fields.times_of_day[0];
      const { error } = await supabase.from('reminder_settings').update(fields).eq('id', id);
      if (error) throw error;
    },
    onMutate: async (patch: any) => {
      await qc.cancelQueries({ queryKey: ['reminder_settings', userId] });
      const prev = qc.getQueryData<any[]>(['reminder_settings', userId]);
      qc.setQueryData<any[]>(['reminder_settings', userId], old => (old ?? []).map(x => (x.id === patch.id ? { ...x, ...patch } : x)));
      return { prev };
    },
    onError: (e: Error, _r, ctx) => {
      if (ctx?.prev) qc.setQueryData(['reminder_settings', userId], ctx.prev);
      toast.error(`Could not save reminder: ${e.message}`);
    },
    onSettled: invalidate,
  });

  const testM = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('send-reminder', { body: { test_reminder_id: id } });
      if (error) {
        let detail = error.message;
        try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail; } catch { /* generic */ }
        throw new Error(detail);
      }
      return data as { ok: boolean; channels: Channel[]; delivered: Channel[]; errors: Record<string, string> };
    },
    onSuccess: res => {
      const failed = Object.entries(res.errors ?? {}).map(([c, e]) => `${CHANNEL_LABEL[c as Channel] ?? c}: ${e}`);
      if (res.ok) {
        toast.success(`Test sent via ${res.delivered.map(c => CHANNEL_LABEL[c]).join(', ')}`, failed.length ? { description: `Not delivered — ${failed.join('; ')}`, duration: 9000 } : undefined);
      } else {
        toast.error('Test could not be delivered', { description: failed.join('; ') || 'No channel accepted the message.', duration: 10000 });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminder_settings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = remindersQ.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Reminders</CardTitle>
            <CardDescription>
              Each reminder sends a digest at the times you choose, in your timezone ({profile?.timezone || 'Asia/Kolkata'}).
              Email goes to <strong>{profile?.email ?? 'your login address'}</strong>.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => addM.mutate()} disabled={addM.isPending}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {profile?.ntfy_topic && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Smartphone className="h-4 w-4" /> Your push topic</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded border bg-background px-2 py-1.5 text-xs">{profile.ntfy_topic}</code>
              <Button size="sm" variant="outline" aria-label="Copy topic" onClick={() => { navigator.clipboard.writeText(profile.ntfy_topic!); toast.success('Copied'); }}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Subscribe to this topic in the <a className="underline" href="https://ntfy.sh/app" target="_blank" rel="noreferrer">ntfy web app</a>,
              the <a className="underline" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noreferrer">Android</a> or
              <a className="underline" href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noreferrer"> iOS</a> app to receive push.
              Telegram is usually the most reliable way to get notified on your phone.
            </p>
          </div>
        )}

        {remindersQ.isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders yet. Add one to get your schedule, tasks or bills delivered automatically.</p>
        ) : rows.map((r: any) => (
          <ReminderRow
            key={r.id}
            row={r}
            profile={profile}
            lastRun={lastRunLine(lastByReminder.get(r.id))}
            onChange={patch => updateM.mutate({ id: r.id, ...patch })}
            onDelete={() => { if (confirm('Delete this reminder?')) deleteM.mutate(r.id); }}
            onTest={() => testM.mutate(r.id)}
            testing={testM.isPending && testM.variables === r.id}
          />
        ))}
      </CardContent>
    </Card>
  );
}

const dedupeSorted = (times: string[]) => Array.from(new Set(times)).sort();

function channelsOf(row: any): Channel[] {
  if (Array.isArray(row.channels) && row.channels.length) return row.channels as Channel[];
  switch (row.channel) {
    case 'ntfy': return ['ntfy'];
    case 'telegram': return ['telegram'];
    case 'both': return ['email', 'ntfy'];
    case 'all': return ['email', 'ntfy', 'telegram'];
    default: return ['email'];
  }
}

function toLocal(row: any) {
  return {
    enabled: !!row.enabled,
    category: row.category as string,
    channels: channelsOf(row),
    days_of_week: (row.days_of_week ?? []) as number[],
    times_of_day: (row.times_of_day?.length ? row.times_of_day : [row.time_of_day ?? '07:00:00']) as string[],
  };
}

interface RowProps {
  row: any;
  profile: ProfileLite | null | undefined;
  lastRun: { ok: boolean; text: string } | null;
  onChange: (patch: any) => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
}

function ReminderRow({ row, profile, lastRun, onChange, onDelete, onTest, testing }: RowProps) {
  const [local, setLocal] = useState(() => toLocal(row));
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef(toLocal(row));

  // Take server changes in when no edit is in flight.
  useEffect(() => {
    if (saveTimer.current) return;
    const next = toLocal(row);
    setLocal(next);
    lastSaved.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.enabled, row.category, JSON.stringify(row.channels), row.channel, JSON.stringify(row.days_of_week), JSON.stringify(row.times_of_day)]);

  function patch(p: Partial<typeof local>, instant = false) {
    setLocal(cur => {
      const next = { ...cur, ...p };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const fire = () => {
        saveTimer.current = null;
        const dirty: Record<string, unknown> = {};
        for (const k of Object.keys(next) as (keyof typeof next)[]) {
          if (JSON.stringify(next[k]) !== JSON.stringify(lastSaved.current[k])) dirty[k] = next[k];
        }
        if (Object.keys(dirty).length) { lastSaved.current = next; onChange(dirty); }
      };
      if (instant) fire(); else saveTimer.current = window.setTimeout(fire, 350);
      return next;
    });
  }

  const addTime = () => {
    const candidates = ['09:00:00', '12:00:00', '15:00:00', '18:00:00', '21:00:00', '06:00:00', '11:00:00', '14:00:00', '17:00:00', '20:00:00'];
    const have = new Set(local.times_of_day);
    const fresh = candidates.find(c => !have.has(c)) ?? '08:30:00';
    patch({ times_of_day: dedupeSorted([...local.times_of_day, fresh]) });
  };
  const setTime = (idx: number, value: string) => { const next = [...local.times_of_day]; next[idx] = value; patch({ times_of_day: dedupeSorted(next) }); };
  const removeTime = (idx: number) => { if (local.times_of_day.length > 1) patch({ times_of_day: local.times_of_day.filter((_, i) => i !== idx) }); };
  const toggleDay = (i: number) => patch({ days_of_week: local.days_of_week.includes(i) ? local.days_of_week.filter(x => x !== i) : [...local.days_of_week, i].sort() });

  const toggleChannel = (c: Channel) => {
    const has = local.channels.includes(c);
    if (has && local.channels.length === 1) { toast.info('Keep at least one channel'); return; }
    patch({ channels: has ? local.channels.filter(x => x !== c) : [...local.channels, c] }, true);
  };

  const hints: Record<Channel, { disabled: boolean; note: string }> = {
    email: { disabled: !profile?.email, note: profile?.email ? `to ${profile.email}` : 'no email on your profile' },
    ntfy: { disabled: !profile?.ntfy_topic, note: 'needs the ntfy app subscribed to your topic' },
    telegram: { disabled: !profile?.telegram_chat_id, note: profile?.telegram_chat_id ? 'to your linked chat' : 'link Telegram in the card below first' },
  };

  return (
    <div className={cn('space-y-3 rounded-lg border p-3 transition-opacity', !local.enabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch checked={local.enabled} onCheckedChange={v => patch({ enabled: v }, true)} aria-label="Enable reminder" />
          <span className="text-sm font-medium">{local.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={!local.enabled || testing} onClick={onTest} title="Send this reminder right now">
            <Send className="h-3.5 w-3.5" /> {testing ? 'Sending…' : 'Test'}
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} title="Delete reminder" aria-label="Delete reminder"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <fieldset disabled={!local.enabled} className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">What to send</Label>
          <select
            value={local.category} onChange={e => patch({ category: e.target.value }, true)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50"
          >
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Send via</Label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map(c => {
              const on = local.channels.includes(c);
              const h = hints[c];
              return (
                <button
                  key={c} type="button" aria-pressed={on} title={h.note}
                  onClick={() => toggleChannel(c)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    on ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
                    on && h.disabled && 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10')}
                >
                  {CHANNEL_LABEL[c]}{on && h.disabled ? ' ⚠' : ''}
                </button>
              );
            })}
          </div>
          {local.channels.some(c => hints[c].disabled) && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {local.channels.filter(c => hints[c].disabled).map(c => `${CHANNEL_LABEL[c]}: ${hints[c].note}`).join(' · ')}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Times of day <span className="text-muted-foreground">({profile?.timezone || 'Asia/Kolkata'})</span></Label>
          <div className="flex flex-wrap items-center gap-2">
            {local.times_of_day.map((t, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <TimePicker value={t} onChange={v => setTime(idx, v)} disabled={!local.enabled} />
                {local.times_of_day.length > 1 && (
                  <button type="button" className="rounded p-1 hover:bg-muted" title="Remove time" aria-label="Remove time" onClick={() => removeTime(idx)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" type="button" onClick={addTime}><Plus className="h-3 w-3" /> Add time</Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Days</Label>
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d} type="button" disabled={!local.enabled} onClick={() => toggleDay(i)} aria-pressed={local.days_of_week.includes(i)}
                className={cn('rounded px-2 py-0.5 text-xs', local.days_of_week.includes(i) ? 'bg-primary text-primary-foreground' : 'bg-secondary')}
              >{d}</button>
            ))}
          </div>
          {local.days_of_week.length === 0 && <p className="text-xs text-amber-600">No days selected — this reminder will never send.</p>}
        </div>
      </fieldset>

      <p className={cn('flex items-start gap-1.5 text-xs', lastRun ? (lastRun.ok ? 'text-muted-foreground' : 'text-red-600') : 'text-muted-foreground')}>
        {lastRun ? (lastRun.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />) : null}
        <span>{lastRun ? lastRun.text : 'Not sent yet — use Test to check delivery.'}</span>
      </p>
    </div>
  );
}
