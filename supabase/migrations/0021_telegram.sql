-- 0021_telegram.sql — Telegram bot integration

-- Add telegram_chat_id to profiles for account linking
alter table public.profiles add column if not exists telegram_chat_id bigint unique;

-- Add 'telegram' to reminder channel options
-- Current check allows 'email', 'ntfy', 'both'. We replace with a wider set.
alter table public.reminder_settings drop constraint if exists reminder_settings_channel_check;
alter table public.reminder_settings add constraint reminder_settings_channel_check
  check (channel in ('email', 'ntfy', 'telegram', 'both', 'all'));

-- Index for quick lookup when webhook arrives
create index if not exists idx_profiles_telegram_chat_id on public.profiles(telegram_chat_id) where telegram_chat_id is not null;
