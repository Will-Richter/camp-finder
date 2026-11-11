-- v8: Google place IDs for camps, shared by every phone so each camp is looked up on Google only once.
-- Google's terms allow keeping place IDs indefinitely (photos themselves are never stored).
create table if not exists camp_gplace (
  camp_id text primary key,
  place_id text not null default '',
  updated_at timestamptz not null default now()
);
alter table camp_gplace enable row level security;
drop policy if exists "read gplace" on camp_gplace;
create policy "read gplace" on camp_gplace for select using (true);
drop policy if exists "add gplace" on camp_gplace;
create policy "add gplace" on camp_gplace for insert with check (length(camp_id) < 200 and length(place_id) < 300);
drop policy if exists "update gplace" on camp_gplace;
create policy "update gplace" on camp_gplace for update using (true) with check (length(place_id) < 300);
grant select, insert, update on camp_gplace to anon, authenticated;
