// job-ai: AI features for the Jobs workspace. All modes are scoped to the calling user.
//   { mode: 'parse_resume', file_path }              PDF in the documents bucket -> text + skills (Gemini)
//   { mode: 'fit', slug }                            deterministic match + AI fit analysis
//   { mode: 'cover_letter', slug, tone? }            draft built only from the resume text
//   { mode: 'ask', slug, question }                  question about one posting
// Results are cached in job_ai_results; uncached calls are capped per user per day.

import { admin, corsHeaders, json, userFromAuth } from '../_shared/util.ts';
import { aiJSON, aiText, aiVision } from '../_shared/ai-provider.ts';
import { UpstreamError, getJob } from '../_shared/freehire.ts';
import { matchJob } from '../_shared/pure/job-match.ts';
import { stripHtml, type Job } from '../_shared/pure/job-shape.ts';

const DAILY_CAP = 30;
// Gemini's free tier is only ~20 requests/day, so Groq goes first and Gemini is the fallback.
const AI_OPTS = { providers: ['groq', 'gemini', 'ollama'] as ('gemini' | 'groq' | 'ollama')[], timeoutMs: 45_000 };
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const RESUME_CHARS = 9000;
const JD_CHARS = 6000;

type Sb = ReturnType<typeof admin>;

interface Profile {
  headline: string | null; skills: string[]; experience_years: number | null; seniority: string | null;
  countries: string[]; work_modes: string[]; salary_min: number | null; salary_currency: string | null;
  resume_text: string | null;
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

class HttpError extends Error { constructor(message: string, public status: number) { super(message); } }

async function loadProfile(sb: Sb, userId: string, requireResume: boolean): Promise<Profile> {
  const { data } = await sb.from('job_profile').select('*').eq('user_id', userId).maybeSingle();
  const p = (data ?? {}) as Partial<Profile>;
  if (requireResume && !(p.resume_text && p.resume_text.trim().length >= 80)) {
    throw new HttpError('Add your resume in the Profile tab first (upload a PDF or paste the text).', 400);
  }
  return {
    headline: p.headline ?? null, skills: p.skills ?? [], experience_years: p.experience_years ?? null,
    seniority: p.seniority ?? null, countries: p.countries ?? [], work_modes: p.work_modes ?? [],
    salary_min: p.salary_min ?? null, salary_currency: p.salary_currency ?? 'INR', resume_text: p.resume_text ?? null,
  };
}

async function enforceCap(sb: Sb, userId: string) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await sb.from('job_ai_results').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= DAILY_CAP) throw new HttpError(`Daily AI limit reached (${DAILY_CAP}). Cached results still work.`, 429);
}

async function cached(sb: Sb, userId: string, slug: string, kind: string, hash: string) {
  const { data } = await sb.from('job_ai_results').select('result')
    .eq('user_id', userId).eq('public_slug', slug).eq('kind', kind).eq('input_hash', hash).maybeSingle();
  return data?.result ?? null;
}

async function store(sb: Sb, userId: string, slug: string, kind: string, hash: string, result: unknown) {
  await sb.from('job_ai_results').upsert(
    { user_id: userId, public_slug: slug, kind, input_hash: hash, result, created_at: new Date().toISOString() },
    { onConflict: 'user_id,public_slug,kind,input_hash' },
  );
}

function jobBrief(job: Job): string {
  const reqs = (job.enrichment.requirements ?? []).map((r) => `- (${r.priority ?? 'required'}) ${r.text}`).join('\n');
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    job.location ? `Location: ${job.location}` : '',
    job.work_mode ? `Work mode: ${job.work_mode}` : '',
    job.skills.length ? `Listed skills: ${job.skills.join(', ')}` : '',
    job.enrichment.experience_years_min != null ? `Experience asked: ${job.enrichment.experience_years_min}+ years` : '',
    reqs ? `Requirements:\n${reqs}` : '',
    `Description:\n${stripHtml(job.description ?? '').slice(0, JD_CHARS)}`,
  ].filter(Boolean).join('\n');
}

function profileBrief(p: Profile): string {
  return [
    p.headline ? `Headline: ${p.headline}` : '',
    p.experience_years != null ? `Years of experience: ${p.experience_years}` : '',
    p.skills.length ? `Skills: ${p.skills.join(', ')}` : '',
    `RESUME:\n${(p.resume_text ?? '').slice(0, RESUME_CHARS)}`,
  ].filter(Boolean).join('\n');
}

