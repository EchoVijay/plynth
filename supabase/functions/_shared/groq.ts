// _shared/groq.ts — Groq Cloud (OpenAI-compatible) provider.
// Free tier: generous per-day request limits, ~10x faster than Gemini.
// Docs: https://console.groq.com/docs

import { getSecret } from './util.ts';

const PER_CALL_TIMEOUT_MS = 12_000;
// Groq retired the Llama 3.x ids; override with GROQ_MODEL_PRIMARY / GROQ_MODEL_FAST if they change again.
const DEFAULT_PRIMARY = 'openai/gpt-oss-120b';
const DEFAULT_FAST = 'openai/gpt-oss-20b';

export class RateLimitError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} rate-limited: ${detail}`);
    this.name = 'RateLimitError';
  }
}

async function callGroq(model: string, key: string, body: unknown): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PER_CALL_TIMEOUT_MS);
  try {
    return await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function chat(model: string, messages: unknown[], asJson: boolean): Promise<string> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
  };
  if (asJson) body.response_format = { type: 'json_object' };
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

  const r = await callGroq(model, key, body);
  if (r.status === 429) {
    const detail = (await r.text()).slice(0, 200);
    throw new RateLimitError('groq', `${model} ${detail}`);
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 400);
    throw new Error(`Groq ${model} → ${r.status}: ${detail}`);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text || text.trim() === '' || text.trim() === '{}') {
    throw new Error(`Groq ${model} returned empty payload`);
  }
  return text;
}

export async function groqJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const model = (await getSecret('GROQ_MODEL_PRIMARY')) || DEFAULT_PRIMARY;
  const messages = [
    {
      role: 'system',
      content: 'You are a precise JSON generator. Output ONLY valid JSON. No markdown, no commentary.',
    },
    {
      role: 'user',
      content: `${prompt}\n\nReturn ONLY a non-empty JSON object matching this shape:\n${schemaHint}`,
    },
  ];
  const text = await chat(model, messages, true);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Groq ${model} invalid JSON: ${(e as Error).message} :: ${text.slice(0, 200)}`);
  }
}

