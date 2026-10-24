import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  AlertTriangle, Bookmark, BookmarkCheck, Briefcase, Building2, CheckCircle2, ChevronDown, Copy, ExternalLink, GraduationCap, Loader2,
  MapPin, MessageCircle, Sparkles, Wallet, Wifi, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loader';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/Sheet';
import { cn } from '@/lib/utils';
import { jobAi, jobsApi, type FitAnalysis, type SearchPage } from '@/lib/jobs/api';
import { sanitizeHtml } from '@/lib/jobs/sanitize';
import { toMatchProfile, useJobActions, useJobProfile, useSavedListings } from '@/lib/jobs/data';
import { formatSalary, ghostSignal, type Job } from '@shared/job-shape.ts';
import { matchJob, normalizeSkill, type MatchResult } from '@shared/job-match.ts';
import { CompanyAvatar, GhostBadge, MatchBadge, StageBadge, skillLabel, timeAgo } from './parts';

type Pane = 'overview' | 'fit' | 'ask';

interface Props {
  slug: string;
  onClose: () => void;
  onOpenJob: (slug: string) => void;
  onGoProfile: () => void;
  onGoTracker: () => void;
}

function useFallbackJob(slug: string): Job | undefined {
  const qc = useQueryClient();
  const saved = useSavedListings();
  return useMemo(() => {
    const fromSaved = saved.data?.find(l => l.public_slug === slug)?.snapshot;
    if (fromSaved) return fromSaved;
    for (const [, data] of qc.getQueriesData<InfiniteData<SearchPage>>({ queryKey: ['jobs-search'] })) {
      for (const page of data?.pages ?? []) {
        const hit = page.jobs.find(j => j.public_slug === slug);
        if (hit) return hit;
      }
    }
    return undefined;
  }, [qc, saved.data, slug]);
}

