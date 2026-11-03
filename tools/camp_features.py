"""What's around each camp, for Camp tonight's "beach, river, lake ..." filters.

Reads an OpenStreetMap export (geojsonseq) of beaches, coastline, rivers, lakes, dams, rock and waterfalls, and
every camp in the app (docs/data/camps-au.json plus the Queensland Parks lists), and writes
docs/data/camp-features.json: {"lat,lon" (4 decimals): flags}.

Flags: B beach, C coast, R river or creek, L lake, D dam or weir, K rock, cliffs or gorge, F waterfall nearby.
"""
import json, math, re, sys
from collections import defaultdict

feat_path, out_path = sys.argv[1], sys.argv[2]
RADIUS = {"B": 350, "C": 250, "R": 250, "L": 400, "D": 600, "K": 400, "F": 2000}
CELL = 0.02

camps = []
d = json.load(open("docs/data/camps-au.json"))
camps += [(c[1], c[2]) for c in d["camps"]]
for js in ("docs/qpws-camps.js", "docs/islands.js"):
    try:
        txt = open(js).read()
        for m in re.finditer(r'\[\s*"[^"]*",\s*"[^"]*",\s*"[^"]*",\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)', txt):
            camps.append((float(m.group(1)), float(m.group(2))))
    except FileNotFoundError:
        pass
camps = list({(round(a, 4), round(b, 4)) for a, b in camps})
print("camps", len(camps))

grid = defaultdict(list)
for i, (la, lo) in enumerate(camps):
    grid[(math.floor(la / CELL), math.floor(lo / CELL))].append(i)
flags = defaultdict(set)


def kind(t):
    nat, wat, ww, lu = t.get("natural"), (t.get("water") or ""), t.get("waterway"), t.get("landuse")
    if nat == "beach": return "B"
    if nat == "coastline": return "C"
    if nat in ("cliff", "bare_rock", "rock", "stone", "scree", "arete", "ridge") or (nat == "valley" and re.search(r"gorge", t.get("name") or "", re.I)): return "K"
    if ww == "waterfall" or nat == "waterfall": return "F"
    if ww in ("dam", "weir") or lu == "reservoir" or wat in ("reservoir",): return "D"
    if ww == "river" or wat in ("river", "stream") or (ww in ("stream", "canal") and t.get("name")): return "R"
    if nat == "water" and (wat in ("lake", "lagoon", "oxbow") or (wat in ("", "pond") and t.get("name"))): return "L"
    return None


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    qx, qy = ax + t * dx - px, ay + t * dy - py
    return math.hypot(qx, qy)


def check(k, pts):
    r = RADIUS[k]
    rd = r / 111000 * 1.6
    for j in range(max(1, len(pts) - 1) if len(pts) > 1 else 1):
        a = pts[j]; b = pts[j + 1] if len(pts) > 1 else pts[j]
        s, n = min(a[1], b[1]) - rd, max(a[1], b[1]) + rd
        w, e = min(a[0], b[0]) - rd, max(a[0], b[0]) + rd
        if (n - s) > 2 or (e - w) > 2: continue
        for ci in range(math.floor(s / CELL), math.floor(n / CELL) + 1):
            for cj in range(math.floor(w / CELL), math.floor(e / CELL) + 1):
                for i in grid.get((ci, cj), ()):
                    if k in flags[i]: continue
                    la, lo = camps[i]
                    if not (s <= la <= n and w <= lo <= e): continue
                    kx = 111320 * math.cos(math.radians(la))
                    dist = seg_dist(lo * kx, la * 110540, a[0] * kx, a[1] * 110540, b[0] * kx, b[1] * 110540)
                    if dist <= r: flags[i].add(k)


def rings(g):
    ty, c = g.get("type"), g.get("coordinates")
    if ty == "Point": return [[c]]
    if ty == "LineString": return [c]
    if ty in ("MultiLineString", "Polygon"): return c
    if ty == "MultiPolygon": return [r for p in c for r in p]
    return []


n = 0
with open(feat_path) as f:
    for line in f:
        line = line.strip().lstrip("\x1e")
        if not line: continue
        ft = json.loads(line)
        k = kind(ft.get("properties") or {})
        if not k: continue
        for ring in rings(ft.get("geometry") or {}):
            if ring: check(k, ring)
        n += 1
print("features", n)

out = {}
order = "BCRLDKF"
for i, fl in flags.items():
    if fl:
        la, lo = camps[i]
        out[f"{la:.4f},{lo:.4f}"] = "".join(x for x in order if x in fl)
tally = {k: sum(1 for v in out.values() if k in v) for k in order}
print("camps with features", len(out), tally)
json.dump({"built": d.get("built"), "f": out}, open(out_path, "w"), separators=(",", ":"))
