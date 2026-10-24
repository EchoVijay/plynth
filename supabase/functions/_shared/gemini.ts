// _shared/gemini.ts — minimal Gemini REST client with bounded retry + model fallback.
// Bounded so the total wall-clock stays under the Supabase JS invoke timeout (~60s).

import { admin, getSecret } from './util.ts';

// Display-only ceiling (Gemini Flash free tier is ~1500 req/day).
const GEMINI_MONTHLY_DISPLAY_LIMIT = 10000;
// Hard timeout per HTTP call to Gemini; prevents hanging the edge function.
const PER_CALL_TIMEOUT_MS = 12_000;
// Hard cap on total wall-clock spent retrying across all models.
const TOTAL_BUDGET_MS = 25_000;

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

export interface GeminiOptions {
  /** Per-call timeout for long structured outputs; the retry budget scales with it. */
  timeoutMs?: number;
}

async function callOnce(model: string, key: string, body: unknown, timeoutMs = PER_CALL_TIMEOUT_MS): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function bumpUsage() {
  try {
    const sb = admin();
    await sb.rpc('api_usage_bump', { p_api_name: 'gemini', p_limit: GEMINI_MONTHLY_DISPLAY_LIMIT });
  } catch (e) {
    console.warn('[gemini] usage bump failed', String(e));
  }
}

export async function geminiJSON<T>(prompt: string, schemaHint: string, opts?: GeminiOptions): Promise<T> {
  const key = await getSecret('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const startedAt = Date.now();
  const callTimeout = opts?.timeoutMs ?? PER_CALL_TIMEOUT_MS;
  const totalBudget = opts?.timeoutMs ? Math.max(TOTAL_BUDGET_MS, opts.timeoutMs * 2) : TOTAL_BUDGET_MS;

  const body = {
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nReturn ONLY valid JSON matching this shape:\n${schemaHint}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  };

  let lastErr = '';
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - startedAt > totalBudget) {
        throw new Error(`Gemini gave up after ${totalBudget / 1000}s. ${lastErr || ''}`.trim());
      }
      let r: Response;
      try {
        r = await callOnce(model, key, body, callTimeout);
      } catch (e) {
        lastErr = `${model} fetch aborted/failed: ${(e as Error).message}`;
        console.warn('[gemini]', lastErr);
        break; // switch model
      }
      if (r.ok) {
        await bumpUsage();
        const data = await r.json();
        const cand = data?.candidates?.[0];
        const text = cand?.content?.parts?.[0]?.text ?? '';
        const finishReason = cand?.finishReason;
        const promptFeedback = data?.promptFeedback;

        const empty = !text || text.trim() === '' || text.trim() === '{}';
        if (empty) {
          console.warn('[gemini] empty payload', JSON.stringify({ model, attempt, finishReason, promptFeedback }));
          if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'BLOCKLIST') {
            lastErr = `${model} blocked: ${finishReason}`;
            break; // switch model immediately
          }
          if (attempt === 0) {
            (body as any).contents[0].parts[0].text =
              `${prompt}\n\nReturn ONLY a non-empty JSON object matching this shape (do NOT return {}):\n${schemaHint}`;
            continue;
          }
          lastErr = `${model} returned empty payload (finishReason=${finishReason})`;
          break;
        }
        try {
          return JSON.parse(text) as T;
        } catch (e) {
          console.warn('[gemini] JSON parse failed', JSON.stringify({ model, attempt, snippet: text.slice(0, 200) }));
          lastErr = `${model} invalid JSON: ${(e as Error).message}`;
          if (attempt === 0) continue;
          break;
        }
      }
      const errBody = (await r.text()).slice(0, 400);
      lastErr = `${model} → ${r.status}: ${errBody}`;
      console.warn('[gemini] http error', JSON.stringify({ model, attempt, status: r.status }));
      // 429 with "exceeded your current quota" = hard daily/project quota; retrying won't help.
      // Per-minute 429 ("rate") is recoverable. We treat *all* 429 as fast-fail across models since
      // the same API key is used for every model, and propagate a clear message.
      if (r.status === 429) {
        throw new Error(`Gemini quota exceeded (HTTP 429). Wait a minute and retry, or check your Google AI Studio quota. Detail: ${errBody.slice(0, 200)}`);
      }
      if (r.status !== 503) break; // only retry on overload
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  throw new Error(`Gemini failed after retries: ${lastErr}`);
}

export async function geminiVision<T>(prompt: string, imageBase64: string, mimeType: string, schemaHint: string): Promise<T> {
  const key = await getSecret('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const startedAt = Date.now();

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: `${prompt}\n\nReturn ONLY valid JSON matching this shape:\n${schemaHint}` },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  };

  let lastErr = '';
  for (const model of MODELS) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      throw new Error(`Gemini vision gave up after ${TOTAL_BUDGET_MS / 1000}s. ${lastErr}`.trim());
    }
    let r: Response;
    try {
      r = await callOnce(model, key, body);
    } catch (e) {
      lastErr = `${model} vision fetch failed: ${(e as Error).message}`;
      console.warn('[gemini]', lastErr);
      continue;
    }
    if (r.ok) {
      await bumpUsage();
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!text || text.trim() === '' || text.trim() === '{}') {
        lastErr = `${model} vision returned empty`;
        console.warn('[gemini]', lastErr);
        continue;
      }
      try {
        return JSON.parse(text) as T;
      } catch (e) {
        lastErr = `${model} vision invalid JSON: ${text.slice(0, 200)}`;
        console.warn('[gemini]', lastErr);
        continue;
      }
    }
    const errBody = (await r.text()).slice(0, 400);
    lastErr = `${model} vision → ${r.status}: ${errBody}`;
    console.warn('[gemini]', lastErr);
    if (r.status === 429) {
      throw new Error(`Gemini quota exceeded (HTTP 429). ${errBody.slice(0, 200)}`);
    }
  }
  throw new Error(`Gemini vision failed: ${lastErr}`);
}
