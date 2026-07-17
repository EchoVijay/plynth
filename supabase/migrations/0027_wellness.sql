-- Wellness: Water & Sleep Tracker

create table if not exists public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  log_date date not null,
  glasses int not null default 0 check (glasses >= 0),
  goal int not null default 8 check (goal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

create table if not exists public.sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  log_date date not null,
  sleep_time time,
  wake_time time,
  total_hours numeric(3,1),
  quality int check (quality between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

create index idx_water_logs_user_date on public.water_logs(user_id, log_date desc);
create index idx_sleep_logs_user_date on public.sleep_logs(user_id, log_date desc);

alter table public.water_logs enable row level security;
alter table public.sleep_logs enable row level security;

create policy "own rows water_logs" on public.water_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows sleep_logs" on public.sleep_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on public.water_logs to authenticated, service_role;
grant all on public.sleep_logs to authenticated, service_role;