export function JobDrawer({ slug, onClose, onOpenJob, onGoProfile, onGoTracker }: Props) {
  const fallback = useFallbackJob(slug);
  const jobQ = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.job(slug),
    staleTime: 10 * 60_000,
    retry: (n, e) => n < 1 && !/not found|404/i.test((e as Error).message),
    placeholderData: fallback,
  });
  const job = jobQ.data ?? fallback;
  const closed = jobQ.isError && /not found|404/i.test((jobQ.error as Error).message);

  const [pane, setPane] = useState<Pane>('overview');
  const [appliedPrompt, setAppliedPrompt] = useState(false);

  const profileQ = useJobProfile();
  const profile = toMatchProfile(profileQ.data);
  const actions = useJobActions();
  const match = job ? matchJob(job, profile) : null;
  const app = job ? actions.appFor(job.public_slug) : undefined;
  const saved = job ? actions.isSaved(job.public_slug) : false;

  const apply = () => {
    if (!job) return;
    window.open(job.url, '_blank', 'noopener,noreferrer');
    if (!app) setAppliedPrompt(true);
  };

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent>
        {!job ? (
          <div className="space-y-3 p-6">
            <SheetTitle className="sr-only">Job details</SheetTitle>
            {jobQ.isError ? (
              <p className="text-sm text-destructive">{(jobQ.error as Error).message}</p>
            ) : (<><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-64" /></>)}
          </div>
        ) : (
          <>
            <header className="space-y-3 border-b p-5 pr-12">
              <div className="flex gap-3">
                <CompanyAvatar name={job.company} className="h-12 w-12 text-base" />
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-semibold leading-snug">{job.title}</SheetTitle>
                  <p className="text-sm text-muted-foreground">{job.company}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.location}</span>}
                {job.work_mode && <span className="inline-flex items-center gap-1 capitalize"><Wifi className="h-3.5 w-3.5" />{job.work_mode}</span>}
                {formatSalary(job.enrichment) && <span className="inline-flex items-center gap-1 font-medium text-foreground"><Wallet className="h-3.5 w-3.5" />{formatSalary(job.enrichment)}</span>}
                {timeAgo(job.posted_at) && <span>Posted {timeAgo(job.posted_at)}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {match && <MatchBadge match={match} />}
                <GhostBadge job={job} />
                {app && <StageBadge stage={app.status} />}
                {(closed || job.closed_at) && <Badge variant="destructive">Posting closed</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={apply} disabled={closed || !!job.closed_at}>Apply <ExternalLink className="h-4 w-4" /></Button>
                <Button
                  variant="outline"
                  onClick={() => actions.toggleSave.mutate({ job, save: !saved })}
                  disabled={actions.toggleSave.isPending}
                >
                  {saved ? <><BookmarkCheck className="h-4 w-4 text-primary" /> Saved</> : <><Bookmark className="h-4 w-4" /> Save</>}
                </Button>
                {app ? (
                  <Button variant="ghost" onClick={onGoTracker}><Briefcase className="h-4 w-4" /> View in tracker</Button>
                ) : (
                  <Button variant="ghost" onClick={() => actions.track.mutate({ job })} disabled={actions.track.isPending}>
                    <Briefcase className="h-4 w-4" /> I applied
                  </Button>
                )}
              </div>
              {appliedPrompt && !app && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span>Did you apply to this job?</span>
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => { actions.track.mutate({ job }); setAppliedPrompt(false); }}>Yes, track it</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAppliedPrompt(false)}>Not yet</Button>
                  </span>
                </div>
              )}
              <nav className="-mb-3 flex gap-1 overflow-x-auto" role="tablist">
                {([['overview', 'Overview', Briefcase], ['fit', 'Fit & apply', Sparkles], ['ask', 'Ask AI', MessageCircle]] as const).map(([id, name, Icon]) => (
                  <button
                    key={id} role="tab" aria-selected={pane === id} onClick={() => setPane(id)}
                    className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                      pane === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                  >
                    <Icon className="h-4 w-4" /> {name}
                  </button>
                ))}
              </nav>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              {pane === 'overview' && <OverviewPane job={job} match={match} loading={jobQ.isFetching && !jobQ.data?.description} onOpenJob={onOpenJob} />}
              {pane === 'fit' && <FitPane job={job} match={match} hasResume={!!profileQ.data?.resume_text} onGoProfile={onGoProfile} />}
              {pane === 'ask' && <AskPane job={job} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-0.5 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function OverviewPane({ job, match, loading, onOpenJob }: { job: Job; match: MatchResult | null; loading: boolean; onOpenJob: (s: string) => void }) {
  const e = job.enrichment;
  const ghost = ghostSignal(job.reality);
  const matched = new Set((match?.matched ?? []).map(normalizeSkill));
  const [showCompany, setShowCompany] = useState(false);

  const similarQ = useQuery({ queryKey: ['job-similar', job.public_slug], queryFn: () => jobsApi.similar(job.public_slug), staleTime: 10 * 60_000 });
  const companyQ = useQuery({
    queryKey: ['job-company', job.company_slug], enabled: showCompany && !!job.company_slug,
    queryFn: () => jobsApi.company(job.company_slug!), staleTime: 10 * 60_000,
  });

  const html = useMemo(() => (job.description ? sanitizeHtml(job.description) : ''), [job.description]);

  return (
    <div className="space-y-6">
      {e.summary && (
        <div className="rounded-xl bg-primary/5 p-4 text-sm leading-relaxed">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"><Sparkles className="h-3.5 w-3.5" /> Summary</div>
          {e.summary}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact icon={Wallet} label="Salary" value={formatSalary(e)} />
        <Fact icon={GraduationCap} label="Experience" value={e.experience_years_min != null ? `${e.experience_years_min}+ years` : null} />
        <Fact icon={Wifi} label="Work mode" value={job.work_mode} />
        <Fact icon={Briefcase} label="Category" value={e.category?.replace(/_/g, ' ')} />
        <Fact icon={Building2} label="Source" value={job.source} />
        <Fact icon={CheckCircle2} label="Visa sponsorship" value={e.visa_sponsorship ? 'Offered' : null} />
      </div>

      {job.skills.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {job.skills.map(s => {
              const have = matched.has(normalizeSkill(s));
              return (
                <span key={s} className={cn('rounded-md px-2 py-1 text-xs', have ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                  {have && '✓ '}{skillLabel(s)}
                </span>
              );
            })}
          </div>
          {match && match.score !== null && <p className="mt-1.5 text-xs text-muted-foreground">Green = in your profile or resume.</p>}
        </section>
      )}

      {ghost.label !== 'No signal' && (
        <section className={cn('rounded-lg border p-3 text-sm', ghost.level === 'bad' ? 'border-red-300/60' : ghost.level === 'warn' ? 'border-amber-300/60' : 'border-emerald-300/60')}>
          <div className="flex items-center gap-1.5 font-medium">
            {ghost.level === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            Posting reality: {ghost.label}
          </div>
          {ghost.evidence.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{ghost.evidence.map(x => <li key={x}>{x}</li>)}</ul>}
          <p className="mt-1 text-xs text-muted-foreground">A signal from observed behaviour, not a verdict on the employer.</p>
        </section>
      )}

      {(e.requirements?.length ?? 0) > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Requirements</h3>
          <ul className="space-y-1.5 text-sm">
            {e.requirements!.slice(0, 12).map((r, i) => (
              <li key={i} className="flex gap-2">
                <Badge variant={r.priority === 'required' || !r.priority ? 'secondary' : 'outline'} className="mt-0.5 h-5 shrink-0 text-[10px]">{r.priority ?? 'required'}</Badge>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Description</h3>
        {loading && !html ? <Skeleton className="h-48" /> : html ? (
          <div className="prose prose-sm max-w-none break-words dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
        ) : <p className="text-sm text-muted-foreground">{job.snippet || 'No description available.'}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Similar jobs</h3>
        {similarQ.isLoading ? <Skeleton className="h-20" /> : (similarQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No similar jobs found.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {similarQ.data!.map(j => (
              <li key={j.public_slug}>
                <button type="button" onClick={() => onOpenJob(j.public_slug)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted">
                  <CompanyAvatar name={j.company} className="h-8 w-8 text-xs" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{j.title}</span><span className="block truncate text-xs text-muted-foreground">{j.company}{j.location ? ` · ${j.location}` : ''}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {job.company_slug && (
        <section>
          <button type="button" onClick={() => setShowCompany(v => !v)} className="flex w-full items-center justify-between text-sm font-semibold">
            More from {job.company} <ChevronDown className={cn('h-4 w-4 transition-transform', showCompany && 'rotate-180')} />
          </button>
          {showCompany && (
            <div className="mt-2">
              {companyQ.isLoading ? <Skeleton className="h-20" /> : (companyQ.data?.jobs ?? []).filter(j => j.public_slug !== job.public_slug).length === 0 ? (
                <p className="text-sm text-muted-foreground">No other open roles found.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {companyQ.data!.jobs.filter(j => j.public_slug !== job.public_slug).map(j => (
                    <li key={j.public_slug}>
                      <button type="button" onClick={() => onOpenJob(j.public_slug)} className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted">
                        <span className="block truncate font-medium">{j.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{j.location ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<FitAnalysis['verdict'], string> = {
  strong: 'bg-emerald-100 text-emerald-800', good: 'bg-green-100 text-green-800', partial: 'bg-amber-100 text-amber-800', weak: 'bg-slate-200 text-slate-700',
};

function FitPane({ job, match, hasResume, onGoProfile }: { job: Job; match: MatchResult | null; hasResume: boolean; onGoProfile: () => void }) {
  const fitM = useMutation({ mutationFn: () => jobAi.fit(job.public_slug), onError: (e: Error) => toast.error(e.message) });
  const [tone, setTone] = useState('professional');
  const [letter, setLetter] = useState('');
  const letterM = useMutation({
    mutationFn: () => jobAi.coverLetter(job.public_slug, tone),
    onSuccess: r => setLetter(r.text),
    onError: (e: Error) => toast.error(e.message),
  });
  const analysis = fitM.data?.analysis;

  return (
    <div className="space-y-6">
      {match && match.parts.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Match breakdown</h3>
            <MatchBadge match={match} />
          </div>
          <div className="space-y-2">
            {match.parts.map(p => (
              <div key={p.key}>
                <div className="flex justify-between text-xs"><span className="font-medium">{p.label}</span><span className="text-muted-foreground">{p.detail}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', p.score >= 0.75 ? 'bg-emerald-500' : p.score >= 0.4 ? 'bg-amber-500' : 'bg-slate-400')} style={{ width: `${Math.round(p.score * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          {match.missing.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Not in your profile or resume: {match.missing.slice(0, 10).map(skillLabel).join(', ')}{match.missing.length > 10 ? '…' : ''}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Calculated from your skills, experience, work mode, location and salary target. Nothing is credited that your profile doesn't show.</p>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Add your skills and experience in your profile to see how well you match.</p>
      )}

      {!hasResume ? (
        <div className="rounded-xl border border-dashed p-5 text-center">
          <p className="text-sm">The AI fit analysis and cover letter use your resume.</p>
          <Button className="mt-3" variant="outline" onClick={onGoProfile}>Add your resume</Button>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">AI fit analysis</h3>
              <Button size="sm" onClick={() => fitM.mutate()} disabled={fitM.isPending}>
                {fitM.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</> : <><Sparkles className="h-4 w-4" /> {analysis ? 'Re-run' : 'Analyse my fit'}</>}
              </Button>
            </div>
            {fitM.isPending && <p className="text-xs text-muted-foreground">This can take up to a minute the first time.</p>}
            {analysis && (
              <div className="space-y-4 rounded-xl border p-4 text-sm">
                <div className="flex items-start gap-2">
                  <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', VERDICT_STYLE[analysis.verdict])}>{analysis.verdict} fit</span>
                  <p>{analysis.summary}</p>
                </div>
                {analysis.strengths.length > 0 && (
                  <div><h4 className="mb-1 font-medium">Strengths</h4><ul className="space-y-1">{analysis.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{s}</li>)}</ul></div>
                )}
                {analysis.gaps.length > 0 && (
                  <div><h4 className="mb-1 font-medium">Gaps</h4><ul className="space-y-1.5">{analysis.gaps.map((g, i) => <li key={i} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span><strong>{g.requirement}</strong>{g.note ? ` — ${g.note}` : ''}</span></li>)}</ul></div>
                )}
                {analysis.how_to_address.length > 0 && (
                  <div><h4 className="mb-1 font-medium">How to address them</h4><ol className="list-decimal space-y-1 pl-5">{analysis.how_to_address.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
                )}
                {analysis.interview_questions.length > 0 && (
                  <div><h4 className="mb-1 font-medium">Likely interview questions</h4><ul className="list-disc space-y-1 pl-5">{analysis.interview_questions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                )}
                <p className="text-xs text-muted-foreground">AI-generated from your resume text. Double-check before relying on it.</p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Cover letter draft</h3>
              <div className="flex items-center gap-2">
                <select value={tone} onChange={e => setTone(e.target.value)} aria-label="Tone" className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                  <option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option>
                </select>
                <Button size="sm" onClick={() => letterM.mutate()} disabled={letterM.isPending}>
                  {letterM.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Writing…</> : letter ? 'Rewrite' : 'Generate'}
                </Button>
              </div>
            </div>
            {letter && (
              <div className="space-y-2">
                <textarea value={letter} onChange={e => setLetter(e.target.value)} rows={12} aria-label="Cover letter" className="w-full rounded-lg border border-input bg-background p-3 text-sm leading-relaxed" />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Draft built only from facts in your resume. Edit before sending.</p>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(letter).then(() => toast.success('Copied')); }}><Copy className="h-4 w-4" /> Copy</Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const SUGGESTED = [
  'Is this a people-management role?',
  'What would the first 90 days look like?',
  'What salary could I negotiate for this role?',
  'What should I ask the recruiter?',
];

function AskPane({ job }: { job: Job }) {
  const [q, setQ] = useState('');
  const [thread, setThread] = useState<{ q: string; a?: string; error?: string }[]>([]);
  const askM = useMutation({
    mutationFn: (question: string) => jobAi.ask(job.public_slug, question),
    onMutate: question => setThread(t => [...t, { q: question }]),
    onSuccess: (r, question) => setThread(t => t.map(x => (x.q === question && x.a === undefined && !x.error ? { ...x, a: r.answer } : x))),
    onError: (e: Error, question) => setThread(t => t.map(x => (x.q === question && x.a === undefined && !x.error ? { ...x, error: e.message } : x))),
  });
  const send = (text: string) => { const v = text.trim(); if (v.length < 3 || askM.isPending) return; setQ(''); askM.mutate(v); };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Ask anything about this posting. Answers use the job description and, when relevant, your resume.</p>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map(s => <button key={s} type="button" onClick={() => send(s)} disabled={askM.isPending} className="rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">{s}</button>)}
      </div>
      <div className="space-y-4">
        {thread.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{t.q}</div>
            <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
              {t.error ? <span className="text-destructive">{t.error}</span> : t.a ?? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</span>}
            </div>
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send(q); }}>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about this job…" maxLength={500} aria-label="Question about this job" />
        <Button type="submit" disabled={askM.isPending || q.trim().length < 3}>Ask</Button>
      </form>
    </div>
  );
}
