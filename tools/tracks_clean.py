"""Slim the OSM export down to what the 4WD map draws.

Kept: every highway=track, anything tagged 4wd_only (yes or recommended), sand and beach driving, rough roads
(very bad smoothness, grade 3-5 tracktype), unsealed roads named like tracks (Track, Stock Route, Fire Trail, 4WD ...),
paths and bridleways open to vehicles, and beaches tagged as open to vehicles (drawn as their outline).

Properties: n name (or ref), g difficulty 1 (good gravel) .. 5 (hard 4WD), w 4WD only (1), s sand (1),
b beach driving (1), x seasonal or creek crossings (1).
"""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
GRADE = {"grade1": 1, "grade2": 2, "grade3": 3, "grade4": 4, "grade5": 5}
SEALED = {"paved", "asphalt", "concrete", "chipseal", "sealed", "paving_stones", "concrete:plates", "metal", "wood"}
NO_ACCESS = {"private", "no", "agricultural", "forestry", "delivery", "military", "emergency"}
DRIVABLE = {"track", "unclassified", "tertiary", "secondary", "primary", "trunk", "service", "road", "residential",
            "tertiary_link", "secondary_link", "primary_link", "living_street"}
FOOT = {"path", "bridleway", "footway", "cycleway"}
OPEN = {"yes", "designated", "permissive", "destination"}
ROUGH = {"very_bad", "horrible", "very_horrible", "impassable"}
TRACKY = re.compile(r"\b(track|stock route|fire ?trail|fire ?road|4wd|4x4|four wheel drive|beach|telegraph|desert|trail)\b", re.I)
BEACHY = re.compile(r"\bbeach\b", re.I)


def keep(t):
    hw = t.get("highway") or ""
    surf = (t.get("surface") or "").lower()
    mv = (t.get("motor_vehicle") or t.get("vehicle") or "").lower()
    acc = (t.get("access") or "").lower()
    four = (t.get("4wd_only") or "").lower() in ("yes", "recommended")
    if t.get("natural") == "beach":     # a beach polygon: only ones mapped as open to vehicles
        return mv in OPEN or four
    if not hw or hw in ("construction", "proposed", "abandoned", "razed", "steps", "pedestrian"):
        return False
    if mv in NO_ACCESS or (acc in NO_ACCESS and mv not in OPEN):
        return False
    if hw in FOOT:                       # walking tracks, unless they're signed for vehicles
        return mv in OPEN or four
    if hw not in DRIVABLE:
        return False
    if hw == "track" or four or surf in ("sand", "beach"):
        return True
    if (t.get("smoothness") or "") in ROUGH or GRADE.get(t.get("tracktype"), 0) >= 3:
        return True
    name = f"{t.get('name') or ''} {t.get('ref') or ''}"
    return bool(TRACKY.search(name)) and surf not in SEALED and hw not in ("residential", "living_street")


def props(t):
    surf = (t.get("surface") or "").lower()
    w = 1 if (t.get("4wd_only") or "").lower() in ("yes", "recommended") else 0
    beach = t.get("natural") == "beach"
    s = 1 if surf in ("sand", "beach") or beach else 0
    g = GRADE.get(t.get("tracktype"), 0)
    if w and g < 4: g = 4
    if (t.get("smoothness") or "") in ("very_horrible", "impassable"): g = 5
    elif (t.get("smoothness") or "") in ("horrible", "very_bad") and g < 4: g = 4
    if not g: g = 3 if t.get("highway") in ("track", "path", "bridleway") else 2
    p = {"g": g}
    nm = t.get("name") or t.get("ref")
    if nm: p["n"] = nm[:60]
    if w: p["w"] = 1
    if s: p["s"] = 1
    if beach or (s and BEACHY.search(f"{nm or ''} {t.get('note') or ''}")): p["b"] = 1
    if t.get("seasonal") in ("yes", "wet_season", "summer", "winter") or t.get("ford") == "yes": p["x"] = 1
    return p


def lines(geom):
    """Polygons (vehicle beaches) become their outline."""
    ty = geom.get("type")
    if ty in ("LineString", "MultiLineString"): return geom
    if ty == "Polygon": return {"type": "MultiLineString", "coordinates": geom["coordinates"]}
    if ty == "MultiPolygon": return {"type": "MultiLineString", "coordinates": [r for poly in geom["coordinates"] for r in poly]}
    return None


kept = dropped = 0
counts = {"sand": 0, "beach": 0, "4wd": 0}
with open(src) as f, open(dst, "w") as out:
    for line in f:
        line = line.strip().lstrip("\x1e")
        if not line: continue
        ft = json.loads(line)
        t = ft.get("properties", {})
        g = lines(ft.get("geometry") or {})
        if not g or not keep(t):
            dropped += 1; continue
        p = props(t)
        counts["sand"] += p.get("s", 0); counts["beach"] += p.get("b", 0); counts["4wd"] += p.get("w", 0)
        out.write(json.dumps({"type": "Feature", "geometry": g, "properties": p}, separators=(",", ":")) + "\n")
        kept += 1
print("kept", kept, "dropped", dropped, counts)
