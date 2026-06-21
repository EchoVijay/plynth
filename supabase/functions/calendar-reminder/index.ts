// calendar-reminder: Fires per-event email reminders based on reminder_minutes[].
// Run every 5 minutes by pg_cron. Dedup via reminder_sent_for jsonb on the event row.

import { admin, json, corsHeaders } from '../_shared/util.ts';
import { sendMail } from '../_shared/mail.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  const sb = admin();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  // Fetch events with reminders set, happening today or tomorrow
  const { data: events, error } = await sb
    .from('calendar_events')
    .select('id, user_id, title, description, event_date, event_time, category, reminder_minutes, reminder_sent_for')
    .or(`event_date.eq.${todayStr},event_date.eq.${tomorrowStr}`)
    .not('reminder_minutes', 'eq', '{}');

  if (error || !events?.length) return json({ ok: true, processed: 0 });

  let sent = 0;

  for (const evt of events) {
    const reminders: number[] = evt.reminder_minutes ?? [];
    const sentFor: Record<string, boolean> = evt.reminder_sent_for ?? {};

    for (const minutes of reminders) {
      const dedupKey = `${evt.event_date}_${minutes}`;
      if (sentFor[dedupKey]) continue;

      // Calculate fire time
      let fireTime: Date;
      if (evt.event_time) {
        // Event has a specific time — fire at event_time minus N minutes
        const [h, m] = evt.event_time.split(':').map(Number);
        fireTime = new Date(`${evt.event_date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
        fireTime = new Date(fireTime.getTime() - minutes * 60000);
      } else {
        // All-day event — fire at 7:00 AM IST minus offset in days
        const daysOffset = Math.floor(minutes / 1440);
        const eventDate = new Date(`${evt.event_date}T07:00:00+05:30`);
        fireTime = new Date(eventDate.getTime() - daysOffset * 86400000);
      }

      // Check if now is within ±5 min of fire time
      const diff = Math.abs(now.getTime() - fireTime.getTime());
      if (diff > 5 * 60000) continue;

      // Get user email
      const { data: userData } = await sb.auth.admin.getUserById(evt.user_id);
      const email = userData?.user?.email;
      if (!email) continue;

      // Build reminder message
      const timeStr = evt.event_time ? ` at ${evt.event_time.slice(0, 5)}` : ' (all day)';
      const dateStr = new Date(evt.event_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      const reminderLabel = minutes === 0 ? 'now' : minutes < 60 ? `in ${minutes} min` : minutes < 1440 ? `in ${Math.round(minutes / 60)} hr` : `in ${Math.round(minutes / 1440)} day(s)`;

      const categoryEmoji: Record<string, string> = {
        birthday: '🎂', interview: '💼', exam: '📝', emi: '💰', bill: '🧾', period: '🩸', general: '📌',
      };
      const emoji = categoryEmoji[evt.category] ?? '📌';

      const subject = `${emoji} Reminder: ${evt.title} — ${reminderLabel}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:20px">
          <h2 style="margin:0 0 8px">${emoji} ${escapeHtml(evt.title)}</h2>
          <p style="color:#666;margin:0 0 12px">${dateStr}${timeStr}</p>
          ${evt.description ? `<p style="margin:0 0 12px">${escapeHtml(evt.description)}</p>` : ''}
          <p style="color:#999;font-size:12px">Category: ${evt.category} · Reminder: ${reminderLabel}</p>
        </div>
      `;

      await sendMail({ to: email, subject, html, user_id: evt.user_id });

      // Mark as sent
      sentFor[dedupKey] = true;
      await sb.from('calendar_events').update({ reminder_sent_for: sentFor }).eq('id', evt.id);
      sent++;
    }
  }

  return json({ ok: true, processed: sent });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
