// _shared/ntfy.ts — push notification via ntfy.sh (per-user topic supported)

import { getSecret } from './util.ts';
import { bridgeConfig } from './bridge.ts';

export async function pushNtfyResult(opts: {
  title: string;
  message: string;
  topic?: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent';
  tags?: string[];
  click?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const topic = opts.topic ?? (await getSecret('NTFY_TOPIC'));
  if (!topic) return { ok: false, error: 'no push topic' };
  const headers: Record<string, string> = {
    // HTTP header values must be Latin-1; emoji would make fetch throw, so keep them out of the title (tags carry the icon).
    Title: opts.title.replace(/[^\x20-\xFF]/g, '').replace(/\s+/g, ' ').trim() || 'Plynth',
    Priority: opts.priority ?? 'default',
  };
  if (opts.tags?.length) headers.Tags = opts.tags.join(',');
  if (opts.click) headers.Click = opts.click;
  const base = ((await getSecret('NTFY_BASE_URL')) ?? 'https://ntfy.sh').replace(/\/$/, '');
  const token = await getSecret('NTFY_TOKEN');
  if (token) headers.Authorization = 'Bearer ' + token;

  let direct = '';
  try {
    const r = await fetch(`${base}/${encodeURIComponent(topic)}`, {
      method: 'POST', headers, body: opts.message, signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { ok: true };
    direct = `ntfy ${r.status}`;
  } catch (e) {
    direct = `ntfy unreachable: ${(e as Error).message}`;
  }

  // The public ntfy.sh rate-limits by source IP and Supabase's shared egress IPs often hit it, so
  // retry from the owner's machine through the bridge.
  const cfg = await bridgeConfig();
  if (cfg) {
    try {
      const r = await fetch(cfg.url + '/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
        body: JSON.stringify({ topic, title: opts.title, message: opts.message, priority: opts.priority, tags: opts.tags, click: opts.click }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return { ok: true };
      return { ok: false, error: `${direct}; bridge relay ${r.status}` };
    } catch (e) {
      return { ok: false, error: `${direct}; bridge relay unreachable: ${(e as Error).message}` };
    }
  }
  return { ok: false, error: direct };
}

export async function pushNtfy(opts: Parameters<typeof pushNtfyResult>[0]): Promise<boolean> {
  return (await pushNtfyResult(opts)).ok;
}
