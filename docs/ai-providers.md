# AI Providers — Plynth

Plynth's server-side AI calls go through a single dispatcher in
[supabase/functions/_shared/ai-provider.ts](../supabase/functions/_shared/ai-provider.ts).
Switch providers by setting Supabase secrets — no code change at call sites.

## Default chain (no quota)

```bash
supabase secrets set AI_PROVIDER=chain
supabase secrets set AI_PROVIDER_CHAIN=groq,ollama
```

The dispatcher tries providers in order. On rate-limit / network / timeout it
advances to the next. Auth or programming errors bubble immediately.

| Position | Provider | Why |
| --- | --- | --- |
| 1 | **Groq Cloud** | Free with generous daily limits (but a small per-minute token cap, e.g. 8k TPM on `gpt-oss-20b`), ~10× faster than Gemini. OpenAI-compatible. Runs `openai/gpt-oss-120b` (primary) and `openai/gpt-oss-20b` (fast). Groq retired the Llama 3.x ids, so check `GET https://api.groq.com/openai/v1/models` if you see `model_not_found`. |
| 2 | **Self-hosted Ollama** | Truly unlimited; runs on your box via Cloudflare tunnel. CPU inference with `llama3.1:8b` (~8 GB RAM). |
| opt-in | **Gemini** | Original; kept for A/B (`AI_PROVIDER=gemini`). Free tier is only ~20 requests/day per model (it is still the only provider that can read PDFs and photos) and has a SAFETY filter that occasionally blocks benign topics like "OpenBMC" — that's why it's no longer the default. |

## Setup

### 1. Groq (mandatory for primary)

1. Create a free key at https://console.groq.com/keys
2. `supabase secrets set GROQ_API_KEY=<key>`
3. (optional) `supabase secrets set GROQ_MODEL_PRIMARY=openai/gpt-oss-120b GROQ_MODEL_FAST=openai/gpt-oss-20b`

### 2. Ollama fallback (optional but recommended)

```bash
bash scripts/install-ollama-bridge.sh
# prints the public URL — paste into:
supabase secrets set OLLAMA_BASE_URL='https://<sub>.trycloudflare.com'
supabase secrets set OLLAMA_MODEL='llama3.1:8b'
supabase secrets set OLLAMA_SHARED_SECRET='<choose-strong-token>'
```

Without `OLLAMA_BASE_URL` the chain skips Ollama and surfaces the Groq error.

## Adding a new provider

1. Add `_shared/<name>.ts` exporting `<name>JSON<T>(prompt, schemaHint)` and
   `<name>Text(prompt, system?)`. Throw `RateLimitError` (from
   `_shared/groq.ts`) on 429 so the chain can advance.
2. Add a `case` in `tryJSON` and `tryText` inside
   [`_shared/ai-provider.ts`](../supabase/functions/_shared/ai-provider.ts).
3. Add the provider name to `AI_PROVIDER_CHAIN`.

## API surface for callers

```ts
import { aiJSON, aiText } from '../_shared/ai-provider.ts';

const plan = await aiJSON<{ items: Item[] }>(prompt, schemaHint);
const advice = await aiText('Suggest 3 ETFs for monthly SIP of 10k', 'You are a frugal Indian investor.');
```

## Use-cases inside Plynth

| Surface | Method | Notes |
| --- | --- | --- |
| Learning plans (per-topic + daily allocation) | `aiJSON` | live |
| Job-search optimization (resume → JD match) | `aiText` | planned |
| Finance advice chatbot | `aiText` | planned |
| Topic research (C, C++, OpenBMC, Linux) | `aiJSON` | live; open-source models avoid Gemini's SAFETY blocks |
