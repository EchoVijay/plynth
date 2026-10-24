// send-mail: generic relay for admin tooling. Callable only with the service-role key
// (or the optional SEND_MAIL_TOKEN) — it must never be an open relay.

import { json, corsHeaders } from '../_shared/util.ts';
import { sendMail } from '../_shared/mail.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKeys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SERVICE_ROLE_KEY')].filter(Boolean);
  const adminToken = Deno.env.get('SEND_MAIL_TOKEN');
  const ok = (!!bearer && serviceKeys.includes(bearer)) || (!!adminToken && req.headers.get('X-Admin-Token') === adminToken);
  if (!ok) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.subject || !(body.html || body.text)) return json({ error: 'subject + html|text required' }, 400);
  const result = await sendMail(body);
  return json(result, result.ok ? 200 : 502);
});
