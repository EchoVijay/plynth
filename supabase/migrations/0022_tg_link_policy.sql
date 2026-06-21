-- 0022_tg_link_policy.sql — Allow authenticated users to create telegram link codes

-- Allow insert of tg_link_ keys by authenticated users (for linking flow)
create policy tg_link_insert on public.system_kv for insert to authenticated
  with check (key like 'tg_link_%');

-- Allow update (for upsert) of tg_link_ keys
create policy tg_link_update on public.system_kv for update to authenticated
  using (key like 'tg_link_%')
  with check (key like 'tg_link_%');
