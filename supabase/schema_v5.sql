-- Camp Finder v5: live fuel prices from the state government schemes, refreshed automatically inside Supabase.
--   WA  FuelWatch (open, no key)            daily after 6am WA time (WA prices are fixed for the day)
--   NSW + TAS  FuelCheck (api.nsw.gov.au)   hourly, once the key and secret are added to fuel_keys
--   QLD  Fuel price reporting API           every 30 minutes, once the subscriber token is added to fuel_keys
-- Prices are stored in dollars per litre, by fuel: ulp, e10, p95, p98, diesel, pdiesel, lpg.
-- Safe to run more than once.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.fuel_prices (
  id text primary key,
  state text, brand text, name text, address text,
  lat double precision not null, lon double precision not null,
  prices jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists fuel_prices_lat on public.fuel_prices (lat);
create index if not exists fuel_prices_lon on public.fuel_prices (lon);
alter table public.fuel_prices enable row level security;
drop policy if exists "fuel prices are public" on public.fuel_prices;
create policy "fuel prices are public" on public.fuel_prices for select using (true);

-- API keys for the state schemes. Private: no one can read this table from the app.
create table if not exists public.fuel_keys (name text primary key, value text not null, updated_at timestamptz default now());
alter table public.fuel_keys enable row level security;

create or replace function public.fuel_key(k text) returns text language sql stable security definer set search_path = public as $$
  select value from fuel_keys where name = k;
$$;
revoke all on function public.fuel_key(text) from public, anon, authenticated;

create or replace function public.fuel_upsert(p_id text, p_state text, p_brand text, p_name text, p_address text, p_lat double precision, p_lon double precision, p_prices jsonb)
returns void language sql security definer set search_path = public as $$
  insert into fuel_prices (id, state, brand, name, address, lat, lon, prices, updated_at)
  values (p_id, p_state, p_brand, p_name, p_address, p_lat, p_lon, p_prices, now())
  on conflict (id) do update set prices = fuel_prices.prices || excluded.prices, brand = excluded.brand, name = excluded.name,
    address = excluded.address, lat = excluded.lat, lon = excluded.lon, updated_at = now();
$$;
revoke all on function public.fuel_upsert(text, text, text, text, text, double precision, double precision, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- WA FuelWatch (RSS, one feed per fuel and region)
create or replace function public.fuel_fetch_wa() returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  prod record; q text; resp extensions.http_response; it xml; n int := 0; pr numeric; la float8; lo float8;
begin
  for prod in select * from (values (1, 'ulp'), (2, 'p95'), (4, 'diesel'), (5, 'lpg'), (6, 'p98'), (11, 'pdiesel')) t(code, fuel) loop
    for q in select 'StateRegion=98' union all select 'Region=' || r from generate_series(1, 60) r where r not in (25, 26, 27) loop
      begin
        select * into resp from extensions.http(('GET', 'https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS?Product=' || prod.code || '&' || q,
          array[extensions.http_header('User-Agent', 'Mozilla/5.0 (Camp Finder fuel prices; hello@gonelappin.au)')], null, null)::extensions.http_request);
        if resp.status <> 200 or resp.content not like '%<item>%' then continue; end if;
        for it in select unnest(xpath('//item', xmlparse(document resp.content))) loop
          pr := nullif((xpath('string(/item/price)', it))[1]::text, '')::numeric;
          la := nullif((xpath('string(/item/latitude)', it))[1]::text, '')::float8;
          lo := nullif((xpath('string(/item/longitude)', it))[1]::text, '')::float8;
          if pr is null or la is null or lo is null then continue; end if;
          perform fuel_upsert('wa:' || md5((xpath('string(/item/trading-name)', it))[1]::text || '|' || (xpath('string(/item/address)', it))[1]::text), 'WA',
            (xpath('string(/item/brand)', it))[1]::text, (xpath('string(/item/trading-name)', it))[1]::text,
            (xpath('string(/item/address)', it))[1]::text || ', ' || (xpath('string(/item/location)', it))[1]::text, la, lo,
            jsonb_build_object(prod.fuel, round(pr / 100, 3)));
          n := n + 1;
        end loop;
      exception when others then continue;   -- one bad feed never stops the rest
      end;
    end loop;
  end loop;
  return n;
end $$;
alter function public.fuel_fetch_wa() set statement_timeout = '15min';

-- ---------------------------------------------------------------- NSW + TAS FuelCheck v2 (api.nsw.gov.au "Fuel API")
-- needs: insert into fuel_keys values ('nsw_key', '...'), ('nsw_secret', '...');
create or replace function public.fuel_fetch_nsw() returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := fuel_key('nsw_key'); sec text := fuel_key('nsw_secret'); tok text := fuel_key('nsw_token'); tok_at timestamptz;
  resp extensions.http_response; j jsonb; st jsonb; p jsonb; n int := 0; s text; fuel text;
  stations jsonb := '{}';
begin
  if k is null or sec is null then return 0; end if;
  select updated_at into tok_at from fuel_keys where name = 'nsw_token';
  if tok is null or tok_at < now() - interval '11 hours' then
    select * into resp from extensions.http(('GET', 'https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials',
      array[extensions.http_header('Authorization', 'Basic ' || encode(convert_to(k || ':' || sec, 'UTF8'), 'base64'))], null, null)::extensions.http_request);
    if resp.status <> 200 then raise warning 'NSW token failed: % %', resp.status, left(resp.content, 300); return 0; end if;
    tok := (resp.content::jsonb)->>'access_token';
    insert into fuel_keys values ('nsw_token', tok, now()) on conflict (name) do update set value = excluded.value, updated_at = now();
  end if;
  foreach s in array array['NSW', 'TAS'] loop
    select * into resp from extensions.http(('GET', 'https://api.onegov.nsw.gov.au/FuelPriceCheck/v2/fuel/prices?states=' || s,
      array[extensions.http_header('apikey', k), extensions.http_header('Authorization', 'Bearer ' || tok),
            extensions.http_header('transactionid', gen_random_uuid()::text),
            extensions.http_header('requesttimestamp', to_char(now() at time zone 'UTC', 'DD/MM/YYYY HH12:MI:SS AM')),
            extensions.http_header('Content-Type', 'application/json; charset=utf-8')], null, null)::extensions.http_request);
    if resp.status <> 200 then raise warning 'NSW prices % failed: % %', s, resp.status, left(resp.content, 300); continue; end if;
    j := resp.content::jsonb;
    stations := '{}';
    for st in select * from jsonb_array_elements(coalesce(j->'stations', '[]')) loop stations := stations || jsonb_build_object(st->>'code', st); end loop;
    for p in select * from jsonb_array_elements(coalesce(j->'prices', '[]')) loop
      st := stations->(p->>'stationcode');
      fuel := case p->>'fueltype' when 'U91' then 'ulp' when 'E10' then 'e10' when 'P95' then 'p95' when 'P98' then 'p98' when 'DL' then 'diesel' when 'PDL' then 'pdiesel' when 'LPG' then 'lpg' else null end;
      if st is null or fuel is null or (p->>'price') is null then continue; end if;
      perform fuel_upsert('nsw:' || (p->>'stationcode'), coalesce(st->>'state', s), st->>'brand', st->>'name', st->>'address',
        (st->'location'->>'latitude')::float8, (st->'location'->>'longitude')::float8, jsonb_build_object(fuel, round((p->>'price')::numeric / 100, 3)));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
alter function public.fuel_fetch_nsw() set statement_timeout = '10min';

-- ---------------------------------------------------------------- QLD fuel price reporting (data consumer API)
-- needs: insert into fuel_keys values ('qld_token', '...');
create or replace function public.fuel_fetch_qld() returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text := fuel_key('qld_token'); base text := 'https://fppdirectapi-prod.fuelpricesqld.com.au';
  hdr extensions.http_header[]; resp extensions.http_response; sites jsonb := '{}'; brands jsonb := '{}'; s jsonb; p jsonb; n int := 0; fuel text;
begin
  if tok is null then return 0; end if;
  hdr := array[extensions.http_header('Authorization', 'FPDAPI SubscriberToken=' || tok), extensions.http_header('Content-Type', 'application/json')];
  select * into resp from extensions.http(('GET', base || '/Subscriber/GetCountryBrands?countryId=21', hdr, null, null)::extensions.http_request);
  if resp.status = 200 then for s in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'Brands', '[]')) loop brands := brands || jsonb_build_object(s->>'BrandId', s->>'Name'); end loop; end if;
  select * into resp from extensions.http(('GET', base || '/Subscriber/GetFullSiteDetails?countryId=21&geoRegionLevel=3&geoRegionId=1', hdr, null, null)::extensions.http_request);
  if resp.status <> 200 then raise warning 'QLD sites failed: % %', resp.status, left(resp.content, 300); return 0; end if;
  for s in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'S', '[]')) loop sites := sites || jsonb_build_object(s->>'S', s); end loop;
  select * into resp from extensions.http(('GET', base || '/Price/GetSitesPrices?countryId=21&geoRegionLevel=3&geoRegionId=1', hdr, null, null)::extensions.http_request);
  if resp.status <> 200 then raise warning 'QLD prices failed: % %', resp.status, left(resp.content, 300); return 0; end if;
  for p in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'SitePrices', '[]')) loop
    s := sites->(p->>'SiteId');
    fuel := case (p->>'FuelId')::int when 2 then 'ulp' when 12 then 'e10' when 5 then 'p95' when 8 then 'p98' when 3 then 'diesel' when 14 then 'pdiesel' when 4 then 'lpg' else null end;
    if s is null or fuel is null or (p->>'Price')::numeric >= 9999 then continue; end if;
    perform fuel_upsert('qld:' || (p->>'SiteId'), 'QLD', brands->>(s->>'B'), s->>'N', s->>'A', (s->>'Lat')::float8, (s->>'Lng')::float8,
      jsonb_build_object(fuel, round((p->>'Price')::numeric / 1000, 3)));
    n := n + 1;
  end loop;
  return n;
end $$;
alter function public.fuel_fetch_qld() set statement_timeout = '10min';

-- ---------------------------------------------------------------- schedules (times in UTC)
select cron.unschedule(jobid) from cron.job where jobname in ('fuel-wa', 'fuel-nsw', 'fuel-qld');
select cron.schedule('fuel-wa', '20 22 * * *', 'select public.fuel_fetch_wa()');     -- 6:20am WA time
select cron.schedule('fuel-nsw', '7 * * * *', 'select public.fuel_fetch_nsw()');     -- hourly (fits the free 2,500 calls a month)
select cron.schedule('fuel-qld', '*/30 * * * *', 'select public.fuel_fetch_qld()');  -- every 30 minutes
