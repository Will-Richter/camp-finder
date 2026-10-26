"""Slim the OSM track export down to what the 4WD map draws.
n: name (or ref), g: difficulty 1 (good gravel) .. 5 (hard 4WD), w: 4WD only (1), s: sand/beach (1), x: seasonal/closed in wet (1)."""
import json, sys
src, dst = sys.argv[1], sys.argv[2]
kept = dropped = 0
GRADE = {"grade1": 1, "grade2": 2, "grade3": 3, "grade4": 4, "grade5": 5}
with open(src) as f, open(dst, "w") as out:
    for line in f:
        line = line.strip().lstrip("\x1e")
        if not line: continue
        ft = json.loads(line)
        if ft.get("geometry", {}).get("type") not in ("LineString", "MultiLineString"): dropped += 1; continue
        t = ft.get("properties", {})
        acc = (t.get("access") or t.get("motor_vehicle") or "").lower()
        if acc in ("private", "no", "agricultural", "forestry", "delivery") or t.get("highway") in ("footway", "path", "cycleway", "bridleway", "steps", "pedestrian"):
            dropped += 1; continue
        w = 1 if t.get("4wd_only") == "yes" else 0
        surf = (t.get("surface") or "").lower()
        s = 1 if surf in ("sand", "beach") else 0
        g = GRADE.get(t.get("tracktype"), 0)
        if w and g < 4: g = max(g, 4)
        if (t.get("smoothness") or "") in ("very_horrible", "impassable"): g = 5
        if not g: g = 3 if t.get("highway") == "track" else 2
        p = {"g": g}
        nm = t.get("name") or t.get("ref")
        if nm: p["n"] = nm[:60]
        if w: p["w"] = 1
        if s: p["s"] = 1
        if t.get("seasonal") in ("yes", "wet_season", "summer") or t.get("ford") == "yes": p["x"] = 1
        out.write(json.dumps({"type": "Feature", "geometry": ft["geometry"], "properties": p}, separators=(",", ":")) + "\n")
        kept += 1
print("kept", kept, "dropped", dropped)
