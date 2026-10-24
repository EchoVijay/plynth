// send-reminder: dispatcher run every 5 minutes by pg_cron.
// For each enabled reminder_settings row it works out, in the USER's timezone, which of its times
// of day are due, builds the digest and delivers it over the chosen channels. reminder_log records
// what really happened per channel; a fire is only considered done once something was delivered,
// otherwise it is retried on the next runs (up to MAX_ATTEMPTS) within the grace window.
//
// Manual test: POST {test_reminder_id} with the owner's JWT (or the service key).

import { admin, json, corsHeaders, getSecret, userFromAuth } from '../_shared/util.ts';
import { renderDigestEmail, type MailSection } from '../_shared/mail-template.ts';
import { notifyUser, parseChannels, type Channel, type Recipient } from '../_shared/notify.ts';
import { loadOverview, type Overview } from '../_shared/overview.ts';
import { dueFires, GRACE_MIN } from '../_shared/pure/reminder-rules.ts';
import { formatClock, greetingFor, localParts } from '../_shared/pure/tz.ts';
import { escapeTelegram } from '../_shared/pure/job-digest.ts';

const MAX_ATTEMPTS = 3;
const DEFAULT_APP_URL = 'https://plynth-finance.netlify.app';

interface Item { html: string; meta?: string; line: string }
interface Section { title: string; emoji: string; items: Item[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const CATEGORY_LABEL: Record<string, string> = {
  all: 'Daily digest', calendar: 'Schedule', tasks: 'Tasks', learning: 'Learning', finance: 'Finance', jobs: 'Jobs',
};

function buildSections(ov: Overview, category: string): Section[] {
  const want = (c: string) => category === 'all' || category === c;
  const out: Section[] = [];
  const today = ov.from;

  if (want('calendar') && ov.events.length) {
    out.push({
      title: "Today's schedule", emoji: '📅',
      items: ov.events.map((e) => {
        const when = e.all_day ? 'All day' : `${formatClock(e.time)}${e.end_time ? ` – ${formatClock(e.end_time)}` : ''}`;
        return {
          html: `<b>${esc(e.title)}</b>`,
          meta: [when, e.location].filter(Boolean).join(' · '),
          line: `• ${when}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`,
        };
      }),
    });
  }
  if (want('tasks') && ov.tasks.length) {
    out.push({
      title: 'Tasks', emoji: '✅',
      items: ov.tasks.map((t) => ({
        html: `<b>${esc(t.title)}</b>`,
        meta: `${t.overdue ? `Overdue (${t.due_date})` : t.due_time ? `Today ${formatClock(t.due_time)}` : 'Today'} · ${t.priority}`,
        line: `• ${t.title}${t.overdue ? ' (overdue)' : ''} — ${t.priority}`,
      })),
    });
  }
  if (want('learning') && ov.learning.length) {
    out.push({
      title: 'Learning today', emoji: '📚',
      items: ov.learning.map((p) => ({
        html: `<b>${esc(p.title)}</b>`,
        meta: `${p.topic ?? ''} · ${p.minutes} min`,
        line: `• ${p.title} (${p.minutes}m)`,
      })),
    });
  }
  if (want('finance')) {
    const emis = ov.emis;
    if (emis.length) {
      out.push({
        title: 'EMIs due soon', emoji: '💰',
        items: emis.map((l) => ({
          html: `<b>${esc(l.name)}</b> &mdash; ${inr(l.amount)}`,
          meta: l.date === today ? 'Due today' : `Due ${l.date}`,
          line: `• ${l.name} ${inr(l.amount)} (${l.date === today ? 'today' : l.date})`,
        })),
      });
    }
    if (ov.subscriptions.length) {
      out.push({
        title: 'Subscriptions renewing', emoji: '🔁',
        items: ov.subscriptions.map((s) => ({
          html: `<b>${esc(s.name)}</b> &mdash; ${inr(s.amount)}`,
          meta: s.date === today ? 'Renews today' : `Renews ${s.date}`,
          line: `• ${s.name} ${inr(s.amount)} (${s.date})`,
        })),
      });
    }
  }
  if (want('jobs')) {
    if (ov.jobs.followUps.length) {
      out.push({
        title: 'Follow-ups due', emoji: '⏰',
        items: ov.jobs.followUps.map((a) => ({
          html: `<b>${esc(a.role)}</b> &mdash; ${esc(a.company)}`,
          meta: `Follow up planned for ${a.follow_up_date}`,
          line: `• Follow up: ${a.role} @ ${a.company}`,
        })),
      });
    }
    if (ov.jobs.quiet.length) {
      out.push({
        title: 'Applications gone quiet', emoji: '🤫',
        items: ov.jobs.quiet.map((a) => ({
          html: `<b>${esc(a.role)}</b> &mdash; ${esc(a.company)}`,
          meta: `No news for ${a.days} days — consider a follow-up`,
          line: `• Quiet ${a.days}d: ${a.role} @ ${a.company}`,
        })),
      });
    }
  }
  return out;
}

interface ReminderRow {
  id: string;
  user_id: string;
  category: string;
  channel: string;
  channels?: string[] | null;
  time_of_day: string;
  times_of_day: string[] | null;
  days_of_week: number[];
  enabled: boolean;
}

type Profile = Recipient & { timezone?: string | null };

async function dispatchOne(
  sb: ReturnType<typeof admin>, r: ReminderRow, p: Profile, fireDate: string, fireTime: string,
  appUrl: string, opts: { record: boolean; attemptsBefore: number },
) {
  const tz = p.timezone || 'Asia/Kolkata';
  const now = new Date();
  const ov = await loadOverview(sb, r.user_id, { tz, now, soonDays: 3 });
  const sections = buildSections(ov, r.category);
  const label = CATEGORY_LABEL[r.category] ?? r.category;
  const nowLocal = localParts(tz, now);
  const first = (p.full_name ?? '').split(' ')[0];

  const subject = `Plynth · ${label} · ${fireTime.slice(0, 5)}`;
  const html = renderDigestEmail({
    greeting: `${greetingFor(nowLocal.minutes)}${first ? ', ' + first : ''} 👋`,
    intro: sections.length ? `Here's your ${label.toLowerCase()} for today.` : `Nothing on your ${label.toLowerCase()} list right now — you're all clear.`,
    sections: sections.map((s): MailSection => ({ title: s.title, emoji: s.emoji, items: s.items.map(({ html, meta }) => ({ html, meta })) })),
    appUrl,
    footerNote: `Scheduled for ${fireTime.slice(0, 5)} (${tz}). Change it in Settings → Reminders.`,
  });
  const lines = sections.flatMap((s) => [`${s.emoji} ${s.title}`, ...s.items.map((i) => i.line)]);
  const text = lines.length ? lines.join('\n') : `Nothing on your ${label.toLowerCase()} list right now — you're all clear.`;
  const telegram = `🔔 *${escapeTelegram(subject)}*\n\n${escapeTelegram(text)}`.slice(0, 3900);

  const channels = parseChannels(r);
  const outcome = await notifyUser(p, channels, { subject, html, text, telegram, click: appUrl, tags: ['bell'] });
  const ok = outcome.delivered.length > 0;

  if (opts.record) {
    await sb.from('reminder_log').upsert({
      reminder_id: r.id, fired_for: fireDate, fired_time: fireTime,
      status: ok ? 'sent' : 'failed', delivered_via: outcome.delivered, errors: outcome.errors,
      attempts: opts.attemptsBefore + 1, updated_at: new Date().toISOString(),
    }, { onConflict: 'reminder_id,fired_for,fired_time' });
  }
  return { ok, channels, delivered: outcome.delivered as Channel[], errors: outcome.errors };
}

async function loadProfile(sb: ReturnType<typeof admin>, userId: string): Promise<Profile> {
  const { data } = await sb.from('profiles').select('user_id,email,full_name,timezone,ntfy_topic,telegram_chat_id').eq('user_id', userId).maybeSingle();
  return { user_id: userId, ...(data ?? {}) } as Profile;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const sb = admin();
  const appUrl = (await getSecret('APP_URL')) ?? DEFAULT_APP_URL;

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKeys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SERVICE_ROLE_KEY')].filter(Boolean);
  const isInternal = !!bearer && serviceKeys.includes(bearer);

  // ---- Manual test: only the reminder's owner (or the service key) ----
  if (body?.test_reminder_id) {
    const user = isInternal ? null : await userFromAuth(req);
    if (!isInternal && !user) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data: r } = await sb.from('reminder_settings').select('*').eq('id', body.test_reminder_id).maybeSingle();
    if (!r || (user && r.user_id !== user.id)) return json({ ok: false, error: 'reminder not found' }, 404);
    const p = await loadProfile(sb, r.user_id);
    const local = localParts(p.timezone, new Date());
    const time = `${String(Math.floor(local.minutes / 60)).padStart(2, '0')}:${String(local.minutes % 60).padStart(2, '0')}:00`;
    try {
      const res = await dispatchOne(sb, r as ReminderRow, p, local.date, time, appUrl, { record: false, attemptsBefore: 0 });
      return json({ ok: res.ok, channels: res.channels, delivered: res.delivered, errors: res.errors, test: true });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  }

  if (!isInternal) return json({ error: 'unauthorized' }, 401);

  // ---- Scheduled run ----
  const now = new Date();
  const { data: rules } = await sb.from('reminder_settings').select('*').eq('enabled', true);
  const userIds = Array.from(new Set((rules ?? []).map((r) => r.user_id)));
  const { data: profs } = userIds.length
    ? await sb.from('profiles').select('user_id,email,full_name,timezone,ntfy_topic,telegram_chat_id').in('user_id', userIds)
    : { data: [] };
  const profMap = new Map<string, Profile>((profs ?? []).map((p: any) => [p.user_id, p as Profile]));

  let sent = 0, failed = 0, notDue = 0;
  for (const raw of rules ?? []) {
    const r = raw as ReminderRow;
    const p = profMap.get(r.user_id);
    if (!p) { notDue++; continue; }
    const local = localParts(p.timezone, now);
    const times = r.times_of_day?.length ? r.times_of_day : [r.time_of_day];
    const fires = dueFires(local, times, r.days_of_week ?? [], GRACE_MIN);
    if (!fires.length) { notDue++; continue; }

    for (const f of fires) {
      const { data: prev } = await sb.from('reminder_log').select('status,attempts')
        .eq('reminder_id', r.id).eq('fired_for', f.date).eq('fired_time', f.time).maybeSingle();
      if (prev && (prev.status === 'sent' || (prev.attempts ?? 1) >= MAX_ATTEMPTS)) continue;
      try {
        const res = await dispatchOne(sb, r, p, f.date, f.time, appUrl, { record: true, attemptsBefore: prev?.attempts ?? 0 });
        if (res.ok) sent++; else { failed++; console.warn('[send-reminder] nothing delivered', r.id, JSON.stringify(res.errors)); }
      } catch (e) {
        failed++;
        console.error('[send-reminder] dispatch failed', r.id, (e as Error).message);
      }
    }
  }
  return json({ ok: true, sent, failed, notDue, scanned: rules?.length ?? 0 });
});
