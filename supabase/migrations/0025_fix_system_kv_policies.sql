-- 0025_fix_system_kv_policies.sql — Add SELECT and DELETE policies for tg_link_ keys

-- Allow authenticated users to read their own tg_link_ codes (needed for upsert)
create policy tg_link_select on public.system_kv for select to authenticated
  using (key like 'tg_link_%');

-- Allow authenticated users to delete expired codes
create policy tg_link_delete on public.system_kv for delete to authenticated
  using (key like 'tg_link_%');
