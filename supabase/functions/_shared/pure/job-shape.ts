// Normalised job shape used by the UI, the digests and the chat tools.

export interface JobRequirement { text: string; priority?: string }

export interface JobEnrichment {
  summary?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  experience_years_min?: number | null;
  category?: string | null;
  visa_sponsorship?: boolean | null;
  requirements?: JobRequirement[] | null;
  domains?: string[] | null;
  company_type?: string | null;
}

export interface JobReality {
  class?: 'fresh' | 'stale' | 'likely-evergreen' | string;
  age_days?: number;
  repost_count?: number;
  mass_posting_count?: number;
  fake_freshness?: boolean;
}

export interface Job {
  public_slug: string;
  title: string;
  company: string;
  company_slug: string | null;
  location: string | null;
  url: string;
  source: string;
  work_mode: string | null;
  countries: string[];
  skills: string[];
  posted_at: string | null;
  first_seen_at: string | null; // when the catalogue first recorded it (can't be rewritten by the source)
  closed_at: string | null;
  snippet: string;
  description?: string; // full HTML, only on the detail endpoint
  enrichment: JobEnrichment;
  reality: JobReality | null;
  view_count: number;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Maps an upstream posting to our shape. `full` keeps the HTML description (detail view only). */
export function slimJob(raw: Record<string, unknown>, full = false): Job {
  const description = typeof raw.description === 'string' ? raw.description : '';
  const e = (raw.enrichment && typeof raw.enrichment === 'object' ? raw.enrichment : {}) as JobEnrichment;
  const job: Job = {
    public_slug: String(raw.public_slug ?? ''),
    title: String(raw.title ?? ''),
    company: String(raw.company ?? ''),
    company_slug: str(raw.company_slug),
    location: str(raw.location),
    url: String(raw.url ?? ''),
    source: String(raw.source ?? ''),
    work_mode: str(raw.work_mode),
    countries: strArr(raw.countries),
    skills: strArr(raw.skills),
    posted_at: str(raw.posted_at),
    first_seen_at: str(raw.created_at),
    closed_at: str(raw.closed_at),
    snippet: stripHtml(description).slice(0, 280),
    enrichment: {
      summary: e.summary ?? null,
      salary_min: e.salary_min ?? null,
      salary_max: e.salary_max ?? null,
      salary_currency: e.salary_currency ?? null,
      salary_period: e.salary_period ?? null,
      experience_years_min: e.experience_years_min ?? null,
      category: e.category ?? null,
      visa_sponsorship: e.visa_sponsorship ?? null,
      requirements: full ? (e.requirements ?? null) : null,
      domains: e.domains ?? null,
      company_type: e.company_type ?? null,
    },
    reality: (raw.reality && typeof raw.reality === 'object' ? raw.reality : null) as JobReality | null,
    view_count: Number(raw.view_count ?? 0),
  };
  if (full) job.description = description;
  return job;
}

export function formatSalary(e: JobEnrichment | null | undefined): string | null {
  if (!e || (!e.salary_min && !e.salary_max)) return null;
  const cur = e.salary_currency ?? '';
  const fmt = (n: number) => {
    if (cur === 'INR') return n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n.toLocaleString('en-IN');
    return n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n);
  };
  const sym = cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : `${cur} `;
  const lo = e.salary_min, hi = e.salary_max;
  const range = lo && hi && lo !== hi ? `${sym}${fmt(lo)}–${fmt(hi)}` : `${sym}${fmt((hi ?? lo)!)}`;
  const per = e.salary_period && e.salary_period !== 'year' ? `/${e.salary_period}` : e.salary_period === 'year' ? '/yr' : '';
  return range + per;
}

export function ghostSignal(r: JobReality | null | undefined): { level: 'ok' | 'warn' | 'bad'; label: string; evidence: string[] } {
  if (!r?.class) return { level: 'ok', label: 'No signal', evidence: [] };
  const evidence: string[] = [];
  if (typeof r.age_days === 'number') evidence.push(`${r.age_days === 0 ? 'Posted today' : `${r.age_days} day${r.age_days === 1 ? '' : 's'} old`}`);
  if ((r.repost_count ?? 0) > 1) evidence.push(`Reposted ${r.repost_count}×`);
  if ((r.mass_posting_count ?? 0) > 1) evidence.push(`Same ad on ${r.mass_posting_count} listings`);
  if (r.fake_freshness) evidence.push('Date looks refreshed rather than new');
  if (r.class === 'fresh') return { level: r.fake_freshness ? 'warn' : 'ok', label: 'Fresh', evidence };
  if (r.class === 'likely-evergreen') return { level: 'bad', label: 'Likely evergreen', evidence };
  return { level: 'warn', label: 'Stale', evidence };
}
