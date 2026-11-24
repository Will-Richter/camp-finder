"""Builds ios-native/Shared/drive-places.json: a small copy of the camp database for Drive mode,
the Lock Screen and CarPlay Live Activity and the Camp Finder widget (they run outside the web app).

camps:  [lat, lon, name, kind, amenities]   kind f free camp, s rest area, c caravan park, p paid camp, u camp (cost unknown), r RV stop
                                            amenities T toilets, W water, S showers, D dogs OK, P power
fuel:   [lat, lon, name, flags]             flags as in camps-au.json: D diesel, L LPG, A AdBlue, T truck stop, 2 open 24 hours
sights: [lat, lon, name, emoji, blurb, rank]

Classifies camps the same way the web app does (normalise / isParkTags / placeName in docs/app.js).
Run: python3 tools/build_drive_places.py
"""
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "ios-native" / "Shared" / "drive-places.json"

PARK_RE = re.compile(r"\b(caravan|holiday|tourist|tourism|leisure|lifestyle|motor|van|cabin|camping|beach|river|lakes?|family)\s*(park|village|resort|retreat|haven)s?\b|\bbig ?4\b|discovery parks?|ingenia|reflections|holiday haven|showgrounds?|\bcaravan\b", re.I)
NOT_PARK_RE = re.compile(r"rest ?area|free camp|dump|overnight (stop|parking)|truck stop|roadside|lookout", re.I)
REST_RE = re.compile(r"\brest ?(area|stop)\b|roadside (stop|rest)|truck stop|driver reviver|overnight (stop|parking)", re.I)


def js_globals(*files):
    """Evaluates the app's data scripts (window.CF_...) with node and returns the globals as JSON."""
    code = "global.window = {};" + "".join(f"require({json.dumps(str(f))});" for f in files) + \
        "process.stdout.write(JSON.stringify({pois: window.CF_POIS || [], qpws: [...(window.CF_QPWS_ALL || []), ...(window.CF_QPWS_CAMPS || [])]}));"
    return json.loads(subprocess.run(["node", "-e", code], check=True, capture_output=True, text=True).stdout)


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


class Grid:
    def __init__(self, cell=0.5):
        self.cell, self.g = cell, {}

    def key(self, la, lo):
        return (math.floor(la / self.cell), math.floor(lo / self.cell))

    def add(self, la, lo, item):
        self.g.setdefault(self.key(la, lo), []).append(item)

    def near(self, la, lo, deg):
        a0, o0 = self.key(la - deg, lo - deg)
        a1, o1 = self.key(la + deg, lo + deg)
        for a in range(a0, a1 + 1):
            for o in range(o0, o1 + 1):
                yield from self.g.get((a, o), [])


def tri(v):
    return v is not None and str(v).lower() in ("yes", "designated", "true", "1")


def main():
    d = json.loads((DOCS / "data" / "camps-au.json").read_text())
    extra = js_globals(DOCS / "pois.js", DOCS / "islands.js", DOCS / "qpws-camps.js")

    towns = Grid()
    for t in d.get("towns", []):
        towns.add(t[0], t[1], t)

    def town_near(la, lo):
        best, best_s = None, math.inf
        for t in towns.near(la, lo, 0.6):
            dist = hav((la, lo), (t[0], t[1]))
            if dist > 60000:
                continue
            s = dist * (0.7 if (t[3] if len(t) > 3 else 1) >= 2 else 1)
            if s < best_s:
                best_s, best = s, (t[2], dist)
        return best

    camps, seen = [], Grid(0.05)
    for _id, la, lo, t in d["camps"]:
        t = t or {}
        if t.get("access") in ("private", "no") or t.get("backcountry") == "yes":
            continue  # walk-in and hike camps aren't for drivers
        fee = str(t.get("fee") or "")
        cost = "free" if fee.lower() == "no" or re.fullmatch(r"(free|donation)", fee, re.I) else "paid" if fee.lower() == "yes" or t.get("charge") else "unknown"
        name = t.get("name") or t.get("name:en") or ""
        park = cost != "free" and not NOT_PARK_RE.search(name) and (bool(name and PARK_RE.search(name)) or (
            t.get("tourism") == "caravan_site" and (cost == "paid" or any(t.get(k) for k in ("website", "contact:website", "phone", "contact:phone", "brand", "reservation")))))
        kind = "f" if cost == "free" else "c" if park else "p" if cost == "paid" else "r" if t.get("tourism") == "caravan_site" else "u"
        if kind in ("u", "r") and REST_RE.search(name):
            kind = "s"
        elif kind in ("u", "r") and re.search(r"free ?camp", name, re.I):
            kind = "f"
        if not name:
            what = "RV stop" if t.get("tourism") == "caravan_site" else "Free camp" if cost == "free" else "Camp"
            tn = town_near(la, lo)
            name = f"Unnamed {what.lower()}" if not tn else f"{what} at {tn[0]}" if tn[1] < 2500 else f"{what} near {tn[0]}" if tn[1] < 10000 else f"{what}, {round(tn[1] / 1000)} km from {tn[0]}"
        am = "".join(ch for ch, ok in (("T", tri(t.get("toilets"))), ("W", tri(t.get("drinking_water", t.get("water_point")))),
                                       ("S", tri(t.get("shower", t.get("showers")))), ("D", tri(t.get("dog", t.get("dogs", t.get("pets"))))),
                                       ("P", tri(t.get("power_supply")))) if ok)
        row = [round(la, 4), round(lo, 4), name[:60], kind, am]
        camps.append(row)
        seen.add(la, lo, row)

    # Queensland Parks campgrounds the OpenStreetMap data doesn't already have (vehicle access only)
    for park, slug, name, la, lo, f in extra["qpws"]:
        drive = re.search(r"[H4KCVM2]", f)
        if not drive and re.search(r"[BAL]", f):
            continue
        if any(hav((la, lo), (c[0], c[1])) < 400 for c in seen.near(la, lo, 0.01)):
            continue
        am = "".join(ch for ch, ok in (("T", "T" in f or "t" in f), ("W", "R" in f or "O" in f), ("S", "S" in f or "s" in f), ("D", "D" in f)) if ok)
        row = [round(la, 4), round(lo, 4), name[:60], "p", am]
        camps.append(row)
        seen.add(la, lo, row)

    fuel = [[round(p[0], 4), round(p[1], 4), (p[2] if len(p) > 2 and p[2] else "Fuel station")[:40], (p[3] if len(p) > 3 else "")] for p in d.get("fuel", [])]
    sights = [[round(p[1], 4), round(p[2], 4), p[0], p[3], p[4], p[5]] for p in extra["pois"]]

    out = {"built": d.get("built", ""), "camps": camps, "fuel": fuel, "sights": sights}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    kinds = {k: sum(1 for c in camps if c[3] == k) for k in "fscpru"}
    print(f"wrote {OUT.relative_to(ROOT)}: {len(camps)} camps {kinds}, {len(fuel)} servos, {len(sights)} must-sees, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
