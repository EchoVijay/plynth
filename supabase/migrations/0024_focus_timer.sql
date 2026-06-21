-- 0024_focus_timer.sql — Focus timer with tree-growing sessions

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  task_id uuid references public.tasks on delete set null,
  tree_species text not null default 'cedar',
  duration_seconds int not null default 1500,
  actual_seconds int not null default 0,
  mode text not null default 'timer' check (mode in ('timer','stopwatch')),
  status text not null default 'in_progress' check (status in ('completed','abandoned','in_progress')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.focus_sessions enable row level security;
create policy focus_own on public.focus_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_focus_user_date on public.focus_sessions(user_id, started_at);

-- Species unlocks stored on profile
alter table public.profiles add column if not exists unlocked_trees text[] not null default '{cedar,bush}';
