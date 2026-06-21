-- 0018_documents_vault.sql — Documents vault: private storage bucket + metadata table.

-- Storage bucket (private)
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 10485760)  -- 10 MB
on conflict (id) do nothing;

-- Storage RLS policies
drop policy if exists "docs_select_own" on storage.objects;
create policy "docs_select_own" on storage.objects for select
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "docs_insert_own" on storage.objects;
create policy "docs_insert_own" on storage.objects for insert
  with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "docs_update_own" on storage.objects;
create policy "docs_update_own" on storage.objects for update
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "docs_delete_own" on storage.objects;
create policy "docs_delete_own" on storage.objects for delete
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- Metadata table
create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  category   text not null default 'other'
    check (category in ('aadhaar','pan','passport','insurance','rental_agreement','driving_license','other')),
  file_path  text not null,
  file_name  text not null,
  mime_type  text not null,
  size_bytes bigint not null check (size_bytes > 0),
  remarks    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.documents(user_id, category);

-- RLS
alter table public.documents enable row level security;

drop policy if exists "own rows documents" on public.documents;
create policy "own rows documents" on public.documents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Grants
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.documents to service_role;
