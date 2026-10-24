import { formatDistanceToNowStrict } from 'date-fns';
import { Bookmark, BookmarkCheck, CheckCircle2, Clock, MapPin, ShieldAlert, Wifi } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { formatSalary, ghostSignal, type Job } from '@shared/job-shape.ts';
import { matchJob, normalizeSkill, type MatchProfile, type MatchResult } from '@shared/job-match.ts';
import { STAGE_LABEL, type Stage } from '@shared/job-tracker.ts';

export const SKILL_LABELS: Record<string, string> = {
  nodejs: 'Node.js', nextjs: 'Next.js', javascript: 'JavaScript', typescript: 'TypeScript', postgresql: 'PostgreSQL',
  mongodb: 'MongoDB', graphql: 'GraphQL', aws: 'AWS', gcp: 'GCP', ai: 'AI', css: 'CSS', html: 'HTML', sql: 'SQL',
  kubernetes: 'Kubernetes', docker: 'Docker', reactnative: 'React Native', github: 'GitHub', oauth: 'OAuth', jwt: 'JWT',
};

export function skillLabel(slug: string): string {
  const k = normalizeSkill(slug);
  return SKILL_LABELS[k] ?? slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return `${formatDistanceToNowStrict(t)} ago`;
}

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  const letters = name.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div
      aria-hidden
      className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold text-white', className)}
      style={{ background: `linear-gradient(135deg, hsl(${h} 65% 48%), hsl(${(h + 40) % 360} 70% 40%))` }}
    >
      {letters}
    </div>
  );
}

const MATCH_STYLE: Record<MatchResult['label'], string> = {
  strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  good: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  weak: 'bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-300',
  unknown: 'bg-muted text-muted-foreground',
};

export function MatchBadge({ match, className }: { match: MatchResult; className?: string }) {
  if (match.score === null) return null;
  return (
    <span title={`${match.matched.length} matching skills`} className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', MATCH_STYLE[match.label], className)}>
      {match.score}% match
    </span>
  );
}

export function GhostBadge({ job }: { job: Job }) {
  const g = ghostSignal(job.reality);
  if (g.level === 'ok') return null;
  return (
    <span
      title={g.evidence.join(' · ')}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        g.level === 'bad' ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300')}
    >
      <ShieldAlert className="h-3 w-3" /> {g.label}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> {STAGE_LABEL[stage] ?? stage}</Badge>;
}

interface JobCardProps {
  job: Job;
  profile: MatchProfile;
  saved: boolean;
  stage?: Stage;
  active?: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
}

export function JobCard({ job, profile, saved, stage, active, onOpen, onToggleSave }: JobCardProps) {
  const match = matchJob(job, profile);
  const salary = formatSalary(job.enrichment);
  const matched = new Set(match.matched.map(normalizeSkill));
  const posted = timeAgo(job.posted_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={cn(
        'group relative cursor-pointer rounded-xl border bg-card p-4 transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-primary ring-1 ring-primary/40',
      )}
    >
      <div className="flex gap-3">
        <CompanyAvatar name={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-snug line-clamp-2">{job.title}</h3>
            <button
              type="button"
              aria-label={saved ? 'Remove from saved' : 'Save job'}
              onClick={e => { e.stopPropagation(); onToggleSave(); }}
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {saved ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}
            </button>
          </div>
          <p className="truncate text-sm text-muted-foreground">{job.company}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>}
            {job.work_mode && <span className="inline-flex items-center gap-1 capitalize"><Wifi className="h-3 w-3" />{job.work_mode}</span>}
            {posted && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{posted}</span>}
            {salary && <span className="font-medium text-foreground">{salary}</span>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <MatchBadge match={match} />
            <GhostBadge job={job} />
            {stage && <StageBadge stage={stage} />}
          </div>

          {job.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {job.skills.slice(0, 6).map(s => (
                <span
                  key={s}
                  className={cn('rounded-md px-1.5 py-0.5 text-[11px]',
                    matched.has(normalizeSkill(s)) ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}
                >
                  {skillLabel(s)}
                </span>
              ))}
              {job.skills.length > 6 && <span className="px-1 text-[11px] text-muted-foreground">+{job.skills.length - 6}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
