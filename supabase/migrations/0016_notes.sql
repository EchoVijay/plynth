-- 0016_notes.sql — Notes with Sections and Pages (OneNote-style).

-- Sections (notebooks/folders)
create table if not exists public.note_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text not null default '📔',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pages within sections
create table if not exists public.note_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null references public.note_sections(id) on delete cascade,
  title text not null default 'Untitled',
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  word_count int not null default 0,
  is_pinned boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index note_sections_user_order on public.note_sections(user_id, sort_order);
create index note_pages_section_order on public.note_pages(user_id, section_id, sort_order);
create index note_pages_pinned on public.note_pages(user_id, is_pinned) where is_pinned = true;

-- RLS
alter table public.note_sections enable row level security;
alter table public.note_pages enable row level security;

create policy "own rows note_sections" on public.note_sections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows note_pages" on public.note_pages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Grant access
grant all on public.note_sections to authenticated, service_role;
grant all on public.note_pages to authenticated, service_role;

-- Seed a "General" section for existing users who don't have one
insert into public.note_sections (user_id, name, color, icon, sort_order)
select p.user_id, 'General', '#6366f1', '📔', 0
from public.profiles p
where not exists (select 1 from public.note_sections ns where ns.user_id = p.user_id);

-- Update new-user trigger to also seed a notes section
create or replace function public.seed_notes_section() returns trigger
language plpgsql security definer as $$
begin
  insert into public.note_sections (user_id, name, color, icon, sort_order)
  values (new.user_id, 'General', '#6366f1', '📔', 0);
  return new;
end;$$;

drop trigger if exists on_profile_created_seed_notes on public.profiles;
create trigger on_profile_created_seed_notes
  after insert on public.profiles
  for each row execute function public.seed_notes_section();
