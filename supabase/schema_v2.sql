-- Camp Finder v2: live trip sharing and phone signal reports. Safe to run more than once.

-- Live trip sharing: only someone with the link (share id) can see a trip, and only the phone with the secret can move it
create table if not exists public.trip_shares (
  id uuid primary key default gen_random_uuid(),
  secret uuid not null default gen_random_uuid(),
  owner uuid references auth.users on delete cascade default auth.uid(),
  name text check (char_length(name) <= 80),
  route jsonb,
  tonight text check (char_length(tonight) <= 120),
  lat double precision, lon double precision, speed real, heading real,
  updated_at timestamptz default now(),
  expires_at timestamptz not null default now() + interval '60 days',
  ended boolean not null default false
);
alter table public.trip_shares enable row level security;   -- no direct access; only through the functions below

create or replace function public.create_share(p_name text, p_route jsonb, p_tonight text) returns table (id uuid, secret uuid)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  return query insert into trip_shares (name, route, tonight, owner) values (left(p_name, 80), p_route, left(p_tonight, 120), auth.uid()) returning trip_shares.id, trip_shares.secret;
end $$;
grant execute on function public.create_share(text, jsonb, text) to authenticated;

create or replace function public.update_share(p_id uuid, p_secret uuid, p_lat double precision, p_lon double precision, p_speed real, p_heading real, p_tonight text, p_ended boolean)
returns void language sql security definer set search_path = public as $$
  update trip_shares set lat = p_lat, lon = p_lon, speed = p_speed, heading = p_heading,
    tonight = coalesce(left(p_tonight, 120), tonight), ended = coalesce(p_ended, ended), updated_at = now()
  where id = p_id and secret = p_secret and expires_at > now();
$$;
grant execute on function public.update_share(uuid, uuid, double precision, double precision, real, real, text, boolean) to anon, authenticated;

create or replace function public.get_share(p_id uuid)
returns table (name text, route jsonb, tonight text, lat double precision, lon double precision, speed real, heading real, updated_at timestamptz, ended boolean)
language sql security definer set search_path = public as $$
  select name, route, tonight, lat, lon, speed, heading, updated_at, ended from trip_shares where id = p_id and expires_at > now();
$$;
grant execute on function public.get_share(uuid) to anon, authenticated;

-- Phone signal reported by travellers at camps
create table if not exists public.signal_reports (
  id bigint generated always as identity primary key,
  camp_key text not null check (char_length(camp_key) <= 80),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  carrier text not null check (carrier in ('telstra', 'optus', 'vodafone', 'starlink')),
  bars smallint not null check (bars between 0 and 4),
  created_at timestamptz not null default now()
);
create index if not exists signal_camp on public.signal_reports (camp_key, created_at desc);
alter table public.signal_reports enable row level security;
drop policy if exists "signal readable" on public.signal_reports;
create policy "signal readable" on public.signal_reports for select using (true);
drop policy if exists "signal insert own" on public.signal_reports;
create policy "signal insert own" on public.signal_reports for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "signal delete own" on public.signal_reports;
create policy "signal delete own" on public.signal_reports for delete to authenticated using (user_id = auth.uid());
