// _shared/chat-tools.ts — Server-side tools the AI chat can call.
// Every tool is automatically scoped to the caller's user_id.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Tool = {
  name: string;
  description: string;
  args_schema: string;
  run: (sb: SupabaseClient, userId: string, args: Record<string, unknown>) => Promise<unknown>;
};

function ymString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
      const today = todayISO();
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
      const today = todayISO();
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
    description: "Job applications and recent listings. status filters applications; recent_days=N filters listings by fetched date.",
    args_schema: '{"status?":"applied|screening|interview|offer|rejected|ghosted", "recent_days?":7}',
    run: async (sb, userId, args) => {
      const apps = await (async () => {
        let q = sb.from('job_applications').select('id,company,role,status,applied_date,job_url,follow_up_date').eq('user_id', userId);
        if (args.status) q = q.eq('status', String(args.status));
        const { data } = await q.order('applied_date', { ascending: false }).limit(50);
        return data ?? [];
      })();
      const days = Number(args.recent_days ?? 0);
      const listings = await (async () => {
        let q = sb.from('job_listings').select('id,title,company,location,job_url,fetched_at,is_new').eq('user_id', userId);
        if (days > 0) q = q.gte('fetched_at', new Date(Date.now() - days * 86400000).toISOString());
        const { data } = await q.order('fetched_at', { ascending: false }).limit(20);
        return data ?? [];
      })();
      return { applications: apps, recent_listings: listings };
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
      const today = todayISO();
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
      const today = todayISO();
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
