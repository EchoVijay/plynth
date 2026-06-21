-- 0017_period_tracker.sql — Period tracker with cycles, daily logs, and page visibility toggle.

-- 1) Add enabled_pages to profiles for page visibility control
alter table public.profiles add column if not exists enabled_pages jsonb not null default '{"period_tracker": false}'::jsonb;

-- 2) Period cycles (start/end of each period)
create table if not exists public.period_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date,
  cycle_length int generated always as (
    case when end_date is not null then end_date - start_date + 1 else null end
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, start_date)
);

-- 3) Daily symptom/mood logs
create table if not exists public.period_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  flow_intensity text check (flow_intensity in ('none', 'spotting', 'light', 'medium', 'heavy')),
  cramps int not null default 0 check (cramps between 0 and 5),
  bloating boolean not null default false,
  headache boolean not null default false,
  breast_tenderness boolean not null default false,
  fatigue boolean not null default false,
  backache boolean not null default false,
  mood text[] not null default '{}',
  energy_level int check (energy_level between 1 and 5),
  sleep_quality int check (sleep_quality between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

-- 4) Indexes
create index period_cycles_user_date on public.period_cycles(user_id, start_date desc);
create index period_logs_user_date on public.period_logs(user_id, log_date desc);

-- 5) RLS
alter table public.period_cycles enable row level security;
alter table public.period_logs enable row level security;

create policy "own rows period_cycles" on public.period_cycles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows period_logs" on public.period_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6) Grants
grant all on public.period_cycles to authenticated, service_role;
grant all on public.period_logs to authenticated, service_role;
