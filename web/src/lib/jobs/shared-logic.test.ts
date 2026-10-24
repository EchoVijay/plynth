import { describe, expect, it } from 'vitest';
import {
  buildSearchQuery, clampPaging, describeFilters, filtersFromUrl, filtersToUrl, isValidSlug, sanitizeFilters,
} from '@shared/job-filters.ts';
import { matchJob, normalizeSkill, annualSalary } from '@shared/job-match.ts';
import { formatSalary, ghostSignal, slimJob, stripHtml } from '@shared/job-shape.ts';
import { digestLines, escapeTelegram, isSearchDue, newSince, openWindowDays, watermark } from '@shared/job-digest.ts';
import { isFollowUpDue, isQuiet, quietDays, trackerStats } from '@shared/job-tracker.ts';

describe('sanitizeFilters', () => {
  it('drops unknown keys, bad enums and junk', () => {
    const f = sanitizeFilters({
      q: '  react  ', work_mode: ['Remote', 'moon'], seniority: ['senior', 'god'],
      skills: ['react', 'bad skill!', 'react'], evil: 'x', salary_min: -5, posted_within_days: 'abc',
    });
    expect(f).toEqual({ q: 'react', work_mode: ['remote'], seniority: ['senior'], skills: ['react'] });
  });

  it('normalises countries and currencies', () => {
    expect(sanitizeFilters({ countries: ['IN', 'in', 'gb'], salary_currency: ['inr'] }))
      .toEqual({ countries: ['in', 'gb'], salary_currency: ['INR'] });
  });

  it('survives non-object input', () => {
    expect(sanitizeFilters(null)).toEqual({});
    expect(sanitizeFilters('x')).toEqual({});
  });

  it('keeps experience_years_max of zero', () => {
    expect(sanitizeFilters({ experience_years_max: 0 })).toEqual({ experience_years_max: 0 });
    expect(sanitizeFilters({ experience_years_max: '' })).toEqual({});
  });
});

describe('buildSearchQuery', () => {
  it('builds a comma-joined upstream query', () => {
    const qs = buildSearchQuery(
      { q: 'react', countries: ['in'], work_mode: ['remote', 'hybrid'], skills: ['react', 'typescript'], skills_mode: 'and', fresh_only: true, sort: 'newest' },
      { limit: 20, offset: 40 },
    );
    const p = new URLSearchParams(qs);
    expect(p.get('countries')).toBe('in');
    expect(p.get('work_mode')).toBe('remote,hybrid');
    expect(p.get('skills_mode')).toBe('and');
    expect(p.get('reality')).toBe('fresh');
    expect(p.get('sort')).toBe('posted_at');
    expect(p.get('order')).toBe('desc');
    expect(p.get('limit')).toBe('20');
    expect(p.get('offset')).toBe('40');
  });

  it('only sends experience_include_unspecified alongside a bound', () => {
    expect(buildSearchQuery({ experience_include_unspecified: true })).toBe('');
    expect(buildSearchQuery({ experience_years_max: 3, experience_include_unspecified: true }))
      .toContain('experience_include_unspecified=true');
  });

  it('supports open_within_days for digests', () => {
    expect(new URLSearchParams(buildSearchQuery({ open_within_days: 3, sort: 'newest' })).get('open_within_days')).toBe('3');
  });

  it('clamps paging to the upstream limits', () => {
    expect(clampPaging(1000, 0)).toEqual({ limit: 50, offset: 0 });
    expect(clampPaging(50, 99999)).toEqual({ limit: 50, offset: 9950 });
    expect(clampPaging('x', 'y')).toEqual({ limit: 20, offset: 0 });
  });
});

