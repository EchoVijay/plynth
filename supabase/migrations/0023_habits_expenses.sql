-- 0023_habits_expenses.sql — Habits tracker + Daily expense tracker

-- ==================== HABITS ====================

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  emoji text not null default '✅',
  frequency text not null default 'daily' check (frequency in ('daily','weekdays','weekends','custom')),
  custom_days int[] default '{}',
  target_per_day int not null default 1,
  color text not null default 'violet',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.habits enable row level security;
create policy habits_own on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_habits_user on public.habits(user_id) where not archived;

create table if not exists public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  check_date date not null,
  count int not null default 1,
  note text,
  created_at timestamptz not null default now(),
  unique(habit_id, check_date)
);

alter table public.habit_checkins enable row level security;
create policy checkins_own on public.habit_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_checkins_user_date on public.habit_checkins(user_id, check_date);
create index idx_checkins_habit_date on public.habit_checkins(habit_id, check_date);

-- ==================== DAILY EXPENSES ====================

create table if not exists public.daily_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  amount numeric not null check (amount > 0),
  category text not null default 'other' check (category in ('food','transport','shopping','bills','health','entertainment','education','other')),
  description text,
  expense_date date not null default current_date,
  payment_method text not null default 'upi' check (payment_method in ('cash','upi','card','other')),
  created_at timestamptz not null default now()
);

alter table public.daily_expenses enable row level security;
create policy expenses_own on public.daily_expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_daily_expenses_user_date on public.daily_expenses(user_id, expense_date);
create index idx_daily_expenses_user_cat on public.daily_expenses(user_id, category);
