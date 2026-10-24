-- 0029_jobs_v2.sql — Jobs workspace v2 (freehire-powered search, tracker ledger, alerts, profile).
-- Legacy job_listings / job_applications rows are kept; new columns are all nullable.

-- ---------- job_listings: freehire snapshot columns ----------
alter table public.job_listings
  add column if not exists public_slug     text,
  add column if not exists company_slug    text,
  add column if not exists work_mode       text,
  add column if not exists skills          text[] not null default '{}',
  add column if not exists salary_min      numeric,
  add column if not exists salary_max      numeric,
  add column if not exists salary_currency text,
  add column if not exists salary_period   text,
  add column if not exists posted_at       timestamptz,
  add column if not exists snapshot        jsonb,
  add column if not exists closed_at       timestamptz;

create index if not exists job_listings_slug_idx on public.job_listings (user_id, public_slug);

-- ---------- job_applications: links + activity ----------
alter table public.job_applications
  add column if not exists listing_id       uuid references public.job_listings(id) on delete set null,
  add column if not exists public_slug      text,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists interview_at     timestamptz,
  add column if not exists calendar_event_id uuid references public.calendar_events(id) on delete set null;

update public.job_applications set last_activity_at = coalesce(updated_at, now());

-- ---------- Append-only event ledger ----------
create table if not exists public.job_application_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,
  kind           text not null check (kind in
    ('created','status_changed','note','follow_up_set','interview_scheduled','reminder_sent','auto_flagged')),
  from_status    text,
  to_status      text,
  note           text,
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index if not exists job_app_events_app_idx on public.job_application_events (application_id, created_at desc);
create index if not exists job_app_events_user_idx on public.job_application_events (user_id, created_at desc);

alter table public.job_application_events enable row level security;
drop policy if exists "read own job_application_events" on public.job_application_events;
create policy "read own job_application_events" on public.job_application_events
  for select using (user_id = auth.uid());
drop policy if exists "add own job_application_events" on public.job_application_events;
create policy "add own job_application_events" on public.job_application_events
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.job_applications a where a.id = application_id and a.user_id = auth.uid())
  );
grant select, insert on public.job_application_events to authenticated;
grant select, insert, update, delete on public.job_application_events to service_role;

-- Bump last_activity_at whenever something is recorded against an application.
create or replace function public.job_app_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.last_activity_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_job_app_before_update on public.job_applications;
create trigger trg_job_app_before_update before update on public.job_applications
  for each row execute function public.job_app_before_update();

-- Every writer (UI, Telegram bot, chat) is recorded because this lives in the database.
create or replace function public.job_app_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_application_events (user_id, application_id, kind, to_status)
    values (new.user_id, new.id, 'created', new.status);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.job_application_events (user_id, application_id, kind, from_status, to_status)
    values (new.user_id, new.id, 'status_changed', old.status, new.status);
  end if;
  if new.follow_up_date is distinct from old.follow_up_date and new.follow_up_date is not null then
    insert into public.job_application_events (user_id, application_id, kind, note)
    values (new.user_id, new.id, 'follow_up_set', 'Follow up on ' || new.follow_up_date::text);
  end if;
  if new.interview_at is distinct from old.interview_at and new.interview_at is not null then
    insert into public.job_application_events (user_id, application_id, kind, meta)
    values (new.user_id, new.id, 'interview_scheduled', jsonb_build_object('at', new.interview_at));
  end if;
  return new;
end $$;

drop trigger if exists trg_job_app_after_write on public.job_applications;
create trigger trg_job_app_after_write after insert or update on public.job_applications
  for each row execute function public.job_app_after_write();

create or replace function public.job_event_bump_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('note','reminder_sent') then
    update public.job_applications set last_activity_at = now() where id = new.application_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_job_event_bump on public.job_application_events;
create trigger trg_job_event_bump after insert on public.job_application_events
  for each row execute function public.job_event_bump_activity();

-- One "created" event for applications that predate the ledger.
insert into public.job_application_events (user_id, application_id, kind, to_status, created_at)
select a.user_id, a.id, 'created', a.status, a.applied_date::timestamptz
from public.job_applications a
where not exists (select 1 from public.job_application_events e where e.application_id = a.id);

-- ---------- Saved searches (alerts) ----------
create table if not exists public.job_saved_searches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  query            jsonb not null default '{}',
  notify           boolean not null default false,
  frequency        text not null default 'daily' check (frequency in ('daily','weekly')),
  channels         text[] not null default '{email}',
  last_run_at      timestamptz,
  last_match_count int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists job_saved_searches_user_idx on public.job_saved_searches (user_id);
create index if not exists job_saved_searches_due_idx on public.job_saved_searches (notify, last_run_at) where notify;

-- ---------- Job profile (one row per user) ----------
create table if not exists public.job_profile (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  headline          text,
  skills            text[] not null default '{}',
  experience_years  numeric,
  seniority         text,
  countries         text[] not null default '{in}',
  work_modes        text[] not null default '{}',
  salary_min        numeric,
  salary_currency   text not null default 'INR',
  resume_text       text,
  resume_file_path  text,
  resume_updated_at timestamptz,
  updated_at        timestamptz not null default now()
);

-- ---------- Cached AI output (fit / cover letter / ask) ----------
create table if not exists public.job_ai_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  public_slug text not null,
  kind        text not null check (kind in ('fit','cover_letter','ask')),
  input_hash  text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, public_slug, kind, input_hash)
);
create index if not exists job_ai_results_lookup_idx on public.job_ai_results (user_id, public_slug, kind, created_at desc);

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['job_saved_searches','job_profile','job_ai_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows %1$s" on public.%1$I', t);
    execute format('create policy "own rows %1$s" on public.%1$I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Seed profile from the old keyword settings so nobody starts from scratch.
insert into public.job_profile (user_id, skills, work_modes)
select s.user_id, coalesce(s.keywords, '{}'),
       case when s.remote_preference in ('remote','hybrid','onsite') then array[s.remote_preference] else '{}' end
from public.job_settings s
on conflict (user_id) do nothing;

-- ---------- Alerts digest cron (the function decides which searches are due) ----------
select cron.schedule('plynth-job-digest', '7 * * * *', $$select public.invoke_edge('job-digest')$$);
