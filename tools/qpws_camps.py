"""Every Queensland Parks camping area (campgrounds A to Z) with its location, access and facilities.
Writes docs/qpws-camps.js: window.CF_QPWS_ALL = [[park, page, name, lat, lon, flags], ...]  (flags as in islands.js)."""
import json, re, sys, time, html
from concurrent.futures import ThreadPoolExecutor
import urllib.request

BASE = "https://parks.qld.gov.au"
UA = {"User-Agent": "Mozilla/5.0 (CampFinder data build; contact will@sunwisesolarcleaning.com)"}
FLAGS = [("H", "High clearance 4WD"), ("4", "4WD"), ("B", "Boat"), ("A", "Walk-in"), ("T", "Toilets (flush)"), ("t", "Toilets (non-flush)"),
         ("S", "Hot showers"), ("s", "Cold showers"), ("F", "Campfires allowed"), ("G", "Generators allowed"), ("C", "Camper trailer camping"),
         ("V", "Caravan camping"), ("M", "Campervan camping"), ("K", "Tent camping beside car"), ("L", "Long walk to tent"), ("W", "Wheelchair"),
         ("P", "Picnic"), ("E", "Electric"), ("D", "Dogs"), ("2", "2WD"), ("R", "Drinking water"), ("O", "Tap water")]

def get(path, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if k == tries - 1: print("fail", path, e, file=sys.stderr); return ""
            time.sleep(2 + k * 3)

def section(page, label):
    i = page.find(">" + label)
    if i < 0: return []
    chunk = page[i:i + 6000]
    j = chunk.find("</ul>")
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", li))).strip() for li in re.findall(r"<li[^>]*>(.*?)</li>", chunk[:j if j > 0 else 6000], re.S)]

def camp(path):
    page = get(path)
    if not page: return None
    m = re.search(r"(-[12]\d\.\d{3,})[^\d-]{1,20}(1[3-5]\d\.\d{3,})", page)
    if not m: return None
    h1 = re.findall(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", h1[-1] if h1 else ""))).strip()
    name = re.sub(r" camping area$", "", name, flags=re.I).replace(" camping area ", " ")
    items = section(page, "Accessible by") + section(page, "Camping area facilities")
    fl = "".join(c for c, lab in FLAGS if any(x.startswith(lab) for x in items))
    p = path.split("/")
    return [p[2], p[4], name, round(float(m.group(1)), 5), round(float(m.group(2)), 5), fl]

idx = get("/parks/campgrounds-a-z?list=all")
paths = sorted(set(re.findall(r"/parks/[a-z0-9-]+/camping/[a-z0-9-]+", idx)))
print("camp pages", len(paths))
with ThreadPoolExecutor(6) as ex: rows = [r for r in ex.map(camp, paths) if r]
print("with location", len(rows))
if len(rows) < 200: sys.exit("too few camps, keeping the old file")
with open("docs/qpws-camps.js", "w") as f:
    f.write("/* Every Queensland Parks camping area, from parks.qld.gov.au (built by tools/qpws_camps.py). Same row format as islands.js. */\n")
    f.write("window.CF_QPWS_ALL = [\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n];\n")
