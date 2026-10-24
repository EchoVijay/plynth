// Pure, dependency-free helpers shared by the Deno edge functions and the web app.
// Keep this file free of Deno / DOM APIs.

export const MAX_LIMIT = 50;
export const MAX_DEPTH = 10000;

export type Sort = 'relevance' | 'newest' | 'popular' | 'salary';

export interface JobFilters {
  q?: string;
  countries?: string[];
  regions?: string[];
  work_mode?: string[];
  seniority?: string[];
  category?: string[];
  skills?: string[];
  skills_mode?: 'and' | 'or';
  employment_type?: string[];
  collections?: string[];
  company_slug?: string[];
  salary_min?: number;
  salary_currency?: string[];
  posted_within_days?: number;
  open_within_days?: number;
  visa_sponsorship?: boolean;
  experience_years_max?: number;
  experience_include_unspecified?: boolean;
  seniority_include_unspecified?: boolean;
  fresh_only?: boolean;
  sort?: Sort;
}

const STRING_ARRAYS = [
  'countries', 'regions', 'work_mode', 'seniority', 'category', 'skills',
  'employment_type', 'collections', 'company_slug', 'salary_currency',
] as const;

const ENUMS: Record<string, readonly string[]> = {
  work_mode: ['remote', 'hybrid', 'onsite'],
  seniority: ['intern', 'junior', 'middle', 'senior', 'lead', 'staff', 'principal', 'c_level'],
  employment_type: ['full_time', 'part_time', 'contract', 'internship', 'fellowship'],
};

const SLUG = /^[a-z0-9][a-z0-9_.+#-]{0,79}$/i;
const SORTS: Record<Exclude<Sort, 'relevance'>, [string, string]> = {
  newest: ['posted_at', 'desc'],
  popular: ['view_count', 'desc'],
  salary: ['salary_max', 'desc'],
};

function cleanList(key: string, v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const allowed = ENUMS[key];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const s = key === 'countries' || key === 'salary_currency' ? raw.trim() : raw.trim().toLowerCase();
    if (!s || out.includes(s)) continue;
    if (allowed ? !allowed.includes(s) : !SLUG.test(s)) continue;
    out.push(key === 'countries' ? s.toLowerCase() : key === 'salary_currency' ? s.toUpperCase() : s);
    if (out.length >= 25) break;
  }
  return out;
}

function posInt(v: unknown, max: number): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : undefined;
}

/** Strips unknown keys and invalid values; the result is safe to send upstream. */
export function sanitizeFilters(input: unknown): JobFilters {
  const f = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: JobFilters = {};
  if (typeof f.q === 'string' && f.q.trim()) out.q = f.q.trim().slice(0, 200);
  for (const key of STRING_ARRAYS) {
    const list = cleanList(key, f[key]);
    if (list.length) (out as Record<string, unknown>)[key] = list;
  }
  if (f.skills_mode === 'and') out.skills_mode = 'and';
  const salary = posInt(f.salary_min, 1e11);
  if (salary) out.salary_min = salary;
  const days = posInt(f.posted_within_days, 36500);
  if (days) out.posted_within_days = days;
  const opened = posInt(f.open_within_days, 36500);
  if (opened) out.open_within_days = opened;
  const exp = posInt(f.experience_years_max, 60);
  if (exp !== undefined && f.experience_years_max !== undefined && f.experience_years_max !== '') out.experience_years_max = exp;
  for (const k of ['visa_sponsorship', 'experience_include_unspecified', 'seniority_include_unspecified', 'fresh_only'] as const) {
    if (f[k] === true) out[k] = true;
  }
  if (f.sort === 'newest' || f.sort === 'popular' || f.sort === 'salary') out.sort = f.sort;
  return out;
}

export function clampPaging(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const l = Math.max(1, Math.min(MAX_LIMIT, posInt(limit, MAX_LIMIT) ?? 20));
  const maxOffset = Math.max(0, MAX_DEPTH - l);
  const o = Math.min(posInt(offset, MAX_DEPTH) ?? 0, maxOffset);
  return { limit: l, offset: o };
}

/** Builds the upstream query string for /jobs/search or /jobs/facets. */
export function buildSearchQuery(filters: JobFilters, paging?: { limit?: unknown; offset?: unknown }): string {
  const f = sanitizeFilters(filters);
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  for (const key of STRING_ARRAYS) {
    const v = f[key];
    if (v?.length) p.set(key, v.join(','));
  }
  if (f.skills_mode === 'and') p.set('skills_mode', 'and');
  if (f.salary_min) p.set('salary_min', String(f.salary_min));
  if (f.posted_within_days) p.set('posted_within_days', String(f.posted_within_days));
  if (f.open_within_days) p.set('open_within_days', String(f.open_within_days));
  if (f.visa_sponsorship) p.set('visa_sponsorship', 'true');
  if (f.experience_years_max !== undefined) {
    p.set('experience_years_max', String(f.experience_years_max));
    if (f.experience_include_unspecified) p.set('experience_include_unspecified', 'true');
  }
  if (f.seniority_include_unspecified && f.seniority?.length) p.set('seniority_include_unspecified', 'true');
  if (f.fresh_only) p.set('reality', 'fresh');
  if (f.sort && f.sort !== 'relevance') {
    const [field, order] = SORTS[f.sort];
    p.set('sort', field);
    p.set('order', order);
  }
  if (paging) {
    const { limit, offset } = clampPaging(paging.limit, paging.offset);
    p.set('limit', String(limit));
    if (offset) p.set('offset', String(offset));
  }
  return p.toString();
}

const SLUG_PATH = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
export function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_PATH.test(s);
}

// ---- URL (de)serialisation used by the Find tab so searches are shareable ----
export function filtersToUrl(filters: JobFilters): URLSearchParams {
  const f = sanitizeFilters(filters);
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v)) p.set(k, v.join(','));
    else if (v === true) p.set(k, '1');
    else if (v !== undefined && v !== false) p.set(k, String(v));
  }
  return p;
}

export function filtersFromUrl(p: URLSearchParams): JobFilters {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of p.entries()) {
    if ((STRING_ARRAYS as readonly string[]).includes(k)) raw[k] = v.split(',');
    else if (v === '1') raw[k] = true;
    else raw[k] = v;
  }
  return sanitizeFilters(raw);
}

/** Human-readable summary, e.g. for saved-search digests. */
export function describeFilters(filters: JobFilters): string {
  const f = sanitizeFilters(filters);
  const bits: string[] = [];
  if (f.q) bits.push(`“${f.q}”`);
  if (f.skills?.length) bits.push(f.skills.join(f.skills_mode === 'and' ? ' + ' : ' / '));
  if (f.seniority?.length) bits.push(f.seniority.join('/'));
  if (f.work_mode?.length) bits.push(f.work_mode.join('/'));
  if (f.countries?.length) bits.push(f.countries.map(c => c.toUpperCase()).join('/'));
  if (f.salary_min) bits.push(`≥ ${f.salary_min.toLocaleString('en-IN')}`);
  if (f.posted_within_days) bits.push(`last ${f.posted_within_days}d`);
  if (f.fresh_only) bits.push('fresh only');
  return bits.join(' · ') || 'All jobs';
}
