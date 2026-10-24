// job-digest: emails / pushes / Telegrams new jobs for saved searches.
//   cron (service-role bearer):   {}                  -> every due search with notify = true
//   user (their own JWT):          { search_id }      -> send that search's digest now (last 7 days, watermark untouched)

import { admin, corsHeaders, getSecret, json, userFromAuth } from '../_shared/util.ts';
import { searchJobs, UpstreamError } from '../_shared/freehire.ts';
import { sanitizeFilters } from '../_shared/pure/job-filters.ts';
import { digestLines, escapeTelegram, isSearchDue, newSince, openWindowDays, watermark, type Frequency } from '../_shared/pure/job-digest.ts';
import { describeFilters } from '../_shared/pure/job-filters.ts';
import { renderDigestEmail } from '../_shared/mail-template.ts';
import { notifyUser, type Channel } from '../_shared/notify.ts';

const MAX_SEARCHES_PER_RUN = 40;

interface SearchRow {
  id: string; user_id: string; name: string; query: Record<string, unknown>; notify: boolean;
  frequency: Frequency; channels: string[]; last_run_at: string | null;
}

interface Profile { email?: string; full_name?: string; ntfy_topic?: string; telegram_chat_id?: number }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function processSearch(sb: ReturnType<typeof admin>, s: SearchRow, forced: boolean, appUrl: string) {
  const now = new Date();
  const mark = watermark(s.last_run_at, now, forced);
  const filters = { ...sanitizeFilters(s.query), open_within_days: openWindowDays(mark, now), sort: 'newest' as const };
  const res = await searchJobs(filters, { limit: 50 });
  const fresh = newSince(res.jobs, mark);

  if (!fresh.length) {
    if (!forced) await sb.from('job_saved_searches').update({ last_run_at: now.toISOString(), last_match_count: 0 }).eq('id', s.id);
    return { matches: 0, sent: false, channels: [] as string[], errors: {} as Record<string, string> };
  }

  const { data: prof } = await sb.from('profiles').select('email,full_name,ntfy_topic,telegram_chat_id').eq('user_id', s.user_id).maybeSingle();
  const p = (prof ?? {}) as Profile;
  const { shown, more } = digestLines(fresh);
  const link = `${appUrl}/jobs?tab=find`;
  const subject = `💼 ${fresh.length}${res.total > 50 && fresh.length >= 50 ? '+' : ''} new job${fresh.length === 1 ? '' : 's'} · ${s.name}`;
  const channels = (s.channels?.length ? s.channels : ['email']) as Channel[];

  const html = renderDigestEmail({
    greeting: `${p.full_name ? p.full_name.split(' ')[0] + ', ' : ''}new matches for “${s.name}”`,
    intro: `${describeFilters(sanitizeFilters(s.query))}`,
    sections: [{
      title: 'New jobs', emoji: '💼',
      items: shown.map((j) => ({
        html: `<a href="${esc(j.url)}" style="color:#6366f1;text-decoration:none"><b>${esc(j.title)}</b></a>`,
        meta: [j.company, j.location].filter(Boolean).join(' · '),
      })).concat(more ? [{ html: `<i>…and ${more} more in Plynth</i>`, meta: '' }] : []),
    }],
    appUrl: link,
    footerNote: 'You get this because you turned on alerts for this search. Change it in Jobs → Alerts.',
  });
  const pushText = shown.slice(0, 5).map((j) => `• ${j.title} @ ${j.company}`).join('\n') + (fresh.length > 5 ? `\n+${fresh.length - 5} more` : '');
  const lines = shown.map((j) => `• [${escapeTelegram(j.title)}](${j.url.replace(/\)/g, '%29')}) — ${escapeTelegram(j.company)}`).join('\n');
  const telegram = `💼 *${escapeTelegram(subject)}*\n\n${lines}${more ? `\n…and ${more} more` : ''}`;

  const outcome = await notifyUser({ user_id: s.user_id, ...p }, channels, { subject, html, text: pushText, telegram, click: link, tags: ['briefcase'] });
  const delivered = outcome.delivered as string[];

  // Only move the watermark when something was delivered, so a failed send is retried next hour.
  if (!forced && delivered.length) {
    await sb.from('job_saved_searches').update({ last_run_at: now.toISOString(), last_match_count: fresh.length }).eq('id', s.id);
  }
  return { matches: fresh.length, sent: delivered.length > 0, channels: delivered, errors: outcome.errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const appUrl = (await getSecret('APP_URL')) ?? 'https://plynth-finance.netlify.app';
  const body = await req.json().catch(() => ({}));

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKeys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SERVICE_ROLE_KEY')].filter(Boolean);
  const isCron = !!bearer && serviceKeys.includes(bearer);

  try {
    if (typeof body.search_id === 'string') {
      const user = isCron ? null : await userFromAuth(req);
      if (!isCron && !user) return json({ error: 'unauthorized' }, 401);
      const q = sb.from('job_saved_searches').select('*').eq('id', body.search_id);
      const { data } = await (user ? q.eq('user_id', user.id) : q).maybeSingle();
      if (!data) return json({ error: 'search not found' }, 404);
      return json(await processSearch(sb, data as SearchRow, true, appUrl));
    }

    if (!isCron) return json({ error: 'unauthorized' }, 401);

    const { data: rows } = await sb.from('job_saved_searches').select('*').eq('notify', true).order('last_run_at', { ascending: true, nullsFirst: true }).limit(200);
    const now = new Date();
    const due = ((rows ?? []) as SearchRow[]).filter((r) => isSearchDue(r.frequency, r.last_run_at, now)).slice(0, MAX_SEARCHES_PER_RUN);
    let sent = 0, matches = 0, failed = 0;
    for (const s of due) {
      try {
        const r = await processSearch(sb, s, false, appUrl);
        matches += r.matches;
        if (r.sent) sent++;
      } catch (e) {
        failed++;
        console.warn('[job-digest] search failed', s.id, (e as Error).message);
        if (e instanceof UpstreamError && e.status === 429) break;
      }
    }
    return json({ ok: true, due: due.length, sent, matches, failed });
  } catch (e) {
    if (e instanceof UpstreamError) return json({ error: e.message }, 502);
    return json({ error: String(e) }, 500);
  }
});
