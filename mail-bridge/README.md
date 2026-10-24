# Plynth Mail Bridge

A tiny Flask HTTP relay that lets the cloud Supabase Edge Functions reuse the
**existing ngrok-remote-manager** Gmail mailer (primary + backup failover +
offline queue + ntfy alerts) WITHOUT touching that project.

## Why this exists

Supabase Edge Functions run in the cloud — they cannot reach `127.0.0.1`.
This bridge sits next to ngrok-remote-manager, imports its `lib/mailer.py`
read-only, and exposes a single HTTPS endpoint via a Cloudflare Tunnel that
the Edge Functions can call.

If the bridge or your laptop is offline, the Edge Function falls back to
**Resend** automatically (see `supabase/functions/_shared/mail.ts`).

## Non-disruption guarantees

- Imports ngrok-remote-manager via `sys.path` — never edits a single file there
- Uses a **separate state directory** (`mail-bridge/state/`) so the offline
  queue is independent from the existing daemon's queue
- Listens on a **different port** (5556) — no conflict with the daemon
- Runs as a **separate systemd unit** (`plynth-mail-bridge.service`)
- A **separate Cloudflare Tunnel** exposes only port 5556

## Setup

```bash
cd /home/vijay/plynth/mail-bridge
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env
# generate a token:
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
# paste it into .env as PLYNTH_BRIDGE_TOKEN

# Smoke test:
PLYNTH_BRIDGE_TOKEN=$(grep PLYNTH_BRIDGE_TOKEN .env | cut -d= -f2) \
  .venv/bin/python bridge.py &
curl -s http://127.0.0.1:5556/api/health | jq .
curl -s -X POST http://127.0.0.1:5556/api/mail/send \
  -H "Authorization: Bearer $PLYNTH_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Plynth bridge test","body":"<h1>It works</h1>","body_type":"html"}'
```

## Install as a systemd service

```bash
sudo cp systemd/plynth-mail-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plynth-mail-bridge
sudo systemctl status plynth-mail-bridge
```

## Expose publicly with Cloudflare Tunnel

See `cloudflared/config.yml.example`. The simplest path (no domain needed):

```bash
cloudflared tunnel --url http://127.0.0.1:5556
# Copy the printed *.trycloudflare.com URL into Supabase secret MAIL_BRIDGE_URL.
```

For a stable hostname, follow the named-tunnel steps in the example file.

## Required Supabase secrets

```bash
supabase secrets set MAIL_BRIDGE_URL=https://plynth-mail.example.com
supabase secrets set MAIL_BRIDGE_TOKEN=<same as PLYNTH_BRIDGE_TOKEN>
supabase secrets set RESEND_API_KEY=<resend key>            # fallback
supabase secrets set RESEND_FROM='Plynth <onboarding@resend.dev>'
supabase secrets set MAIL_DEFAULT_TO=vijay.devops.bot@gmail.com
supabase secrets set NTFY_TOPIC=vijay-devbot-7k9x
supabase secrets set GEMINI_API_KEY=<gemini key>
```

## Verifying non-disruption

```bash
ls -lh /home/vijay/ngrok-remote-manager/state/email_queue.jsonl
# Should NOT grow when Plynth bridge sends mail.
ls -lh /home/vijay/plynth/mail-bridge/state/email_queue.jsonl
# This is the bridge's separate queue.
```

> **The bridge is now a fallback only.** Primary mail delivery is Gmail SMTP straight from Supabase
> (`GMAIL_USER` / `GMAIL_APP_PASSWORD` secrets, see `docs/deploy.md`), so mail works with the laptop off.
> The bridge is still used for ntfy push relay (ntfy.sh throttles Supabase IPs) and as a last-resort mail path.

## Always-on tunnel (systemd)

Supabase edge functions reach the bridge through a Cloudflare quick tunnel. The URL changes on every
restart, so `tunnel-publish.sh` starts the tunnel, checks `/api/health`, and publishes the URL to the
`system_kv` table (`mail_bridge_url`). Edge functions read it from there (or from the `MAIL_BRIDGE_URL`
secret if set).

```bash
# env file (mode 600): PROJECT_URL=https://<ref>.supabase.co  and  SERVICE_ROLE_KEY=<service role key>
$EDITOR ~/.config/plynth-mail-tunnel.env && chmod 600 ~/.config/plynth-mail-tunnel.env
sudo cp mail-bridge/systemd/plynth-mail-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now plynth-mail-tunnel
supabase secrets set MAIL_BRIDGE_TOKEN=<same token as the bridge .env>
```

The bridge also exposes `/api/push`, which relays ntfy.sh pushes from a home IP (ntfy.sh rate-limits
Supabase's shared egress IPs). Resend's sandbox sender only delivers to the Resend account owner, so it
is only a fallback; add a verified domain to `RESEND_FROM` to make it a real second transport.
