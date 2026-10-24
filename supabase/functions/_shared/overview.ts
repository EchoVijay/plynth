// _shared/overview.ts — one query for "what is on my plate between two dates", used by reminder
// digests and the chat's get_schedule tool so every surface gives the same answer.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { expandCalendar, isAllDayEvent } from './pure/calendar-expand.ts';
import { addDaysYmd, localParts } from './pure/tz.ts';
import { isFollowUpDue, isQuiet, quietDays } from './pure/job-tracker.ts';

export interface EventItem {
  title: string;
  date: string;
  end_date: string | null;
  time: string | null;      // "HH:mm" or null for all-day
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  category: string;
  repeats: string | null;
}

export interface Overview {
  from: string;
  to: string;
  timezone: string;
  events: EventItem[];
  tasks: { title: string; due_date: string | null; due_time: string | null; priority: string; status: string; overdue: boolean }[];
  learning: { title: string; date: string; minutes: number; topic: string | null; status: string }[];
  emis: { name: string; amount: number; date: string }[];
  subscriptions: { name: string; amount: number; date: string }[];
  jobs: { followUps: { role: string; company: string; follow_up_date: string }[]; quiet: { role: string; company: string; days: number }[] };
}

export async function userTimezone(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb.from('profiles').select('timezone').eq('user_id', userId).maybeSingle();
  return (data?.timezone as string | undefined) || 'Asia/Kolkata';
}

export function todayIn(tz: string, now = new Date()): string {
  return localParts(tz, now).date;
}

function monthDueDates(day: number, from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

export async function loadOverview(
  sb: SupabaseClient, userId: string, opts: { tz?: string; from?: string; to?: string; now?: Date; soonDays?: number } = {},
): Promise<Overview> {
  const tz = opts.tz ?? (await userTimezone(sb, userId));
  const now = opts.now ?? new Date();
  const today = todayIn(tz, now);
  const from = opts.from ?? today;
  const to = opts.to && opts.to >= from ? opts.to : from;
  const includesToday = from <= today && to >= today;
  // Bills (EMIs, renewals) are worth a heads-up a few days before they land.
  const billsTo = opts.soonDays ? addDaysYmd(to, opts.soonDays) : to;

  const [ev, tk, lp, loans, subs, apps] = await Promise.all([
    sb.from('calendar_events')
      .select('id,title,event_date,event_time,end_date,end_time,is_all_day,recurrence,location,category,completed')
      .eq('user_id', userId).lte('event_date', to)
      .or(`event_date.gte.${from},recurrence.not.is.null,end_date.gte.${from}`).limit(500),
    sb.from('tasks').select('title,due_date,due_time,priority,status')
      .eq('user_id', userId).neq('status', 'completed')
      .or(`and(due_date.gte.${from},due_date.lte.${to})${includesToday ? `,due_date.lt.${today}` : ''}`).limit(100),
    sb.from('learning_plans').select('title,date,estimated_minutes,status,learning_topics(topic_name)')
      .eq('user_id', userId).gte('date', from).lte('date', to).neq('status', 'completed').order('date').order('order_in_day').limit(60),
    sb.from('loans').select('name,emi_amount,emi_due_day').eq('user_id', userId).eq('status', 'active'),
    sb.from('subscriptions').select('name,amount,next_renewal_date').eq('user_id', userId).eq('status', 'active')
      .gte('next_renewal_date', from).lte('next_renewal_date', billsTo),
    includesToday
      ? sb.from('job_applications').select('company,role,status,applied_date,follow_up_date,last_activity_at').eq('user_id', userId).limit(300)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const events: EventItem[] = expandCalendar(
    ((ev.data ?? []) as any[]).filter((e) => !e.completed), from, to,
  ).map((o) => ({
    title: o.event.title,
    date: o.date,
    end_date: o.endDate !== o.date ? o.endDate : null,
    time: o.event.event_time ? String(o.event.event_time).slice(0, 5) : null,
    end_time: o.event.end_time ? String(o.event.end_time).slice(0, 5) : null,
    all_day: isAllDayEvent(o.event),
    location: (o.event as any).location ?? null,
    category: (o.event as any).category ?? 'general',
    repeats: o.event.recurrence,
  }));

  const emis = ((loans.data ?? []) as any[]).flatMap((l) =>
    monthDueDates(Number(l.emi_due_day), from, billsTo).map((date) => ({ name: l.name as string, amount: Number(l.emi_amount), date })));

  const appRows = (apps.data ?? []) as any[];
  return {
    from, to, timezone: tz,
    events,
    tasks: ((tk.data ?? []) as any[]).map((t) => ({
      title: t.title, due_date: t.due_date, due_time: t.due_time ? String(t.due_time).slice(0, 5) : null,
      priority: t.priority, status: t.status, overdue: !!t.due_date && t.due_date < today,
    })),
    learning: ((lp.data ?? []) as any[]).map((p) => ({
      title: p.title, date: p.date, minutes: p.estimated_minutes, topic: p.learning_topics?.topic_name ?? null, status: p.status,
    })),
    emis: emis.sort((a, b) => a.date.localeCompare(b.date)),
    subscriptions: ((subs.data ?? []) as any[]).map((s) => ({ name: s.name, amount: Number(s.amount), date: s.next_renewal_date })),
    jobs: {
      followUps: appRows.filter((a) => isFollowUpDue(a, now)).slice(0, 8)
        .map((a) => ({ role: a.role, company: a.company, follow_up_date: a.follow_up_date })),
      quiet: appRows.filter((a) => isQuiet(a, now)).slice(0, 8)
        .map((a) => ({ role: a.role, company: a.company, days: quietDays(a, now) ?? 0 })),
    },
  };
}

export { addDaysYmd };
