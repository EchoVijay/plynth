# Jobs workspace

The Jobs page is a four-part workspace inspired by [freehire](https://github.com/strelov1/freehire)
(MIT): **Find → Apply → Track → Ask**. Job data comes from freehire's free, keyless public API
(`https://freehire.me/api/v1`); everything else (profile, tracker, alerts, AI) is Plynth's own.

## What each tab does

| Tab | Purpose |
|---|---|
| **Find** | Search ~100k live postings (India by default) with typeahead and filters: work mode, seniority, skills (any/all), country, posted-within, minimum salary, max experience, employment type, visa sponsorship. Stale / evergreen "ghost" ads are hidden by default. Every card shows a deterministic match % against your profile. |
| **Job drawer** | Full posting (sanitised HTML), AI summary, requirements, skills you have vs. lack, posting-reality signal, similar jobs and the company's other roles. **Apply** opens the original posting and then asks "Did you apply?". **Fit & apply** shows the match breakdown, an AI fit analysis and a cover-letter draft. **Ask AI** answers questions about the posting. |
| **Saved** | Saved jobs (including older JSearch ones), kept even after a posting closes. |
| **Tracker** | Kanban with Applied / Screening / Interview / Offer / Rejected / Ghosted, stats, "quiet for 14+ days" nudges, per-application timeline (append-only ledger written by DB triggers), follow-up dates, and *Interview → Add in Calendar* (creates a Calendar event with reminders). |
| **Alerts** | Saved searches with daily/weekly digests by email, push (ntfy) and/or Telegram. |
| **Profile** | Skills, experience, target salary, countries, work modes and your resume (PDF upload read by AI, or pasted text). |

Also: chat tools (`search_jobs`, `get_job`, `list_jobs`), Telegram `/jobs` and `/applied`,
follow-up/quiet reminders in the daily digest, and a dashboard "Job Search" card.

## Architecture

```
Browser ──► jobs-api ──► freehire.me/api/v1        (auth + whitelist + cache; the API sends no CORS headers)
        ──► job-ai   ──► Groq → Gemini → Ollama    (parse_resume | fit | cover_letter | ask)
        ──► Supabase tables (RLS)  ◄── job-digest (pg_cron, hourly)
```

- Pure logic shared by the web app and the edge functions lives in
  `supabase/functions/_shared/pure/` (filters/query builder, match score, tracker rules,
  digest rules, job shape). The web app imports it through the `@shared` alias; it is unit-tested
  in `web/src/lib/jobs/shared-logic.test.ts`.
- `jobs-api` requires a signed-in user, whitelists filter keys, clamps paging and caches responses
  (60 s searches, 10 min postings, 1 h facets) with stale-on-error.
- `job-ai` caches results in `job_ai_results` and caps uncached calls at 30 per user per day.
  The fit/cover-letter prompts only allow facts that appear in the resume text.
- Job descriptions are third-party HTML and are sanitised with DOMPurify before rendering.

## Deploy

```bash
supabase db push                                   # 0029_jobs_v2, 0030_job_app_backdated_activity
supabase functions deploy jobs-api job-ai job-digest chat telegram-bot send-reminder
supabase secrets set GROQ_API_KEY=<key> GEMINI_API_KEY=<key>
supabase secrets set GROQ_MODEL_PRIMARY=openai/gpt-oss-120b GROQ_MODEL_FAST=openai/gpt-oss-20b
```

`job-digest` is scheduled by migration 0029 (`plynth-job-digest`, hourly); it decides which saved
searches are due. Gemini is only needed for reading PDF resumes; if it is rate-limited the Profile
tab asks the user to paste the text instead.

## Notes

- Dependence on freehire.me: the app caches and degrades gracefully, but if the public API
  changes or goes away, only `_shared/freehire.ts` needs replacing.
- Attribution: the Find tab links to freehire.me and apply links keep freehire's `utm_source`.
- Not included (from freehire): CV builder/PDF templates, CV tailoring, tracer links, referrals,
  mail inbox linking, auto-apply, interview rehearsal and market insights.
