import { Bookmark, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { toMatchProfile, useApplications, useJobProfile, useSavedListings, useUserId, type ListingRow } from '@/lib/jobs/data';
import { formatSalary, type Job } from '@shared/job-shape.ts';
import { CompanyAvatar, MatchBadge, StageBadge, skillLabel, timeAgo } from './parts';
import { matchJob } from '@shared/job-match.ts';

export function SavedTab({ openJob }: { openJob: (slug: string) => void }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const savedQ = useSavedListings();
  const appsQ = useApplications();
  const profile = toMatchProfile(useJobProfile().data);

  const unsave = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_listings').update({ is_saved: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['listings-saved', userId] }); toast.success('Removed from saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const track = useMutation({
    mutationFn: async (l: ListingRow) => {
      const { error } = await supabase.from('job_applications').insert({
        user_id: userId!, company: l.company, role: l.title, job_url: l.job_url, listing_id: l.id,
        public_slug: l.public_slug, applied_date: new Date().toISOString().slice(0, 10), status: 'applied',
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['applications', userId] }); toast.success('Added to tracker'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (savedQ.isLoading) return <Skeleton className="h-40" />;
  const rows = savedQ.data ?? [];
  if (!rows.length) {
    return <EmptyState icon={Bookmark} title="No saved jobs yet" description="Tap the bookmark on any job in Find to keep it here, even after the posting closes." />;
  }

  const appFor = (l: ListingRow) => (appsQ.data ?? []).find(a => a.listing_id === l.id || (l.public_slug && a.public_slug === l.public_slug));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{rows.length} saved</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map(l => {
          const app = appFor(l);
          const snap = l.snapshot as Job | null;
          const salary = snap ? formatSalary(snap.enrichment) : null;
          const match = snap ? matchJob(snap, profile) : null;
          const skills = (l.skills ?? snap?.skills ?? []).slice(0, 5);
          const openable = !!l.public_slug;
          return (
            <div key={l.id} className="rounded-xl border bg-card p-4">
              <div className="flex gap-3">
                <CompanyAvatar name={l.company} />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={!openable}
                    onClick={() => openable && openJob(l.public_slug!)}
                    className="block text-left font-semibold leading-snug hover:text-primary disabled:hover:text-foreground"
                  >
                    {l.title}
                  </button>
                  <p className="truncate text-sm text-muted-foreground">{l.company}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[l.location, l.work_mode, salary ?? l.salary_range ?? null, `saved ${timeAgo(l.fetched_at) ?? ''}`.trim()].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {match && <MatchBadge match={match} />}
                    {app && <StageBadge stage={app.status} />}
                    {!openable && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">legacy listing</span>}
                    {skills.map(s => <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{skillLabel(s)}</span>)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={l.job_url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Apply</Button></a>
                {!app && <Button size="sm" onClick={() => track.mutate(l)} disabled={track.isPending}>I applied</Button>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => unsave.mutate(l.id)} aria-label="Remove from saved"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
