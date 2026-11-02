create table if not exists public.users (
    username           text primary key,
    display_name       text not null,
    first_login        timestamptz not null default now(),
    last_login         timestamptz not null default now(),
    wins               integer not null default 0,
    losses             integer not null default 0,
    games_played       integer not null default 0,
    avatar             text,
    total_play_time    bigint  not null default 0,
    server_ban         boolean not null default false,
    server_ban_expiry  timestamptz,
    server_ban_duration text,
    server_ban_reason  text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

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

alter table public.users enable row level security;

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

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

select 'users table' as object, count(*) as rows from public.users
union all
select 'avatars bucket', count(*) from storage.buckets where id = 'avatars';