describe('url round trip', () => {
  it('serialises and restores filters', () => {
    const f = { q: 'go', countries: ['in'], work_mode: ['remote'], fresh_only: true, salary_min: 1000000 };
    expect(filtersFromUrl(filtersToUrl(f))).toEqual(f);
  });
  it('describes filters', () => {
    expect(describeFilters({ q: 'react', work_mode: ['remote'], countries: ['in'] })).toBe('“react” · remote · IN');
    expect(describeFilters({})).toBe('All jobs');
  });
  it('validates slugs', () => {
    expect(isValidSlug('react-developer-acme-ab12cd')).toBe(true);
    expect(isValidSlug('../etc/passwd')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
  });
});

describe('matchJob', () => {
  const profile = { skills: ['React', 'TypeScript', 'Node.js'], experience_years: 4, work_modes: ['remote', 'hybrid'], countries: ['in'], salary_min: 1500000, salary_currency: 'INR' };

  it('normalises skill aliases', () => {
    expect(normalizeSkill('Node.js')).toBe('nodejs');
    expect(normalizeSkill('Postgres')).toBe('postgresql');
    expect(normalizeSkill('C#')).toBe('csharp');
  });

  it('scores a strong match and lists gaps', () => {
    const r = matchJob({
      skills: ['react', 'typescript', 'nodejs', 'graphql'], work_mode: 'remote', countries: ['in'],
      enrichment: { experience_years_min: 3, salary_max: 2400000, salary_currency: 'INR', salary_period: 'year' },
    }, profile);
    expect(r.matched).toEqual(['react', 'typescript', 'nodejs']);
    expect(r.missing).toEqual(['graphql']);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.label).toBe('strong');
  });

  it('penalises experience and skill gaps', () => {
    const r = matchJob({ skills: ['rust', 'cpp'], work_mode: 'onsite', countries: ['us'], enrichment: { experience_years_min: 10 } }, profile);
    expect(r.score).toBeLessThan(35);
    expect(r.label).toBe('weak');
  });

  it('ignores location for remote roles', () => {
    const r = matchJob({ work_mode: 'remote', countries: ['us'] }, { countries: ['in'], work_modes: ['remote'] });
    expect(r.parts.find(p => p.key === 'location')!.score).toBe(1);
  });

  it('does not compare salary across currencies', () => {
    const r = matchJob({ enrichment: { salary_max: 100000, salary_currency: 'USD', salary_period: 'year' } }, profile);
    expect(r.parts.find(p => p.key === 'salary')).toBeUndefined();
    expect(r.score).toBeNull();
  });

  it('counts skills that only appear in the resume text', () => {
    const r = matchJob(
      { skills: ['nodejs', 'cloud-native', 'machine-learning', 'sql'] },
      { skills: [], resume_text: 'Built Node.js services. Deployed cloud native apps; some machine learning work.' },
    );
    expect(r.matched).toEqual(['nodejs', 'cloud-native', 'machine-learning']);
    expect(r.missing).toEqual(['sql']);
  });

  it('does not match partial words from the resume', () => {
    const r = matchJob({ skills: ['go', 'java'] }, { resume_text: 'I enjoy javascript and going to work' });
    expect(r.matched).toEqual([]);
  });

  it('does not report a score from location alone', () => {
    const r = matchJob({ countries: ['in'], work_mode: 'remote' }, { countries: ['in'], work_modes: ['remote'] });
    expect(r.parts.length).toBe(2);
    expect(r.score).toBeNull();
    const withExp = matchJob({ countries: ['in'], work_mode: 'remote', enrichment: { experience_years_min: 2 } }, { countries: ['in'], work_modes: ['remote'], experience_years: 3 });
    expect(withExp.score).toBe(100);
  });

  it('returns unknown with nothing to compare', () => {
    expect(matchJob({}, {}).label).toBe('unknown');
  });

  it('annualises salaries', () => {
    expect(annualSalary(100000, 'month')).toBe(1200000);
    expect(annualSalary(0, 'year')).toBeNull();
    expect(annualSalary(5, 'fortnight')).toBeNull();
  });
});

describe('tracker rules', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  it('detects quiet applications', () => {
    expect(quietDays({ status: 'applied', applied_date: '2026-10-01' }, now)).toBe(23);
    expect(isQuiet({ status: 'applied', applied_date: '2026-10-01' }, now)).toBe(true);
    expect(isQuiet({ status: 'applied', applied_date: '2026-10-20' }, now)).toBe(false);
    expect(isQuiet({ status: 'interview', applied_date: '2026-09-01' }, now)).toBe(false);
  });
  it('prefers last activity over applied date', () => {
    expect(isQuiet({ status: 'screening', applied_date: '2026-09-01', last_activity_at: '2026-10-22T00:00:00Z' }, now)).toBe(false);
  });
  it('flags due follow-ups on active applications only', () => {
    expect(isFollowUpDue({ status: 'applied', applied_date: '2026-10-01', follow_up_date: '2026-10-24' }, now)).toBe(true);
    expect(isFollowUpDue({ status: 'applied', applied_date: '2026-10-01', follow_up_date: '2026-12-01' }, now)).toBe(false);
    expect(isFollowUpDue({ status: 'rejected', applied_date: '2026-10-01', follow_up_date: '2026-10-01' }, now)).toBe(false);
  });
  it('computes stats', () => {
    const s = trackerStats([{ status: 'applied' }, { status: 'applied' }, { status: 'interview' }, { status: 'rejected' }, { status: 'ghosted' }]);
    expect(s).toEqual({ total: 5, active: 3, interviews: 1, offers: 0, responseRate: 40 });
    expect(trackerStats([]).responseRate).toBeNull();
  });
});

