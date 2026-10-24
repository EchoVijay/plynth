// _shared/chat-tools.ts — Server-side tools the AI chat can call.
// Every tool is automatically scoped to the caller's user_id.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getJob, searchJobs } from './freehire.ts';
import { sanitizeFilters } from './pure/job-filters.ts';
import { matchJob } from './pure/job-match.ts';
import { formatSalary } from './pure/job-shape.ts';
import { addDaysYmd, localParts } from './pure/tz.ts';
import { loadOverview, userTimezone } from './overview.ts';

type Tool = {
  name: string;
  description: string;
  args_schema: string;
  run: (sb: SupabaseClient, userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

function ymString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "Today" in the user's own timezone (the server clock is UTC, which is a day behind in India until 05:30). */
async function todayFor(sb: SupabaseClient, userId: string): Promise<string> {
  return localParts(await userTimezone(sb, userId), new Date()).date;
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const TOOLS: Tool[] = [
  {
    name: 'get_profile',
    description: "User profile basics: name, timezone, theme.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const { data } = await sb.from('profiles')
        .select('full_name, timezone, theme_preference')
        .eq('user_id', userId).maybeSingle();
      return data ?? {};
    },
  },

  {
    name: 'get_finance_summary',
    description: "Finance snapshot for a month: total budget, planned spend, balance, EMIs, recurring, one-off expenses. Use today's month if not specified.",
    args_schema: '{"year_month?":"YYYY-MM"}',
    run: async (sb, userId, args) => {
      const ym = (args.year_month as string) || ymString(new Date());
      const [budget, monthly, recurring, loans] = await Promise.all([
        sb.from('budget_months').select('total_budget,notes').eq('user_id', userId).eq('year_month', ym).maybeSingle(),
        sb.from('monthly_expenses').select('name,amount,category,paid,recurring_id').eq('user_id', userId).eq('year_month', ym).limit(100),
        sb.from('recurring_expenses').select('name,amount,category,active').eq('user_id', userId).limit(50),
        sb.from('loans').select('name,emi_amount,emi_due_day,status').eq('user_id', userId).eq('status', 'active').limit(50),
      ]);
      const recurringTotal = (recurring.data ?? []).filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0);
      const oneOffTotal = (monthly.data ?? []).filter((e) => !e.recurring_id).reduce((s, e) => s + Number(e.amount), 0);
      const emiTotal = (loans.data ?? []).reduce((s, l) => s + Number(l.emi_amount), 0);
      const total = Number(budget.data?.total_budget ?? 0);
      const planned = recurringTotal + oneOffTotal + emiTotal;
      return {
        year_month: ym,
        total_budget: total,
        planned,
        balance: total - planned,
        breakdown: { emis: emiTotal, recurring: recurringTotal, one_off: oneOffTotal },
        emis: loans.data ?? [],
        recurring: recurring.data ?? [],
        monthly_expenses: monthly.data ?? [],
        notes: budget.data?.notes ?? null,
      };
    },
  },

  {
    name: 'list_loans',
    description: "All loans with EMI, principal, interest, tenure, due day, status.",
    args_schema: '{"status?":"active|closed"}',
    run: async (sb, userId, args) => {
      let q = sb.from('loans').select('id,name,lender,loan_type,principal_amount,interest_rate,emi_amount,tenure_months,start_date,emi_due_day,status').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      const { data } = await q.limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_learning_topics',
    description: "Topics the user is learning. Filter by status or partial name (case-insensitive).",
    args_schema: '{"status?":"active|paused|completed", "name_contains?":"string"}',
    run: async (sb, userId, args) => {
      let q = sb.from('learning_topics').select('id,topic_name,level,priority,status,target_completion_date,created_at').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      if (args.name_contains) q = q.ilike('topic_name', `%${String(args.name_contains)}%`);
      const { data } = await q.order('priority', { ascending: false }).limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_learning_plan_items',
    description: "Daily learning plan items for a date or date-range. Defaults to today and next 7 days. Use range='overdue' for past pending items.",
    args_schema: '{"date?":"YYYY-MM-DD", "range?":"today|upcoming|overdue|week"}',
    run: async (sb, userId, args) => {
      const today = await todayFor(sb, userId);
      let from = today, to = shiftDays(today, 7);
      const range = (args.range as string) || (args.date ? '' : 'upcoming');
      if (args.date) { from = String(args.date); to = String(args.date); }
      else if (range === 'today') { from = today; to = today; }
      else if (range === 'overdue') { from = '2000-01-01'; to = shiftDays(today, -1); }
      else if (range === 'week') { from = today; to = shiftDays(today, 6); }
      let q = sb.from('learning_plans')
        .select('id,date,title,description,estimated_minutes,status,topic_id,learning_topics(topic_name)')
        .eq('user_id', userId)
        .gte('date', from).lte('date', to);
      if (range === 'overdue') q = q.in('status', ['pending', 'in_progress']);
      const { data } = await q.order('date').limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_tasks',
    description: "User's todos. Filter by status (pending|in_progress|completed) or due_window (today|overdue|week). By default returns all non-completed tasks.",
    args_schema: '{"status?":"pending|in_progress|completed", "due_window?":"today|overdue|week"}',
    run: async (sb, userId, args) => {
      const today = await todayFor(sb, userId);
      let q = sb.from('tasks').select('id,title,description,priority,status,due_date,category_id,task_categories(name)').eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      else q = q.in('status', ['pending', 'in_progress']);
      if (args.due_window === 'today') q = q.eq('due_date', today);
      else if (args.due_window === 'overdue') q = q.lt('due_date', today).neq('status', 'completed');
      else if (args.due_window === 'week') q = q.gte('due_date', today).lte('due_date', shiftDays(today, 6));
      const { data } = await q.order('due_date', { ascending: true, nullsFirst: false }).limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_jobs',
    description: "The user's job tracker: applications (with stage, follow-up date, interview time, days since last activity) and saved jobs. status filters applications.",
    args_schema: '{"status?":"applied|screening|interview|offer|rejected|ghosted"}',
    run: async (sb, userId, args) => {
      let q = sb.from('job_applications')
        .select('id,company,role,status,applied_date,job_url,follow_up_date,interview_at,last_activity_at,public_slug')
        .eq('user_id', userId);
      if (args.status) q = q.eq('status', String(args.status));
      const { data: apps } = await q.order('applied_date', { ascending: false }).limit(50);
      const { data: saved } = await sb.from('job_listings')
        .select('title,company,location,job_url,public_slug')
        .eq('user_id', userId).eq('is_saved', true).order('fetched_at', { ascending: false }).limit(20);
      const now = Date.now();
      return {
        applications: (apps ?? []).map((a) => ({
          ...a,
          days_since_activity: a.last_activity_at ? Math.floor((now - Date.parse(a.last_activity_at)) / 86400000) : null,
        })),
        saved_jobs: saved ?? [],
      };
    },
  },

  {
    name: 'search_jobs',
    description: "Search live job postings (India by default). Returns title, company, location, work mode, salary, posted date, apply link and a 0-100 match score against the user's profile. Use for 'find me ... jobs'.",
    args_schema: '{"q?":"react developer","work_mode?":["remote"],"seniority?":["senior"],"skills?":["react"],"countries?":["in"],"posted_within_days?":7,"limit?":5}',
    run: async (sb, userId, args) => {
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()) : undefined);
      const { data: prof } = await sb.from('job_profile').select('skills,experience_years,work_modes,countries,salary_min,salary_currency,resume_text').eq('user_id', userId).maybeSingle();
      const res = await searchJobs(sanitizeFilters({
        q: args.q, work_mode: list(args.work_mode), seniority: list(args.seniority), skills: list(args.skills),
        countries: list(args.countries) ?? prof?.countries ?? ['in'], posted_within_days: args.posted_within_days,
        fresh_only: true, sort: args.q ? undefined : 'newest',
      }), { limit: Math.min(Number(args.limit) || 5, 8) });
      return {
        total_matching: res.total,
        jobs: res.jobs.map((j) => ({
          slug: j.public_slug, title: j.title, company: j.company, location: j.location, work_mode: j.work_mode,
          salary: formatSalary(j.enrichment), posted_at: j.posted_at, apply_url: j.url,
          match: prof ? matchJob(j, prof).score : null,
        })),
      };
    },
  },

  {
    name: 'get_job',
    description: "Details of one job posting by slug (from search_jobs): summary, requirements, skills, salary, and how well it matches the user's profile.",
    args_schema: '{"slug":"..."}',
    run: async (sb, userId, args) => {
      const j = await getJob(String(args.slug ?? ''));
      const { data: prof } = await sb.from('job_profile').select('skills,experience_years,work_modes,countries,salary_min,salary_currency,resume_text').eq('user_id', userId).maybeSingle();
      const m = prof ? matchJob(j, prof) : null;
      return {
        title: j.title, company: j.company, location: j.location, work_mode: j.work_mode, salary: formatSalary(j.enrichment),
        summary: j.enrichment.summary, experience_years_min: j.enrichment.experience_years_min, skills: j.skills,
        requirements: (j.enrichment.requirements ?? []).slice(0, 8), apply_url: j.url,
        match: m ? { score: m.score, matched: m.matched, missing: m.missing.slice(0, 10) } : null,
      };
    },
  },

  {
    name: 'get_schedule',
    description: "The user's agenda for a day or range: calendar events and work blocks (including repeating ones), tasks due or overdue, learning plan items, EMIs and subscription renewals, job follow-ups. Use for 'what is my schedule / plan / agenda / what do I have today, tomorrow, this week, on <date>'.",
    args_schema: '{"range?":"today|tomorrow|week|next_week","date?":"YYYY-MM-DD","from?":"YYYY-MM-DD","to?":"YYYY-MM-DD"}',
    run: async (sb, userId, args) => {
      const tz = await userTimezone(sb, userId);
      const today = localParts(tz, new Date()).date;
      const dow = new Date(today + 'T00:00:00Z').getUTCDay();
      const mondayOffset = (dow + 6) % 7;
      const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      let from = today, to = today;
      const range = String(args.range ?? '');
      if (ymd(args.date)) { from = to = ymd(args.date)!; }
      else if (ymd(args.from)) { from = ymd(args.from)!; to = ymd(args.to) ?? from; }
      else if (range === 'tomorrow') { from = to = addDaysYmd(today, 1); }
      else if (range === 'week') { from = today; to = addDaysYmd(today, 6); }
      else if (range === 'next_week') { from = addDaysYmd(today, 7 - mondayOffset); to = addDaysYmd(from, 6); }
      if (to < from) to = from;
      if (new Date(to).getTime() - new Date(from).getTime() > 31 * 86400000) to = addDaysYmd(from, 31);
      const ov = await loadOverview(sb, userId, { tz, from, to });
      const nothing = !ov.events.length && !ov.tasks.length && !ov.learning.length && !ov.emis.length && !ov.subscriptions.length;
      return {
        today, timezone: tz, from, to,
        calendar_events: ov.events, tasks: ov.tasks, learning_plan: ov.learning,
        emis_due: ov.emis, subscription_renewals: ov.subscriptions, job_followups: ov.jobs,
        note: nothing ? 'Nothing is scheduled in this range.' : undefined,
      };
    },
  },

  {
    name: 'list_bookmarks',
    description: "The user's saved bookmarks/links. Optional text search q and category.",
    args_schema: '{"q?":"text","category?":"..."}',
    run: async (sb, userId, args) => {
      let q = sb.from('bookmarks').select('title,url,category,description,created_at').eq('user_id', userId);
      if (args.category) q = q.eq('category', String(args.category));
      if (args.q) q = q.or(`title.ilike.%${String(args.q).replace(/[%,]/g, ' ')}%,description.ilike.%${String(args.q).replace(/[%,]/g, ' ')}%`);
      const { data } = await q.order('created_at', { ascending: false }).limit(30);
      return data ?? [];
    },
  },

  {
    name: 'list_documents',
    description: "Documents in the user's vault: title, category, file name, remarks, upload date (metadata only — file contents are never read).",
    args_schema: '{"category?":"aadhaar|pan|passport|insurance|rental_agreement|driving_license|other"}',
    run: async (sb, userId, args) => {
      let q = sb.from('documents').select('title,category,file_name,mime_type,size_bytes,remarks,created_at').eq('user_id', userId);
      if (args.category) q = q.eq('category', String(args.category));
      const { data } = await q.order('created_at', { ascending: false }).limit(50);
      return data ?? [];
    },
  },

  {
    name: 'list_subscriptions',
    description: "Recurring subscriptions with amount, billing cycle and next renewal date, plus the monthly total of active ones.",
    args_schema: '{"status?":"active|paused|cancelled"}',
    run: async (sb, userId, args) => {
      let q = sb.from('subscriptions').select('name,amount,category,billing_cycle,next_renewal_date,status,payment_method').eq('user_id', userId);
      q = q.eq('status', String(args.status ?? 'active'));
      const { data } = await q.order('next_renewal_date', { ascending: true }).limit(60);
      const rows = data ?? [];
      const monthly = rows.reduce((sum, r) => sum + Number(r.amount) / (r.billing_cycle === 'yearly' ? 12 : r.billing_cycle === 'quarterly' ? 3 : r.billing_cycle === 'weekly' ? 1 / 4.345 : 1), 0);
      return { subscriptions: rows, approx_monthly_total: Math.round(monthly) };
    },
  },

  {
    name: 'get_wellness',
    description: "Water intake and sleep logs for the last N days (default 7) with goals and averages.",
    args_schema: '{"days?":7}',
    run: async (sb, userId, args) => {
      const today = await todayFor(sb, userId);
      const days = Math.min(Math.max(Number(args.days) || 7, 1), 30);
      const since = shiftDays(today, -(days - 1));
      const [water, sleep] = await Promise.all([
        sb.from('water_logs').select('log_date,glasses,goal').eq('user_id', userId).gte('log_date', since).order('log_date', { ascending: false }),
        sb.from('sleep_logs').select('log_date,sleep_time,wake_time,total_hours,quality').eq('user_id', userId).gte('log_date', since).order('log_date', { ascending: false }),
      ]);
      const sl = sleep.data ?? [];
      const avgSleep = sl.length ? Math.round((sl.reduce((a, r) => a + Number(r.total_hours ?? 0), 0) / sl.length) * 10) / 10 : null;
      return { today, water: water.data ?? [], sleep: sl, avg_sleep_hours: avgSleep };
    },
  },

  {
    name: 'get_reminders',
    description: "The user's notification reminders (what is sent, when, over which channels) and whether the last delivery worked.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const [rules, prof] = await Promise.all([
        sb.from('reminder_settings').select('id,category,channels,times_of_day,days_of_week,enabled').eq('user_id', userId),
        sb.from('profiles').select('email,timezone,ntfy_topic,telegram_chat_id').eq('user_id', userId).maybeSingle(),
      ]);
      const ids = (rules.data ?? []).map((r) => r.id);
      const { data: logs } = ids.length
        ? await sb.from('reminder_log').select('reminder_id,status,delivered_via,errors,updated_at').in('reminder_id', ids).order('updated_at', { ascending: false }).limit(50)
        : { data: [] as any[] };
      const lastBy = new Map<string, any>();
      for (const l of logs ?? []) if (!lastBy.has(l.reminder_id)) lastBy.set(l.reminder_id, l);
      return {
        timezone: prof.data?.timezone, email: prof.data?.email,
        telegram_linked: !!prof.data?.telegram_chat_id, push_topic_set: !!prof.data?.ntfy_topic,
        reminders: (rules.data ?? []).map((r) => ({ ...r, last_delivery: lastBy.get(r.id) ?? null })),
      };
    },
  },

  {
    name: 'get_period_info',
    description: "Period tracker: current cycle phase, next period prediction, recent symptoms. Only works if user has enabled period tracking.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const { data: cycles } = await sb.from('period_cycles').select('*').eq('user_id', userId).order('start_date', { ascending: false }).limit(12);
      if (!cycles?.length) return { enabled: false, message: 'No period data logged yet.' };
      const sorted = [...cycles].sort((a: any, b: any) => a.start_date.localeCompare(b.start_date));
      const lengths: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const len = Math.round((new Date(sorted[i].start_date).getTime() - new Date(sorted[i-1].start_date).getTime()) / 86400000);
        if (len > 15 && len < 60) lengths.push(len);
      }
      const avgCycle = lengths.length ? Math.round(lengths.reduce((s, l) => s + l, 0) / lengths.length) : 28;
      const last = cycles[0];
      const today = new Date().toISOString().slice(0, 10);
      const dayInCycle = Math.round((new Date(today).getTime() - new Date(last.start_date).getTime()) / 86400000) + 1;
      const periodLen = 5;
      const ovDay = avgCycle - 14;
      let phase = 'luteal';
      if (dayInCycle <= periodLen) phase = 'menstrual';
      else if (dayInCycle <= ovDay - 2) phase = 'follicular';
      else if (dayInCycle <= ovDay + 1) phase = 'ovulatory';
      const nextStart = new Date(new Date(last.start_date).getTime() + avgCycle * 86400000).toISOString().slice(0, 10);
      const fertileStart = new Date(new Date(last.start_date).getTime() + (ovDay - 4) * 86400000).toISOString().slice(0, 10);
      const fertileEnd = new Date(new Date(last.start_date).getTime() + (ovDay + 1) * 86400000).toISOString().slice(0, 10);
      // Recent logs
      const { data: logs } = await sb.from('period_logs').select('log_date,flow_intensity,mood,energy_level')
        .eq('user_id', userId).order('log_date', { ascending: false }).limit(5);
      return {
        enabled: true,
        current_phase: phase,
        day_in_cycle: dayInCycle,
        avg_cycle_length: avgCycle,
        next_period_start: nextStart,
        fertile_window: { start: fertileStart, end: fertileEnd },
        ovulation_day: new Date(new Date(last.start_date).getTime() + ovDay * 86400000).toISOString().slice(0, 10),
        last_period_start: last.start_date,
        recent_logs: logs ?? [],
      };
    },
  },

  {
    name: 'list_notes',
    description: "User's notes: sections and recent pages with title and first ~200 chars of text content.",
    args_schema: '{"section_name?":"string"}',
    run: async (sb, userId, args) => {
      const sections = await sb.from('note_sections').select('id,name,color').eq('user_id', userId).order('sort_order');
      let pagesQ = sb.from('note_pages').select('id,title,section_id,content_json,updated_at').eq('user_id', userId);
      if (args.section_name) {
        const sec = (sections.data ?? []).find((s: any) => s.name.toLowerCase().includes(String(args.section_name).toLowerCase()));
        if (sec) pagesQ = pagesQ.eq('section_id', sec.id);
      }
      const pages = await pagesQ.order('updated_at', { ascending: false }).limit(20);
      const mapped = (pages.data ?? []).map((p: any) => {
        let text = '';
        try { text = extractText(p.content_json).slice(0, 200); } catch {}
        const sec = (sections.data ?? []).find((s: any) => s.id === p.section_id);
        return { id: p.id, title: p.title, section: sec?.name ?? '', snippet: text, updated_at: p.updated_at };
      });
      return { sections: sections.data ?? [], pages: mapped };
    },
  },

  {
    name: 'get_habits_today',
    description: "Today's habits: which are due, completed count, and current streaks.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const today = await todayFor(sb, userId);
      const { data: habits } = await sb.from('habits').select('id,name,emoji,frequency,custom_days,target_per_day')
        .eq('user_id', userId).eq('archived', false);
      const dow = new Date().getDay();
      const due = (habits ?? []).filter((h: any) => {
        if (h.frequency === 'daily') return true;
        if (h.frequency === 'weekdays') return dow >= 1 && dow <= 5;
        if (h.frequency === 'weekends') return dow === 0 || dow === 6;
        return (h.custom_days ?? []).includes(dow);
      });
      const { data: checkins } = await sb.from('habit_checkins').select('habit_id,count')
        .eq('user_id', userId).eq('check_date', today);
      const result = due.map((h: any) => {
        const c = (checkins ?? []).find((ci: any) => ci.habit_id === h.id);
        return { name: h.name, emoji: h.emoji, target: h.target_per_day, done: c?.count ?? 0, completed: (c?.count ?? 0) >= h.target_per_day };
      });
      return { date: today, total_due: due.length, completed: result.filter((r: any) => r.completed).length, habits: result };
    },
  },

  {
    name: 'list_daily_expenses',
    description: "Daily expenses for a date range. Defaults to current month if no range given.",
    args_schema: '{"from_date?":"YYYY-MM-DD","to_date?":"YYYY-MM-DD"}',
    run: async (sb, userId, args) => {
      const today = await todayFor(sb, userId);
      const fromDate = (args.from_date as string) || today.slice(0, 8) + '01';
      const toDate = (args.to_date as string) || today;
      const { data } = await sb.from('daily_expenses').select('amount,category,description,expense_date,payment_method')
        .eq('user_id', userId).gte('expense_date', fromDate).lte('expense_date', toDate)
        .order('expense_date', { ascending: false }).limit(100);
      const expenses = data ?? [];
      const total = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
      const byCategory: Record<string, number> = {};
      for (const e of expenses) byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount);
      return { from: fromDate, to: toDate, total, count: expenses.length, by_category: byCategory, recent: expenses.slice(0, 20) };
    },
  },

  {
    name: 'get_focus_summary',
    description: "Focus timer stats: today's sessions, 30-day totals, trees grown, total focus time.",
    args_schema: '{}',
    run: async (sb, userId) => {
      const today = await todayFor(sb, userId);
      const since30 = shiftDays(today, -30);
      const { data: todaySessions } = await sb.from('focus_sessions')
        .select('tree_species,actual_seconds,status,mode')
        .eq('user_id', userId).gte('started_at', today + 'T00:00:00');
      const { data: monthlySessions } = await sb.from('focus_sessions')
        .select('actual_seconds,status,started_at')
        .eq('user_id', userId).eq('status', 'completed').gte('started_at', since30 + 'T00:00:00');
      const ts = todaySessions ?? [];
      const ms = monthlySessions ?? [];
      const todayCompleted = ts.filter((s: any) => s.status === 'completed');
      const todaySec = todayCompleted.reduce((s: number, r: any) => s + r.actual_seconds, 0);
      const monthSec = ms.reduce((s: number, r: any) => s + r.actual_seconds, 0);
      const uniqueDays = new Set(ms.map((s: any) => s.started_at.slice(0, 10))).size;
      return {
        today: { completed: todayCompleted.length, abandoned: ts.filter((s: any) => s.status === 'abandoned').length, focus_minutes: Math.round(todaySec / 60) },
        last_30_days: { sessions: ms.length, focus_minutes: Math.round(monthSec / 60), active_days: uniqueDays },
      };
    },
  },
];

function extractText(json: any): string {
  if (!json || !json.content) return '';
  const parts: string[] = [];
  function walk(nodes: any[]) {
    for (const n of nodes) {
      if (n.type === 'text') parts.push(n.text ?? '');
      if (n.content) walk(n.content);
    }
  }
  walk(json.content);
  return parts.join(' ');
}

export function toolsCatalogText(): string {
  return TOOLS.map((t) => `- ${t.name}(${t.args_schema}) — ${t.description}`).join('\n');
}

export function toolsCatalogFiltered(allowedTools: Set<string>): string {
  return TOOLS.filter((t) => allowedTools.has(t.name))
    .map((t) => `- ${t.name}(${t.args_schema}) — ${t.description}`)
    .join('\n');
}

export async function runTool(sb: SupabaseClient, userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return await tool.run(sb, userId, args ?? {});
}
