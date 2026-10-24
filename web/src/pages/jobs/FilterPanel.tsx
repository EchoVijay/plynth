import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import { jobsApi } from '@/lib/jobs/api';
import { normalizeSkill } from '@shared/job-match.ts';
import type { JobFilters } from '@shared/job-filters.ts';
import { skillLabel } from './parts';

const WORK_MODES = ['remote', 'hybrid', 'onsite'];
const SENIORITY = ['intern', 'junior', 'middle', 'senior', 'lead', 'staff', 'principal'];
const EMPLOYMENT = [['full_time', 'Full-time'], ['contract', 'Contract'], ['part_time', 'Part-time'], ['internship', 'Internship']] as const;
const POSTED = [[0, 'Any time'], [1, 'Last 24 hours'], [3, 'Last 3 days'], [7, 'Last week'], [14, 'Last 2 weeks'], [30, 'Last month']] as const;
const COUNTRIES: Record<string, string> = { in: 'India', us: 'United States', gb: 'United Kingdom', de: 'Germany', ae: 'UAE', sg: 'Singapore', ca: 'Canada', au: 'Australia', nl: 'Netherlands', ie: 'Ireland' };
const SORTS = [['relevance', 'Best match'], ['newest', 'Newest'], ['popular', 'Most viewed'], ['salary', 'Highest salary']] as const;

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{title}</Label>
      {children}
    </div>
  );
}

interface Props {
  filters: JobFilters;
  anywhere: boolean;
  onChange: (next: JobFilters, opts?: { anywhere?: boolean }) => void;
  onReset: () => void;
}

