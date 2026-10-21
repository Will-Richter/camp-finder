#!/usr/bin/env python3
"""Builds docs/data/camps-au.json, the camp database built into Camp Finder.

Downloads every campground, caravan park, boat ramp and dump point in Australia from
OpenStreetMap (via Overpass) in tiles, keeps only the details the app uses, and writes
one compact file. Run weekly (GitHub Actions does this) or by hand:

    python3 tools/build_camp_data.py            # writes docs/data/camps-au.json

Uses only the Python standard library.
"""
import json, sys, time, urllib.parse, urllib.request, datetime, os

SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "GoneLappinCampFinder/1.0 (data build; au.com.gonelappin.campfinder)"
KEEP = {
    "name", "name:en", "tourism", "backcountry", "fee", "charge", "toilets", "drinking_water", "water_point",
    "shower", "showers", "dog", "dogs", "pets", "power_supply", "openfire", "fireplace", "campfire",
    "sanitary_dump_station", "tents", "caravans", "motorhome", "maxstay", "access", "website",
    "contact:website", "url", "phone", "contact:phone", "operator", "description", "note", "image",
    "wikimedia_commons", "opening_hours", "is_in", "capacity", "reservation", "4wd_only", "maxlength",
}
# Australia split into tiles (south, west, north, east) small enough for Overpass to answer
LATS = [-44.0, -38.0, -34.0, -30.0, -26.0, -20.0, -9.0]
LONS = [112.0, 120.0, 129.0, 138.0, 143.0, 147.0, 151.0, 160.0]


def query(bbox, kind="core", tries=6):
    s, w, n, e = bbox
    b = f"{s},{w},{n},{e}"
    if kind == "core":
        body = f'nwr["tourism"~"^(camp_site|caravan_site)$"]({b});nwr["leisure"="slipway"]({b});nwr["amenity"="sanitary_dump_station"]({b});'
    else:  # extras: fuel, water and low clearances (kept separate so a slow server can't block the camps)
        body = (f'nwr["amenity"="fuel"]({b});node["amenity"~"^(water_point|drinking_water)$"]({b});'
                f'node["place"~"^(city|town|village)$"]["name"]({b});'
                f'way["maxheight"]["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|track)(_link)?$"]({b});node["barrier"="height_restrictor"]({b});')
    q = f'[out:json][timeout:180];({body});out center tags;'
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(tries):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                j = json.load(r)
            if "elements" not in j or "runtime error" in j.get("remark", ""):
                raise RuntimeError(j.get("remark", "bad response"))
            return j["elements"]
        except Exception as ex:  # busy server: wait and try the next one
            last = ex
            print(f"  {url.split('/')[2]} failed ({ex}); retrying", file=sys.stderr)
            time.sleep(10 + attempt * 15)
    raise RuntimeError(f"tile {bbox} failed: {last}")


OHSOME = "https://api.ohsome.org/v1/elements/centroid"
AU = "112,-44,154,-9"


def ohsome(filt):
    """One request for all of Australia via the ohsome API (HeiGIT), as Overpass-style elements."""
    data = urllib.parse.urlencode({"bboxes": AU, "filter": filt, "properties": "tags"}).encode()
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(OHSOME, data=data, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=600) as r:
                j = json.load(r)
            out = []
            for f in j.get("features", []):
                p = f.get("properties", {})
                osm = p.get("@osmId", "")
                if "/" not in osm:
                    continue
                typ, oid = osm.split("/", 1)
                lon, lat = f["geometry"]["coordinates"][:2]
                tags = {k: str(v) for k, v in p.items() if not k.startswith("@")}
                out.append({"type": typ, "id": oid, "lat": lat, "lon": lon, "tags": tags})
            return out
        except Exception as ex:
            last = ex
            print(f"  ohsome failed ({ex}); retrying", file=sys.stderr)
            if "403" in str(ex):
                break
            time.sleep(20 + attempt * 20)
    raise RuntimeError(f"ohsome failed: {last}")


FAILED_CORE, FAILED_EXTRA = [], []


def all_elements():
    try:
        els = ohsome("tourism in (camp_site, caravan_site)")
        print(f"ohsome: {len(els)} camps", file=sys.stderr)
        if len(els) < 3000:
            raise RuntimeError("too few camps from ohsome")
        els += ohsome("leisure=slipway")
        els += ohsome("amenity=sanitary_dump_station")
        els += ohsome("amenity=fuel")
        els += ohsome("amenity in (water_point, drinking_water)")
        els += ohsome("place in (city, town, village) and name=* and type:node")
        els += ohsome("maxheight=* and (bridge=yes or tunnel=yes or barrier=height_restrictor or highway in (motorway, trunk, primary, secondary, tertiary, unclassified, residential, motorway_link, trunk_link, primary_link, secondary_link, track))")
        return els
    except Exception as ex:
        print(f"ohsome unavailable ({ex}); using Overpass tiles", file=sys.stderr)
    els, failed = [], []
    tiles = [(LATS[i], LONS[j], LATS[i + 1], LONS[j + 1]) for i in range(len(LATS) - 1) for j in range(len(LONS) - 1)]
    for k, t in enumerate(tiles, 1):
        print(f"tile {k}/{len(tiles)} {t}", file=sys.stderr)
        try:
            els += query(t)
        except Exception as ex:
            print(f"  tile failed: {ex}", file=sys.stderr)
            failed.append(t); FAILED_CORE.append(t)
        time.sleep(2)
    if len(failed) > 4:
        raise RuntimeError(f"{len(failed)} tiles failed")
    started = time.time()
    for k, t in enumerate(tiles, 1):
        if time.time() - started > 100 * 60:
            print("  extras: out of time, keeping what we have", file=sys.stderr)
            FAILED_EXTRA.extend(tiles[k - 1:])
            break
        print(f"extras {k}/{len(tiles)} {t}", file=sys.stderr)
        try:
            els += query(t, "extra", tries=3)
        except Exception as ex:
            print(f"  extras tile skipped: {ex}", file=sys.stderr)
            FAILED_EXTRA.append(t)
        time.sleep(2)
    return els


