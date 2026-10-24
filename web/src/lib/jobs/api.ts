import { supabase } from '@/lib/supabase';
import type { JobFilters } from '@shared/job-filters.ts';
import type { Job } from '@shared/job-shape.ts';
import type { MatchResult } from '@shared/job-match.ts';

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') detail = (await ctx.json())?.error ?? detail;
    } catch { /* keep generic message */ }
    throw new Error(detail);
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export interface SearchPage { jobs: Job[]; total: number; limit: number; offset: number }

export interface FacetData {
  total: number;
  facets: Record<string, Record<string, number>>;
  stats?: Record<string, { min: number; max: number }>;
}

export interface Suggestion {
  text: string;
  parts: { kind: string; slug: string; text: string }[];
  jobs?: number;
}

export interface CompanyData {
  company: { slug?: string; name?: string; collections?: string[] } & Record<string, unknown>;
  jobs: Job[];
}

export const jobsApi = {
  async search(filters: JobFilters, limit: number, offset: number): Promise<SearchPage> {
    const r = await invoke<{ data: Job[]; meta: { total: number; limit: number; offset: number } }>('jobs-api', { op: 'search', filters, limit, offset });
    return { jobs: r.data, ...r.meta };
  },
  async facets(filters: JobFilters): Promise<FacetData> {
    return (await invoke<{ data: FacetData }>('jobs-api', { op: 'facets', filters })).data;
  },
  async job(slug: string): Promise<Job> {
    return (await invoke<{ data: Job }>('jobs-api', { op: 'job', slug })).data;
  },
  async similar(slug: string): Promise<Job[]> {
    return (await invoke<{ data: Job[] }>('jobs-api', { op: 'similar', slug })).data;
  },
  async company(slug: string): Promise<CompanyData> {
    return (await invoke<{ data: CompanyData }>('jobs-api', { op: 'company', slug })).data;
  },
  async suggest(q: string): Promise<Suggestion[]> {
    return (await invoke<{ data: Suggestion[] }>('jobs-api', { op: 'suggest', q })).data;
  },
};

export interface FitAnalysis {
  verdict: 'strong' | 'good' | 'partial' | 'weak';
  summary: string;
  strengths: string[];
  gaps: { requirement: string; status: string; note: string }[];
  how_to_address: string[];
  interview_questions: string[];
}

export interface ResumeExtract {
  text: string;
  headline: string | null;
  skills: string[];
  experience_years: number | null;
  seniority: string | null;
}

export const jobAi = {
  async parseResume(filePath: string): Promise<ResumeExtract> {
    return (await invoke<{ data: ResumeExtract }>('job-ai', { mode: 'parse_resume', file_path: filePath })).data;
  },
  async fit(slug: string): Promise<{ match: MatchResult; analysis: FitAnalysis; cached: boolean }> {
    return (await invoke<{ data: { match: MatchResult; analysis: FitAnalysis; cached: boolean } }>('job-ai', { mode: 'fit', slug })).data;
  },
  async coverLetter(slug: string, tone: string): Promise<{ text: string; cached: boolean }> {
    return (await invoke<{ data: { text: string; cached: boolean } }>('job-ai', { mode: 'cover_letter', slug, tone })).data;
  },
  async ask(slug: string, question: string): Promise<{ answer: string; cached: boolean }> {
    return (await invoke<{ data: { answer: string; cached: boolean } }>('job-ai', { mode: 'ask', slug, question })).data;
  },
};
