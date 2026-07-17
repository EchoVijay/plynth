// telegram-bot: Webhook handler for Plynth Telegram Bot.
// Receives updates from Telegram, routes commands, and interacts with DB.

import { admin, json, corsHeaders, getSecret } from '../_shared/util.ts';
import { sendTelegram, parseCommand, downloadFile, setWebhook, setMyCommands, type TelegramUpdate } from '../_shared/telegram.ts';
import { aiVision } from '../_shared/ai-provider.ts';

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

async function handleNote(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/note Meeting notes: discussed Q3 targets`';

  // Find or create "Telegram Notes" section
  let { data: section } = await sb.from('note_sections').select('id')
    .eq('user_id', userId).eq('name', 'Telegram Notes').maybeSingle();
  if (!section) {
    const { data: newSection, error: secErr } = await sb.from('note_sections').insert({
      user_id: userId, name: 'Telegram Notes', color: '#6366f1', icon: '📱', sort_order: 99,
    }).select('id').single();
    if (secErr) return `❌ ${secErr.message}`;
    section = newSection;
  }

  // Extract title (first line or first 50 chars) and full content
  const firstLine = args.split('\n')[0].slice(0, 80);
  const contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: args }] }] };

  const { error } = await sb.from('note_pages').insert({
    user_id: userId, section_id: section!.id, title: firstLine,
    content_json: contentJson, word_count: args.split(/\s+/).length,
  });
  if (error) return `❌ ${error.message}`;
  return `✅ Note saved: *${firstLine}*`;
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
  let category = 'general';
  let recurrence: string | null = null;
  let reminderMinutes: number[] = [];

  // Check if second part is a time (HH:MM)
  if (parts[1] && /^\d{1,2}:\d{2}$/.test(parts[1])) {
    eventTime = parts[1].padStart(5, '0') + ':00';
    titleStart = 2;
  }

  // Check if next part is a category keyword
  const catKeywords = ['birthday', 'interview', 'exam', 'emi', 'bill'];
  if (parts[titleStart] && catKeywords.includes(parts[titleStart].toLowerCase())) {
    category = parts[titleStart].toLowerCase();
    titleStart++;
    // Auto-set recurrence & reminder for birthdays
    if (category === 'birthday') {
      recurrence = 'yearly';
      reminderMinutes = [1440]; // 1 day before
    }
  }

  const title = parts.slice(titleStart).join(' ');
  if (!title) return '❌ Event title is required.';

  const { error } = await sb.from('calendar_events').insert({
    user_id: userId, title, event_date: eventDate, event_time: eventTime,
    category, recurrence, reminder_minutes: reminderMinutes,
  });
  if (error) return `❌ ${error.message}`;
  const catEmoji: Record<string, string> = { birthday: '🎂', interview: '💼', exam: '📝', emi: '💰', bill: '🧾', general: '📌' };
  return `✅ ${catEmoji[category] ?? '📌'} Event created: *${title}*\n📅 ${eventDate}${eventTime ? ' at ' + eventTime.slice(0, 5) : ''}${recurrence ? ' (yearly)' : ''}`;
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
  const title = msg.caption?.trim() || fileName;
  await sb.from('documents').insert({
    user_id: userId,
    title,
    file_name: fileName,
    file_path: storagePath,
    mime_type: mimeType,
    size_bytes: file.data.byteLength,
    category: 'other',
  });

  return `✅ Document uploaded: *${title}* (${(file.data.byteLength / 1024).toFixed(1)} KB)`;
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

async function handleFocus(sb: ReturnType<typeof admin>, userId: string): Promise<string> {
  const d = today();
  const { data } = await sb.from('focus_sessions').select('actual_seconds,status,tree_species')
    .eq('user_id', userId).gte('started_at', d + 'T00:00:00');
  const sessions = data ?? [];
  const completed = sessions.filter((s: any) => s.status === 'completed');
  const abandoned = sessions.filter((s: any) => s.status === 'abandoned');
  const totalMin = Math.round(completed.reduce((s: number, r: any) => s + r.actual_seconds, 0) / 60);

  if (!completed.length && !abandoned.length) return '🌳 No focus sessions today. Open Plynth to start one!';

  const lines = ['🌳 *Focus Today*\n'];
  lines.push(`✅ ${completed.length} completed · ${totalMin}m focused`);
  if (abandoned.length) lines.push(`🥀 ${abandoned.length} abandoned`);
  if (completed.length) {
    lines.push('\n*Trees:*');
    for (const s of completed) {
      const min = Math.round(s.actual_seconds / 60);
      lines.push(`  🌲 ${s.tree_species} — ${min}m`);
    }
  }
  return lines.join('\n');
}

async function handleExpense(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  if (!args) return '❌ Usage: `/expense 250 food Lunch at cafe`';
  const parts = args.split(/\s+/);
  const amount = parseFloat(parts[0]);
  if (isNaN(amount) || amount <= 0) return '❌ First argument must be a positive number (amount).';

  const validCats = ['housing', 'food', 'transport', 'utilities', 'entertainment', 'health', 'shopping', 'other'];
  const catAliases: Record<string, string> = {
    lunch: 'food', dinner: 'food', breakfast: 'food', snack: 'food', grocery: 'food', groceries: 'food',
    uber: 'transport', auto: 'transport', metro: 'transport', bus: 'transport', fuel: 'transport', petrol: 'transport',
    rent: 'housing', wifi: 'utilities', electric: 'utilities', electricity: 'utilities', water: 'utilities', gas: 'utilities', bills: 'utilities',
    movie: 'entertainment', netflix: 'entertainment', spotify: 'entertainment',
    medicine: 'health', doctor: 'health', gym: 'health',
    clothes: 'shopping', amazon: 'shopping',
  };

  let category = 'other';
  let descParts = parts.slice(1);

  if (parts[1]) {
    const word = parts[1].toLowerCase();
    if (validCats.includes(word)) {
      category = word;
      descParts = parts.slice(2);
    } else if (catAliases[word]) {
      category = catAliases[word];
      descParts = parts.slice(2);
    }
  }
  const description = descParts.join(' ') || null;

  const { error } = await sb.from('daily_expenses').insert({
    user_id: userId, amount, category, description, expense_date: today(), payment_method: 'upi',
  });
  if (error) return `❌ ${error.message}`;

  const catEmoji: Record<string, string> = { food: '🍔', transport: '🚗', shopping: '🛒', utilities: '💡', health: '💊', entertainment: '🎬', housing: '🏠', other: '📦' };
  return `✅ ${catEmoji[category] ?? '📦'} ₹${amount.toLocaleString('en-IN')} — ${description ?? category}`;
}

// ---------- Subscription ----------
async function handleSub(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  // /sub → list active subs
  if (!parts[0] || parts[0] === 'list') {
    const { data } = await sb.from('subscriptions').select('name,amount,billing_cycle,next_renewal_date')
      .eq('user_id', userId).eq('status', 'active').order('next_renewal_date');
    if (!data?.length) return '💳 No active subscriptions.\nAdd with: `/sub add Netflix 199 monthly`';
    const lines = data.map(s => {
      const daysLeft = Math.ceil((new Date(s.next_renewal_date + 'T00:00:00').getTime() - Date.now()) / 86400000);
      return `• *${s.name}* — ₹${s.amount} (${s.billing_cycle}) · ${daysLeft}d`;
    });
    const total = data.reduce((sum, s) => {
      const m = s.billing_cycle === 'yearly' ? 12 : s.billing_cycle === 'quarterly' ? 3 : 1;
      return sum + Number(s.amount) / m;
    }, 0);
    return `💳 *Active Subscriptions*\n\n${lines.join('\n')}\n\n*Monthly burn:* ₹${Math.round(total).toLocaleString('en-IN')}`;
  }
  // /sub add <name> <amount> <cycle>
  if (parts[0] === 'add') {
    const name = parts[1];
    const amount = parseFloat(parts[2]);
    const cycle = parts[3]?.toLowerCase() || 'monthly';
    if (!name || !amount) return '❌ Usage: `/sub add Netflix 199 monthly`';
    if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) return '❌ Cycle must be: monthly, quarterly, yearly';
    const billingDay = new Date().getDate();
    const nextDate = today();
    const { error } = await sb.from('subscriptions').insert({
      user_id: userId, name, amount, category: 'other', billing_cycle: cycle,
      billing_day: billingDay, next_renewal_date: nextDate, status: 'active',
    });
    if (error) return `❌ ${error.message}`;
    return `✅ Subscription added: *${name}* — ₹${amount} (${cycle})`;
  }
  return '❌ Usage: `/sub` to list, `/sub add <name> <amount> <cycle>` to add';
}

// ---------- Water ----------
async function handleWater(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  const num = parseInt(args.trim());
  // /water → show today's progress
  if (!num && args.trim() !== '0') {
    const { data } = await sb.from('water_logs').select('glasses,goal')
      .eq('user_id', userId).eq('log_date', today()).maybeSingle();
    const g = data?.glasses ?? 0;
    const goal = data?.goal ?? 8;
    const pct = Math.round((g / goal) * 100);
    return `💧 *Water Today:* ${g}/${goal} glasses (${pct}%)\n${g >= goal ? '✅ Goal met! Great job!' : `${goal - g} more to go`}\n\nLog with: \`/water 2\``;
  }
  // /water N → add N glasses
  const toAdd = Math.max(0, num);
  const { data: existing } = await sb.from('water_logs').select('glasses,goal')
    .eq('user_id', userId).eq('log_date', today()).maybeSingle();
  const current = existing?.glasses ?? 0;
  const goal = existing?.goal ?? 8;
  const newTotal = current + toAdd;
  const { error } = await sb.from('water_logs').upsert(
    { user_id: userId, log_date: today(), glasses: newTotal, goal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,log_date' }
  );
  if (error) return `❌ ${error.message}`;
  return `💧 +${toAdd} glass${toAdd > 1 ? 'es' : ''} → *${newTotal}/${goal}*${newTotal >= goal ? ' ✅ Goal met!' : ''}`;
}