const TRUTH_RULES = `Rules: use ONLY facts that appear in the RESUME. Never invent employers, titles, dates, metrics, tools, degrees or certifications. If the resume does not show something the job asks for, say it is not shown rather than assuming it.`;

// ---------- modes ----------
async function parseResume(sb: Sb, userId: string, filePath: unknown) {
  if (typeof filePath !== 'string' || !filePath.startsWith(`${userId}/`) || filePath.includes('..')) {
    throw new HttpError('invalid file path', 400);
  }
  const { data: blob, error } = await sb.storage.from('documents').download(filePath);
  if (error || !blob) throw new HttpError('Could not read the uploaded file.', 400);
  if (blob.size > MAX_PDF_BYTES) throw new HttpError('PDF is too large (max 8 MB).', 400);
  const mime = blob.type === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : blob.type;
  if (!mime.startsWith('application/pdf') && !mime.startsWith('image/')) throw new HttpError('Upload a PDF or an image of your resume.', 400);
  await enforceCap(sb, userId);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const out = await aiVision<{ text: string; headline?: string; skills?: string[]; experience_years?: number; seniority?: string }>(
    `Extract the content of this resume. Return the full text faithfully in "text" (plain text, keep section headings and bullet points, do not summarise or add anything). ` +
    `Also return "headline" (their current role in <= 8 words), "skills" (up to 40 concrete technical/professional skills that are explicitly mentioned), ` +
    `"experience_years" (total professional years as a number, or null if unclear) and "seniority" (one of intern, junior, middle, senior, lead, staff, principal, or null).`,
    b64(bytes), mime,
    '{"text":"...","headline":"...","skills":["..."],"experience_years":0,"seniority":"senior"}',
  ).catch((e) => {
    console.error('[job-ai] resume vision failed', (e as Error).message);
    throw new HttpError('Could not read the file right now (the AI reader is busy or over its daily limit). Paste your resume text below instead, or try again later.', 503);
  });
  const text = (out.text ?? '').trim();
  if (text.length < 40) throw new HttpError('Could not read any text from that file. Paste your resume text instead.', 422);

  await sb.from('job_profile').upsert({
    user_id: userId, resume_text: text.slice(0, 20000), resume_file_path: filePath,
    resume_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  // Log usage so extraction counts against the daily cap.
  await sb.from('job_ai_results').insert({
    user_id: userId, public_slug: '_resume', kind: 'ask', input_hash: await sha(filePath + Date.now()), result: { parsed: true },
  });

  const skills = Array.isArray(out.skills) ? out.skills.filter((s) => typeof s === 'string').slice(0, 40) : [];
  return {
    text,
    headline: out.headline ?? null,
    skills,
    experience_years: typeof out.experience_years === 'number' ? out.experience_years : null,
    seniority: out.seniority ?? null,
  };
}

async function fit(sb: Sb, userId: string, slug: string) {
  const profile = await loadProfile(sb, userId, true);
  const job = await getJob(slug);
  const match = matchJob(job, profile);
  const hash = await sha(`${profile.resume_text}|${profile.skills.join(',')}|${profile.experience_years}`);
  const hit = await cached(sb, userId, slug, 'fit', hash);
  if (hit) return { match, analysis: hit, cached: true };
  await enforceCap(sb, userId);

  const prompt = `You are a candid recruiter assessing how well a candidate fits one job.\n${TRUTH_RULES}\n\n` +
    `JOB\n${jobBrief(job)}\n\nCANDIDATE\n${profileBrief(profile)}\n\n` +
    `Deterministic skill match already computed: matched=[${match.matched.join(', ')}], missing=[${match.missing.join(', ')}].\n` +
    `Return JSON with: verdict (strong|good|partial|weak), summary (2 sentences), strengths (3-5 short strings, each tied to resume evidence), ` +
    `gaps (up to 5 objects {requirement, status: "missing"|"weak"|"not_shown", note}), how_to_address (3 concrete, honest steps), ` +
    `interview_questions (4 likely questions about the gaps and the role).`;
  const analysis = await aiJSON<Record<string, unknown>>(prompt,
    '{"verdict":"good","summary":"...","strengths":["..."],"gaps":[{"requirement":"...","status":"missing","note":"..."}],"how_to_address":["..."],"interview_questions":["..."]}',
    AI_OPTS);
  const clean = {
    verdict: ['strong', 'good', 'partial', 'weak'].includes(String(analysis.verdict)) ? analysis.verdict : 'partial',
    summary: String(analysis.summary ?? ''),
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths.map(String).slice(0, 6) : [],
    gaps: Array.isArray(analysis.gaps) ? analysis.gaps.slice(0, 6).map((g: any) => ({
      requirement: String(g?.requirement ?? ''), status: String(g?.status ?? 'not_shown'), note: String(g?.note ?? ''),
    })) : [],
    how_to_address: Array.isArray(analysis.how_to_address) ? analysis.how_to_address.map(String).slice(0, 5) : [],
    interview_questions: Array.isArray(analysis.interview_questions) ? analysis.interview_questions.map(String).slice(0, 6) : [],
  };
  await store(sb, userId, slug, 'fit', hash, clean);
  return { match, analysis: clean, cached: false };
}

async function coverLetter(sb: Sb, userId: string, slug: string, toneRaw: unknown) {
  const tone = ['professional', 'friendly', 'concise'].includes(String(toneRaw)) ? String(toneRaw) : 'professional';
  const profile = await loadProfile(sb, userId, true);
  const job = await getJob(slug);
  const hash = await sha(`${tone}|${profile.resume_text}`);
  const hit = await cached(sb, userId, slug, 'cover_letter', hash);
  if (hit) return { ...(hit as object), cached: true };
  await enforceCap(sb, userId);

  const text = await aiText(
    `Write a ${tone} cover letter (max 220 words, 3 short paragraphs, no placeholders like [Name]) for this job.\n` +
    `Open with why this role and company, then 2-3 resume-backed strengths that match the requirements, then a brief close.\n\n` +
    `JOB\n${jobBrief(job)}\n\nCANDIDATE\n${profileBrief(profile)}`,
    `You write honest, specific cover letters. ${TRUTH_RULES} Output only the letter text.`,
    AI_OPTS,
  );
  const result = { text: text.trim(), tone };
  await store(sb, userId, slug, 'cover_letter', hash, result);
  return { ...result, cached: false };
}

async function ask(sb: Sb, userId: string, slug: string, questionRaw: unknown) {
  const question = String(questionRaw ?? '').trim().slice(0, 500);
  if (question.length < 3) throw new HttpError('Ask a question about this job.', 400);
  const profile = await loadProfile(sb, userId, false);
  const job = await getJob(slug);
  const hash = await sha(`${question}|${profile.resume_text ?? ''}|${profile.skills.join(',')}`);
  const hit = await cached(sb, userId, slug, 'ask', hash);
  if (hit) return { ...(hit as object), cached: true };
  await enforceCap(sb, userId);

  const answer = await aiText(
    `JOB\n${jobBrief(job)}\n\n${profile.resume_text ? `CANDIDATE\n${profileBrief(profile)}\n\n` : ''}QUESTION: ${question}`,
    `You are a career coach answering one question about a specific job posting. Base answers on the posting and, when relevant, the candidate's resume. ` +
    `${TRUTH_RULES} If the posting does not say, say so. Be concise (under 180 words).`,
    AI_OPTS,
  );
  const result = { answer: answer.trim() };
  await store(sb, userId, slug, 'ask', hash, result);
  return { ...result, cached: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const user = await userFromAuth(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body.mode !== 'string') return json({ error: 'mode required' }, 400);

  const sb = admin();
  try {
    switch (body.mode) {
      case 'parse_resume': return json({ data: await parseResume(sb, user.id, body.file_path) });
      case 'fit': return json({ data: await fit(sb, user.id, String(body.slug ?? '')) });
      case 'cover_letter': return json({ data: await coverLetter(sb, user.id, String(body.slug ?? ''), body.tone) });
      case 'ask': return json({ data: await ask(sb, user.id, String(body.slug ?? ''), body.question) });
      default: return json({ error: 'unknown mode' }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof UpstreamError) return json({ error: e.message }, e.status === 404 ? 404 : 502);
    console.error('[job-ai]', (e as Error).message);
    const quota = /quota|429|rate.?limit/i.test((e as Error).message ?? '');
    return json({
      error: quota
        ? 'The AI service has reached its limit for now. Please try again later.'
        : 'The AI service is busy or unavailable right now. Please try again in a minute.',
    }, 503);
  }
});
