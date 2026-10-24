import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { jobAi } from '@/lib/jobs/api';
import { defaultProfile, useJobProfile, useUserId, type JobProfile } from '@/lib/jobs/data';
import { normalizeSkill } from '@shared/job-match.ts';
import { skillLabel, timeAgo } from './parts';

const SENIORITY = ['', 'intern', 'junior', 'middle', 'senior', 'lead', 'staff', 'principal'];
const WORK_MODES = ['remote', 'hybrid', 'onsite'];
const COUNTRIES: Record<string, string> = { in: 'India', us: 'United States', gb: 'United Kingdom', de: 'Germany', ae: 'UAE', sg: 'Singapore', ca: 'Canada', au: 'Australia', nl: 'Netherlands', ie: 'Ireland' };
const MAX_UPLOAD = 8 * 1024 * 1024;

interface Form {
  headline: string;
  skills: string[];
  experience_years: string;
  seniority: string;
  countries: string[];
  work_modes: string[];
  salary_lpa: string;
  resume_text: string;
}

function toForm(p: JobProfile): Form {
  return {
    headline: p.headline ?? '', skills: p.skills, experience_years: p.experience_years?.toString() ?? '', seniority: p.seniority ?? '',
    countries: p.countries, work_modes: p.work_modes, salary_lpa: p.salary_min ? String(p.salary_min / 100000) : '', resume_text: p.resume_text ?? '',
  };
}

