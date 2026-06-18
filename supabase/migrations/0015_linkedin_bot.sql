-- LinkedIn auto-apply bot tables

-- Bot run commands & status
CREATE TABLE IF NOT EXISTS public.bot_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed','cancelled')),
  command    text NOT NULL DEFAULT 'start'
               CHECK (command IN ('start','stop')),
  keywords   text NOT NULL DEFAULT '',
  location   text NOT NULL DEFAULT '',
  remote_only boolean NOT NULL DEFAULT false,
  max_applies int NOT NULL DEFAULT 25,
  applied_count int NOT NULL DEFAULT 0,
  error_message text,
  jobs_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- LinkedIn credentials (encrypted at rest by Supabase)
CREATE TABLE IF NOT EXISTS public.linkedin_config (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_email text NOT NULL DEFAULT '',
  -- NOTE: password stored only if user opts in; the bot bridge reads it locally
  resume_path   text NOT NULL DEFAULT '',
  years_exp     text NOT NULL DEFAULT '0',
  months_exp    text NOT NULL DEFAULT '0',
  portfolio_url text NOT NULL DEFAULT '',
  auto_apply    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX bot_runs_user_status ON public.bot_runs(user_id, status);
CREATE INDEX bot_runs_pending ON public.bot_runs(status) WHERE status = 'pending';

-- RLS
ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own bot_runs" ON public.bot_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own linkedin_config" ON public.linkedin_config
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_runs TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_config TO authenticated, service_role;
