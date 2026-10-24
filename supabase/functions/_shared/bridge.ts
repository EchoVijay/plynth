// _shared/bridge.ts — where the Plynth mail/push bridge (running on the owner's machine) can be reached.
// The tunnel URL changes when cloudflared restarts, so tunnel-publish.sh keeps the live one in
// system_kv ('mail_bridge_url'); MAIL_BRIDGE_URL overrides it when a fixed address is configured.

import { admin, getSecret } from './util.ts';

const URL_CACHE_MS = 60_000;
let cached: { url: string | null; at: number } | null = null;

export async function bridgeConfig(): Promise<{ url: string; token: string } | null> {
  const token = await getSecret('MAIL_BRIDGE_TOKEN');
  if (!token) return null;
  let url = await getSecret('MAIL_BRIDGE_URL');
  if (!url) {
    if (!cached || Date.now() - cached.at > URL_CACHE_MS) {
      let found: string | null = null;
      try {
        const { data } = await admin().from('system_kv').select('value').eq('key', 'mail_bridge_url').maybeSingle();
        found = (data?.value as string | undefined) ?? null;
      } catch { /* bridge is optional */ }
      cached = { url: found, at: Date.now() };
    }
    url = cached.url;
  }
  return url ? { url: url.replace(/\/$/, ''), token } : null;
}
