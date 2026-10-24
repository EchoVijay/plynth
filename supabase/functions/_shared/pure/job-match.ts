// Deterministic CV↔vacancy score. No LLM: only facts present in the profile and the posting count.

export interface MatchJob {
  skills?: string[] | null;
  work_mode?: string | null;
  countries?: string[] | null;
  enrichment?: {
    salary_min?: number | null;
    salary_max?: number | null;
    salary_currency?: string | null;
    salary_period?: string | null;
    experience_years_min?: number | null;
  } | null;
}

export interface MatchProfile {
  skills?: string[] | null;
  resume_text?: string | null;
  experience_years?: number | null;
  work_modes?: string[] | null;
  countries?: string[] | null;
  salary_min?: number | null;
  salary_currency?: string | null;
}

export interface MatchPart {
  key: 'skills' | 'experience' | 'work_mode' | 'salary' | 'location';
  label: string;
  score: number; // 0..1
  weight: number;
  detail: string;
}

export interface MatchResult {
  score: number | null; // 0..100, null when there is nothing to compare
  label: 'strong' | 'good' | 'partial' | 'weak' | 'unknown';
  matched: string[];
  missing: string[];
  parts: MatchPart[];
}

const ALIASES: Record<string, string> = {
  js: 'javascript', ecmascript: 'javascript', ts: 'typescript', reactjs: 'react', reactnative: 'reactnative',
  nodejs: 'nodejs', node: 'nodejs', nextjs: 'nextjs', vuejs: 'vue', angularjs: 'angular',
  postgres: 'postgresql', psql: 'postgresql', mongo: 'mongodb', k8s: 'kubernetes', golang: 'go',
  py: 'python', 'c#': 'csharp', dotnet: 'net', amazonwebservices: 'aws', gcp: 'googlecloud',
  ml: 'machinelearning', ai: 'ai', tf: 'terraform', gha: 'githubactions',
};

export function normalizeSkill(s: string): string {
  const k = s.toLowerCase().trim().replace(/[^a-z0-9+#]/g, '');
  return ALIASES[k] ?? k;
}

function skillSet(list?: string[] | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of list ?? []) {
    const n = normalizeSkill(s);
    if (n && !m.has(n)) m.set(n, s);
  }
  return m;
}

let tokenCache: { text: string; tokens: Set<string> } | null = null;

/** Normalised 1–3 word phrases from free text, so "Node.js" or "cloud native" in a resume can match a skill slug. */
export function resumeTokens(text?: string | null): Set<string> {
  if (!text) return new Set();
  if (tokenCache?.text === text) return tokenCache.tokens;
  const out = new Set<string>();
  const words = text.toLowerCase().split(/[\s,;|/()•·\-–—:]+/)
    .map(w => w.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ''))
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let phrase = '';
    for (let n = 0; n < 3 && i + n < words.length; n++) {
      phrase += words[i + n];
      const k = normalizeSkill(phrase);
      if (k) out.add(k);
    }
  }
  tokenCache = { text, tokens: out };
  return out;
}

const PERIOD_TO_YEAR: Record<string, number> = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };

export function annualSalary(amount: number | null | undefined, period?: string | null): number | null {
  if (!amount || amount <= 0) return null;
  const f = PERIOD_TO_YEAR[(period ?? 'year').toLowerCase()];
  return f ? amount * f : null;
}

export function matchJob(job: MatchJob, profile: MatchProfile): MatchResult {
  const parts: MatchPart[] = [];
  const mine = skillSet(profile.skills);
  const inResume = resumeTokens(profile.resume_text);
  const theirs = skillSet(job.skills);
  const matched: string[] = [];
  const missing: string[] = [];

  if ((mine.size || inResume.size) && theirs.size) {
    for (const [n, label] of theirs) (mine.has(n) || inResume.has(n) ? matched : missing).push(label);
    parts.push({
      key: 'skills', label: 'Skills', weight: 0.55,
      score: matched.length / theirs.size,
      detail: `${matched.length} of ${theirs.size} listed skills`,
    });
  } else {
    for (const label of theirs.values()) missing.push(label);
  }

  const need = job.enrichment?.experience_years_min;
  const have = profile.experience_years;
  if (need != null && have != null) {
    const gap = Math.max(0, need - have);
    parts.push({
      key: 'experience', label: 'Experience', weight: 0.15,
      score: Math.max(0, 1 - gap / Math.max(need, 1)),
      detail: gap ? `asks ${need}y, you have ${have}y` : `asks ${need}y — you meet it`,
    });
  }

  if (job.work_mode && profile.work_modes?.length) {
    const ok = profile.work_modes.includes(job.work_mode);
    parts.push({ key: 'work_mode', label: 'Work mode', weight: 0.1, score: ok ? 1 : 0, detail: job.work_mode });
  }

  if (job.countries?.length && profile.countries?.length) {
    const ok = job.countries.some(c => profile.countries!.includes(c.toLowerCase()));
    // Remote roles are location-agnostic, so a country miss only counts for on-site/hybrid.
    const score = ok || job.work_mode === 'remote' ? 1 : 0;
    parts.push({ key: 'location', label: 'Location', weight: 0.05, score, detail: job.countries.join(', ').toUpperCase() });
  }

  const e = job.enrichment;
  const top = annualSalary(e?.salary_max ?? e?.salary_min, e?.salary_period);
  if (top && profile.salary_min && e?.salary_currency && e.salary_currency === (profile.salary_currency ?? 'INR')) {
    parts.push({
      key: 'salary', label: 'Salary', weight: 0.15,
      score: Math.min(1, top / profile.salary_min),
      detail: top >= profile.salary_min ? 'meets your target' : 'below your target',
    });
  }

  // One incidental signal (e.g. just "same country") must not read as a 100% match.
  const hasSkills = parts.some(p => p.key === 'skills');
  if (!parts.length || (!hasSkills && parts.length < 3)) return { score: null, label: 'unknown', matched, missing, parts };

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = Math.round((parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight) * 100);
  const label = score >= 75 ? 'strong' : score >= 55 ? 'good' : score >= 35 ? 'partial' : 'weak';
  return { score, label, matched, missing, parts };
}
