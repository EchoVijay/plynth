-- 0032_reminders_v3.sql — Multi-channel reminders, delivery tracking, recipient logging.

-- ---------- reminder_settings.channels (any combination of email / ntfy / telegram) ----------
alter table public.reminder_settings
  add column if not exists channels text[] not null default '{email}';

update public.reminder_settings set channels = case channel
  when 'email'    then array['email']
  when 'ntfy'     then array['ntfy']
  when 'telegram' then array['telegram']
  when 'both'     then array['email','ntfy']
  when 'all'      then array['email','ntfy','telegram']
  else array['email'] end;

alter table public.reminder_settings drop constraint if exists reminder_settings_channels_check;
alter table public.reminder_settings add constraint reminder_settings_channels_check
  check (cardinality(channels) > 0 and channels <@ array['email','ntfy','telegram']);

-- Keep the legacy single-value column and the new array in step, whichever one a writer sets.
create or replace function public.reminder_sync_channels() returns trigger
language plpgsql as $$
declare
  derived text[];
begin
  if tg_op = 'UPDATE' and new.channels is distinct from old.channels then
    new.channel := case
      when new.channels = array['email'] then 'email'
      when new.channels = array['ntfy'] then 'ntfy'
      when new.channels = array['telegram'] then 'telegram'
      when new.channels @> array['email','ntfy'] and cardinality(new.channels) = 2 then 'both'
      else 'all' end;
  elsif tg_op = 'INSERT' and new.channels = array['email'] and new.channel <> 'email'
        or tg_op = 'UPDATE' and new.channel is distinct from old.channel and new.channels is not distinct from old.channels then
    derived := case new.channel
      when 'ntfy' then array['ntfy']
      when 'telegram' then array['telegram']
      when 'both' then array['email','ntfy']
      when 'all' then array['email','ntfy','telegram']
      else array['email'] end;
    new.channels := derived;
  end if;
  return new;
end $$;

drop trigger if exists trg_reminder_sync_channels on public.reminder_settings;
create trigger trg_reminder_sync_channels before insert or update on public.reminder_settings
  for each row execute function public.reminder_sync_channels();

-- ---------- reminder_log: what actually happened ----------
alter table public.reminder_log
  add column if not exists status       text not null default 'sent',
  add column if not exists delivered_via text[] not null default '{}',
  add column if not exists errors       jsonb not null default '{}',
  add column if not exists attempts     int not null default 1,
  add column if not exists updated_at   timestamptz not null default now();

alter table public.reminder_log drop constraint if exists reminder_log_status_check;
alter table public.reminder_log add constraint reminder_log_status_check check (status in ('sent','failed'));

grant select on public.reminder_log to authenticated;
grant select, insert, update, delete on public.reminder_log to service_role;

-- ---------- email_log: who it was sent to ----------
alter table public.email_log add column if not exists to_addr text;
