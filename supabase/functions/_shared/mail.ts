// _shared/mail.ts — sends mail and records exactly one email_log row per message.
//
// Transports, in order:
//   1. Gmail SMTP (smtp.gmail.com:465, app password) — runs entirely in the cloud, free, reaches any address.
//   2. Resend — its default sender only delivers to the account owner until a domain is verified.
//   3. Home mail bridge (Cloudflare tunnel) — last resort, needs the host machine online.

import { admin, getSecret } from './util.ts';
import { bridgeConfig } from './bridge.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

export interface SendMailInput {
  to?: string;             // optional override; default = MAIL_DEFAULT_TO
  subject: string;
  html?: string;
  text?: string;
  urgent?: boolean;
  user_id?: string;        // for email_log
}

export interface SendMailResult { ok: boolean; channel: string; error?: string }

const BRIDGE_TIMEOUT_MS = 20_000;
const RESEND_TIMEOUT_MS = 15_000;
const GMAIL_TIMEOUT_MS = 25_000;

async function viaGmail(to: string, input: SendMailInput): Promise<SendMailResult> {
  const user = await getSecret('GMAIL_USER');
  const pass = await getSecret('GMAIL_APP_PASSWORD');
  if (!user || !pass) return { ok: false, channel: 'gmail', error: 'gmail smtp not configured' };
  const name = (await getSecret('MAIL_FROM_NAME')) ?? 'Plynth';
  const client = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } },
  });
  try {
    await Promise.race([
      client.send({
        from: `${name} <${user}>`, to,
        subject: input.subject,
        content: input.text ?? 'This message needs an HTML-capable mail client.',
        html: input.html,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), GMAIL_TIMEOUT_MS)),
    ]);
    return { ok: true, channel: 'gmail' };
  } catch (e) {
    return { ok: false, channel: 'gmail', error: `gmail smtp: ${(e as Error).message}` };
  } finally {
    try { await client.close(); } catch { /* already closed */ }
  }
}

async function viaBridge(to: string, input: SendMailInput): Promise<SendMailResult> {
  const cfg = await bridgeConfig();
  if (!cfg) return { ok: false, channel: 'bridge', error: 'mail bridge not configured' };
  try {
    const r = await fetch(cfg.url + '/api/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({
        to, subject: input.subject,
        body: input.html ?? input.text ?? '',
        body_type: input.html ? 'html' : 'plain',
        urgent: !!input.urgent,
      }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (r.ok) return { ok: true, channel: 'bridge' };
    return { ok: false, channel: 'bridge', error: `bridge ${r.status}: ${(await r.text()).slice(0, 160)}` };
  } catch (e) {
    return { ok: false, channel: 'bridge', error: `bridge unreachable: ${(e as Error).message}` };
  }
}

async function viaResend(to: string, input: SendMailInput): Promise<SendMailResult> {
  const key = await getSecret('RESEND_API_KEY');
  if (!key) return { ok: false, channel: 'resend', error: 'resend not configured' };
  const from = (await getSecret('RESEND_FROM')) ?? 'Plynth <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ from, to: [to], subject: input.subject, html: input.html, text: input.text }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (r.ok) return { ok: true, channel: 'resend' };
    const body = await r.text();
    const sandbox = /only send testing emails to your own email address/i.test(body);
    return {
      ok: false, channel: 'resend',
      error: sandbox
        ? `Resend sandbox only delivers to its owner; ${to} needs the mail bridge or a verified Resend domain`
        : `resend ${r.status}: ${body.slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, channel: 'resend', error: `resend unreachable: ${(e as Error).message}` };
  }
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = input.to ?? (await getSecret('MAIL_DEFAULT_TO')) ?? 'vijay.devops.bot@gmail.com';

  const errors: string[] = [];
  let result: SendMailResult | null = null;
  for (const transport of [viaGmail, viaResend, viaBridge]) {
    const r = await transport(to, input);
    if (r.ok) { result = r; break; }
    if (r.error) errors.push(r.error);
  }
  if (!result) result = { ok: false, channel: 'none', error: errors.join(' | ') };

  try {
    await admin().from('email_log').insert({
      user_id: input.user_id ?? null,
      to_addr: to,
      subject: input.subject,
      channel_used: result.ok ? result.channel : 'none',
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    });
  } catch (e) {
    console.warn('[mail] email_log insert failed', (e as Error).message);
  }
  return result;
}