def parse_height(v):
    """'3.5', '3.5 m', "12'6\"" -> metres"""
    import re
    v = v.strip().lower()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*m?$", v)
    if m:
        return float(m.group(1))
    m = re.match(r"^(\d+)'\s*(\d+)?", v)
    if m:
        return round(int(m.group(1)) * 0.3048 + int(m.group(2) or 0) * 0.0254, 2)
    return None


def main(out_path):
    camps, ramps, dumps, fuel, water, low, towns, seen = [], [], [], [], [], [], [], set()
    if True:
        for el in all_elements():
            key = f"{el['type']}/{el['id']}"
            if key in seen:
                continue
            seen.add(key)
            lat = el.get("lat", el.get("center", {}).get("lat"))
            lon = el.get("lon", el.get("center", {}).get("lon"))
            if lat is None or lon is None:
                continue
            tags = el.get("tags", {})
            pt = [round(lat, 5), round(lon, 5)]
            if tags.get("tourism") in ("camp_site", "caravan_site"):
                small = {k2: v[:400] for k2, v in tags.items() if k2 in KEEP}
                camps.append([key, *pt, small])
            elif tags.get("leisure") == "slipway":
                ramps.append(pt)
            elif tags.get("amenity") == "sanitary_dump_station":
                dumps.append(pt)
            elif tags.get("amenity") in ("water_point", "drinking_water"):
                if tags.get("access") in ("private", "no") or tags.get("drinking_water") == "no":
                    continue
                water.append([*pt, 1 if tags.get("amenity") == "water_point" else 0])
            elif tags.get("place") in ("city", "town", "village") and tags.get("name"):
                # towns, so unnamed camps can be called "Free camp near Gin Gin"
                towns.append([round(lat, 3), round(lon, 3), tags["name"][:40], {"city": 3, "town": 2}.get(tags["place"], 1)])
            elif tags.get("amenity") == "fuel":
                nm = (tags.get("brand") or tags.get("name") or "Fuel station")[:40]
                if tags.get("name") and tags.get("brand") and tags["brand"] not in tags["name"]:
                    nm = f'{tags["brand"]} {tags["name"]}'[:50]
                fuel.append([*pt, nm])
            elif tags.get("maxheight") and tags.get("highway") not in ("service", "footway", "cycleway", "path") and tags.get("amenity") != "parking" and not tags.get("parking"):
                h = parse_height(tags["maxheight"])
                if h and h < 4.6:
                    low.append([*pt, h])
    # Tiles a busy server couldn't answer keep last week's data instead of losing it
    try:
        with open(out_path, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        old = {}
    inside = lambda t, la, lo: t[0] <= la < t[2] and t[1] <= lo < t[3]
    def keep(key, rows, tiles, latlon):
        for r in old.get(key, []):
            la, lo = latlon(r)
            if any(inside(t, la, lo) for t in tiles):
                rows.append(r)
    keep("camps", camps, FAILED_CORE, lambda r: (r[1], r[2]))
    keep("ramps", ramps, FAILED_CORE, lambda r: (r[0], r[1]))
    keep("dumps", dumps, FAILED_CORE, lambda r: (r[0], r[1]))
    for key, rows in (("fuel", fuel), ("water", water), ("low", low), ("towns", towns)):
        keep(key, rows, FAILED_EXTRA, lambda r: (r[0], r[1]))
    if FAILED_CORE or FAILED_EXTRA:
        print(f"kept previous data for {len(FAILED_CORE)} camp tiles and {len(FAILED_EXTRA)} extra tiles", file=sys.stderr)
    if old.get("camps") and len(camps) < len(old["camps"]) * 0.97:
        raise SystemExit(f"Only {len(camps)} camps vs {len(old['camps'])} last time; keeping the old file.")
    if len(camps) < 3000:
        raise SystemExit(f"Only {len(camps)} camps found; keeping the old file.")
    out = {
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenStreetMap contributors (ODbL)",
        "camps": camps, "ramps": ramps, "dumps": dumps, "fuel": fuel, "water": water, "low": low, "towns": towns,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)
    print(f"{len(camps)} camps, {len(ramps)} boat ramps, {len(dumps)} dump points, {len(fuel)} fuel stations, {len(water)} water points, {len(low)} low clearances, {len(towns)} towns -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "docs", "data", "camps-au.json"))
