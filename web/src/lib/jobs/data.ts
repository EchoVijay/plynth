import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import type { Job } from '@shared/job-shape.ts';
import type { MatchProfile } from '@shared/job-match.ts';
import type { Stage } from '@shared/job-tracker.ts';

export interface JobProfile {
  user_id: string;
  headline: string | null;
  skills: string[];
  experience_years: number | null;
  seniority: string | null;
  countries: string[];
  work_modes: string[];
  salary_min: number | null;
  salary_currency: string;
  resume_text: string | null;
  resume_file_path: string | null;
  resume_updated_at: string | null;
}

export interface ListingRow {
  id: string;
  external_id: string;
  public_slug: string | null;
  company_slug: string | null;
  title: string;
  company: string;
  location: string | null;
  job_url: string;
  source: string;
  description_snippet: string | null;
  work_mode: string | null;
  skills: string[] | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_range: string | null;
  posted_at: string | null;
  fetched_at: string;
  is_saved: boolean;
  snapshot: Job | null;
}

export interface AppRow {
  id: string;
  company: string;
  role: string;
  job_url: string | null;
  listing_id: string | null;
  public_slug: string | null;
  applied_date: string;
  status: Stage;
  notes: string | null;
  follow_up_date: string | null;
  salary_offered: number | null;
  last_activity_at: string | null;
  interview_at: string | null;
  calendar_event_id: string | null;
  resume_used: string | null;
}

export interface SavedSearchRow {
  id: string;
  name: string;
  query: Record<string, unknown>;
  notify: boolean;
  frequency: 'daily' | 'weekly';
  channels: string[];
  last_run_at: string | null;
  last_match_count: number;
  created_at: string;
}

export const todayLocal = () => format(new Date(), 'yyyy-MM-dd');

export function defaultProfile(userId: string): JobProfile {
  return {
    user_id: userId, headline: null, skills: [], experience_years: null, seniority: null,
    countries: ['in'], work_modes: [], salary_min: null, salary_currency: 'INR',
    resume_text: null, resume_file_path: null, resume_updated_at: null,
  };
}

export function toMatchProfile(p: JobProfile | undefined | null): MatchProfile {
  return p
    ? { skills: p.skills, resume_text: p.resume_text, experience_years: p.experience_years, work_modes: p.work_modes, countries: p.countries, salary_min: p.salary_min, salary_currency: p.salary_currency }
    : {};
}

export function useUserId(): string | undefined {
  return useSession().session?.user.id;
}

export function useJobProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['job-profile', userId],
    enabled: !!userId,
    queryFn: async (): Promise<JobProfile> => {
      const { data, error } = await supabase.from('job_profile').select('*').eq('user_id', userId!).maybeSingle();
      if (error) throw error;
      return { ...defaultProfile(userId!), ...(data ?? {}) } as JobProfile;
    },
  });
}

export function useSavedListings() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['listings-saved', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ListingRow[]> => {
      const { data, error } = await supabase.from('job_listings').select('*')
        .eq('user_id', userId!).eq('is_saved', true).order('fetched_at', { ascending: false }).limit(300);
      if (error) throw error;
      return (data ?? []) as ListingRow[];
    },
  });
}

export function useApplications() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['applications', userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppRow[]> => {
      const { data, error } = await supabase.from('job_applications').select('*')
        .eq('user_id', userId!).order('applied_date', { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as AppRow[];
    },
  });
}

function listingRow(userId: string, job: Job) {
  return {
    user_id: userId,
    external_id: job.public_slug,
    public_slug: job.public_slug,
    company_slug: job.company_slug,
    title: job.title,
    company: job.company,
    location: job.location,
    job_url: job.url,
    source: job.source,
    description_snippet: job.snippet,
    posted_date: job.posted_at ? job.posted_at.slice(0, 10) : null,
    posted_at: job.posted_at,
    work_mode: job.work_mode,
    skills: job.skills,
    salary_min: job.enrichment.salary_min ?? null,
    salary_max: job.enrichment.salary_max ?? null,
    salary_currency: job.enrichment.salary_currency ?? null,
    salary_period: job.enrichment.salary_period ?? null,
    snapshot: job,
    is_new: false,
  };
}

/** Save / unsave / track actions shared by the Find drawer, Saved tab and Tracker. */
export function useJobActions() {
  const userId = useUserId();
  const qc = useQueryClient();
  const saved = useSavedListings();
  const apps = useApplications();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['listings-saved', userId] });
    qc.invalidateQueries({ queryKey: ['applications', userId] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }, [qc, userId]);

  const upsertListing = async (job: Job, extra: Record<string, unknown> = {}): Promise<string> => {
    const { data, error } = await supabase.from('job_listings')
      .upsert({ ...listingRow(userId!, job), ...extra }, { onConflict: 'user_id,external_id' })
      .select('id').single();
    if (error) throw error;
    return data.id as string;
  };

  const toggleSave = useMutation({
    mutationFn: async ({ job, save }: { job: Job; save: boolean }) => {
      await upsertListing(job, { is_saved: save });
      return save;
    },
    onSuccess: save => { toast.success(save ? 'Saved' : 'Removed from saved'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const track = useMutation({
    mutationFn: async ({ job, status = 'applied' }: { job: Job; status?: Stage }) => {
      const existing = (apps.data ?? []).find(a => a.public_slug === job.public_slug);
      if (existing) return { duplicate: true as const };
      const listingId = await upsertListing(job);
      const { error } = await supabase.from('job_applications').insert({
        user_id: userId!, company: job.company, role: job.title, job_url: job.url,
        listing_id: listingId, public_slug: job.public_slug, applied_date: todayLocal(), status,
      });
      if (error) throw error;
      return { duplicate: false as const };
    },
    onSuccess: r => { toast.success(r.duplicate ? 'Already in your tracker' : 'Added to tracker'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const savedSlugs = new Set((saved.data ?? []).map(l => l.public_slug).filter(Boolean) as string[]);
  const appBySlug = new Map((apps.data ?? []).filter(a => a.public_slug).map(a => [a.public_slug!, a]));

  return {
    savedSlugs,
    appBySlug,
    isSaved: (slug: string) => savedSlugs.has(slug),
    appFor: (slug: string) => appBySlug.get(slug),
    toggleSave,
    track,
    refresh,
    ready: !!userId,
  };
}
