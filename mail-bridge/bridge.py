"""Plynth mail bridge.

A tiny Flask HTTP wrapper that lets the Plynth Supabase Edge Functions reuse the
existing ngrok-remote-manager mailer (Gmail primary + Gmail backup + offline
queue) WITHOUT modifying that project.

- Imports lib.mailer.Mailer / lib.config.load_all read-only.
- Uses a SEPARATE state directory so the existing daemon's offline queue is
  untouched.
- Listens on 127.0.0.1:5556 (different from any port the existing daemon uses).
- Bearer-token auth on every request.
- Exposed publicly via a separate Cloudflare Tunnel (see cloudflared/).

Run as a systemd unit; never edit ngrok-remote-manager.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import threading
from pathlib import Path

from flask import Flask, jsonify, request

# --- Wire in the existing mailer without modifying it ----------------------
NGROK_PROJECT = os.environ.get("NGROK_PROJECT_PATH", "/home/vijay/ngrok-remote-manager")
sys.path.insert(0, NGROK_PROJECT)

from lib.config import load_all  # noqa: E402
from lib.mailer import Mailer     # noqa: E402

# Use a dedicated state dir so we don't share the queue file with the daemon.
STATE_DIR = Path(os.environ.get("PLYNTH_BRIDGE_STATE_DIR", "/home/vijay/plynth/mail-bridge/state"))
STATE_DIR.mkdir(parents=True, exist_ok=True)

# Build a config dict, ensure absolute paths point to our state dir for queueing.
_cfg = load_all()
# Mailer in lib/mailer.py uses a module-level state path; we monkey-patch it
# at runtime ONLY inside this process to redirect the queue file.
import lib.mailer as _ngrok_mailer  # noqa: E402
if hasattr(_ngrok_mailer, "QUEUE_FILE"):
    _ngrok_mailer.QUEUE_FILE = str(STATE_DIR / "email_queue.jsonl")

mailer = Mailer(_cfg)
NOTIFY_DEFAULT = _cfg.get("NOTIFY_EMAIL", "vijay.devops.bot@gmail.com")

BRIDGE_TOKEN = os.environ.get("PLYNTH_BRIDGE_TOKEN", "").strip()
if not BRIDGE_TOKEN:
    print("[plynth-bridge] WARNING: PLYNTH_BRIDGE_TOKEN not set — bridge will refuse all requests")

START_TS = time.time()
log = logging.getLogger("plynth-bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# --- Background flush thread -----------------------------------------------
def _flush_loop() -> None:
    while True:
        try:
            mailer.flush_queue()
            mailer.check_primary_recovery()
        except Exception as e:
            log.warning("flush loop error: %s", e)
        time.sleep(60)

threading.Thread(target=_flush_loop, daemon=True).start()

# --- HTTP API --------------------------------------------------------------
app = Flask(__name__)


def _check_auth() -> bool:
    if not BRIDGE_TOKEN:
        return False
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {BRIDGE_TOKEN}"


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "primary_up": not getattr(mailer, "using_backup", False),
        "queue_size": getattr(mailer, "queue_size", 0),
        "uptime_s": int(time.time() - START_TS),
    })


_send_lock = threading.Lock()


@app.route("/api/mail/send", methods=["POST"])
def send_mail():
    if not _check_auth():
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    subject = (data.get("subject") or "").strip()
    body = data.get("body") or ""
    body_type = data.get("body_type", "plain")
    urgent = bool(data.get("urgent", False))
    to = (data.get("to") or NOTIFY_DEFAULT).strip()

    if not subject or not body:
        return jsonify({"error": "subject and body required"}), 400

    # The existing Mailer.send() sends to NOTIFY_EMAIL by default. Override
    # the recipient just for this call by temporarily swapping the config.
    # Mailer copies NOTIFY_EMAIL into self.notify_email at construction, so that attribute is the one to swap.
    with _send_lock:
        original_to = mailer.notify_email
        try:
            mailer.notify_email = to
            ok = mailer.send(subject=subject, body=body, body_type=body_type, urgent=urgent)
        finally:
            mailer.notify_email = original_to
    return jsonify({
        "success": bool(ok),
        "using_backup": getattr(mailer, "using_backup", False),
        "queue_size": getattr(mailer, "queue_size", 0),
    }), (200 if ok else 502)


@app.route("/api/push", methods=["POST"])
def push():
    """Relay a push to ntfy.sh from this machine's IP.

    ntfy.sh rate-limits by source IP, and Supabase's shared egress IPs often hit it (HTTP 429);
    the edge functions fall back to this endpoint when that happens.
    """
    if not _check_auth():
        return jsonify({"error": "unauthorized"}), 401
    import urllib.error
    import urllib.parse
    import urllib.request

    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or "").strip()
    message = data.get("message") or ""
    if not topic or not message:
        return jsonify({"error": "topic and message required"}), 400

    headers = {"Title": str(data.get("title") or "Plynth").encode("latin-1", "ignore").decode("latin-1")}
    if data.get("priority"):
        headers["Priority"] = str(data["priority"])
    if data.get("tags"):
        headers["Tags"] = ",".join(str(t) for t in data["tags"])
    if data.get("click"):
        headers["Click"] = str(data["click"])
    req = urllib.request.Request(
        "https://ntfy.sh/" + urllib.parse.quote(topic, safe=""),
        data=message.encode("utf-8"), headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return jsonify({"success": 200 <= resp.status < 300, "status": resp.status})
    except urllib.error.HTTPError as e:
        return jsonify({"success": False, "status": e.code}), 502
    except Exception as e:  # network errors
        return jsonify({"success": False, "error": str(e)}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5556")), debug=False)