export function FilterPanel({ filters, anywhere, onChange, onReset }: Props) {
  const f = filters;
  const set = (patch: Partial<JobFilters>) => onChange({ ...f, ...patch });
  const toggle = (key: 'work_mode' | 'seniority' | 'employment_type' | 'countries', value: string) => {
    const cur = f[key] ?? [];
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    onChange({ ...f, [key]: next.length ? next : undefined }, key === 'countries' ? { anywhere: next.length === 0 } : undefined);
  };

  // Counts reflect the other active filters; skip `q` so typing doesn't refetch them.
  const facetsQ = useQuery({
    queryKey: ['jobs-facets', { ...f, q: undefined }],
    queryFn: () => jobsApi.facets({ ...f, q: undefined }),
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
  });
  const counts = facetsQ.data?.facets ?? {};

  const [skillInput, setSkillInput] = useState('');
  const addSkill = (raw: string) => {
    const slug = normalizeSkill(raw);
    if (!slug) return;
    if (!(f.skills ?? []).includes(slug)) set({ skills: [...(f.skills ?? []), slug] });
    setSkillInput('');
  };

  const [salaryInput, setSalaryInput] = useState(f.salary_min ? String(f.salary_min / 100000) : '');
  const [expInput, setExpInput] = useState(f.experience_years_max !== undefined ? String(f.experience_years_max) : '');
  const lastSalary = useRef(f.salary_min);
  useEffect(() => {
    if (f.salary_min !== lastSalary.current) { lastSalary.current = f.salary_min; setSalaryInput(f.salary_min ? String(f.salary_min / 100000) : ''); }
  }, [f.salary_min]);
  useEffect(() => { setExpInput(f.experience_years_max !== undefined ? String(f.experience_years_max) : ''); }, [f.experience_years_max]);

  const commitSalary = () => {
    const lpa = parseFloat(salaryInput);
    if (Number.isFinite(lpa) && lpa > 0) set({ salary_min: Math.round(lpa * 100000), salary_currency: ['INR'] });
    else set({ salary_min: undefined, salary_currency: undefined });
  };
  const commitExp = () => {
    const n = parseInt(expInput, 10);
    if (Number.isFinite(n) && n >= 0) set({ experience_years_max: n, experience_include_unspecified: true });
    else set({ experience_years_max: undefined, experience_include_unspecified: undefined });
  };

  const countryList = anywhere ? [] : (f.countries ?? []);
  const addable = Object.keys(COUNTRIES).filter(c => !countryList.includes(c));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Filters</h2>
        <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <Section title="Sort by">
        <select
          value={f.sort ?? 'relevance'}
          onChange={e => set({ sort: e.target.value === 'relevance' ? undefined : (e.target.value as JobFilters['sort']) })}
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          aria-label="Sort by"
        >
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Section>

      <Section title="Work mode">
        <div className="flex flex-wrap gap-1.5">
          {WORK_MODES.map(m => (
            <Chip key={m} active={!!f.work_mode?.includes(m)} onClick={() => toggle('work_mode', m)}>
              {label(m)}{counts.work_mode?.[m] != null && <span className="ml-1 opacity-60">{counts.work_mode[m].toLocaleString()}</span>}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Seniority">
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY.map(s => (
            <Chip key={s} active={!!f.seniority?.includes(s)} onClick={() => toggle('seniority', s)}>
              {label(s)}{counts.seniority?.[s] != null && <span className="ml-1 opacity-60">{counts.seniority[s].toLocaleString()}</span>}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Skills">
        <div className="flex flex-wrap gap-1.5">
          {(f.skills ?? []).map(s => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {skillLabel(s)}
              <button type="button" aria-label={`Remove ${s}`} onClick={() => { const next = (f.skills ?? []).filter(x => x !== s); set({ skills: next.length ? next : undefined }); }}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); addSkill(skillInput); }}>
          <Input value={skillInput} onChange={e => setSkillInput(e.target.value)} placeholder="Add skill, e.g. react" className="h-9" aria-label="Add skill" />
          <Button type="submit" size="sm" variant="outline" aria-label="Add skill"><Plus className="h-4 w-4" /></Button>
        </form>
        {(f.skills?.length ?? 0) > 1 && (
          <div className="flex gap-1.5">
            <Chip active={f.skills_mode !== 'and'} onClick={() => set({ skills_mode: undefined })}>Any of</Chip>
            <Chip active={f.skills_mode === 'and'} onClick={() => set({ skills_mode: 'and' })}>All of</Chip>
          </div>
        )}
      </Section>

      <Section title="Country">
        <div className="flex flex-wrap gap-1.5">
          {countryList.map(c => (
            <Chip key={c} active onClick={() => toggle('countries', c)}>{COUNTRIES[c] ?? c.toUpperCase()} ×</Chip>
          ))}
          {anywhere && <Chip active onClick={() => onChange({ ...f, countries: undefined }, { anywhere: false })}>Anywhere ×</Chip>}
        </div>
        {addable.length > 0 && (
          <select
            value=""
            onChange={e => e.target.value && toggle('countries', e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
            aria-label="Add country"
          >
            <option value="">Add country…</option>
            {addable.map(c => <option key={c} value={c}>{COUNTRIES[c]}</option>)}
          </select>
        )}
        {!anywhere && countryList.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...f, countries: undefined }, { anywhere: true })}>
            Search anywhere
          </button>
        )}
      </Section>

      <Section title="Posted">
        <select
          value={f.posted_within_days ?? 0}
          onChange={e => set({ posted_within_days: Number(e.target.value) || undefined })}
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          aria-label="Posted within"
        >
          {POSTED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Section>

      <Section title="Min salary (₹ lakh / year)">
        <Input
          type="number" min={0} step="0.5" value={salaryInput} placeholder="e.g. 20"
          onChange={e => setSalaryInput(e.target.value)} onBlur={commitSalary}
          onKeyDown={e => { if (e.key === 'Enter') commitSalary(); }}
          className="h-9" aria-label="Minimum salary in lakh per year"
        />
      </Section>

      <Section title="Max experience asked (years)">
        <Input
          type="number" min={0} value={expInput} placeholder="e.g. 5"
          onChange={e => setExpInput(e.target.value)} onBlur={commitExp}
          onKeyDown={e => { if (e.key === 'Enter') commitExp(); }}
          className="h-9" aria-label="Maximum experience in years"
        />
      </Section>

      <Section title="Employment">
        <div className="flex flex-wrap gap-1.5">
          {EMPLOYMENT.map(([v, l]) => <Chip key={v} active={!!f.employment_type?.includes(v)} onClick={() => toggle('employment_type', v)}>{l}</Chip>)}
        </div>
      </Section>

      <div className="space-y-3 border-t pt-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Hide stale &amp; evergreen ads
            <span className="block text-xs text-muted-foreground">Only recently posted, non-recycled roles</span>
          </span>
          <Switch checked={!!f.fresh_only} onCheckedChange={v => set({ fresh_only: v || undefined })} aria-label="Hide stale and evergreen ads" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Visa sponsorship</span>
          <Switch checked={!!f.visa_sponsorship} onCheckedChange={v => set({ visa_sponsorship: v || undefined })} aria-label="Visa sponsorship" />
        </label>
      </div>
    </div>
  );
}
