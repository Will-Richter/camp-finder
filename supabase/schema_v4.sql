-- Camp Finder v4: Family sharing (like Life360, for road trips).
-- The traveller turns it on and gets an invite code; family enter the code to watch them live:
-- where they are, speed, the trip they're on, where they've camped, kilometres and badges.
-- Safe to run more than once.

create table if not exists public.family_shares (
  id uuid primary key default gen_random_uuid(),
  secret uuid not null default gen_random_uuid(),
  code text not null unique,
  owner uuid not null references auth.users on delete cascade default auth.uid(),
  name text check (char_length(name) <= 60),
  car jsonb check (pg_column_size(car) < 2000),
  lat double precision, lon double precision, speed real, heading real, accuracy real,
  pos_at timestamptz,
  trip jsonb check (pg_column_size(trip) < 120000),
  stats jsonb check (pg_column_size(stats) < 60000),
  paused boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.family_shares enable row level security;   -- no direct access; only through the functions below

-- 8-character codes without look-alike letters (no 0/O, 1/I/L)
create or replace function public.family_new_code() returns text language plpgsql as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; begin
  loop
    c := '';
    for i in 1..8 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from family_shares where code = c);
  end loop;
  return c;
end $$;

-- Turn sharing on (one share per person; turning it on again gives a fresh code)
create or replace function public.create_family(p_name text, p_car jsonb)
returns table (id uuid, secret uuid, code text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from family_shares where owner = auth.uid();
  return query insert into family_shares (name, car, owner, code) values (left(p_name, 60), p_car, auth.uid(), family_new_code())
    returning family_shares.id, family_shares.secret, family_shares.code;
end $$;
grant execute on function public.create_family(text, jsonb) to authenticated;

-- Updates from the phone. Anything left null stays as it was.
create or replace function public.update_family(p_id uuid, p_secret uuid,
  p_lat double precision default null, p_lon double precision default null, p_speed real default null, p_heading real default null, p_accuracy real default null,
  p_name text default null, p_car jsonb default null, p_trip jsonb default null, p_stats jsonb default null, p_paused boolean default null, p_clear_trip boolean default false)
returns void language sql security definer set search_path = public as $$
  update family_shares set
    lat = coalesce(p_lat, lat), lon = coalesce(p_lon, lon),
    speed = case when p_lat is null then speed else p_speed end,
    heading = case when p_lat is null then heading else p_heading end,
    accuracy = case when p_lat is null then accuracy else p_accuracy end,
    pos_at = case when p_lat is null then pos_at else now() end,
    name = coalesce(left(p_name, 60), name), car = coalesce(p_car, car),
    trip = case when p_clear_trip then null else coalesce(p_trip, trip) end,
    stats = coalesce(p_stats, stats), paused = coalesce(p_paused, paused), updated_at = now()
  where id = p_id and secret = p_secret;
$$;
grant execute on function public.update_family(uuid, uuid, double precision, double precision, real, real, real, text, jsonb, jsonb, jsonb, boolean, boolean) to anon, authenticated;

-- A new code (the old one stops working, so anyone you gave it to can't see you any more)
create or replace function public.new_family_code(p_id uuid, p_secret uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := family_new_code(); begin
  update family_shares set code = c, updated_at = now() where id = p_id and secret = p_secret;
  if not found then return null; end if;
  return c;
end $$;
grant execute on function public.new_family_code(uuid, uuid) to anon, authenticated;

-- Turn sharing off completely: the location and history are deleted
create or replace function public.stop_family(p_id uuid, p_secret uuid) returns void
language sql security definer set search_path = public as $$
  delete from family_shares where id = p_id and secret = p_secret;
$$;
grant execute on function public.stop_family(uuid, uuid) to anon, authenticated;

-- What family see. Paused: just the name, no location.
create or replace function public.get_family(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  select case when paused then jsonb_build_object('name', name, 'car', car, 'paused', true, 'updated_at', updated_at)
    else jsonb_build_object('name', name, 'car', car, 'lat', lat, 'lon', lon, 'speed', speed, 'heading', heading, 'accuracy', accuracy,
      'pos_at', pos_at, 'trip', trip, 'stats', stats, 'updated_at', updated_at, 'paused', false) end
  from family_shares where code = upper(replace(p_code, '-', ''));
$$;
grant execute on function public.get_family(text) to anon, authenticated;
