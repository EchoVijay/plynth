// Rules for the application tracker: stages, quiet-application detection, ledger helpers.

export const STAGES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted'] as const;
export type Stage = typeof STAGES[number];

export const ACTIVE_STAGES: readonly Stage[] = ['applied', 'screening', 'interview', 'offer'];
export const QUIET_AFTER_DAYS = 14;

export interface TrackedApp {
  status: string;
  applied_date: string;
  last_activity_at?: string | null;
  follow_up_date?: string | null;
}

const DAY = 86400000;

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}

/** Days since anything happened to the application, or null if it is not waiting on a reply. */
export function quietDays(app: TrackedApp, now: Date): number | null {
  if (app.status !== 'applied' && app.status !== 'screening') return null;
  return daysSince(app.last_activity_at ?? app.applied_date, now);
}

export function isQuiet(app: TrackedApp, now: Date, threshold = QUIET_AFTER_DAYS): boolean {
  const d = quietDays(app, now);
  return d !== null && d >= threshold;
}

export function isFollowUpDue(app: TrackedApp, now: Date): boolean {
  if (!app.follow_up_date || !ACTIVE_STAGES.includes(app.status as Stage)) return false;
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return app.follow_up_date <= today;
}

export interface TrackerStats {
  total: number;
  active: number;
  interviews: number;
  offers: number;
  responseRate: number | null; // share of applications that moved past "applied"
}

export function trackerStats(apps: { status: string }[]): TrackerStats {
  const total = apps.length;
  const count = (...s: string[]) => apps.filter(a => s.includes(a.status)).length;
  const responded = count('screening', 'interview', 'offer', 'rejected');
  return {
    total,
    active: count(...ACTIVE_STAGES),
    interviews: count('interview'),
    offers: count('offer'),
    responseRate: total ? Math.round((responded / total) * 100) : null,
  };
}

export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview',
  offer: 'Offer', rejected: 'Rejected', ghosted: 'Ghosted',
};