export async function groqText(prompt: string, system?: string): Promise<string> {
  const model = (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
  const messages = [
    { role: 'system', content: system || 'You are a helpful assistant for Plynth users.' },
    { role: 'user', content: prompt },
  ];
  return await chat(model, messages, false);
}

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export async function groqVision<T>(prompt: string, imageBase64: string, mimeType: string, schemaHint: string): Promise<T> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const messages = [
    {
      role: 'system',
      content: 'You are a precise JSON generator. Output ONLY valid JSON. No markdown, no commentary.',
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: `${prompt}\n\nReturn ONLY a non-empty JSON object matching this shape:\n${schemaHint}` },
      ],
    },
  ];

  const r = await callGroq(VISION_MODEL, key, {
    model: VISION_MODEL,
    messages,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  if (r.status === 429) {
    const detail = (await r.text()).slice(0, 200);
    throw new RateLimitError('groq', `${VISION_MODEL} ${detail}`);
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 400);
    throw new Error(`Groq vision ${VISION_MODEL} → ${r.status}: ${detail}`);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text || text.trim() === '' || text.trim() === '{}') {
    throw new Error(`Groq vision returned empty payload`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Groq vision invalid JSON: ${(e as Error).message} :: ${text.slice(0, 200)}`);
  }
}

// ---------- Chat-page helpers (streaming, for chat/index.ts) ----------

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

const CHAT_TIMEOUT_MS = 60_000;

/** One-shot non-streaming JSON-mode chat. Used for tool-call decisions. */
export async function groqChatJSON(messages: ChatMsg[], opts?: { model?: string; timeoutMs?: number }): Promise<string> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');
  const model = opts?.model || (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
  // Reasoning models (gpt-oss) spend tokens thinking, so a tiny max_tokens would truncate the answer.
  const reasoning = model.startsWith('openai/gpt-oss');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? CHAT_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: reasoning ? 512 : 96,
        ...(reasoning ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 1200);
      // gpt-oss sometimes answers a tool-routing prompt with a native tool call or plain prose, which Groq rejects.
      // Recover the intended decision (see recoverToolCall) instead of failing the whole chat turn.
      const recovered = recoverToolCall(detail);
      if (recovered) return recovered;
      throw new Error(`Groq chat ${r.status}: ${detail.slice(0, 400)}`);
    }
    const data = await r.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(t);
  }
}

function recoverToolCall(errorBody: string): string | null {
  try {
    const err = JSON.parse(errorBody)?.error;
    // A prose answer instead of JSON means the model has nothing more to look up.
    if (err?.code === 'json_validate_failed') return JSON.stringify({ action: 'final' });
    if (err?.code !== 'tool_use_failed' || typeof err.failed_generation !== 'string') return null;
    const call = JSON.parse(err.failed_generation);
    if (typeof call?.name !== 'string') return null;
    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments ?? {});
    return JSON.stringify({ action: 'tool', tool: call.name, args });
  } catch {
    return null;
  }
}

/** Streaming chat. Yields token deltas (OpenAI SSE format). */
export interface GroqRateLimit {
  remainingRequests?: number;
  limitRequests?: number;
  remainingTokens?: number;
  limitTokens?: number;
}

export async function* groqChatStream(
  messages: ChatMsg[],
  opts?: { model?: string; timeoutMs?: number; signal?: AbortSignal; rateLimit?: GroqRateLimit },
): AsyncGenerator<string, void, unknown> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');
  const model = opts?.model || (await getSecret('GROQ_MODEL_PRIMARY')) || DEFAULT_PRIMARY;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? CHAT_TIMEOUT_MS);
  if (opts?.signal) {
    if (opts.signal.aborted) ctl.abort();
    else opts.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 1536,
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        stream: true,
      }),
      signal: ctl.signal,
    });
    if (!r.ok || !r.body) {
      const detail = r.body ? (await r.text()).slice(0, 400) : '';
      throw new Error(`Groq chat stream ${r.status}: ${detail}`);
    }
    // Capture rate-limit headers
    if (opts?.rateLimit) {
      opts.rateLimit.remainingRequests = Number(r.headers.get('x-ratelimit-remaining-requests')) || undefined;
      opts.rateLimit.limitRequests = Number(r.headers.get('x-ratelimit-limit-requests')) || undefined;
      opts.rateLimit.remainingTokens = Number(r.headers.get('x-ratelimit-remaining-tokens')) || undefined;
      opts.rateLimit.limitTokens = Number(r.headers.get('x-ratelimit-limit-tokens')) || undefined;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line === 'data: [DONE]') continue;
        if (!line.startsWith('data: ')) continue;
        try {
          const obj = JSON.parse(line.slice(6));
          const delta: string = obj?.choices?.[0]?.delta?.content ?? '';
          if (delta) yield delta;
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    clearTimeout(t);
  }
}

// ---- Resilient variants: if one model is rate-limited (free-tier TPM caps are small) or erroring, try the other ----

async function otherModel(used: string): Promise<string> {
  const primary = (await getSecret('GROQ_MODEL_PRIMARY')) || DEFAULT_PRIMARY;
  const fast = (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
  return used === primary ? fast : primary;
}

export async function groqChatJSONResilient(messages: ChatMsg[], opts?: { timeoutMs?: number }): Promise<string> {
  const first = (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
  try {
    return await groqChatJSON(messages, { ...opts, model: first });
  } catch (e) {
    const second = await otherModel(first);
    if (second === first) throw e;
    console.warn('[groq] decision turn failed on', first, '- retrying on', second, (e as Error).message.slice(0, 120));
    return await groqChatJSON(messages, { ...opts, model: second });
  }
}

export async function* groqChatStreamResilient(
  messages: ChatMsg[],
  opts?: { timeoutMs?: number; signal?: AbortSignal; rateLimit?: GroqRateLimit },
): AsyncGenerator<string, void, unknown> {
  const first = (await getSecret('GROQ_MODEL_PRIMARY')) || DEFAULT_PRIMARY;
  let yielded = false;
  try {
    for await (const d of groqChatStream(messages, { ...opts, model: first })) { yielded = true; yield d; }
  } catch (e) {
    // Only retry when nothing has reached the user yet.
    const second = await otherModel(first);
    if (yielded || second === first || opts?.signal?.aborted) throw e;
    console.warn('[groq] stream failed on', first, '- retrying on', second, (e as Error).message.slice(0, 120));
    for await (const d of groqChatStream(messages, { ...opts, model: second })) yield d;
  }
}
