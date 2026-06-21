-- 0019_calendar.sql — Calendar events with per-event reminders.

create table if not exists public.calendar_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  event_date     date not null,
  event_time     time,
  end_date       date,
  end_time       time,
  category       text not null default 'general'
    check (category in ('birthday','interview','exam','emi','bill','period','general')),
  recurrence     text check (recurrence in ('daily','weekly','monthly','yearly')),
  color          text,
  reminder_minutes int[] not null default '{}',
  reminder_sent_for jsonb not null default '{}',
  is_auto        boolean not null default false,
  source_type    text,
  source_id      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.calendar_events(user_id, event_date);

-- RLS
alter table public.calendar_events enable row level security;

drop policy if exists "own rows calendar_events" on public.calendar_events;
create policy "own rows calendar_events" on public.calendar_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, update, delete on public.calendar_events to service_role;

-- Cron job: calendar reminders every 5 minutes
select cron.schedule(
  'plynth-calendar-reminder',
  '*/5 * * * *',
  $$select public.invoke_edge('calendar-reminder')$$
);