describe('job shape', () => {
  const raw = {
    public_slug: 'a-b', title: 'Dev', company: 'Acme', url: 'https://x', source: 'greenhouse', skills: ['react', 5],
    description: '<p>Hello <b>world</b></p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>',
    created_at: '2026-10-23T00:00:00Z', posted_at: '2026-10-22T00:00:00Z', view_count: 7,
    enrichment: { salary_min: 2500000, salary_max: 4000000, salary_currency: 'INR', salary_period: 'year', requirements: [{ text: 'x' }] },
    reality: { class: 'fresh', age_days: 2, repost_count: 3, fake_freshness: false },
  };

  it('strips html to a plain snippet', () => {
    expect(stripHtml('<p>A &amp; B</p><style>p{}</style><p>C</p>')).toBe('A & B C');
    expect(slimJob(raw).snippet).toBe('Hello world One Two');
  });

  it('keeps the description and requirements only for the detail view', () => {
    expect(slimJob(raw).description).toBeUndefined();
    expect(slimJob(raw).enrichment.requirements).toBeNull();
    expect(slimJob(raw, true).description).toContain('<ul>');
    expect(slimJob(raw, true).enrichment.requirements).toHaveLength(1);
  });

  it('filters malformed values', () => {
    const j = slimJob(raw);
    expect(j.skills).toEqual(['react']);
    expect(j.first_seen_at).toBe('2026-10-23T00:00:00Z');
    expect(j.work_mode).toBeNull();
  });

  it('formats salaries', () => {
    expect(formatSalary(slimJob(raw).enrichment)).toBe('₹25L–40L/yr');
    expect(formatSalary({ salary_min: 90000, salary_max: 120000, salary_currency: 'USD', salary_period: 'year' })).toBe('$90k–120k/yr');
    expect(formatSalary({})).toBeNull();
  });

  it('explains the ghost signal with evidence', () => {
    const g = ghostSignal({ class: 'likely-evergreen', age_days: 120, repost_count: 4 });
    expect(g.level).toBe('bad');
    expect(g.evidence).toEqual(['120 days old', 'Reposted 4×']);
    expect(ghostSignal({ class: 'fresh', age_days: 0 }).label).toBe('Fresh');
    expect(ghostSignal(null).label).toBe('No signal');
  });
});

describe('digest rules', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const job = (slug: string, seen: string | null, posted: string | null = null) => slimJob({ public_slug: slug, title: slug, company: 'c', url: 'u', created_at: seen, posted_at: posted });

  it('decides when a search is due', () => {
    expect(isSearchDue('daily', null, now)).toBe(true);
    expect(isSearchDue('daily', '2026-10-23T09:00:00Z', now)).toBe(true);
    expect(isSearchDue('daily', '2026-10-23T12:00:00Z', now)).toBe(false);
    expect(isSearchDue('daily', '2026-10-24T02:00:00Z', now)).toBe(false);
    expect(isSearchDue('weekly', '2026-10-20T10:00:00Z', now)).toBe(false);
    expect(isSearchDue('weekly', '2026-10-17T09:00:00Z', now)).toBe(true);
  });

  it('computes the watermark and window', () => {
    expect(watermark('2026-10-23T10:00:00Z', now, false).toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(watermark(null, now, false).toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(watermark('2026-10-23T10:00:00Z', now, true).toISOString()).toBe('2026-10-17T10:00:00.000Z');
    expect(openWindowDays(new Date('2026-10-23T10:00:00Z'), now)).toBe(2);
    expect(openWindowDays(new Date('2026-01-01T00:00:00Z'), now)).toBe(30);
  });

  it('keeps only jobs first seen after the watermark', () => {
    const jobs = [job('new', '2026-10-24T08:00:00Z'), job('old', '2026-10-22T08:00:00Z'), job('fallback', null, '2026-10-24T01:00:00Z'), job('none', null)];
    expect(newSince(jobs, new Date('2026-10-23T10:00:00Z')).map(j => j.public_slug)).toEqual(['new', 'fallback']);
  });

  it('limits the digest and counts the rest', () => {
    const jobs = Array.from({ length: 14 }, (_, i) => job(`j${i}`, '2026-10-24T08:00:00Z'));
    const { shown, more } = digestLines(jobs);
    expect(shown).toHaveLength(10);
    expect(more).toBe(4);
  });

  it('escapes Telegram markdown', () => {
    expect(escapeTelegram('a_b*c[d`e')).toBe('a\\_b\\*c\\[d\\`e');
  });
});
