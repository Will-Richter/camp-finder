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
        body = (f'way["maxheight"]["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|track)(_link)?$"]({b});node["barrier"="height_restrictor"]({b});')
    return query_body(body, tries)


def query_body(body, tries=6, timeout=300):
    q = f'[out:json][timeout:{timeout}][maxsize:1073741824];({body});out center tags;'
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(tries):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout + 60) as r:
                j = json.load(r)
            if "elements" not in j or "runtime error" in j.get("remark", ""):
                raise RuntimeError(j.get("remark", "bad response"))
            return j["elements"]
        except Exception as ex:  # busy server: wait and try the next one
            last = ex
            print(f"  {url.split('/')[2]} failed ({ex}); retrying", file=sys.stderr)
            time.sleep(10 + attempt * 15)
    raise RuntimeError(f"query failed: {last}")


OHSOME = "https://api.ohsome.org/v1/elements/centroid"
AU = "112,-44,154,-9"


def ohsome(filt, attempts=4, timeout=600):
    """One request for all of Australia via the ohsome API (HeiGIT), as Overpass-style elements."""
    data = urllib.parse.urlencode({"bboxes": AU, "filter": filt, "properties": "tags"}).encode()
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(OHSOME, data=data, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
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
FAILED_KINDS = set()   # towns / fuel / water that couldn't be fetched this time


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
    els += fetch_kinds(tiles)
    # Low clearances are heavy: tile by tile, as many as time allows
    started = time.time()
    for k, t in enumerate(tiles, 1):
        if time.time() - started > 80 * 60:
            print("  low clearances: out of time, keeping what we have", file=sys.stderr)
            FAILED_EXTRA.extend(tiles[k - 1:])
            break
        print(f"low clearances {k}/{len(tiles)} {t}", file=sys.stderr)
        try:
            els += query(t, "extra", tries=3)
        except Exception as ex:
            print(f"  tile skipped: {ex}", file=sys.stderr)
            FAILED_EXTRA.append(t)
        time.sleep(2)
    return els


def fetch_kinds(tiles):
    """Towns, fuel and water: one small request each for all of Australia (fast, and nothing gets cut off part way)"""
    els = []
    au = "-44.0,112.0,-9.0,160.0"
    OH = {"towns": "place in (city, town, village) and name=* and type:node", "fuel": "amenity=fuel",
          "water": "amenity in (water_point, drinking_water) and type:node"}
    for kind, body in (("towns", f'node["place"="city"]["name"]({au});node["place"="town"]["name"]({au});node["place"="village"]["name"]({au});'),
                       ("fuel", f'nwr["amenity"="fuel"]({au});'),
                       ("water", f'node["amenity"~"^(water_point|drinking_water)$"]({au});')):
        try:   # ohsome first: one quick request, and it doesn't share Overpass's busy servers
            got = ohsome(OH[kind], attempts=2, timeout=240)
            if len(got) < 500:
                raise RuntimeError(f"only {len(got)}")
            print(f"{kind}: {len(got)} from ohsome", file=sys.stderr)
            els += got
            continue
        except Exception as ex:
            print(f"  {kind} from ohsome failed ({ex}); trying Overpass", file=sys.stderr)
        try:
            got = query_body(body, tries=3, timeout=240)
            print(f"{kind}: {len(got)} for all of Australia", file=sys.stderr)
            els += got
        except Exception as ex:   # too big or too busy: same request in tiles
            print(f"  {kind} in one go failed ({ex}); trying tiles", file=sys.stderr)
            got, bad, t0 = [], 0, time.time()
            for t in tiles:
                if time.time() - t0 > 20 * 60:   # don't let one busy server eat the whole run
                    bad = 99; break
                tb = f"{t[0]},{t[1]},{t[2]},{t[3]}"
                try:
                    got += query_body(body.replace(f"({au})", f"({tb})"), tries=3, timeout=180)
                except Exception:
                    bad += 1
                time.sleep(3)
            if bad > 3:
                print(f"  {kind}: {bad} tiles failed, keeping last time's", file=sys.stderr)
                FAILED_KINDS.add(kind)
            else:
                print(f"{kind}: {len(got)} from tiles", file=sys.stderr)
                els += got
        time.sleep(20)
    return els


def extras_only(out_path):
    """Quick refresh of just towns, fuel stations and water points, patched into the existing file."""
    LATS_, LONS_ = LATS, LONS
    tiles = [(LATS_[i], LONS_[j], LATS_[i + 1], LONS_[j + 1]) for i in range(len(LATS_) - 1) for j in range(len(LONS_) - 1)]
    with open(out_path, encoding="utf-8") as f:
        d = json.load(f)
    towns, fuel, water = [], [], []
    seen = set()
    for el in fetch_kinds(tiles):
        key = f"{el['type']}/{el['id']}"
        if key in seen:
            continue
        seen.add(key)
        lat = el.get("lat", el.get("center", {}).get("lat")); lon = el.get("lon", el.get("center", {}).get("lon"))
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {}); pt = [round(lat, 5), round(lon, 5)]
        if tags.get("place") in ("city", "town", "village") and tags.get("name"):
            towns.append([round(lat, 3), round(lon, 3), tags["name"][:40], {"city": 3, "town": 2}.get(tags["place"], 1)])
        elif tags.get("amenity") == "fuel":
            nm = (tags.get("brand") or tags.get("name") or "Fuel station")[:40]
            if tags.get("name") and tags.get("brand") and tags["brand"] not in tags["name"]:
                nm = f'{tags["brand"]} {tags["name"]}'[:50]
            fuel.append([*pt, nm])
        elif tags.get("amenity") in ("water_point", "drinking_water"):
            if tags.get("access") in ("private", "no") or tags.get("drinking_water") == "no":
                continue
            water.append([*pt, 1 if tags.get("amenity") == "water_point" else 0])
    for key, rows in (("towns", towns), ("fuel", fuel), ("water", water)):
        if key in FAILED_KINDS or len(rows) < len(d.get(key, [])) * 0.8:
            print(f"  {key}: keeping {len(d.get(key, []))} (got {len(rows)})", file=sys.stderr)
        else:
            d[key] = rows
            print(f"  {key}: {len(rows)}", file=sys.stderr)
    d["built"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)


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
    keep("low", low, FAILED_EXTRA, lambda r: (r[0], r[1]))
    for key, rows in (("fuel", fuel), ("water", water), ("towns", towns)):
        if key in FAILED_KINDS or (old.get(key) and len(rows) < len(old[key]) * 0.8):   # failed or came back short: keep last time's
            print(f"  {key}: using last time's {len(old.get(key, []))} (got {len(rows)})", file=sys.stderr)
            rows[:] = old.get(key, rows)
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
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else os.path.join(here, "..", "docs", "data", "camps-au.json")
    if "--extras-only" in sys.argv:
        extras_only(path)
    else:
        main(path)
