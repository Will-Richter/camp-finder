-- Camp Finder schema v7: travellers' AdBlue reports for fuel stations
-- Anyone can read; anyone using the app can add a report (no sign-in needed). Stations are keyed by location.
create table if not exists public.fuel_reports (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lon double precision not null,
  adblue text not null check (adblue in ('pump', 'drums', 'none')),
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fuel_reports_where on public.fuel_reports (lat, lon, created_at desc);
alter table public.fuel_reports enable row level security;
drop policy if exists "fuel reports readable" on public.fuel_reports;
create policy "fuel reports readable" on public.fuel_reports for select using (true);
drop policy if exists "fuel reports insert" on public.fuel_reports;
create policy "fuel reports insert" on public.fuel_reports for insert to anon, authenticated
  with check (lat between -45 and -9 and lon between 112 and 155 and (user_id is null or user_id = auth.uid()));
grant select, insert on public.fuel_reports to anon, authenticated;
