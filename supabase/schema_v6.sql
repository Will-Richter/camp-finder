-- Camp Finder schema v6: South Australian fuel prices (SAFPIS, the same Informed Sources system as Queensland's)
-- Run once in the Supabase SQL editor, then add the subscriber token you get from safuelpricinginformation.com.au:
--   insert into fuel_keys values ('sa_token', 'YOUR-TOKEN') on conflict (name) do update set value = excluded.value, updated_at = now();

create or replace function public.fuel_fetch_sa() returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text := fuel_key('sa_token'); base text := 'https://fppdirectapi-prod.safuelpricinginformation.com.au';
  hdr extensions.http_header[]; resp extensions.http_response; sites jsonb := '{}'; brands jsonb := '{}'; s jsonb; p jsonb; n int := 0; fuel text;
begin
  if tok is null then return 0; end if;
  hdr := array[extensions.http_header('Authorization', 'FPDAPI SubscriberToken=' || tok), extensions.http_header('Content-Type', 'application/json')];
  select * into resp from extensions.http(('GET', base || '/Subscriber/GetCountryBrands?countryId=21', hdr, null, null)::extensions.http_request);
  if resp.status = 200 then for s in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'Brands', '[]')) loop brands := brands || jsonb_build_object(s->>'BrandId', s->>'Name'); end loop; end if;
  -- geoRegionLevel 3 = state, geoRegionId 4 = South Australia
  select * into resp from extensions.http(('GET', base || '/Subscriber/GetFullSiteDetails?countryId=21&geoRegionLevel=3&geoRegionId=4', hdr, null, null)::extensions.http_request);
  if resp.status <> 200 then raise warning 'SA sites failed: % %', resp.status, left(resp.content, 300); return 0; end if;
  for s in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'S', '[]')) loop sites := sites || jsonb_build_object(s->>'S', s); end loop;
  select * into resp from extensions.http(('GET', base || '/Price/GetSitesPrices?countryId=21&geoRegionLevel=3&geoRegionId=4', hdr, null, null)::extensions.http_request);
  if resp.status <> 200 then raise warning 'SA prices failed: % %', resp.status, left(resp.content, 300); return 0; end if;
  for p in select * from jsonb_array_elements(coalesce(resp.content::jsonb->'SitePrices', '[]')) loop
    s := sites->(p->>'SiteId');
    fuel := case (p->>'FuelId')::int when 2 then 'ulp' when 12 then 'e10' when 5 then 'p95' when 8 then 'p98' when 3 then 'diesel' when 14 then 'pdiesel' when 4 then 'lpg' else null end;
    if s is null or fuel is null or (p->>'Price')::numeric >= 9999 then continue; end if;
    perform fuel_upsert('sa:' || (p->>'SiteId'), 'SA', brands->>(s->>'B'), s->>'N', s->>'A', (s->>'Lat')::float8, (s->>'Lng')::float8,
      jsonb_build_object(fuel, round((p->>'Price')::numeric / 1000, 3)));
    n := n + 1;
  end loop;
  return n;
end $$;
alter function public.fuel_fetch_sa() set statement_timeout = '10min';
select cron.schedule('fuel-sa', '*/30 * * * *', 'select public.fuel_fetch_sa()');  -- every 30 minutes

-- Which states have live prices, and how fresh (handy to check after adding a key)
create or replace view public.fuel_coverage as
  select state, count(*) as stations, max(updated_at) as newest from public.fuel_prices group by state order by state;