export function ProfileTab() {
  const userId = useUserId();
  const qc = useQueryClient();
  const profileQ = useJobProfile();
  const profile = profileQ.data;
  const [form, setForm] = useState<Form | null>(null);
  const [skillInput, setSkillInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (profile && !form) setForm(toForm(profile)); }, [profile, form]);

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const years = f.experience_years.trim() === '' ? null : Number(f.experience_years);
      const lpa = f.salary_lpa.trim() === '' ? null : Number(f.salary_lpa);
      if ((years !== null && !Number.isFinite(years)) || (lpa !== null && !Number.isFinite(lpa))) throw new Error('Experience and salary must be numbers');
      const { error } = await supabase.from('job_profile').upsert({
        user_id: userId!, headline: f.headline.trim() || null, skills: f.skills, experience_years: years,
        seniority: f.seniority || null, countries: f.countries.length ? f.countries : ['in'], work_modes: f.work_modes,
        salary_min: lpa !== null ? Math.round(lpa * 100000) : null, salary_currency: 'INR',
        resume_text: f.resume_text.trim() || null, updated_at: new Date().toISOString(),
        ...(f.resume_text.trim() !== (profile?.resume_text ?? '') ? { resume_updated_at: new Date().toISOString() } : {}),
      }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Profile saved'); qc.invalidateQueries({ queryKey: ['job-profile', userId] }); qc.invalidateQueries({ queryKey: ['jobs-search'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD) throw new Error('File is too large (max 8 MB)');
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf && !file.type.startsWith('image/')) throw new Error('Upload a PDF or an image of your resume');
      const path = `${userId}/resume-${Date.now()}.${isPdf ? 'pdf' : file.name.split('.').pop() ?? 'png'}`;
      const up = await supabase.storage.from('documents').upload(path, file, { contentType: isPdf ? 'application/pdf' : file.type });
      if (up.error) throw up.error;
      try {
        const out = await jobAi.parseResume(path);
        if (profile?.resume_file_path && profile.resume_file_path !== path) {
          await supabase.storage.from('documents').remove([profile.resume_file_path]);
        }
        return out;
      } catch (e) {
        await supabase.storage.from('documents').remove([path]);
        throw e;
      }
    },
    onSuccess: out => {
      setForm(f => {
        const base = f ?? toForm(defaultProfile(userId!));
        return {
          ...base,
          resume_text: out.text,
          headline: base.headline || out.headline || '',
          skills: [...new Set([...base.skills, ...out.skills.map(s => s.trim()).filter(Boolean)])].slice(0, 60),
          experience_years: base.experience_years || (out.experience_years != null ? String(out.experience_years) : ''),
          seniority: base.seniority || (SENIORITY.includes(out.seniority ?? '') ? out.seniority ?? '' : ''),
        };
      });
      toast.success('Resume read. Review the details below and save.');
      qc.invalidateQueries({ queryKey: ['job-profile', userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return <Skeleton className="h-60" />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const toggle = (k: 'countries' | 'work_modes', v: string) => set(k, form[k].includes(v) ? form[k].filter(x => x !== v) : [...form[k], v]);
  const addSkill = () => {
    const parts = skillInput.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const have = new Set(form.skills.map(normalizeSkill));
    const fresh = parts.filter(p => !have.has(normalizeSkill(p)));
    set('skills', [...form.skills, ...fresh]);
    setSkillInput('');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <p className="text-sm text-muted-foreground">
        Your profile powers match scores, the “For you” search and the AI fit analysis and cover letters. Nothing here is shared with employers.
      </p>

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> Resume</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload.mutate(file); }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading your resume…</> : <><Upload className="h-4 w-4" /> Upload PDF</>}
          </Button>
          <span className="text-xs text-muted-foreground">
            {profile?.resume_updated_at ? `Updated ${timeAgo(profile.resume_updated_at)}` : 'Or paste the text below'} · read with AI, may take ~20 s
          </span>
        </div>
        <Textarea
          value={form.resume_text} onChange={e => set('resume_text', e.target.value)} rows={12} maxLength={20000}
          placeholder="Resume text. Used by AI features; nothing outside your account sees it."
          aria-label="Resume text"
        />
        <p className="text-xs text-muted-foreground">{form.resume_text.length.toLocaleString()} / 20,000 characters</p>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">About you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="headline">Headline</Label><Input id="headline" value={form.headline} onChange={e => set('headline', e.target.value)} placeholder="e.g. Senior Frontend Engineer" maxLength={120} /></div>
          <div className="space-y-1.5"><Label htmlFor="exp">Years of experience</Label><Input id="exp" type="number" min={0} step="0.5" value={form.experience_years} onChange={e => set('experience_years', e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="sen">Seniority</Label>
            <select id="sen" value={form.seniority} onChange={e => set('seniority', e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
              {SENIORITY.map(s => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Not set'}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="sal">Target salary (₹ lakh / year)</Label><Input id="sal" type="number" min={0} step="0.5" value={form.salary_lpa} onChange={e => set('salary_lpa', e.target.value)} placeholder="e.g. 25" /></div>
        </div>

        <div className="space-y-2">
          <Label>Skills</Label>
          <div className="flex flex-wrap gap-1.5">
            {form.skills.map(s => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {skillLabel(s)}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => set('skills', form.skills.filter(x => x !== s))}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); addSkill(); }}>
            <Input value={skillInput} onChange={e => setSkillInput(e.target.value)} placeholder="Add skills, comma separated" aria-label="Add skills" />
            <Button type="submit" variant="outline"><Plus className="h-4 w-4" /> Add</Button>
          </form>
        </div>

        <div className="space-y-2">
          <Label>Work mode you'd accept</Label>
          <div className="flex flex-wrap gap-2">
            {WORK_MODES.map(m => <button key={m} type="button" aria-pressed={form.work_modes.includes(m)} onClick={() => toggle('work_modes', m)} className={cn('rounded-full border px-3 py-1 text-xs font-medium capitalize', form.work_modes.includes(m) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>{m}</button>)}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Countries to search</Label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(COUNTRIES).map(([c, name]) => <button key={c} type="button" aria-pressed={form.countries.includes(c)} onClick={() => toggle('countries', c)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', form.countries.includes(c) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>{name}</button>)}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save profile'}</Button>
      </div>
    </div>
  );
}
