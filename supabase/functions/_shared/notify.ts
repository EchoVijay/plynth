// _shared/notify.ts — deliver one message to a user over email / push / Telegram and report what
// really happened per channel (so callers can retry, show errors, or fall back).

import { sendMail } from './mail.ts';
import { pushNtfyResult } from './ntfy.ts';
import { sendTelegramResult } from './telegram.ts';

export type Channel = 'email' | 'ntfy' | 'telegram';
export const ALL_CHANNELS: Channel[] = ['email', 'ntfy', 'telegram'];

export interface Recipient {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  ntfy_topic?: string | null;
  telegram_chat_id?: number | string | null;
}

export interface NotifyMessage {
  subject: string;
  html: string;           // email body
  text: string;           // push body (plain, short)
  telegram?: string;      // Markdown; defaults to a bold subject + text
  click?: string;
  tags?: string[];
}

export interface ChannelResult { ok: boolean; error?: string }

export interface NotifyOutcome {
  delivered: Channel[];
  results: Partial<Record<Channel, ChannelResult>>;
  errors: Record<string, string>;
}

export function parseChannels(row: { channels?: string[] | null; channel?: string | null }): Channel[] {
  const fromArray = (row.channels ?? []).filter((c): c is Channel => (ALL_CHANNELS as string[]).includes(c));
  if (fromArray.length) return fromArray;
  switch (row.channel) {
    case 'ntfy': return ['ntfy'];
    case 'telegram': return ['telegram'];
    case 'both': return ['email', 'ntfy'];
    case 'all': return ALL_CHANNELS;
    default: return ['email'];
  }
}

export async function notifyUser(r: Recipient, channels: Channel[], m: NotifyMessage): Promise<NotifyOutcome> {
  const results: Partial<Record<Channel, ChannelResult>> = {};

  await Promise.all(channels.map(async (c) => {
    try {
      if (c === 'email') {
        if (!r.email) { results.email = { ok: false, error: 'no email on your profile' }; return; }
        const res = await sendMail({ to: r.email, subject: m.subject, html: m.html, user_id: r.user_id });
        results.email = { ok: res.ok, error: res.error };
      } else if (c === 'ntfy') {
        if (!r.ntfy_topic) { results.ntfy = { ok: false, error: 'no push topic set' }; return; }
        const res = await pushNtfyResult({
          title: m.subject, message: m.text.slice(0, 280), topic: r.ntfy_topic,
          tags: m.tags ?? ['bell'], click: m.click,
        });
        results.ntfy = res;
      } else if (c === 'telegram') {
        if (!r.telegram_chat_id) { results.telegram = { ok: false, error: 'Telegram is not linked' }; return; }
        results.telegram = await sendTelegramResult(
          Number(r.telegram_chat_id), m.telegram ?? `🔔 *${m.subject}*\n\n${m.text}`,
        );
      }
    } catch (e) {
      results[c] = { ok: false, error: (e as Error).message };
    }
  }));

  const delivered = channels.filter((c) => results[c]?.ok);
  const errors: Record<string, string> = {};
  for (const c of channels) if (!results[c]?.ok) errors[c] = results[c]?.error ?? 'failed';
  return { delivered, results, errors };
}
