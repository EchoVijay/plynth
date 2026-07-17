-- Subscription Tracker

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  amount numeric not null check (amount > 0),
  category text not null default 'other'
    check (category in ('streaming','music','cloud','fitness','saas','news','gaming','other')),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly','quarterly','yearly')),
  billing_day int not null default 1 check (billing_day between 1 and 31),
  next_renewal_date date not null,
  status text not null default 'active'
    check (status in ('active','paused','cancelled')),
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_user_status on public.subscriptions(user_id, status);
create index idx_subscriptions_renewal on public.subscriptions(user_id, next_renewal_date) where status = 'active';

alter table public.subscriptions enable row level security;
create policy "own rows subscriptions" on public.subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on public.subscriptions to authenticated, service_role;
