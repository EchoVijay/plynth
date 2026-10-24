// _shared/telegram.ts — Telegram Bot API helpers

import { getSecret } from './util.ts';

const API = 'https://api.telegram.org/bot';

async function botToken(): Promise<string> {
  const t = await getSecret('TELEGRAM_BOT_TOKEN');
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return t;
}

export async function sendTelegramResult(chatId: number | bigint, text: string, opts?: {
  parseMode?: 'Markdown' | 'HTML';
  disablePreview?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const token = await botToken();
  const post = async (parseMode?: string) => {
    const r = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: typeof chatId === 'bigint' ? chatId.toString() : chatId,
        text: text.slice(0, 4000),
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: opts?.disablePreview ?? true,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    return { ok: r.ok, status: r.status, body: r.ok ? '' : (await r.text()).slice(0, 200) };
  };
  try {
    let res = await post(opts?.parseMode ?? 'Markdown');
    // A stray * or _ in a task title makes Telegram reject the whole message; resend it as plain text.
    if (!res.ok && res.status === 400 && /parse entities/i.test(res.body)) res = await post(undefined);
    if (res.ok) return { ok: true };
    const blocked = res.status === 403;
    return { ok: false, error: blocked ? 'telegram: bot was blocked or chat not started' : `telegram ${res.status}: ${res.body}` };
  } catch (e) {
    return { ok: false, error: `telegram unreachable: ${(e as Error).message}` };
  }
}

export async function sendTelegram(chatId: number | bigint, text: string, opts?: {
  parseMode?: 'Markdown' | 'HTML';
  disablePreview?: boolean;
}): Promise<boolean> {
  try {
    return (await sendTelegramResult(chatId, text, opts)).ok;
  } catch {
    return false;
  }
}

export async function setWebhook(url: string): Promise<{ ok: boolean; description?: string }> {
  const token = await botToken();
  const r = await fetch(`${API}${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message'] }),
  });
  return await r.json();
}

export async function getFileUrl(fileId: string): Promise<string | null> {
  const token = await botToken();
  const r = await fetch(`${API}${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const path = data?.result?.file_path;
  if (!path) return null;
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

export async function downloadFile(fileId: string): Promise<{ data: ArrayBuffer; name: string } | null> {
  const url = await getFileUrl(fileId);
  if (!url) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const name = url.split('/').pop() ?? 'file';
  return { data: await r.arrayBuffer(), name };
}

// --- Telegram Update type (subset) ---
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  };
}

export interface ParsedCommand {
  command: string; // without /
  args: string;    // everything after the command
}

export function parseCommand(text: string): ParsedCommand | null {
  const m = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (!m) return null;
  return { command: m[1].toLowerCase(), args: m[2].trim() };
}

export async function setMyCommands(commands: { command: string; description: string }[]): Promise<{ ok: boolean }> {
  const token = await botToken();
  const r = await fetch(`${API}${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  return await r.json();
}
