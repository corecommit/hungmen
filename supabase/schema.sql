-- ═══════════════════════════════════════════════════════════════════════════
-- HANGMAN — Supabase database setup
--
-- HOW TO RUN:
--   1. Open your project at https://supabase.com/dashboard
--   2. Left sidebar: "SQL Editor" -> "New query"
--   3. Paste this ENTIRE file and click "Run" (or press Ctrl+Enter)
--   4. You should see "Success. No rows returned"
--
-- It is safe to run this file more than once (everything uses
-- if-not-exists / on-conflict logic).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1) USERS TABLE
--    One row per player. `username` is always lowercase and is the primary
--    key. Stats and ban state live here.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
    username           text primary key,
    display_name       text not null,
    first_login        timestamptz not null default now(),
    last_login         timestamptz not null default now(),
    wins               integer not null default 0,
    losses             integer not null default 0,
    games_played       integer not null default 0,
    avatar             text,                        -- public Storage URL
    total_play_time    bigint  not null default 0,
    server_ban         boolean not null default false,
    server_ban_expiry  timestamptz,
    server_ban_duration text,
    server_ban_reason  text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- Keep updated_at fresh on every UPDATE automatically.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
    before update on public.users
    for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- 2) ROW LEVEL SECURITY
--    RLS is ON with NO policies, so the table is completely invisible to the
--    anon / regular API keys. Only the service_role key (used by the game
--    server on Render) can read and write it. Never add a "for anon" policy
--    here — players must never query user data directly.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.users enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) ATOMIC STATS INCREMENT
--    Called by the game server when a game ends. Atomic, so two games
--    finishing at the same moment can never lose an increment.
--    EXECUTE is revoked from anon/authenticated so only the service role
--    (server-side) can call it.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.increment_stats(p_username text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_result = 'win' then
        update public.users
           set wins = wins + 1,
               games_played = games_played + 1,
               last_login = now()
         where username = lower(p_username);
    elsif p_result = 'loss' then
        update public.users
           set losses = losses + 1,
               games_played = games_played + 1,
               last_login = now()
         where username = lower(p_username);
    else
        update public.users
           set last_login = now()
         where username = lower(p_username);
    end if;
end;
$$;

revoke execute on function public.increment_stats(text, text) from anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) AVATAR STORAGE BUCKET
--    Public bucket = anyone can VIEW an avatar image via its public URL
--    (needed so players' browsers can display them), but only the service
--    role key can upload. No storage policies are needed for this setup.
-- ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) QUICK VERIFICATION (results appear in the SQL Editor after running)
-- ───────────────────────────────────────────────────────────────────────────
select 'users table' as object, count(*) as rows from public.users
union all
select 'avatars bucket', count(*) from storage.buckets where id = 'avatars';
