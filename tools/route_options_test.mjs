// Tries the Route options logic (docs/routes.js) on long trips with real routers, and draws each trip's options.
//   node tools/route_options_test.mjs <out dir> [path to the AppleRoute helper]
// Apple Maps (through tools/AppleRoute.swift, on a Mac) is what the iPhone app uses; Valhalla is what the website uses
// (here the public FOSSGIS server, which runs the same router as Stadia Maps).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const R = require(path.join(root, "docs/routes.js"));
const out = path.resolve(process.argv[2] || "route-tests");
fs.mkdirSync(out, { recursive: true });
const appleBin = process.argv[3];
const only = (process.env.BACKENDS || "apple,valhalla").split(",");

const RAD = Math.PI / 180;
const hav = (a, b) => { const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2; return 12742000 * Math.asin(Math.min(1, Math.sqrt(h))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the app's nearest-town lookup, from the same town list
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/data/camps-au.json"), "utf8"));
const towns = (data.towns || []).map(([lat, lon, name, rank]) => ({ lat, lon, name, rank: rank || 1 }));
function townNear(lat, lon) {
  let best = null, bs = Infinity;
  for (const t of towns) {
    if (Math.abs(t.lat - lat) > 0.6 || Math.abs(t.lon - lon) > 0.6) continue;
    const d = hav([lat, lon], [t.lat, t.lon]); if (d > 60000) continue;
    const sc = d * (t.rank >= 2 ? 0.7 : 1); if (sc < bs) { bs = sc; best = { ...t, d }; }
  }
  return best;
}
const town = (name) => { const t = towns.filter((x) => x.name === name).sort((x, y) => y.rank - x.rank)[0]; if (!t) throw new Error(`no town ${name}`); return { name, lat: t.lat, lon: t.lon }; };

// ---- routers
let apple = null, requests = 0;
if (only.includes("apple") && appleBin && fs.existsSync(appleBin)) {
  const p = spawn(appleBin, [], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", id = 0;
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const j = JSON.parse(line); waiting.get(j.id)?.(j); waiting.delete(j.id); } catch { /* not ours */ }
    }
  });
  const cache = new Map();
  apple = {
    leg(a, b) {
      const k = `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
      if (!cache.has(k)) cache.set(k, new Promise((res) => { const n = ++id; requests++; waiting.set(n, res); p.stdin.write(JSON.stringify({ id: n, from: [a.lat, a.lon], to: [b.lat, b.lon] }) + "\n"); }));
      return cache.get(k);
    },
    close: () => p.stdin.end(),
  };
}
async function appleRoute(points) {
  const legs = await Promise.all(points.slice(1).map((b, i) => apple.leg(points[i], b)));
  const bad = legs.find((l) => !l.ok); if (bad) throw new Error(bad.error || "No route");
  const coordinates = [];
  legs.forEach((l, i) => coordinates.push(...(i ? l.coordinates.slice(1) : l.coordinates)));
  return { distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), geometry: { coordinates } };
}
function poly6(str) {
  const pts = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k) lon += d; else lat += d;
    }
    pts.push([lon / 1e6, lat / 1e6]);
  }
  return pts;
}
let lastV = 0;
const vCache = new Map();
async function valhallaRoute(points) {
  const body = { locations: points.map((p) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) })), costing: "auto", costing_options: { auto: {} }, units: "kilometers", directions_type: "none" };
  const key = JSON.stringify(body.locations);
  if (vCache.has(key)) return vCache.get(key);
  const go = (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = Math.max(0, lastV + 1200 - Date.now()); lastV = Date.now() + wait; await sleep(wait);
      requests++;
      const r = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`, { headers: { "User-Agent": "CampFinder-route-options-check (github.com/Will-Richter/camp-finder)" } }).catch((e) => ({ ok: false, status: 0, e }));
      if (r.status === 429 || r.status === 0 || r.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      const j = await r.json();
      if (!j.trip?.legs?.length) throw new Error(j.error || "No route");
      const coordinates = [];
      j.trip.legs.forEach((l, k) => { const c = poly6(l.shape); coordinates.push(...(k ? c.slice(1) : c)); });
      return { distance: j.trip.summary.length * 1000, duration: j.trip.summary.time, geometry: { coordinates } };
    }
    throw new Error("Valhalla busy");
  })();
  vCache.set(key, go);
  return go;
}

