#!/usr/bin/env bash
# tunnel-publish.sh — expose the local mail bridge through a Cloudflare quick tunnel and publish the
# live URL to Supabase (public.system_kv, key 'mail_bridge_url') so the cloud edge functions can find it.
# Quick-tunnel URLs change on every restart; this re-publishes after each one. If the machine or the
# tunnel is down, the functions fall back to Resend automatically (see supabase/functions/_shared/mail.ts).
#
# Needs in the environment (see mail-bridge/README.md):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   [optional: BRIDGE_PORT=5556, TUNNEL_LOG=/tmp/plynth-mail-tunnel.log]

set -u
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
PORT="${BRIDGE_PORT:-5556}"
LOG="${TUNNEL_LOG:-/tmp/plynth-mail-tunnel.log}"
: > "$LOG"

publish() {
  local url="$1" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${SUPABASE_URL}/rest/v1/system_kv?on_conflict=key" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
    --data "$(printf '{"key":"mail_bridge_url","value":"%s","updated_at":"%s"}' "$url" "$(date -u +%FT%TZ)")")
  echo "[mail-tunnel] published $url -> HTTP $code" >&2
  [[ "$code" =~ ^2 ]]
}

cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" --logfile "$LOG" >/dev/null 2>&1 &
CF=$!
trap 'kill "$CF" 2>/dev/null' EXIT

LAST=""
while kill -0 "$CF" 2>/dev/null; do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
  if [[ -n "$url" && "$url" != "$LAST" ]]; then
    # A fresh quick tunnel needs a few seconds before it answers; only publish a URL that works.
    if curl -fsS -m 8 "${url}/api/health" >/dev/null 2>&1 && publish "$url"; then LAST="$url"; fi
  fi
  sleep 5
done
echo "[mail-tunnel] cloudflared exited; letting systemd restart" >&2
exit 1
