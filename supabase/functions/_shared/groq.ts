// _shared/groq.ts — Groq Cloud (OpenAI-compatible) provider.
// Free tier: ~14,400 req/day per model, no monthly cap, ~10x faster than Gemini.
// Docs: https://console.groq.com/docs

import { getSecret } from './util.ts';

const PER_CALL_TIMEOUT_MS = 12_000;
const DEFAULT_PRIMARY = 'llama-3.3-70b-versatile';
const DEFAULT_FAST = 'llama-3.1-8b-instant';

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

// ---------- Chat-page helpers (streaming, for chat/index.ts) ----------

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

const CHAT_TIMEOUT_MS = 60_000;

/** One-shot non-streaming JSON-mode chat. Used for tool-call decisions. */
export async function groqChatJSON(messages: ChatMsg[], opts?: { model?: string; timeoutMs?: number }): Promise<string> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');
  const model = opts?.model || (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
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
        max_tokens: 96,
        response_format: { type: 'json_object' },
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 400);
      throw new Error(`Groq chat ${r.status}: ${detail}`);
    }
    const data = await r.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(t);
  }
}

/** Streaming chat. Yields token deltas (OpenAI SSE format). */
export async function* groqChatStream(
  messages: ChatMsg[],
  opts?: { model?: string; timeoutMs?: number; signal?: AbortSignal },
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
        stream: true,
      }),
      signal: ctl.signal,
    });
    if (!r.ok || !r.body) {
      const detail = r.body ? (await r.text()).slice(0, 400) : '';
      throw new Error(`Groq chat stream ${r.status}: ${detail}`);
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