// ---- drawing
const recap = fs.readFileSync(path.join(root, "docs/recap.js"), "utf8");
const COAST = JSON.parse(/const COAST = (\[.*?\]);/s.exec(recap)[1]), TAS = JSON.parse(/const TAS = (\[.*?\]);/s.exec(recap)[1]);
const COLORS = ["#1F8A4C", "#1D7FB8", "#D9822B", "#8E5CC4", "#C8463D", "#2A9D8F"];
function svg(title, a, b, list) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const o of list) for (const [la, lo] of o.line.pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const padY = Math.max(1.2, (n - s) * 0.12), padX = Math.max(1.2, (e - w) * 0.12);
  s -= padY; n += padY; w -= padX; e += padX;
  const k = Math.cos(((s + n) / 2) * RAD), W = 1000, H = Math.round(W * (n - s) / ((e - w) * k));
  const X = (lo) => ((lo - w) / (e - w) * W).toFixed(1), Y = (la) => ((n - la) / (n - s) * H).toFixed(1);
  const poly = (pts) => pts.map(([lo, la]) => `${X(lo)},${Y(la)}`).join(" ");
  const legend = list.map((o, i) => `<text x="16" y="${H + 30 + i * 26}" font-size="18" font-family="Helvetica"><tspan fill="${COLORS[i]}" font-weight="bold">● ${o.title}</tspan> ${Math.round(o.route.distance / 1000)} km · ${(o.route.duration / 3600).toFixed(1)} h${o.fastest ? " · fastest" : ""}${o.dirt.length ? ` · dirt: ${o.dirt.join(", ")}` : ""}${o.pts.length ? ` · through ${o.pts.map((p) => p.name).join(", ")}` : ""}</text>`).join("");
  const lines = list.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => {
    const st = []; let next = 0; for (let j = 0; j < o.line.pts.length; j++) if (o.line.cum[j] >= next) { st.push([o.line.pts[j][1], o.line.pts[j][0]]); next = o.line.cum[j] + 3000; }
    return `<polyline points="${poly(st)}" fill="none" stroke="white" stroke-width="9" stroke-linejoin="round"/><polyline points="${poly(st)}" fill="none" stroke="${COLORS[i]}" stroke-width="5" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40 + list.length * 26}" viewBox="0 0 ${W} ${H + 40 + list.length * 26}">
<rect width="100%" height="100%" fill="#F6F7F4"/><rect width="${W}" height="${H}" fill="#DCEBF2"/>
<polygon points="${poly(COAST)}" fill="#EEF1ED" stroke="#B9C2BC"/><polygon points="${poly(TAS)}" fill="#EEF1ED" stroke="#B9C2BC"/>
${lines}
<circle cx="${X(a.lon)}" cy="${Y(a.lat)}" r="9" fill="#0E5A3E" stroke="white" stroke-width="3"/><circle cx="${X(b.lon)}" cy="${Y(b.lat)}" r="9" fill="#F5C518" stroke="#1A1608" stroke-width="3"/>
<text x="16" y="${H - 14}" font-size="22" font-weight="bold" font-family="Helvetica" fill="#17201C">${title}</text>
${legend}</svg>`;
}

// ---- the trips
const TRIPS = [
  ["Bundaberg", "Exmouth"], ["Exmouth", "Bundaberg"], ["Brisbane", "Perth"], ["Cairns", "Perth"], ["Melbourne", "Darwin"],
  ["Sydney", "Darwin"], ["Bundaberg", "Broome"], ["Adelaide", "Darwin"], ["Brisbane", "Sydney"], ["Bundaberg", "Melbourne"],
  ["Melbourne", "Adelaide"], ["Perth", "Darwin"], ["Townsville", "Alice Springs"], ["Sydney", "Perth"],
];
const backends = [];
if (apple) backends.push(["apple", appleRoute]);
if (only.includes("valhalla")) backends.push(["valhalla", valhallaRoute]);
const SHORT = new Set(["Brisbane-Sydney", "Melbourne-Adelaide", "Bundaberg-Melbourne", "Townsville-Alice Springs"]);   // the public Valhalla server stops at 1500 km
const results = [];
let md = `# Route options check\n\n${new Date().toISOString()}\n\n`;
for (const [name, route] of backends) {
  md += `## ${name === "apple" ? "Apple Maps (iPhone app)" : "Valhalla (website)"}\n\n`;
  for (const [x, y] of TRIPS) {
    if (name === "valhalla" && !SHORT.has(`${x}-${y}`)) continue;
    const a = town(x), b = town(y), slug = `${name}-${x}-${y}`.replace(/\s+/g, "_");
    const t0 = Date.now(), r0 = requests;
    try {
      const base = await route([a, b]);
      const logs = [];
      const list = await R.choices(a, b, base, { route, townNear, max: 5, timeout: 240000, log: (t) => logs.push(t) });
      const secs = (Date.now() - t0) / 1000;
      const rows = list.map((o) => ({ title: o.title, km: Math.round(o.route.distance / 1000), h: +(o.route.duration / 3600).toFixed(1), fastest: o.fastest, dirt: o.dirt, through: o.pts.map((p) => p.name) }));
      results.push({ backend: name, from: x, to: y, secs, requests: requests - r0, options: rows, summary: R.describe(list[0].line, a, b) });
      md += `### ${x} to ${y}  (${secs.toFixed(0)} s, ${requests - r0} requests)\n\n![](${slug}.svg)\n\n` + rows.map((o) => `- **${o.title}** ${o.km} km, ${o.h} h${o.fastest ? " (fastest)" : ""}${o.dirt.length ? `, dirt: ${o.dirt.join(", ")}` : ""}${o.through.length ? `, through ${o.through.join(", ")}` : ""}`).join("\n") + "\n\n<details><summary>Tried</summary>\n\n" + logs.map((l) => `- ${l}`).join("\n") + "\n</details>\n\n";
      fs.writeFileSync(path.join(out, `${slug}.svg`), svg(`${x} to ${y} (${name})`, a, b, list));
      console.log(`${name} ${x} -> ${y}: ${secs.toFixed(0)} s, ${requests - r0} requests\n${rows.map((o) => `   ${o.title} ${o.km} km ${o.h} h${o.fastest ? " fastest" : ""}${o.dirt.length ? " dirt " + o.dirt : ""} [${o.through.join(", ")}]`).join("\n")}`);
    } catch (e) {
      md += `### ${x} to ${y}\n\nFailed: ${e.message}\n\n`;
      console.log(`${name} ${x} -> ${y}: FAILED ${e.stack || e.message}`);
      results.push({ backend: name, from: x, to: y, error: String(e.message || e) });
    }
  }
}
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(out, "README.md"), md);
apple?.close();
process.exit(0);
