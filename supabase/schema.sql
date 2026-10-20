-- Camp Finder shared database (Supabase / Postgres)
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.

-- Traveller-added camps --------------------------------------------------------
create table if not exists public.camps (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users on delete set null default auth.uid(),
  name text not null check (char_length(name) between 2 and 80),
  lat double precision not null check (lat between -45 and -9),
  lon double precision not null check (lon between 112 and 155),
  cost text not null default 'free' check (cost in ('free', 'paid')),
  donation boolean not null default false,
  charge text check (char_length(charge) <= 60),
  amenities jsonb not null default '{}'::jsonb,
  suits jsonb not null default '{}'::jsonb,
  max_stay text check (char_length(max_stay) <= 40),
  notes text check (char_length(notes) <= 1000),
  photo_url text,
  status text not null default 'live' check (status in ('live', 'hidden')),
  reports int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists camps_lat_lon on public.camps (lat, lon);

-- "Is it still free?" check-ins, for any camp (map, official or traveller) --------
create table if not exists public.checkins (
  id bigint generated always as identity primary key,
  camp_key text not null check (char_length(camp_key) <= 80),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  status text not null check (status in ('free', 'price_changed', 'closed', 'full', 'great')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index if not exists checkins_camp on public.checkins (camp_key, created_at desc);

-- Trip notes: bookings and checklist ticks, private to each person ---------------
create table if not exists public.trip_notes (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  key text not null check (char_length(key) <= 160),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Row level security -------------------------------------------------------------
alter table public.camps enable row level security;
alter table public.checkins enable row level security;
alter table public.trip_notes enable row level security;

drop policy if exists "camps readable" on public.camps;
create policy "camps readable" on public.camps for select using (status = 'live' or created_by = auth.uid());
drop policy if exists "camps insert own" on public.camps;
create policy "camps insert own" on public.camps for insert to authenticated with check (created_by = auth.uid() and status = 'live' and reports = 0);
drop policy if exists "camps update own" on public.camps;
create policy "camps update own" on public.camps for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "camps delete own" on public.camps;
create policy "camps delete own" on public.camps for delete to authenticated using (created_by = auth.uid());

drop policy if exists "checkins readable" on public.checkins;
create policy "checkins readable" on public.checkins for select using (true);
drop policy if exists "checkins insert own" on public.checkins;
create policy "checkins insert own" on public.checkins for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "checkins delete own" on public.checkins;
create policy "checkins delete own" on public.checkins for delete to authenticated using (user_id = auth.uid());

drop policy if exists "trip notes own" on public.trip_notes;
create policy "trip notes own" on public.trip_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Report a bad camp: hidden automatically after 3 reports ------------------------
create table if not exists public.camp_reports (
  camp_id uuid references public.camps on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  created_at timestamptz default now(),
  primary key (camp_id, user_id)
);
alter table public.camp_reports enable row level security;

create or replace function public.report_camp(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into camp_reports (camp_id, user_id) values (target, auth.uid()) on conflict do nothing;
  update camps set reports = (select count(*) from camp_reports where camp_id = target),
                   status = case when (select count(*) from camp_reports where camp_id = target) >= 3 then 'hidden' else status end
  where id = target;
end $$;
grant execute on function public.report_camp(uuid) to authenticated;

-- Delete my account (Apple requires in-app account deletion) ---------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from auth.users where id = auth.uid();
end $$;
grant execute on function public.delete_my_account() to authenticated;

-- Photo storage: anyone can view, signed-in people upload into their own folder ------
insert into storage.buckets (id, name, public) values ('camp-photos', 'camp-photos', true) on conflict (id) do nothing;
drop policy if exists "camp photos read" on storage.objects;
create policy "camp photos read" on storage.objects for select using (bucket_id = 'camp-photos');
drop policy if exists "camp photos upload own" on storage.objects;
create policy "camp photos upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'camp-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "camp photos delete own" on storage.objects;
create policy "camp photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'camp-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Star ratings and short reviews, one per person per camp -------------------------
create table if not exists public.ratings (
  camp_key text not null check (char_length(camp_key) <= 80),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  stars smallint not null check (stars between 1 and 5),
  review text check (char_length(review) <= 600),
  rig text check (char_length(rig) <= 20),
  name text check (char_length(name) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (camp_key, user_id)
);
create index if not exists ratings_camp on public.ratings (camp_key, updated_at desc);
alter table public.ratings enable row level security;
drop policy if exists "ratings readable" on public.ratings;
create policy "ratings readable" on public.ratings for select using (true);
drop policy if exists "ratings write own" on public.ratings;
create policy "ratings write own" on public.ratings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Average stars per camp (used on map cards and lists)
create or replace view public.rating_summary with (security_invoker = true) as
  select camp_key, round(avg(stars)::numeric, 1) as avg, count(*)::int as n from public.ratings group by camp_key;
grant select on public.rating_summary to anon, authenticated;

-- Traveller photos of any camp ---------------------------------------------------
create table if not exists public.camp_photos (
  id bigint generated always as identity primary key,
  camp_key text not null check (char_length(camp_key) <= 80),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  url text not null check (char_length(url) <= 400),
  path text not null check (char_length(path) <= 200),
  reports int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists camp_photos_camp on public.camp_photos (camp_key, created_at desc);
alter table public.camp_photos enable row level security;
drop policy if exists "photos readable" on public.camp_photos;
create policy "photos readable" on public.camp_photos for select using (reports < 3 or user_id = auth.uid());
drop policy if exists "photos insert own" on public.camp_photos;
create policy "photos insert own" on public.camp_photos for insert to authenticated with check (user_id = auth.uid() and reports = 0);
drop policy if exists "photos delete own" on public.camp_photos;
create policy "photos delete own" on public.camp_photos for delete to authenticated using (user_id = auth.uid());

create table if not exists public.photo_reports (
  photo_id bigint references public.camp_photos on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  primary key (photo_id, user_id)
);
alter table public.photo_reports enable row level security;
create or replace function public.report_photo(target bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into photo_reports (photo_id, user_id) values (target, auth.uid()) on conflict do nothing;
  update camp_photos set reports = (select count(*) from photo_reports where photo_id = target) where id = target;
end $$;
grant execute on function public.report_photo(bigint) to authenticated;
