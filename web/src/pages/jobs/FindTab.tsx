import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellPlus, Briefcase, Filter, Loader2, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { jobsApi, type Suggestion } from '@/lib/jobs/api';
import { toMatchProfile, useJobActions, useJobProfile, useUserId } from '@/lib/jobs/data';
import { describeFilters, filtersFromUrl, filtersToUrl, sanitizeFilters, type JobFilters } from '@shared/job-filters.ts';
import { normalizeSkill } from '@shared/job-match.ts';
import { FilterPanel } from './FilterPanel';
import { JobCard } from './parts';

const PAGE = 20;
const FILTER_KEYS_RESET = ['tab', 'job'];

interface Props {
  params: URLSearchParams;
  setParams: (next: URLSearchParams, opts?: { replace?: boolean }) => void;
  openJob: (slug: string) => void;
  activeSlug: string | null;
}

export function FindTab({ params, setParams, openJob, activeSlug }: Props) {
  const profileQ = useJobProfile();
  const profile = profileQ.data;
  const actions = useJobActions();

  const urlFilters = useMemo(() => filtersFromUrl(params), [params]);
  const anywhere = params.get('cx') === '1';
  // Stale / evergreen ads are hidden unless the URL opts out (`stale=1`); most of the catalogue is stale.
  const allowStale = params.get('stale') === '1';
  const filters: JobFilters = useMemo(() => {
    const base = { ...urlFilters, fresh_only: allowStale ? undefined : true };
    if (anywhere || base.countries?.length) return base;
    return { ...base, countries: profile?.countries?.length ? profile.countries : ['in'] };
  }, [urlFilters, anywhere, allowStale, profile?.countries]);

  const commit = (next: JobFilters, opts?: { anywhere?: boolean }) => {
    const p = filtersToUrl(sanitizeFilters({ ...next, fresh_only: undefined }));
    for (const k of FILTER_KEYS_RESET) { const v = params.get(k); if (v) p.set(k, v); }
    const cx = opts?.anywhere ?? anywhere;
    if (cx) { p.set('cx', '1'); p.delete('countries'); }
    if (!next.fresh_only) p.set('stale', '1');
    setParams(p, { replace: true });
  };

  const reset = () => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS_RESET) { const v = params.get(k); if (v) p.set(k, v); }
    setParams(p, { replace: true });
  };

  // ---- search box ----
  const [qInput, setQInput] = useState(filters.q ?? '');
  useEffect(() => { setQInput(filters.q ?? ''); }, [filters.q]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = qInput.trim();
    if (text.length < 2 || text === (filters.q ?? '')) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      jobsApi.suggest(text).then(s => setSuggestions(s.slice(0, 7))).catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [qInput, filters.q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setShowSuggest(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const submitQuery = (text: string) => { setShowSuggest(false); commit({ ...filters, q: text.trim() || undefined }); };
  const pickSuggestion = (s: Suggestion) => {
    const part = s.parts?.[0];
    setShowSuggest(false);
    if (part?.kind === 'skill') { commit({ ...filters, q: undefined, skills: [...new Set([...(filters.skills ?? []), normalizeSkill(part.slug)])] }); setQInput(''); }
    else if (part?.kind === 'company') { commit({ ...filters, q: undefined, company_slug: [part.slug] }); setQInput(''); }
    else submitQuery(s.text);
  };

  // ---- results ----
  const searchQ = useInfiniteQuery({
    queryKey: ['jobs-search', filters],
    enabled: !!profile,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: ({ pageParam }) => jobsApi.search(filters, PAGE, pageParam),
    getNextPageParam: last => {
      const next = last.offset + last.limit;
      return next < last.total && next + PAGE <= 10000 ? next : undefined;
    },
  });
  const jobs = searchQ.data?.pages.flatMap(p => p.jobs) ?? [];
  const total = searchQ.data?.pages[0]?.total ?? 0;
  const matchProfile = useMemo(() => toMatchProfile(profile), [profile]);

  const forYou = () => {
    if (!profile) return;
    const skills = [...new Set(profile.skills.map(normalizeSkill).filter(Boolean))].slice(0, 6);
    if (!skills.length) { toast.info('Add your skills in the Profile tab to get personalised results.'); return; }
    commit({
      skills, countries: profile.countries.length ? profile.countries : ['in'],
      work_mode: profile.work_modes.length ? profile.work_modes : undefined,
      salary_min: profile.salary_min ?? undefined, salary_currency: profile.salary_min ? [profile.salary_currency] : undefined,
      experience_years_max: profile.experience_years != null ? Math.ceil(profile.experience_years) + 1 : undefined,
      experience_include_unspecified: profile.experience_years != null ? true : undefined,
      fresh_only: true, sort: 'newest',
    }, { anywhere: false });
  };

  const [showFilters, setShowFilters] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const activeCount = [...filtersToUrl(filters).keys()].filter(k => k !== 'countries' && k !== 'fresh_only').length;
  const chips = describeFilters(filters);

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <aside className={cn('lg:block', showFilters ? 'block' : 'hidden')}>
        <div className="rounded-xl border bg-card p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <FilterPanel filters={filters} anywhere={anywhere} onChange={commit} onReset={reset} />
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div ref={boxRef} className="relative min-w-[12rem] flex-1">
            <form onSubmit={e => { e.preventDefault(); submitQuery(qInput); }}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qInput}
                onChange={e => { setQInput(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                placeholder="Search roles, companies, skills…"
                aria-label="Search jobs"
                className="h-11 pl-9 pr-9"
              />
              {qInput && (
                <button type="button" aria-label="Clear search" onClick={() => { setQInput(''); submitQuery(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>
            {showSuggest && suggestions.length > 0 && (
              <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-xl" role="listbox">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => pickSuggestion(s)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="truncate">{s.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.parts?.[0]?.kind}{s.jobs ? ` · ${s.jobs}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button variant="outline" className="lg:hidden" onClick={() => setShowFilters(v => !v)}>
            <Filter className="h-4 w-4" /> Filters{activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeCount}</span>}
          </Button>
          <Button variant="outline" onClick={forYou} title="Use your profile to build a search">
            <Sparkles className="h-4 w-4 text-amber-500" /> For you
          </Button>
          <Button variant="outline" onClick={() => setSaveOpen(true)} title="Get alerts for this search">
            <BellPlus className="h-4 w-4" /> Save search
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {searchQ.isLoading || !profile ? 'Searching…' : <><strong className="text-foreground">{total.toLocaleString()}</strong> jobs</>}
            {searchQ.isFetching && !searchQ.isLoading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
            <span className="ml-2 hidden sm:inline">· {chips}</span>
          </span>
          <a href="https://freehire.me" target="_blank" rel="noopener noreferrer" className="text-xs hover:text-foreground">Jobs from freehire.me</a>
        </div>

        {searchQ.isError ? (
          <EmptyState icon={Briefcase} title="Couldn't load jobs" description={(searchQ.error as Error).message} action={<Button onClick={() => searchQ.refetch()}>Try again</Button>} />
        ) : searchQ.isLoading || !profile ? (
          <div className="grid gap-3 xl:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title="No jobs match these filters" description="Try removing a filter or searching anywhere." action={<Button variant="outline" onClick={reset}>Reset filters</Button>} />
        ) : (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              {jobs.map(job => (
                <JobCard
                  key={job.public_slug}
                  job={job}
                  profile={matchProfile}
                  saved={actions.isSaved(job.public_slug)}
                  stage={actions.appFor(job.public_slug)?.status}
                  active={activeSlug === job.public_slug}
                  onOpen={() => openJob(job.public_slug)}
                  onToggleSave={() => actions.toggleSave.mutate({ job, save: !actions.isSaved(job.public_slug) })}
                />
              ))}
            </div>
            {searchQ.hasNextPage ? (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => searchQ.fetchNextPage()} disabled={searchQ.isFetchingNextPage}>
                  {searchQ.isFetchingNextPage ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : 'Load more'}
                </Button>
              </div>
            ) : jobs.length >= 10000 - PAGE ? (
              <p className="text-center text-xs text-muted-foreground">That's the deepest page the search allows. Narrow the filters to see more.</p>
            ) : null}
          </>
        )}
      </section>

      {saveOpen && <SaveSearchDialog filters={filters} onClose={() => setSaveOpen(false)} />}
    </div>
  );
}

function SaveSearchDialog({ filters, onClose }: { filters: JobFilters; onClose: () => void }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const [name, setName] = useState(() => describeFilters(filters).slice(0, 60));
  const [notify, setNotify] = useState(true);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [channels, setChannels] = useState<string[]>(['email']);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('job_saved_searches').insert({
        user_id: userId!, name: name.trim() || 'My search', query: filters, notify, frequency,
        channels: channels.length ? channels : ['email'],
        // Start the watermark now so the first digest only contains genuinely new jobs.
        last_run_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Search saved'); qc.invalidateQueries({ queryKey: ['job-searches', userId] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleChannel = (c: string) => setChannels(cur => cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c]);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Save this search</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ss-name">Name</Label>
            <Input id="ss-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
            <p className="text-xs text-muted-foreground">{describeFilters(filters)}</p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Notify me about new jobs</span>
            <Switch checked={notify} onCheckedChange={setNotify} aria-label="Notify me" />
          </label>
          {notify && (
            <>
              <div className="space-y-1.5">
                <Label>How often</Label>
                <div className="flex gap-2">
                  {(['daily', 'weekly'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setFrequency(f)} className={cn('rounded-full border px-3 py-1 text-xs font-medium capitalize', frequency === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>{f}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Send via</Label>
                <div className="flex flex-wrap gap-2">
                  {[['email', 'Email'], ['ntfy', 'Push (ntfy)'], ['telegram', 'Telegram']].map(([c, l]) => (
                    <button key={c} type="button" onClick={() => toggleChannel(c)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', channels.includes(c) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>{l}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save search'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