// ---------- Sleep ----------
async function handleSleep(sb: ReturnType<typeof admin>, userId: string, args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) return '❌ Usage: `/sleep 11pm 7am [quality 1-5]`';

  // Parse times
  function parseTgTime(val: string): string {
    const m = val.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return val;
    let h = parseInt(m[1]);
    const min = m[2] || '00';
    const ampm = m[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  const sleepTime = parseTgTime(parts[0]);
  const wakeTime = parseTgTime(parts[1]);
  const quality = parts[2] ? Math.min(5, Math.max(1, parseInt(parts[2]) || 0)) : null;

  // Compute hours
  const [sh, sm] = sleepTime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  let sleepMin = sh * 60 + (sm || 0);
  let wakeMin = wh * 60 + (wm || 0);
  if (wakeMin <= sleepMin) wakeMin += 24 * 60;
  const totalHours = Math.round((wakeMin - sleepMin) / 6) / 10;

  const { error } = await sb.from('sleep_logs').upsert(
    { user_id: userId, log_date: today(), sleep_time: sleepTime, wake_time: wakeTime, total_hours: totalHours, quality, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,log_date' }
  );
  if (error) return `❌ ${error.message}`;
  const stars = quality ? ' ⭐'.repeat(quality) : '';
  return `🌙 Sleep logged: *${totalHours}h* (${sleepTime} → ${wakeTime})${stars}`;
}

function helpText(): string {
  return [
    '🤖 *Plynth Bot Commands*\n',
    '`/todo <title> [date] [priority]` — Add a task',
    '`/note <text>` — Quick note to Telegram Notes',
    '`/habit [name]` — Check-in a habit (or view all)',
    '`/expense <amount> [category] [note]` — Log expense',
    '`/sub` — List subscriptions / `/sub add <name> <₹> <cycle>`',
    '`/water [N]` — Log water (or view today\'s intake)',
    '`/sleep <bed> <wake> [quality]` — Log sleep',
    '`/focus` — Today\'s focus sessions',
    '`/period start|end` — Log period',
    '`/bookmark <url> [title]` — Save bookmark',
    '`/event <date> [category] <title>` — Add event',
    '`/today` — Today\'s summary',
    '`/emi` — Active EMI summary',
    '`/link <code>` — Link your Plynth account',
    '`/unlink` — Unlink account',
    '`/help` — Show this message',
    '',
    '*Categories:* birthday, interview, exam, emi, bill',
    '*Expense:* food, transport, shopping, utilities, health, entertainment, housing',
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

    if (body.action === 'setup_commands') {
      const result = await setMyCommands([
        { command: 'todo', description: 'Add a task — /todo Buy groceries tomorrow' },
        { command: 'note', description: 'Quick note — /note Meeting notes...' },
        { command: 'habit', description: 'Check-in habit — /habit or /habit Water' },
        { command: 'expense', description: 'Log expense — /expense 200 food lunch' },
        { command: 'event', description: 'Add event — /event 2026-07-01 birthday Mom' },
        { command: 'period', description: 'Log period — /period start or /period end' },
        { command: 'bookmark', description: 'Save bookmark — /bookmark https://...' },
        { command: 'sub', description: 'Subscriptions — /sub or /sub add Netflix 199 monthly' },
        { command: 'water', description: 'Log water — /water or /water 3' },
        { command: 'sleep', description: 'Log sleep — /sleep 11pm 7am 4' },
        { command: 'focus', description: 'Today\'s focus sessions' },
        { command: 'today', description: 'Today\'s summary' },
        { command: 'emi', description: 'Active EMI summary' },
        { command: 'link', description: 'Link Plynth account — /link CODE' },
        { command: 'unlink', description: 'Unlink account' },
        { command: 'help', description: 'Show all commands' },
      ]);
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
        case 'todo': result = await handleTask(sb, userId, cmd.args); break;
        case 'note': result = await handleNote(sb, userId, cmd.args); break;
        case 'period': result = await handlePeriod(sb, userId, cmd.args); break;
        case 'bookmark': result = await handleBookmark(sb, userId, cmd.args); break;
        case 'event': result = await handleEvent(sb, userId, cmd.args); break;
        case 'today': result = await handleToday(sb, userId); break;
        case 'emi': result = await handleEmi(sb, userId); break;
        case 'habit': result = await handleHabit(sb, userId, cmd.args); break;
        case 'expense': result = await handleExpense(sb, userId, cmd.args); break;
        case 'sub': result = await handleSub(sb, userId, cmd.args); break;
        case 'water': result = await handleWater(sb, userId, cmd.args); break;
        case 'sleep': result = await handleSleep(sb, userId, cmd.args); break;
        case 'focus': result = await handleFocus(sb, userId); break;
        case 'unlink': result = await handleUnlink(sb, chatId); break;
        default: result = `Unknown command: /${cmd.command}\nType /help for available commands.`;
      }
      await reply(chatId, result);
      return json({ ok: true });
    }

    // File/photo upload → try bill scan first, then fall back to document upload
    if (msg.document || msg.photo?.length) {
      const caption = msg.caption?.trim() ?? '';
      const isExpenseCaption = caption.toLowerCase().startsWith('/expense');
      const isPhoto = !!msg.photo?.length;
      // User caption (strip /expense prefix if present)
      const userCaption = isExpenseCaption ? caption.slice(8).trim() : caption;

      // Try bill scanning for photos (or docs with /expense caption)
      if (isPhoto || isExpenseCaption) {
        try {
          await reply(chatId, '🔍 Scanning for bill/receipt...');
          const fileId = isPhoto
            ? msg.photo![msg.photo!.length - 1].file_id
            : msg.document!.file_id;
          const file = await downloadFile(fileId);
          if (file) {
            // Convert to base64
            const bytes = new Uint8Array(file.data);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);
            const mime = isPhoto ? 'image/jpeg' : (msg.document?.mime_type ?? 'image/jpeg');

            type BillResult = { is_bill: boolean; amount?: number; category?: string; description?: string; merchant?: string };
            const prompt = `Analyze this image. If it's a bill, receipt, payment screenshot (GPay, PhonePe, Paytm, UPI, bank transfer, invoice, restaurant bill), extract the details.
If NOT a bill/receipt/payment, set is_bill to false.`;
            const schema = `{ "is_bill": true, "amount": 349, "category": "food|transport|shopping|utilities|health|entertainment|housing|other", "description": "short description", "merchant": "store name" }`;

            const result = await aiVision<BillResult>(prompt, base64, mime, schema);

            if (result.is_bill && result.amount && result.amount > 0) {
              const cat = ['food','transport','shopping','utilities','health','entertainment','housing','other'].includes(result.category ?? '')
                ? result.category! : 'other';
              // Use user's caption as description if provided, otherwise use AI-extracted info
              const desc = userCaption || result.description || result.merchant || cat;
              const { error } = await sb.from('daily_expenses').insert({
                user_id: userId, amount: result.amount, category: cat,
                description: desc, expense_date: today(), payment_method: 'upi',
              });
              if (error) {
                await reply(chatId, `❌ Bill scanned but save failed: ${error.message}`);
              } else {
                const catEmoji: Record<string, string> = { food: '🍔', transport: '🚗', shopping: '🛒', utilities: '💡', health: '💊', entertainment: '🎬', housing: '🏠', other: '📦' };
                await reply(chatId, `✅ ${catEmoji[cat] ?? '📦'} Bill scanned!\n*₹${result.amount.toLocaleString('en-IN')}* — ${desc}${result.merchant && !userCaption ? ` (${result.merchant})` : ''}\nCategory: ${cat}`);
              }
              return json({ ok: true });
            }
            // Not a bill — fall through to document upload
            if (!result.is_bill && !isExpenseCaption) {
              const docResult = await handleDoc(sb, userId, update);
              await reply(chatId, docResult);
              return json({ ok: true });
            }
            // /expense caption but AI didn't detect a bill
            if (isExpenseCaption) {
              await reply(chatId, '⚠️ Could not extract expense from this image. Try a clearer photo of the bill.');
              return json({ ok: true });
            }
          }
        } catch (e) {
          console.error('Bill scan error:', e);
          // Fall through to document upload on AI failure
        }
      }

      // Default: upload as document
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
