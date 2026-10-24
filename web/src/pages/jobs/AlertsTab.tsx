import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Search, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useUserId, type SavedSearchRow } from '@/lib/jobs/data';
import { describeFilters, type JobFilters } from '@shared/job-filters.ts';
import { timeAgo } from './parts';

const CHANNELS = [['email', 'Email'], ['ntfy', 'Push'], ['telegram', 'Telegram']] as const;

export function AlertsTab({ runSearch }: { runSearch: (filters: JobFilters) => void }) {
  const userId = useUserId();
  const qc = useQueryClient();

  const searchesQ = useQuery({
    queryKey: ['job-searches', userId],
    enabled: !!userId,
    queryFn: async (): Promise<SavedSearchRow[]> => {
      const { data, error } = await supabase.from('job_saved_searches').select('*').eq('user_id', userId!).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SavedSearchRow[];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SavedSearchRow> }) => {
      const { error } = await supabase.from('job_saved_searches').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-searches', userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_saved_searches').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['job-searches', userId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendNow = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('job-digest', { body: { search_id: id } });
      if (error) {
        let detail = error.message;
        try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail; } catch { /* generic */ }
        throw new Error(detail);
      }
      return data as { sent: boolean; matches: number; channels?: string[]; errors?: Record<string, string> };
    },
    onSuccess: r => {
      const failed = Object.entries(r.errors ?? {}).map(([c, e]) => `${c}: ${e}`).join('; ');
      if (r.matches === 0) toast.success('No new jobs yet — nothing to send');
      else if (r.sent) toast.success(`Sent ${r.matches} new job${r.matches === 1 ? '' : 's'} via ${(r.channels ?? []).join(', ')}`, failed ? { description: `Not delivered — ${failed}` } : undefined);
      else toast.error('Found new jobs but could not deliver them', { description: failed || 'No channel accepted the message.' });
      qc.invalidateQueries({ queryKey: ['job-searches', userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (searchesQ.isLoading) return <Skeleton className="h-40" />;
  const rows = searchesQ.data ?? [];
  if (!rows.length) {
    return <EmptyState icon={Bell} title="No saved searches" description="Search in Find, then tap “Save search” to get a digest of new jobs by email, push or Telegram." />;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Digests list only jobs posted since the last one. Delivery uses the channels you pick on each search.</p>
      {rows.map(s => {
        const filters = s.query as JobFilters;
        return (
          <div key={s.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 font-semibold">{s.notify ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}<span className="truncate">{s.name}</span></h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{describeFilters(filters)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.last_run_at ? `Last digest ${timeAgo(s.last_run_at)} · ${s.last_match_count} new` : 'No digest sent yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => runSearch(filters)}><Search className="h-4 w-4" /> Open</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete “${s.name}”?`)) remove.mutate(s.id); }} aria-label="Delete search"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={s.notify} onCheckedChange={v => update.mutate({ id: s.id, patch: { notify: v } })} aria-label={`Notify for ${s.name}`} /> Notify
              </label>
              <select
                value={s.frequency} disabled={!s.notify} aria-label="Frequency"
                onChange={e => update.mutate({ id: s.id, patch: { frequency: e.target.value as 'daily' | 'weekly' } })}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50"
              >
                <option value="daily">Daily</option><option value="weekly">Weekly</option>
              </select>
              <div className="flex gap-1.5">
                {CHANNELS.map(([c, l]) => {
                  const on = s.channels.includes(c);
                  return (
                    <button
                      key={c} type="button" disabled={!s.notify} aria-pressed={on}
                      onClick={() => { const next = on ? s.channels.filter(x => x !== c) : [...s.channels, c]; update.mutate({ id: s.id, patch: { channels: next.length ? next : ['email'] } }); }}
                      className={cn('rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50', on ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <Button size="sm" variant="outline" className="ml-auto" title="Sends matches from the last 7 days right now" onClick={() => sendNow.mutate(s.id)} disabled={sendNow.isPending && sendNow.variables === s.id}>
                <Send className="h-4 w-4" /> Send digest now
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
