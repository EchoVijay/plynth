-- 0030_job_app_backdated_activity.sql — A backdated application's last activity is the day it was sent.
-- Without this, adding "applied 3 weeks ago" would look active today and never be flagged as quiet.

create or replace function public.job_app_before_insert() returns trigger
language plpgsql as $$
begin
  if new.applied_date < current_date then
    new.last_activity_at := least(new.last_activity_at, new.applied_date::timestamptz);
  end if;
  return new;
end $$;

drop trigger if exists trg_job_app_before_insert on public.job_applications;
create trigger trg_job_app_before_insert before insert on public.job_applications
  for each row execute function public.job_app_before_insert();
