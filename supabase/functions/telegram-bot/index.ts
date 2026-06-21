// telegram-bot: Webhook handler for Plynth Telegram Bot.
// Receives updates from Telegram, routes commands, and interacts with DB.

import { admin, json, corsHeaders, getSecret } from '../_shared/util.ts';
import { sendTelegram, parseCommand, downloadFile, setWebhook, type TelegramUpdate } from '../_shared/telegram.ts';

// ---------- Helpers ----------

function reply(chatId: number, text: string) {
  return sendTelegram(chatId, text);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse relative dates: "tomorrow", "today", "next monday", or ISO date
function parseDate(input: string): string | null {
  const lower = input.toLowerCase().trim();
  const now = new Date();
  if (!lower || lower === 'today') return today();
  if (lower === 'tomorrow') {
    now.setDate(now.getDate() + 1);
    return now.toISOString().slice(0, 10);
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const nextMatch = lower.match(/^next\s+(\w+)$/);
  if (nextMatch) {
    const dayIdx = days.indexOf(nextMatch[1]);
    if (dayIdx >= 0) {
      const diff = ((dayIdx - now.getDay()) + 7) % 7 || 7;
      now.setDate(now.getDate() + diff);
      return now.toISOString().slice(0, 10);
    }
  }
  // Try ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;
  // Try dd/mm or dd-mm
  const dm = lower.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : String(now.getFullYear());
    return `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  }
  return null;
}

// ---------- Command Handlers ----------

async function handleLink(sb: ReturnType<typeof admin>, chatId: number, args: string): Promise<string> {
  const code = args.trim().toUpperCase();
  if (!code || code.length < 4) return '❌ Usage: `/link CODE`\nGet the code from Plynth Settings → Telegram.';

  // Look up the code in system_kv (key: tg_link_<code>)
  const key = `tg_link_${code}`;
  const { data } = await sb.from('system_kv').select('value,updated_at').eq('key', key).maybeSingle();
  if (!data) return '❌ Invalid or expired code. Generate a new one from Settings.';

  // Check expiry (5 min)
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > 5 * 60 * 1000) {
    await sb.from('system_kv').delete().eq('key', key);
    return '❌ Code expired. Generate a new one from Settings.';
  }

  const userId = data.value;
  // Store chat_id on profile
  const { error } = await sb.from('profiles').update({ telegram_chat_id: chatId }).eq('user_id', userId);
  if (error) return `❌ Link failed: ${error.message}`;

  // Clean up the code
  await sb.from('system_kv').delete().eq('key', key);
  return '✅ Account linked! You can now use all bot commands and receive notifications here.';
}

async function handleUnlink(sb: ReturnType<typeof admin>, chatId: number): Promise<string> {
  const { error } = await sb.from('profiles').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId);
  if (error) return `❌ ${error.message}`;
  return '✅ Account unlinked. You won\'t receive notifications here anymore.';
}

async function handleTask(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/task Buy groceries tomorrow high`';
  // Parse: last word might be priority, second-to-last might be date
  const parts = args.split(/\s+/);
  const priorities = ['low', 'medium', 'high', 'urgent'];
  let priority = 'medium';
  let dueDate: string | null = today();
  let titleParts = [...parts];

  // Check if last word is a priority
  if (priorities.includes(parts[parts.length - 1]?.toLowerCase())) {
    priority = parts.pop()!.toLowerCase();
    titleParts = [...parts];
  }

  // Check if last remaining word is a date-like token
  if (parts.length > 1) {
    const maybeDateStr = parts[parts.length - 1];
    const parsed = parseDate(maybeDateStr);
    if (parsed && maybeDateStr.toLowerCase() !== parts.slice(0, -1).join(' ').toLowerCase()) {
      dueDate = parsed;
      titleParts = parts.slice(0, -1);
    }
  }

  const title = titleParts.join(' ');
  if (!title) return '❌ Could not parse task title.';

  const { error } = await sb.from('tasks').insert({
    user_id: userId, title, due_date: dueDate, priority, status: 'pending',
  });
  if (error) return `❌ ${error.message}`;
  return `✅ Task created: *${title}*\n📅 ${dueDate} · ${priority}`;
}

async function handlePeriod(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  const action = args.toLowerCase().trim();
  if (action === 'start') {
    const { error } = await sb.from('period_logs').insert({
      user_id: userId, log_date: today(), flow_intensity: 'medium',
    });
    if (error?.code === '23505') return '📌 Already logged for today.';
    if (error) return `❌ ${error.message}`;
    return `✅ Period started — logged for ${today()}.`;
  }
  if (action === 'end') {
    // Mark today as the last day (light flow)
    const { error } = await sb.from('period_logs').insert({
      user_id: userId, log_date: today(), flow_intensity: 'light',
      notes: 'Period end marked via Telegram',
    });
    if (error?.code === '23505') return '📌 Already logged for today.';
    if (error) return `❌ ${error.message}`;
    return `✅ Period end logged for ${today()}.`;
  }
  return '❌ Usage: `/period start` or `/period end`';
}

async function handleBookmark(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/bookmark https://example.com Optional title`';
  const parts = args.split(/\s+/);
  const url = parts[0];
  if (!url.startsWith('http')) return '❌ First argument must be a URL.';
  const title = parts.slice(1).join(' ') || new URL(url).hostname;

  // Auto-detect category from URL
  let category = 'website';
  if (url.includes('github.com')) category = 'github';
  else if (url.includes('youtube.com') || url.includes('youtu.be')) category = 'video';
  else if (/twitter\.com|x\.com|instagram\.com|linkedin\.com/.test(url)) category = 'social';

  const { error } = await sb.from('bookmarks').insert({ user_id: userId, title, url, category });
  if (error) return `❌ ${error.message}`;
  return `✅ Bookmark saved: [${title}](${url}) (${category})`;
}

async function handleEvent(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/event 2026-06-25 14:00 Meeting title`';
  const parts = args.split(/\s+/);
  const eventDate = parseDate(parts[0]);
  if (!eventDate) return '❌ Could not parse date. Use YYYY-MM-DD or "tomorrow".';

  let eventTime: string | null = null;
  let titleStart = 1;
  // Check if second part is a time (HH:MM)
  if (parts[1] && /^\d{1,2}:\d{2}$/.test(parts[1])) {
    eventTime = parts[1].padStart(5, '0') + ':00';
    titleStart = 2;
  }

  const title = parts.slice(titleStart).join(' ');
  if (!title) return '❌ Event title is required.';

  const { error } = await sb.from('calendar_events').insert({
    user_id: userId, title, event_date: eventDate, event_time: eventTime, category: 'general',
  });
  if (error) return `❌ ${error.message}`;
  return `✅ Event created: *${title}*\n📅 ${eventDate}${eventTime ? ' at ' + eventTime.slice(0, 5) : ''}`;
}

async function handleToday(sb: ReturnType<typeof admin>, userId: string): Promise<string> {
  const d = today();
  const lines: string[] = ['📋 *Today\'s Summary*\n'];

  // Tasks
  const { data: tasks } = await sb.from('tasks').select('title,priority,status')
    .eq('user_id', userId).eq('due_date', d).neq('status', 'completed').neq('status', 'cancelled');
  if (tasks?.length) {
    lines.push('*Tasks:*');
    for (const t of tasks) lines.push(`  • ${t.title} (${t.priority})`);
    lines.push('');
  }

  // Learning
  const { data: plans } = await sb.from('learning_plans').select('title,status,estimated_minutes')
    .eq('user_id', userId).eq('date', d).neq('status', 'completed');
  if (plans?.length) {
    lines.push('*Learning:*');
    for (const p of plans) lines.push(`  • ${p.title} (${p.estimated_minutes}m)`);
    lines.push('');
  }

  // Calendar events
  const { data: events } = await sb.from('calendar_events').select('title,event_time,category')
    .eq('user_id', userId).eq('event_date', d);
  if (events?.length) {
    lines.push('*Events:*');
    for (const e of events) lines.push(`  • ${e.title}${e.event_time ? ' at ' + e.event_time.slice(0, 5) : ''}`);
    lines.push('');
  }

  // EMI due
  const day = new Date().getDate();
  const { data: loans } = await sb.from('loans').select('name,emi_amount,emi_due_day')
    .eq('user_id', userId).eq('status', 'active').eq('emi_due_day', day);
  if (loans?.length) {
    lines.push('*EMI Due Today:*');
    for (const l of loans) lines.push(`  • ${l.name}: ₹${l.emi_amount}`);
    lines.push('');
  }

  if (lines.length === 1) lines.push('Nothing scheduled — enjoy your day! 🎉');
  return lines.join('\n');
}

async function handleDoc(sb: ReturnType<typeof admin>, userId: string, update: TelegramUpdate): Promise<string> {
  const msg = update.message!;
  const doc = msg.document;
  const photo = msg.photo;

  let fileId: string;
  let fileName: string;
  let mimeType = 'application/octet-stream';

  if (doc) {
    fileId = doc.file_id;
    fileName = doc.file_name ?? `doc_${Date.now()}`;
    mimeType = doc.mime_type ?? mimeType;
  } else if (photo?.length) {
    // Take highest resolution
    const best = photo[photo.length - 1];
    fileId = best.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    mimeType = 'image/jpeg';
  } else {
    return '❌ No file detected. Send a document or photo.';
  }

  // Download from Telegram
  const file = await downloadFile(fileId);
  if (!file) return '❌ Could not download file from Telegram.';

  // Upload to Supabase Storage (documents bucket)
  const storagePath = `${userId}/${fileName}`;
  const { error } = await sb.storage.from('documents').upload(storagePath, file.data, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) return `❌ Upload failed: ${error.message}`;

  // Save metadata to documents table
  await sb.from('documents').insert({
    user_id: userId,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: file.data.byteLength,
    category: 'other',
  });

  return `✅ Document uploaded: *${fileName}* (${(file.data.byteLength / 1024).toFixed(1)} KB)`;
}

async function handleEmi(sb: ReturnType<typeof admin>, userId: string): Promise<string> {
  const { data: loans } = await sb.from('loans').select('name,emi_amount,emi_due_day,status')
    .eq('user_id', userId).eq('status', 'active').order('emi_due_day');
  if (!loans?.length) return '💰 No active loans.';

  const total = loans.reduce((s, l) => s + Number(l.emi_amount), 0);
  const lines = ['💰 *Active EMIs*\n'];
  for (const l of loans) {
    lines.push(`  • ${l.name}: ₹${Number(l.emi_amount).toLocaleString('en-IN')} (day ${l.emi_due_day})`);
  }
  lines.push(`\n*Total:* ₹${total.toLocaleString('en-IN')}/month`);
  return lines.join('\n');
}

async function handleHabit(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) {
    // Show today's habits status
    const { data: habits } = await sb.from('habits').select('id,name,emoji,frequency,custom_days,target_per_day')
      .eq('user_id', userId).eq('archived', false);
    const dow = new Date().getDay();
    const due = (habits ?? []).filter((h: any) => {
      if (h.frequency === 'daily') return true;
      if (h.frequency === 'weekdays') return dow >= 1 && dow <= 5;
      if (h.frequency === 'weekends') return dow === 0 || dow === 6;
      return (h.custom_days ?? []).includes(dow);
    });
    if (!due.length) return '🔥 No habits due today.';
    const { data: checkins } = await sb.from('habit_checkins').select('habit_id,count')
      .eq('user_id', userId).eq('check_date', today());
    const lines = ['🔥 *Habits Today*\n'];
    let doneCount = 0;
    for (const h of due) {
      const c = (checkins ?? []).find((ci: any) => ci.habit_id === h.id);
      const count = c?.count ?? 0;
      const done = count >= h.target_per_day;
      if (done) doneCount++;
      lines.push(`${done ? '✅' : '⬜'} ${h.emoji} ${h.name} (${count}/${h.target_per_day})`);
    }
    lines.push(`\n*${doneCount}/${due.length}* completed`);
    return lines.join('\n');
  }

  // Check-in a habit by name match
  const searchName = args.toLowerCase();
  const { data: habits } = await sb.from('habits').select('id,name,emoji,target_per_day')
    .eq('user_id', userId).eq('archived', false);
  const match = (habits ?? []).find((h: any) => h.name.toLowerCase().includes(searchName));
  if (!match) return `❌ No habit matching "${args}". Type \`/habit\` to see your habits.`;

  // Upsert check-in
  const d = today();
  const { data: existing } = await sb.from('habit_checkins').select('id,count')
    .eq('habit_id', match.id).eq('check_date', d).maybeSingle();
  if (existing) {
    await sb.from('habit_checkins').update({ count: existing.count + 1 }).eq('id', existing.id);
  } else {
    await sb.from('habit_checkins').insert({ habit_id: match.id, user_id: userId, check_date: d, count: 1 });
  }
  const newCount = (existing?.count ?? 0) + 1;
  const done = newCount >= match.target_per_day;
  return `${done ? '✅' : '⏳'} ${match.emoji} *${match.name}* — ${newCount}/${match.target_per_day}${done ? ' 🎉 Complete!' : ''}`;
}

async function handleExpense(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/expense 250 food Lunch at cafe`';
  const parts = args.split(/\s+/);
  const amount = parseFloat(parts[0]);
  if (isNaN(amount) || amount <= 0) return '❌ First argument must be a positive number (amount).';

  const validCats = ['food', 'transport', 'shopping', 'bills', 'health', 'entertainment', 'education', 'other'];
  let category = 'other';
  let descParts = parts.slice(1);

  if (parts[1] && validCats.includes(parts[1].toLowerCase())) {
    category = parts[1].toLowerCase();
    descParts = parts.slice(2);
  }
  const description = descParts.join(' ') || null;

  const { error } = await sb.from('daily_expenses').insert({
    user_id: userId, amount, category, description, expense_date: today(), payment_method: 'upi',
  });
  if (error) return `❌ ${error.message}`;

  const catEmoji: Record<string, string> = { food: '🍔', transport: '🚗', shopping: '🛒', bills: '💡', health: '💊', entertainment: '🎬', education: '📚', other: '📦' };
  return `✅ ${catEmoji[category] ?? '📦'} ₹${amount.toLocaleString('en-IN')} — ${description ?? category}`;
}

function helpText(): string {
  return [
    '🤖 *Plynth Bot Commands*\n',
    '`/task <title> [date] [priority]` — Add a task',
    '`/habit [name]` — Check-in a habit (or view all)',
    '`/expense <amount> [category] [note]` — Log expense',
    '`/period start|end` — Log period',
    '`/bookmark <url> [title]` — Save bookmark',
    '`/event <date> [time] <title>` — Add calendar event',
    '`/today` — Today\'s summary',
    '`/emi` — Active EMI summary',
    '`/link <code>` — Link your Plynth account',
    '`/unlink` — Unlink account',
    '`/help` — Show this message',
    '',
    '📎 Send a file/photo to upload to Documents.',
    '💬 Send any text (without /) for AI chat.',
  ].join('\n');
}

// ---------- Main Handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  // Setup endpoint: POST with { action: "setup_webhook" }
  if (req.method === 'POST') {
    let body: any;
    try { body = await req.clone().json(); } catch { body = {}; }

    if (body.action === 'setup_webhook') {
      const url = body.url || `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`;
      const result = await setWebhook(url);
      return json(result);
    }

    // Normal Telegram webhook update
    const update: TelegramUpdate = body;
    if (!update.message) return json({ ok: true });

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text ?? '';
    const sb = admin();

    // Look up user by chat_id
    const { data: profile } = await sb.from('profiles')
      .select('user_id').eq('telegram_chat_id', chatId).maybeSingle();
    const userId = profile?.user_id;

    // Handle /link (doesn't require existing link)
    const cmd = parseCommand(text);
    if (cmd?.command === 'link') {
      const result = await handleLink(sb, chatId, cmd.args);
      await reply(chatId, result);
      return json({ ok: true });
    }
    if (cmd?.command === 'start') {
      await reply(chatId, '👋 Welcome to Plynth Bot!\n\nLink your account first:\n1. Go to Plynth Settings → Telegram\n2. Click "Generate Link Code"\n3. Send `/link CODE` here\n\nType /help for all commands.');
      return json({ ok: true });
    }
    if (cmd?.command === 'help') {
      await reply(chatId, helpText());
      return json({ ok: true });
    }

    // All other commands require a linked account
    if (!userId) {
      await reply(chatId, '⚠️ Account not linked.\nUse `/link CODE` to connect your Plynth account.\nGet the code from Settings → Telegram.');
      return json({ ok: true });
    }

    // Route commands
    if (cmd) {
      let result: string;
      switch (cmd.command) {
        case 'task': result = await handleTask(sb, userId, cmd.args); break;
        case 'period': result = await handlePeriod(sb, userId, cmd.args); break;
        case 'bookmark': result = await handleBookmark(sb, userId, cmd.args); break;
        case 'event': result = await handleEvent(sb, userId, cmd.args); break;
        case 'today': result = await handleToday(sb, userId); break;
        case 'emi': result = await handleEmi(sb, userId); break;
        case 'habit': result = await handleHabit(sb, userId, cmd.args); break;
        case 'expense': result = await handleExpense(sb, userId, cmd.args); break;
        case 'unlink': result = await handleUnlink(sb, chatId); break;
        default: result = `Unknown command: /${cmd.command}\nType /help for available commands.`;
      }
      await reply(chatId, result);
      return json({ ok: true });
    }

    // File/photo upload → Documents
    if (msg.document || msg.photo?.length) {
      const result = await handleDoc(sb, userId, update);
      await reply(chatId, result);
      return json({ ok: true });
    }

    // Free text → AI chat (forward to chat function internally)
    if (text) {
      try {
        const chatUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/chat`;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // Create/get a telegram conversation
        const convKey = `tg_conv_${userId}`;
        const { data: convRow } = await sb.from('system_kv').select('value').eq('key', convKey).maybeSingle();
        let conversationId = convRow?.value;

        const chatResp = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ message: text, conversation_id: conversationId }),
        });

        if (!chatResp.ok) {
          await reply(chatId, '❌ AI chat error. Try again later.');
          return json({ ok: true });
        }

        // Parse SSE stream to extract final text
        const sse = await chatResp.text();
        let fullText = '';
        let newConvId = conversationId;
        for (const line of sse.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.delta) fullText += d.delta;
            if (d.conversation_id) newConvId = d.conversation_id;
          } catch { /* skip */ }
        }

        // Save conversation ID for continuity
        if (newConvId && newConvId !== conversationId) {
          await sb.from('system_kv').upsert({ key: convKey, value: newConvId, updated_at: new Date().toISOString() });
        }

        if (fullText) {
          // Telegram has 4096 char limit
          const trimmed = fullText.length > 4000 ? fullText.slice(0, 4000) + '…' : fullText;
          await reply(chatId, trimmed);
        } else {
          await reply(chatId, '🤔 No response from AI.');
        }
      } catch (e) {
        console.error('AI chat via Telegram error:', e);
        await reply(chatId, '❌ Something went wrong with AI chat.');
      }
      return json({ ok: true });
    }

    return json({ ok: true });
  }

  return json({ error: 'POST only' }, 405);
});
