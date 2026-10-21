-- Camp Finder v3: longer-lasting live shares, protected camp reports, shared trip plans and in-app feedback.
-- Safe to run more than once.

-- Live sharing: keep the link alive while the journey is running; when it ends, forget where the phone is
create or replace function public.update_share(p_id uuid, p_secret uuid, p_lat double precision, p_lon double precision, p_speed real, p_heading real, p_tonight text, p_ended boolean)
returns void language sql security definer set search_path = public as $$
  update trip_shares set
    lat = case when coalesce(p_ended, false) then null else p_lat end,
    lon = case when coalesce(p_ended, false) then null else p_lon end,
    speed = case when coalesce(p_ended, false) then null else p_speed end,
    heading = p_heading,
    tonight = coalesce(left(p_tonight, 120), tonight),
    ended = coalesce(p_ended, ended),
    updated_at = now(),
    expires_at = case when coalesce(p_ended, false) then now() + interval '7 days' else greatest(expires_at, now() + interval '30 days') end
  where id = p_id and secret = p_secret and expires_at > now();
$$;
grant execute on function public.update_share(uuid, uuid, double precision, double precision, real, real, text, boolean) to anon, authenticated;

-- Camps: the person who added a camp can edit it, but can't un-hide it after other travellers reported it
create or replace function public.camps_guard() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := old.status;
    new.reports := old.reports;
  end if;
  return new;
end $$;
drop trigger if exists camps_guard on public.camps;
create trigger camps_guard before update on public.camps for each row execute function public.camps_guard();

-- Shared trip plans: anyone with the link can view a plan someone sent them
create table if not exists public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null check (pg_column_size(data) < 400000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 year'
);
alter table public.trip_plans enable row level security;   -- no direct access; only through the functions below

create or replace function public.create_plan(p_data jsonb) returns uuid
language sql security definer set search_path = public as $$
  insert into trip_plans (data) values (p_data) returning id;
$$;
grant execute on function public.create_plan(jsonb) to anon, authenticated;

create or replace function public.get_plan(p_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select data from trip_plans where id = p_id and expires_at > now();
$$;
grant execute on function public.get_plan(uuid) to anon, authenticated;

-- Feedback from inside the app (read it in Supabase: Table Editor > feedback)
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message text not null check (char_length(message) between 1 and 4000),
  contact text check (char_length(contact) <= 200),
  kind text check (char_length(kind) <= 40),
  device jsonb check (pg_column_size(device) < 4000),
  user_id uuid default auth.uid()
);
alter table public.feedback enable row level security;

create or replace function public.send_feedback(p_message text, p_contact text, p_kind text, p_device jsonb) returns void
language sql security definer set search_path = public as $$
  insert into feedback (message, contact, kind, device) values (left(p_message, 4000), left(p_contact, 200), left(p_kind, 40), p_device);
$$;
grant execute on function public.send_feedback(text, text, text, jsonb) to anon, authenticated;
