// Scheduling + selection rules for saved-search digests.

import type { Job } from './job-shape.ts';

export const MAX_JOBS_IN_DIGEST = 10;
const HOUR = 3600000;
const DAY = 24 * HOUR;

export type Frequency = 'daily' | 'weekly';

export function isSearchDue(frequency: Frequency, lastRunAt: string | null | undefined, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  const needed = frequency === 'weekly' ? 6.9 * DAY : 23 * HOUR;
  return now.getTime() - last >= needed;
}

/** The watermark: jobs first seen after this moment count as "new". */
export function watermark(lastRunAt: string | null | undefined, now: Date, forced: boolean): Date {
  if (forced || !lastRunAt || Number.isNaN(Date.parse(lastRunAt))) return new Date(now.getTime() - (forced ? 7 : 1) * DAY);
  return new Date(lastRunAt);
}

/** Days to ask the catalogue for; one day of slack covers clock skew and crawl delay. */
export function openWindowDays(mark: Date, now: Date): number {
  return Math.min(30, Math.max(1, Math.ceil((now.getTime() - mark.getTime()) / DAY) + 1));
}

export function newSince(jobs: Job[], mark: Date): Job[] {
  return jobs.filter(j => {
    const t = Date.parse(j.first_seen_at ?? j.posted_at ?? '');
    return !Number.isNaN(t) && t > mark.getTime();
  });
}

export interface DigestLine { title: string; company: string; location: string | null; url: string; slug: string }

export function digestLines(jobs: Job[], limit = MAX_JOBS_IN_DIGEST): { shown: DigestLine[]; more: number } {
  const shown = jobs.slice(0, limit).map(j => ({ title: j.title, company: j.company, location: j.location, url: j.url, slug: j.public_slug }));
  return { shown, more: Math.max(0, jobs.length - shown.length) };
}

/** Telegram "Markdown" (legacy) treats these as formatting characters. */
export function escapeTelegram(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}
