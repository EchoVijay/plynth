// calendar-reminder: fires per-event reminders (reminder_minutes[]), run every 5 minutes by pg_cron.
// - Works in each user's own timezone.
// - Expands repeating events, so a weekly stand-up or a yearly birthday is reminded every time.
// - Delivers by email plus any other channel the user uses for reminders (push / Telegram).
// - Dedupes per occurrence in reminder_sent_for ("yyyy-MM-dd_minutes"); a reminder is only marked
//   sent once something was actually delivered, so a failed send retries on the next run.

import { admin, json, corsHeaders, getSecret } from '../_shared/util.ts';
import { renderDigestEmail } from '../_shared/mail-template.ts';
import { notifyUser, parseChannels, type Channel, type Recipient } from '../_shared/notify.ts';
import { expandCalendar } from '../_shared/pure/calendar-expand.ts';
import { calendarDue, calendarFireTime, reminderLabel } from '../_shared/pure/reminder-rules.ts';
import { addDaysYmd, formatClock, localParts } from '../_shared/pure/tz.ts';
import { escapeTelegram } from '../_shared/pure/job-digest.ts';

const DEFAULT_APP_URL = 'https://plynth-finance.netlify.app';
const EMOJI: Record<string, string> = {
  birthday: '🎂', interview: '💼', exam: '📝', emi: '💰', bill: '🧾', period: '🩸', general: '📌',
  work: '💻', focus: '🎯', study: '📚', personal: '🧘', other: '📌',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface EventRow {
  id: string; user_id: string; title: string; description: string | null; location: string | null;
  event_date: string; event_time: string | null; end_date: string | null; end_time: string | null;
  is_all_day: boolean | null; recurrence: string | null; category: string;
  reminder_minutes: number[]; reminder_sent_for: Record<string, boolean> | null; completed: boolean | null;
}
type Profile = Recipient & { timezone?: string | null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKeys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SERVICE_ROLE_KEY')].filter(Boolean);
  if (!bearer || !serviceKeys.includes(bearer)) return json({ error: 'unauthorized' }, 401);

  const sb = admin();
  const appUrl = (await getSecret('APP_URL')) ?? DEFAULT_APP_URL;
  const now = new Date();

  const { data: events, error } = await sb.from('calendar_events')
    .select('id,user_id,title,description,location,event_date,event_time,end_date,end_time,is_all_day,recurrence,category,reminder_minutes,reminder_sent_for,completed')
    .not('reminder_minutes', 'eq', '{}').limit(2000);
  if (error) return json({ ok: false, error: error.message }, 500);
  const rows = ((events ?? []) as EventRow[]).filter((e) => !e.completed && e.reminder_minutes?.length);
  if (!rows.length) return json({ ok: true, sent: 0, failed: 0, scanned: 0 });

  const userIds = [...new Set(rows.map((e) => e.user_id))];
  const [{ data: profs }, { data: rules }] = await Promise.all([
    sb.from('profiles').select('user_id,email,full_name,timezone,ntfy_topic,telegram_chat_id').in('user_id', userIds),
    sb.from('reminder_settings').select('user_id,channel,channels').eq('enabled', true).in('user_id', userIds),
  ]);
  const profMap = new Map<string, Profile>((profs ?? []).map((p: any) => [p.user_id, p as Profile]));
  const channelsByUser = new Map<string, Set<Channel>>();
  for (const u of userIds) channelsByUser.set(u, new Set<Channel>(['email']));
  for (const r of rules ?? []) for (const c of parseChannels(r as any)) channelsByUser.get((r as any).user_id)?.add(c);

  let sent = 0, failed = 0;
  for (const evt of rows) {
    const p = profMap.get(evt.user_id);
    if (!p) continue;
    const tz = p.timezone || 'Asia/Kolkata';
    const today = localParts(tz, now).date;
    const occs = expandCalendar([evt], addDaysYmd(today, -1), addDaysYmd(today, 4));
    const sentFor: Record<string, boolean> = { ...(evt.reminder_sent_for ?? {}) };
    let changed = false;

    for (const occ of occs) {
      for (const minutes of evt.reminder_minutes) {
        const key = `${occ.date}_${minutes}`;
        if (sentFor[key]) continue;
        const fire = calendarFireTime(occ.date, evt.event_time, minutes, tz);
        if (!calendarDue(fire, now)) continue;

        const emoji = EMOJI[evt.category] ?? '📌';
        const label = reminderLabel(minutes);
        const when = evt.event_time && !evt.is_all_day
          ? `${occ.date} at ${formatClock(evt.event_time)}${evt.end_time ? ` – ${formatClock(evt.end_time)}` : ''}`
          : `${occ.date} (all day)`;
        const subject = `${emoji} ${evt.title} — ${label}`;
        const html = renderDigestEmail({
          greeting: `${emoji} Reminder`,
          intro: `${evt.title} — ${label}`,
          sections: [{
            title: 'Details', emoji: '📅',
            items: [
              { html: `<b>${esc(evt.title)}</b>`, meta: when },
              ...(evt.location ? [{ html: `📍 ${esc(evt.location)}` }] : []),
              ...(evt.description ? [{ html: esc(evt.description) }] : []),
            ],
          }],
          appUrl: `${appUrl}/calendar`,
          footerNote: 'Edit this reminder from the event in your Calendar.',
        });
        const text = [when, evt.location ? `at ${evt.location}` : '', evt.description ?? ''].filter(Boolean).join('\n');
        const telegram = `${emoji} *${escapeTelegram(evt.title)}* — ${label}\n${escapeTelegram(text)}`;

        const channels = [...(channelsByUser.get(evt.user_id) ?? ['email' as Channel])];
        const out = await notifyUser(p, channels, { subject, html, text, telegram, click: `${appUrl}/calendar`, tags: ['calendar'] });
        if (out.delivered.length) {
          sentFor[key] = true; changed = true; sent++;
        } else {
          failed++;
          console.warn('[calendar-reminder] nothing delivered', evt.id, key, JSON.stringify(out.errors));
        }
      }
    }

    if (changed) {
      // Drop dedupe keys for occurrences long past so the column doesn't grow forever.
      const cutoff = addDaysYmd(today, -14);
      for (const k of Object.keys(sentFor)) if (k.slice(0, 10) < cutoff) delete sentFor[k];
      await sb.from('calendar_events').update({ reminder_sent_for: sentFor }).eq('id', evt.id);
    }
  }
  return json({ ok: true, sent, failed, scanned: rows.length });
});
