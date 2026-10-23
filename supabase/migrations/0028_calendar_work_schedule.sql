-- 0028_calendar_work_schedule.sql — Teams-style work scheduling on top of calendar_events.
-- Adds location / all-day / completed flags and work-oriented categories.
-- 'other' is included because Quick Capture already inserts it.

alter table public.calendar_events
  add column if not exists location   text,
  add column if not exists is_all_day boolean not null default false,
  add column if not exists completed  boolean not null default false;

alter table public.calendar_events drop constraint if exists calendar_events_category_check;
alter table public.calendar_events add constraint calendar_events_category_check
  check (category in (
    'work','focus','study','personal',
    'birthday','interview','exam','emi','bill','period','general','other'
  ));

create index if not exists calendar_events_user_recurrence_idx
  on public.calendar_events(user_id) where recurrence is not null;
