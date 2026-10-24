// Thin client for freehire's public API (https://freehire.me/api/v1, MIT, keyless).
// Adds timeouts, a small in-memory TTL cache and stale-on-error so a flaky upstream doesn't break the UI.

import { buildSearchQuery, clampPaging, isValidSlug, type JobFilters } from './pure/job-filters.ts';
import { slimJob, type Job } from './pure/job-shape.ts';

const BASE = 'https://freehire.me/api/v1';
const TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 300;
const UA = 'Plynth/1.4 (personal dashboard; +https://plynth-finance.netlify.app)';

interface Entry { exp: number; data: unknown }
const cache = new Map<string, Entry>();

export class UpstreamError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function get(path: string, ttlMs: number): Promise<any> {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.data;
  try {
    const r = await fetch(BASE + path, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new UpstreamError(body?.error ?? `freehire ${r.status}`, r.status);
    }
    const data = await r.json();
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(path, { exp: Date.now() + ttlMs, data });
    return data;
  } catch (e) {
    // Serve the last good answer for transient failures, but never for a 4xx (bad request / not found).
    if (hit && !(e instanceof UpstreamError && e.status < 500 && e.status !== 429)) return hit.data;
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(`freehire unreachable: ${(e as Error).message}`, 502);
  }
}

export interface SearchResult { jobs: Job[]; total: number; limit: number; offset: number }

export async function searchJobs(filters: JobFilters, paging: { limit?: unknown; offset?: unknown } = {}): Promise<SearchResult> {
  const qs = buildSearchQuery(filters, paging);
  const res = await get(`/jobs/search?${qs}`, 60_000);
  const { limit, offset } = clampPaging(paging.limit, paging.offset);
  return {
    jobs: (res.data ?? []).map((j: Record<string, unknown>) => slimJob(j)),
    total: Number(res.meta?.total ?? 0),
    limit, offset,
  };
}

export async function getJob(slug: string): Promise<Job> {
  if (!isValidSlug(slug)) throw new UpstreamError('invalid slug', 400);
  const res = await get(`/jobs/${encodeURIComponent(slug)}`, 10 * 60_000);
  return slimJob(res.data, true);
}

export async function similarJobs(slug: string, limit = 6): Promise<Job[]> {
  if (!isValidSlug(slug)) throw new UpstreamError('invalid slug', 400);
  const res = await get(`/jobs/${encodeURIComponent(slug)}/similar?limit=${clampPaging(limit, 0).limit}`, 10 * 60_000);
  return (res.data ?? []).map((j: Record<string, unknown>) => slimJob(j));
}

export async function getCompany(slug: string): Promise<{ company: Record<string, unknown>; jobs: Job[] }> {
  if (!isValidSlug(slug)) throw new UpstreamError('invalid slug', 400);
  const res = await get(`/companies/${encodeURIComponent(slug)}`, 10 * 60_000);
  return {
    company: res.data?.company ?? {},
    jobs: (res.data?.jobs ?? []).slice(0, 12).map((j: Record<string, unknown>) => slimJob(j)),
  };
}

export async function getFacets(filters: JobFilters): Promise<unknown> {
  const qs = buildSearchQuery(filters);
  const res = await get(`/jobs/facets${qs ? `?${qs}` : ''}`, 60 * 60_000);
  return res.data;
}

export async function suggest(q: string): Promise<unknown[]> {
  const text = q.trim().slice(0, 80);
  if (text.length < 2) return [];
  const res = await get(`/suggest?q=${encodeURIComponent(text)}`, 5 * 60_000);
  return res.data ?? [];
}
