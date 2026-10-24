-- 0033_focus_tasks.sql — Focus planner: tasks carry a time estimate and the focus time spent on them.
-- Webcam monitoring (presence / phone detection) is intentionally NOT represented here: it never
-- leaves the browser, so there are no columns for warnings, away time or penalties.

alter table public.tasks
  add column if not exists estimated_minutes int check (estimated_minutes is null or estimated_minutes between 1 and 1440),
  add column if not exists focused_seconds int not null default 0 check (focused_seconds >= 0);

alter table public.focus_sessions
  add column if not exists task_title text;

create index if not exists idx_tasks_estimated on public.tasks (user_id, due_date) where estimated_minutes is not null;
