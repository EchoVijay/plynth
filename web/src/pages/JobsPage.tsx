import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Bookmark, KanbanSquare, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApplications, useSavedListings } from '@/lib/jobs/data';
import { filtersToUrl, type JobFilters } from '@shared/job-filters.ts';
import { ACTIVE_STAGES } from '@shared/job-tracker.ts';
import { AlertsTab } from './jobs/AlertsTab';
import { FindTab } from './jobs/FindTab';
import { JobDrawer } from './jobs/JobDrawer';
import { ProfileTab } from './jobs/ProfileTab';
import { SavedTab } from './jobs/SavedTab';
import { TrackerTab } from './jobs/TrackerTab';

const TABS = [
  { id: 'find', label: 'Find', icon: Search },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'tracker', label: 'Tracker', icon: KanbanSquare },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'profile', label: 'Profile', icon: UserRound },
] as const;
type TabId = typeof TABS[number]['id'];

export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some(t => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'find';
  const jobSlug = params.get('job');

  const savedQ = useSavedListings();
  const appsQ = useApplications();
  const activeApps = (appsQ.data ?? []).filter(a => ACTIVE_STAGES.includes(a.status)).length;
  const counts: Partial<Record<TabId, number>> = { saved: savedQ.data?.length, tracker: activeApps };

  const patch = useCallback((fn: (p: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(params);
    fn(next);
    setParams(next, { replace });
  }, [params, setParams]);

  const goTab = (id: TabId) => patch(p => { p.set('tab', id); p.delete('job'); });
  const openJob = (slug: string) => patch(p => { p.set('job', slug); });
  const closeJob = () => patch(p => { p.delete('job'); }, true);
  const runSearch = (filters: JobFilters) => {
    const next = filtersToUrl({ ...filters, fresh_only: undefined });
    if (!filters.fresh_only) next.set('stale', '1');
    next.set('tab', 'find');
    setParams(next);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-sm text-muted-foreground">Find it, apply, track it, ask about it — in one place.</p>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Jobs sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id} role="tab" aria-selected={tab === id} onClick={() => goTab(id)}
            className={cn('inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            <Icon className="h-4 w-4" /> {label}
            {counts[id] ? <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{counts[id]}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'find' && <FindTab params={params} setParams={(p, o) => setParams(p, o)} openJob={openJob} activeSlug={jobSlug} />}
      {tab === 'saved' && <SavedTab openJob={openJob} />}
      {tab === 'tracker' && <TrackerTab openJob={openJob} />}
      {tab === 'alerts' && <AlertsTab runSearch={runSearch} />}
      {tab === 'profile' && <ProfileTab />}

      {jobSlug && (
        <JobDrawer
          key={jobSlug}
          slug={jobSlug}
          onClose={closeJob}
          onOpenJob={openJob}
          onGoProfile={() => goTab('profile')}
          onGoTracker={() => goTab('tracker')}
        />
      )}
    </div>
  );
}
