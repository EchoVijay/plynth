-- 0020_bookmarks_and_page_order.sql — Bookmarks table + page_order on profiles.

create table if not exists public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  url         text not null,
  category    text not null default 'other'
    check (category in ('github','website','tool','article','video','social','other')),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on public.bookmarks(user_id, category);

alter table public.bookmarks enable row level security;

drop policy if exists "own rows bookmarks" on public.bookmarks;
create policy "own rows bookmarks" on public.bookmarks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.bookmarks to authenticated;
grant select, insert, update, delete on public.bookmarks to service_role;

-- Page ordering (nullable — null = default order)
alter table public.profiles
  add column if not exists page_order text[];
