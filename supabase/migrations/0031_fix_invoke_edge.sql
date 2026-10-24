-- 0031_fix_invoke_edge.sql — Every pg_cron job (reminders, calendar reminders, digests, learning plan)
-- has been failing with: ERROR: column reference "name" is ambiguous.
-- The helper's parameter was called `name`, which clashed with vault.decrypted_secrets.name.
-- Postgres cannot rename an input parameter with CREATE OR REPLACE, so drop and recreate.

drop function if exists public.invoke_edge(text, jsonb);

create function public.invoke_edge(fn_name text, payload jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  base_url text;
  service_key text;
begin
  select s.decrypted_secret into base_url    from vault.decrypted_secrets s where s.name = 'PROJECT_URL'      limit 1;
  select s.decrypted_secret into service_key from vault.decrypted_secrets s where s.name = 'SERVICE_ROLE_KEY' limit 1;
  if base_url is null or service_key is null then
    -- Surface the misconfiguration in cron.job_run_details instead of silently doing nothing.
    raise exception 'PROJECT_URL or SERVICE_ROLE_KEY missing in vault — cannot invoke %', fn_name;
  end if;
  perform net.http_post(
    url     := base_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key),
    body    := payload
  );
end;$$;

revoke all on function public.invoke_edge(text, jsonb) from public, anon, authenticated;
grant execute on function public.invoke_edge(text, jsonb) to service_role, postgres;
