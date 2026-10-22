/* Gone Lappin' Camp Finder
 * Live data: OpenStreetMap via Overpass (camps, boat ramps, dump points),
 * OSRM (driving routes + turn-by-turn), Photon (place search),
 * Wikimedia Commons (photos taken nearby).
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- config
  const CFG = {
    overpass: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ],
    osrm: [
      "https://router.project-osrm.org/route/v1/driving/",
      "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
    ],
    photon: "https://photon.komoot.io/api/",
    commons: "https://commons.wikimedia.org/w/api.php",
    auBox: [112.5, -44.5, 154.5, -9.5], // w,s,e,n
    // Camp database built into the app, refreshed weekly from the published copy (tools/build_camp_data.py)
    campData: "data/camps-au.json",
    campDataLive: "https://raw.githubusercontent.com/Will-Richter/camp-finder/main/docs/data/camps-au.json",
    // Google Places photos: paste an iOS-restricted Places API key here to switch them on (see GOOGLE_PHOTOS.md)
    googleKey: "AIzaSyAmDLzNnWpVNQTEFOCiarRRCJCfkdl1EJs", // restricted to the Camp Finder iPhone app and the Places API
    stadiaKey: "21bef218-b23a-4eba-bf2e-20bca8e2f73c", // Stadia Maps key for the map background (free while testing). Empty = OpenStreetMap's own tiles
    priceData: "data/prices.json",
    priceDataLive: "https://raw.githubusercontent.com/Will-Richter/camp-finder/main/docs/data/prices.json",
    googleReviews: true, // also show the Google star rating and up to 5 Google reviews (needs googleKey)
    googlePhotos: 4, // photos per camp (each one shown is billed by Google after the free monthly allowance)
    exploreMinZoom: 9,
    boatRampKm: 5,
    dumpKm: 10,
    shareUrl: null, // set to the shared camps API once accounts are switched on
  };

  const AMENITIES = [
    { id: "toilets", label: "Toilets" },
    { id: "water", label: "Drinking water" },
    { id: "showers", label: "Showers" },
    { id: "dogs", label: "Dogs allowed" },
    { id: "boatramp", label: "Boat ramp nearby" },
    { id: "dump", label: "Dump point nearby" },
    { id: "power", label: "Powered sites" },
    { id: "fires", label: "Campfires" },
  ];

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  function hav(a, b) { // [lat,lon]
    const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const km = (m) => (m >= 100000 ? Math.round(m / 1000) : Math.round(m / 100) / 10).toLocaleString("en-AU") + " km";
  function hrs(sec) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }, // false = storage full
  };
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  async function fetchJSON(url, opts = {}, timeoutMs = 30000) {
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(id); }
  }

  // ---------------------------------------------------------------- native fetch bridge (iOS app): no CORS limits, proper app identity
  const nativeFetch = (() => {
    const h = window.webkit?.messageHandlers?.nativeFetch;
    if (!h) return null;
    let n = 0; const cbs = {};
    window.__cfFetchDone = (id, ok, body) => { const c = cbs[id]; delete cbs[id]; if (c) ok ? c.res(body) : c.rej(new Error(body || "Network error")); };
    return (url, opts = {}) => new Promise((res, rej) => {
      const id = ++n, ms = opts.timeout || 30000; cbs[id] = { res, rej };
      h.postMessage({ id, url, method: opts.method, body: opts.body, contentType: opts.contentType, headers: opts.headers, timeout: ms / 1000 });
      setTimeout(() => { if (cbs[id]) { delete cbs[id]; rej(new Error("timeout")); } }, ms + 2000);
    });
  })();

  // Apple Maps bridges (iOS app): place search and driving directions without public servers
  function nativeCall(name, done) {
    const h = window.webkit?.messageHandlers?.[name];
    if (!h) return null;
    let n = 0; const cbs = {};
    window[done] = (id, ok, v) => { const c = cbs[id]; delete cbs[id]; if (c) ok ? c.res(v) : c.rej(new Error(String(v || "Failed"))); };
    return (msg, ms = 20000) => new Promise((res, rej) => {
      const id = ++n; cbs[id] = { res, rej };
      h.postMessage({ id, ...msg });
      setTimeout(() => { if (cbs[id]) { delete cbs[id]; rej(new Error("timeout")); } }, ms);
    });
  }
  const nativePlaces = nativeCall("places", "__cfPlacesDone");
  const nativeRoute = nativeCall("route", "__cfRouteDone");

  // ---------------------------------------------------------------- data: Overpass
  const CAMP_SEL = 'nwr["tourism"~"^(camp_site|caravan_site)$"]';
  // Ask all public Overpass servers at once and use the first good answer (they're often busy).
  async function overpass(query) {
    const body = "data=" + encodeURIComponent(query);
    const one = async (ep) => {
      const json = nativeFetch
        ? JSON.parse(await nativeFetch(ep, { method: "POST", body, contentType: "application/x-www-form-urlencoded", timeout: 60000 }))
        : await fetchJSON(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, 60000);
      if (!json || !Array.isArray(json.elements)) throw new Error("Bad response");
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      return json;
    };
    try { return await Promise.any(CFG.overpass.map(one)); }
    catch (e) { throw (e.errors && e.errors[0]) || e; }
  }

  function parseElements(json) {
    const camps = [], ramps = [], dumps = [];
    for (const el of json.elements || []) {
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      const p = { id: `${el.type}/${el.id}`, lat, lon, tags: t };
      if (t.tourism === "camp_site" || t.tourism === "caravan_site") camps.push(normalise(p));
      else if (t.leisure === "slipway") ramps.push(p);
      else if (t.amenity === "sanitary_dump_station") dumps.push(p);
    }
    return { camps, ramps, dumps };
  }

  const yes = (v) => v != null && /^(yes|designated|permissive|leashed|customers|limited|free|outside|inside|seasonal)$/i.test(v);
  const no = (v) => v != null && /^(no|none|0)$/i.test(v);
  function tri(v) { return yes(v) ? true : no(v) ? false : null; }

  // A camp with no name gets one from where it is: "Free camp near Gin Gin"
  function placeName(c, town) {
    const t = c.tags || {};
    const what = t.tourism === "caravan_site" ? "RV stop" : t.backcountry === "yes" ? (c.cost === "free" ? "Free bush camp" : "Bush camp") : c.cost === "free" ? "Free camp" : "Camp";
    const where = t.is_in ? String(t.is_in).split(/[,;]/)[0].trim() : "";
    if (!town) return where ? `${what} near ${where}` : `Unnamed ${what.toLowerCase()}`;
    if (town.d < 2500) return `${what} at ${town.name}`;
    if (town.d < 10000) return `${what} near ${town.name}`;
    return `${what}, ${Math.round(town.d / 1000)} km from ${town.name}`;
  }

  function normalise(p) {
    const t = p.tags;
    let cost = "unknown";
    if (no(t.fee) || /^(free|donation)$/i.test(t.fee || "")) cost = "free";
    else if (yes(t.fee) || t.charge) cost = "paid";
    const dogs = tri(t.dog ?? t.dogs ?? t.pets);
    const fires = tri(t.openfire ?? t.fireplace ?? t.campfire);
    return {
      ...p,
      name: t.name || t["name:en"] || placeName({ cost, tags: t }, typeof campDB !== "undefined" && campDB.townNear ? campDB.townNear(p.lat, p.lon) : null),
      named: !!t.name,
      kind: t.tourism === "caravan_site" ? "Caravan / RV site" : (t.backcountry === "yes" ? "Bush camp" : "Campground"),
      cost,
      donation: /donation/i.test(t.fee || ""),
      charge: t.charge || "",
      a: {
        toilets: tri(t.toilets),
        water: tri(t.drinking_water ?? t.water_point),
        showers: tri(t.shower ?? t.showers),
        dogs,
        power: tri(t.power_supply),
        fires,
        dumpOnSite: tri(t.sanitary_dump_station),
      },
      tents: tri(t.tents), caravans: tri(t.caravans), motorhome: tri(t.motorhome),
      backcountry: t.backcountry === "yes",
      maxstay: t.maxstay || "",
      access: t.access || "",
      website: t.website || t["contact:website"] || t.url || "",
      phone: t.phone || t["contact:phone"] || "",
      operator: t.operator || "",
      desc: t.description || t.note || "",
      image: t.image || "",
      commons: t.wikimedia_commons || "",
      hours: t.opening_hours || "",
    };
  }

  function nearestDist(p, pts) {
    let best = Infinity;
    for (const q of pts) { const d = hav([p.lat, p.lon], [q.lat, q.lon]); if (d < best) best = d; }
    return best;
  }
  function enrich(camps, ramps, dumps) {
    for (const c of camps) {
      c.rampM = ramps.length ? nearestDist(c, ramps) : Infinity;
      c.dumpM = c.a.dumpOnSite ? 0 : (dumps.length ? nearestDist(c, dumps) : Infinity);
    }
    return camps;
  }

  // ---------------------------------------------------------------- matching & scoring
  function rigOK(c, rig) {
    if (c.access === "private" || c.access === "no") return false;
    if (rig === "tent") return c.tents !== false;
    if (rig === "rooftop") return true;
    if (rig === "camper") return !c.backcountry || c.caravans === true;
    if (rig === "caravan") return c.caravans !== false && !c.backcountry && !(c.tents === true && c.caravans == null && c.kind === "Bush camp");
    if (rig === "motorhome") return c.motorhome !== false && c.caravans !== false && !c.backcountry;
    return true;
  }
  function has(c, id) {
    switch (id) {
      case "toilets": return c.a.toilets === true;
      case "water": return c.a.water === true;
      case "showers": return c.a.showers === true;
      case "dogs": return c.a.dogs === true;
      case "power": return c.a.power === true;
      case "fires": return c.a.fires === true;
      case "boatramp": return c.rampM <= CFG.boatRampKm * 1000;
      case "dump": return c.dumpM <= CFG.dumpKm * 1000;
      default: return true;
    }
  }
  function missing(c, wants) { return wants.filter((w) => !has(c, w)); }

  // ---- More filters (explore): big rigs, 2WD / 4WD access, longer stays
  const MORE_FILTERS = [
    { id: "bigrig", label: "Big rig OK", icon: "🚌" },
    { id: "twowd", label: "2WD access", icon: "🚗" },
    { id: "fourwd", label: "4WD camps", icon: "⛰️" },
    { id: "longstay", label: "Stay 3+ nights", icon: "📅" },
  ];
  const textOf = (c) => `${c.name || ""} ${c.desc || ""} ${c.tags?.note || ""} ${c.tags?.description || ""}`;
  function maxStayDays(c) {
    if (!c) return null;
    const v = String(c.maxstay || c.tags?.maxstay || "").toLowerCase();
    const m = /(\d+(?:\.\d+)?)\s*(hour|hr|h\b|day|night|week|month)/.exec(v);
    if (m) {
      const n = +m[1], u = m[2];
      if (/^h/.test(u)) return n >= 18 ? Math.max(1, Math.round(n / 24)) : 0;
      return Math.round(n * (/^w/.test(u) ? 7 : /^m/.test(u) ? 30 : 1));
    }
    if (/overnight/.test(v)) return 1;
    if (c.kind === "Roadside rest area") return 1;
    return null;
  }
  const isFourWD = (c) => c.tags?.["4wd_only"] === "yes" || /\b(4wd|4x4|four.?wheel.?drive|high clearance)\b/i.test(textOf(c));
  function bigRigOK(c) {
    const txt = textOf(c);
    if (c.caravans === false || c.backcountry || c.access === "no" || c.access === "private" || isFourWD(c)) return false;
    if (/(no|not suitable for)\s+(big rigs?|large (rigs?|vehicles|vans|caravans)|caravans)|small (rigs?|vehicles|vans) only/i.test(txt)) return false;
    const len = parseFloat(c.tags?.maxlength); if (len && len < 9) return false;
    return !!(c.heavy || c.caravans === true || c.motorhome === true || c.kind === "Caravan / RV site" || len >= 9 || /big rigs?|large rigs?|drive.?through|b-?doubles?|road ?trains?|truck parking/i.test(txt));
  }
  function moreOK(c, f) {
    switch (f) {
      case "bigrig": return bigRigOK(c);
      case "twowd": return !isFourWD(c) && !c.backcountry;
      case "fourwd": return isFourWD(c);
      case "longstay": { const d = maxStayDays(c); return d != null ? d >= 3 : c.kind !== "Roadside rest area"; }
      default: return true;
    }
  }
  // Many camps don't record every amenity. For trip planning, "not recorded" passes a must-have
  // (with a note); only a recorded "no" rules a camp out.
  const SHORT_LABEL = { toilets: "Toilets", water: "Drinking water", showers: "Showers", dogs: "Dogs allowed", power: "Power", fires: "Campfires", boatramp: "Boat ramp", dump: "Dump point" };
  const AMEN_KEY = { toilets: "toilets", water: "water", showers: "showers", dogs: "dogs", power: "power", fires: "fires" };
  const unknownFor = (c, w) => AMEN_KEY[w] ? c.a[AMEN_KEY[w]] == null : false;
  function ruledOut(c, wants) { return wants.filter((w) => !has(c, w) && !unknownFor(c, w)); }
  function unrecorded(c, wants) { return wants.filter((w) => !has(c, w) && unknownFor(c, w)); }
  function costOK(c, mode) { return mode === "any" || mode === "cheap" || c.cost === "free"; }

  function score(c, wants, costMode) {
    let s = 0;
    if (c.cost === "free") s += 40; else if (c.cost === "unknown") s += 14; else s += costMode === "any" ? 20 : 0;
    for (const id of ["toilets", "water", "showers", "dogs", "power", "fires"]) if (c.a[id] === true) s += 4;
    s += wants.filter((w) => has(c, w)).length * 12;
    s -= wants.filter((w) => unknownFor(c, w)).length * 4;
    if (c.named) s += 5;
    if (c.source === "rest") s -= 22; // a proper camp beats a highway rest area
    if (c.source === "user") s += 3;
    if (c.website || c.phone) s += 2;
    if (c.desc) s += 2;
    if (c.rampM <= CFG.boatRampKm * 1000) s += 3;
    return s;
  }

  // ---------------------------------------------------------------- routing
  async function osrm(points, steps = false) {
    if (nativeRoute) {
      try { return await appleRoute(points, steps); }
      catch (e) { if (/No route|directions not available/i.test(e.message)) throw new Error("No route"); /* else try the web routers */ }
    }
    const coords = points.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    const q = `?overview=full&geometries=geojson&steps=${steps}`;
    let lastErr;
    for (const base of CFG.osrm) {
      try {
        const j = await fetchJSON(base + coords + q, {}, 30000);
        if (j.code !== "Ok" || !j.routes?.length) throw new Error(j.message || "No route");
        return j.routes[0];
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Routing unavailable");
  }

  // Apple Maps route, shaped like an OSRM route (multi-stop = one leg per pair)
  async function appleRoute(points, steps) {
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      legs.push(await nativeRoute({ from: [points[i - 1].lat, points[i - 1].lon], to: [points[i].lat, points[i].lon], steps }, 30000));
    }
    const coordinates = [];
    legs.forEach((l, i) => coordinates.push(...(i ? l.coordinates.slice(1) : l.coordinates)));
    return {
      distance: legs.reduce((a, l) => a + l.distance, 0),
      duration: legs.reduce((a, l) => a + l.duration, 0),
      geometry: { type: "LineString", coordinates },
      legs: legs.map((l) => ({
        distance: l.distance, duration: l.duration,
        steps: (l.steps || []).map((s) => ({ distance: s.distance, text: s.text, maneuver: { type: "apple" } })),
      })),
    };
  }

  function buildLine(route) {
    const pts = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] };
  }
  function sample(line, stepM) {
    const out = [line.pts[0]]; let next = stepM;
    for (let i = 1; i < line.pts.length; i++) {
      if (line.cum[i] >= next) { out.push(line.pts[i]); next = line.cum[i] + stepM; }
    }
    out.push(line.pts[line.pts.length - 1]);
    return out;
  }
  // min/max without spreading (spreading a huge route into Math.min throws on very long trips)
  function minOf(a) { let m = Infinity; for (const v of a) if (v < m) m = v; return m; }
  function maxOf(a) { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; }
  // Route points bucketed into ~25 km cells, so finding the nearest point on a 14,000 km route is quick
  function lineGrid(line) {
    if (line._g) return line._g;
    const g = new Map();
    line.pts.forEach((p, i) => { const k = `${Math.floor(p[0] * 4)}:${Math.floor(p[1] * 4)}`; let b = g.get(k); if (!b) g.set(k, (b = [])); b.push(i); });
    return (line._g = g);
  }
  function project(line, c) {
    // nearest route vertex (route geometry is dense enough for camp-scale accuracy)
    let best = Infinity, at = 0;
    const g = lineGrid(line), cy = Math.floor(c.lat * 4), cx = Math.floor(c.lon * 4);
    for (let r = 1; r <= 4 && best === Infinity; r += r < 2 ? 1 : 2) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const b = g.get(`${cy + dy}:${cx + dx}`); if (!b) continue;
        for (const i of b) { const d = hav(line.pts[i], [c.lat, c.lon]); if (d < best) { best = d; at = line.cum[i]; } }
      }
    }
    if (best === Infinity) { // far from the route: check every point
      const step = line.pts.length > 6000 ? 4 : 1;
      for (let i = 0; i < line.pts.length; i += step) { const d = hav(line.pts[i], [c.lat, c.lon]); if (d < best) { best = d; at = line.cum[i]; } }
    }
    return { off: best, along: at };
  }
  // ---- Return trips: the route goes out and comes back, often on the same road, so a camp, servo or sight can be
  // "on the way" twice. These give its position on each leg separately (line.turn = where you turn around).
  function projectRange(line, c, lo, hi) {
    let best = Infinity, at = lo;
    const g = lineGrid(line), cy = Math.floor(c.lat * 4), cx = Math.floor(c.lon * 4);
    for (let r = 1; r <= 4 && best === Infinity; r += r < 2 ? 1 : 2) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const b = g.get(`${cy + dy}:${cx + dx}`); if (!b) continue;
        for (const i of b) { const cu = line.cum[i]; if (cu < lo || cu > hi) continue; const d = hav(line.pts[i], [c.lat, c.lon]); if (d < best) { best = d; at = cu; } }
      }
    }
    if (best === Infinity) { // far from this leg: check every point on it
      const step = line.pts.length > 6000 ? 4 : 1;
      for (let i = 0; i < line.pts.length; i += step) { const cu = line.cum[i]; if (cu < lo || cu > hi) continue; const d = hav(line.pts[i], [c.lat, c.lon]); if (d < best) { best = d; at = cu; } }
    }
    return { off: best, along: at };
  }
  function projectAll(line, c) {
    if (!line.turn) return [{ ...project(line, c), leg: "" }];
    return [{ ...projectRange(line, c, 0, line.turn), leg: "" }, { ...projectRange(line, c, line.turn, line.total), leg: "back" }];
  }
  // one copy per leg it's near (the way-back copy is marked _leg: "back")
  function perLeg(line, list, maxOff, idSuffix = false) {
    if (!line.turn) return list.map((x) => ({ ...x, ...project(line, x) })).filter((x) => x.off <= maxOff);
    const out = [];
    for (const x of list) for (const pr of projectAll(line, x)) {
      if (pr.off > maxOff) continue;
      out.push({ ...x, a: x.a ? { ...x.a } : x.a, along: pr.along, off: pr.off, _leg: pr.leg, ...(idSuffix && pr.leg ? { id: `${x.id}@back` } : {}) });
    }
    return out;
  }
  // where on the route you reach your destination and turn for home
  function markTurn(line, route, to, outLegs) {
    const legs = route.legs || [];
    const outDist = legs.slice(0, outLegs).reduce((a, l) => a + (l.distance || 0), 0);
    const approx = route.distance ? line.total * outDist / route.distance : line.total / 2;
    const win = line.total * 0.12;
    let best = Infinity, at = approx;
    line.pts.forEach((p, i) => { if (Math.abs(line.cum[i] - approx) <= win) { const d = hav(p, [to.lat, to.lon]); if (d < best) { best = d; at = line.cum[i]; } } });
    line.turn = at;
    return at;
  }

  // Turn-by-turn text from OSRM steps
  function stepText(s) {
    if (s.text) return s.text;
    const m = s.maneuver || {}, type = m.type, mod = m.modifier || "", road = s.name || s.ref || "";
    const onto = road ? ` onto ${road}` : "";
    const dir = mod.replace("uturn", "U-turn").replace("straight", "straight ahead");
    switch (type) {
      case "depart": return `Head off${road ? " on " + road : ""}`;
      case "arrive": return "Arrive at the camp";
      case "roundabout": case "rotary": case "roundabout turn":
        return `At the roundabout, take exit ${m.exit || 1}${onto}`;
      case "exit roundabout": case "exit rotary": return `Leave the roundabout${onto}`;
      case "merge": return `Merge ${dir}${onto}`;
      case "on ramp": return `Take the ramp ${dir}${onto}`;
      case "off ramp": return `Take the exit ${dir}${onto}`;
      case "fork": return `Keep ${dir} at the fork${onto}`;
      case "end of road": return `At the end of the road, turn ${dir}${onto}`;
      case "new name": case "continue": return mod && mod !== "straight" ? `Continue ${dir}${onto}` : `Continue${onto}`;
      default: return mod === "straight" ? `Continue${onto}` : `Turn ${dir}${onto}`;
    }
  }

  // ---------------------------------------------------------------- place search (Photon)
  const placeCache = new Map();
  async function searchPlaces(q) {
    const key = q.toLowerCase();
    if (placeCache.has(key)) return placeCache.get(key);
    let out = null;
    if (nativePlaces) { try { out = await nativePlaces({ q }, 10000); } catch { /* fall back to web search */ } }
    if (!out || !out.length) {
      try { out = await photonPlaces(q); } catch (e) { if (!out) throw e; }
    }
    placeCache.set(key, out);
    return out;
  }
  async function photonPlaces(q) {
    const [w, s, e, n] = CFG.auBox;
    const url = `${CFG.photon}?q=${encodeURIComponent(q)}&limit=8&lang=en&bbox=${w},${s},${e},${n}`;
    const j = await fetchJSON(url, {}, 10000);
    const seen = new Set();
    return (j.features || [])
      .filter((f) => !f.properties.country || /australia/i.test(f.properties.country))
      .map((f) => {
        const p = f.properties, [lon, lat] = f.geometry.coordinates;
        const name = p.name || p.street || q;
        const area = [p.city && p.city !== name ? p.city : "", p.county || "", p.state || ""].filter(Boolean).join(", ");
        return { name, area, lat, lon };
      })
      .filter((r) => { const k = r.name + r.area; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 6);
  }

  function attachSuggest(input, onPick) {
    const list = $(`#${input.id}-suggest`);
    let timer, active = -1, items = [];
    const close = () => { list.hidden = true; active = -1; };
    const render = () => {
      list.innerHTML = items.map((r, i) => `<li role="option" data-i="${i}" class="${i === active ? "is-active" : ""}">${esc(r.name)}<small>${esc(r.area)}</small></li>`).join("");
      list.hidden = !items.length;
    };
    input.addEventListener("input", () => {
      input.dataset.lat = ""; input.dataset.lon = "";
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { close(); return; }
      timer = setTimeout(async () => {
        try { items = await searchPlaces(q); render(); } catch { items = []; close(); }
      }, 350);
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0) { pick(items[active]); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li"); if (!li) return;
      e.preventDefault(); pick(items[+li.dataset.i]);
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
    function pick(r) {
      input.value = r.area ? `${r.name}, ${r.area.split(", ").pop()}` : r.name;
      input.dataset.lat = r.lat; input.dataset.lon = r.lon; close(); onPick && onPick(r);
    }
  }
  async function resolvePlace(input) {
    if (input.dataset.lat) return { name: input.value.split(",")[0], lat: +input.dataset.lat, lon: +input.dataset.lon };
    const q = input.value.trim();
    if (!q) throw new Error(`Enter a ${input.id === "from" ? "starting point" : "destination"}.`);
    const r = await searchPlaces(q);
    if (!r.length) throw new Error(`Couldn't find "${q}" in Australia.`);
    input.dataset.lat = r[0].lat; input.dataset.lon = r[0].lon;
    return { name: r[0].name, lat: r[0].lat, lon: r[0].lon };
  }

  // ---------------------------------------------------------------- photos (Wikimedia Commons, near the camp)
  const photoCache = new Map();
  async function photosNear(c) {
    if (photoCache.has(c.id)) return photoCache.get(c.id);
    const url = `${CFG.commons}?action=query&generator=geosearch&ggscoord=${c.lat}|${c.lon}&ggsradius=1500&ggslimit=10&ggsnamespace=6&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=520&format=json&origin=*`;
    let out = [];
    try {
      const j = await fetchJSON(url, {}, 12000);
      out = Object.values(j.query?.pages || {})
        .map((p) => p.imageinfo?.[0]).filter(Boolean)
        .filter((i) => /\.(jpe?g|png|webp)$/i.test(i.url))
        .map((i) => ({ thumb: i.thumburl, page: i.descriptionurl, by: (i.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim() }))
        .slice(0, 8);
    } catch { /* photos are optional */ }
    photoCache.set(c.id, out);
    return out;
  }


  // ---------------------------------------------------------------- trip logic
  function friendly(err) {
    const m = String(err?.message || err);
    if (navigator.onLine === false || /offline|internet connection appears/i.test(m)) return "No signal right now. Camps already on your phone are still shown, and routes will fill in when you're back in range.";
    if (/No route/i.test(m)) return "Couldn't find a driving route between those places.";
    if (/^(Enter a|Couldn't find ")/.test(m)) return m; // our own plain-English messages
    return "Camps for this area couldn't be loaded just now. Try again shortly, or download areas while you have signal.";
  }

  // ---------------------------------------------------------------- extra sources: official data, local rules, traveller-added camps
  async function getJSON(url) {
    if (nativeFetch) return JSON.parse(await nativeFetch(url));
    return fetchJSON(url, {}, 25000);
  }

  const SOURCES = {
    rest: { label: "Official rest area", by: "National Formal Rest Areas, Australian Government", url: "https://catalogue.data.infrastructure.gov.au/dataset/national-formal-rest-areas" },
    vicforest: { label: "Official state forest camp", by: "Recreation Sites, Victorian Government (CC BY 3.0)", url: "https://discover.data.vic.gov.au/dataset/recreation-sites" },
    osm: { label: "Community map", by: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
    user: { label: "Added by you", by: "You", url: "" },
    community: { label: "Traveller added", by: "a Camp Finder traveller", url: "" },
  };

  const YN = (v) => (v === "Y" ? true : v === "N" ? false : null);
  // Australia-wide rest areas (state road authorities, combined by the federal government)
  async function restAreasIn([s, w, n, e]) {
    const base = "https://spatial.infrastructure.gov.au/server/rest/services/Hosted/RADAR_Curated_Prod_restareas/FeatureServer/1/query";
    const url = `${base}?where=1%3D1&geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson&resultRecordCount=2000`;
    const j = await getJSON(url);
    return (j.features || []).map((f) => {
      const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      const truckOnly = /heavy vehicle only|trucks? only|no cars/i.test(p.comments || "");
      return {
        id: `rest/${p.radar_id || p.id}`, lat, lon, tags: {}, source: "rest",
        name: p.name || (p.reported_location ? `Rest area, ${p.reported_location}` : `Rest area near ${p.locality || "highway"}`),
        named: !!p.name, kind: "Roadside rest area", cost: "free", donation: false, charge: "",
        a: { toilets: YN(p.toilet), water: YN(p.water), showers: null, dogs: null, power: YN(p.power), fires: null, dumpOnSite: YN(p.waste_water) },
        tents: null, caravans: truckOnly ? false : null, motorhome: truckOnly ? false : null, backcountry: false,
        maxstay: "", access: truckOnly ? "no" : "", website: "", phone: "", operator: p.state ? `${p.state} road authority` : "", hours: "",
        desc: [p.comments, p.road_name].filter(Boolean).join(". "), image: "", commons: "",
        rule: "Overnight stays at rest areas depend on the signs at each site. Many allow up to 20 or 24 hours.",
        heavy: p.heavy_vehicle_area === "Y",
      };
    }).filter((c) => c.access !== "no");
  }

  // Victorian state forest recreation sites with camping
  async function vicForestIn([s, w, n, e]) {
    if (e < 140.9 || s > -33.9 || w > 150.1 || n < -39.3) return []; // outside Victoria
    const url = `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:recweb_site&outputFormat=application/json&srsName=EPSG:4326&count=1000&CQL_FILTER=${encodeURIComponent(`camping='Y' AND BBOX(geom,${s},${w},${n},${e},'EPSG:4326')`)}`;
    let j;
    try { j = await getJSON(url); }
    catch { j = await getJSON(url.replace(/BBOX\(geom/, "BBOX(the_geom")); }
    const now = Date.now();
    return (j.features || []).map((f) => {
      const p = f.properties || {};
      const lon = p.x_coord ?? f.geometry.coordinates[0], lat = p.y_coord ?? f.geometry.coordinates[1];
      const closed = p.clos_stat && (!p.clos_start || Date.parse(p.clos_start) <= now) && (!p.clos_open || Date.parse(p.clos_open) > now);
      return {
        id: `vic/${p.serial_no}`, lat, lon, tags: {}, source: "vicforest",
        name: p.name || p.label, named: true, kind: "State forest campground",
        cost: p.fee === "N" ? "free" : p.fee === "Y" ? "paid" : "unknown", donation: false, charge: "",
        a: { toilets: p.pct_aframe || p.pct_pedest || p.pct_other ? true : null, water: null, showers: null, dogs: p.walkingdog === "Y" ? true : null, power: null, fires: p.bbq_pit || p.bbq_wood ? true : null, dumpOnSite: null },
        tents: true, caravans: /CARAVAN/i.test(p.campervan_type || "") ? true : p.campervanning === "Y" ? null : null, motorhome: null, backcountry: false,
        maxstay: "", access: "", website: "https://www.ffm.vic.gov.au/recreation-and-tourism", phone: "", operator: "Victorian Government (state forest)", hours: "",
        desc: [p.comments, p.camping_c, p.access_dsc ? `Getting there: ${p.access_dsc}` : ""].filter(Boolean).join("\n\n"),
        image: "", commons: "",
        closed: closed ? (p.clos_desc || "Closed") + (p.clos_open ? ` Expected to reopen ${new Date(p.clos_open).toLocaleDateString("en-AU")}.` : "") : "",
      };
    });
  }

  // National park camps from OpenStreetMap: flag permits, fees and booking site by state
  const PARK_OP = /parks? and wildlife|qpws|national parks|npws|parks victoria|parks australia|dbca|parks tasmania|department of environment|parks sa|natural resources/i;
  function stateOf(lat, lon) { // accurate borders (Murray River, QLD rivers, SA corner) live in badges.js
    const st = window.CFGeo ? CFGeo.stateAt(lat, lon) : "QLD";
    return st === "ACT" ? "NSW" : st;
  }
  const BOOKING = {
    QLD: ["Queensland Parks", "https://qld.gov.au/camping"],
    NSW: ["NSW National Parks", "https://www.nationalparks.nsw.gov.au/camping-and-accommodation"],
    VIC: ["Parks Victoria", "https://www.parks.vic.gov.au/where-to-stay"],
    SA: ["National Parks SA", "https://www.parks.sa.gov.au/booking"],
    WA: ["Parks and Wildlife WA", "https://parks.dbca.wa.gov.au/campgrounds"],
    TAS: ["Parks Tasmania", "https://parks.tas.gov.au/explore-our-parks/know-before-you-go/camping"],
    NT: ["NT Parks", "https://nt.gov.au/parks/book"],
  };
  function markPark(c) {
    const t = c.tags || {};
    const isPark = PARK_OP.test(t.operator || "") || /national park|conservation park|state forest|regional park/i.test(`${t.name || ""} ${t["is_in"] || ""}`);
    if (!isPark) return c;
    const st = stateOf(c.lat, c.lon), [who, url] = BOOKING[st] || [];
    c.park = { state: st, who, url };
    if (st === "QLD" && c.cost === "unknown") { c.cost = "paid"; c.charge = "Camping permit"; }
    return c;
  }

  // Local camping rules (official council or tourism sources only)
  const RULES = [
    { place: "Agnes Water and Seventeen Seventy", lat: -24.2, lon: 151.89, km: 7,
      text: "Camping outside a campground or caravan park is illegal here and fined by police, rangers and the council.",
      src: "https://www.visitagnes1770.com.au/caravanning-camping/" },
  ];
  const rulesNear = (lat, lon) => RULES.filter((r) => hav([lat, lon], [r.lat, r.lon]) <= r.km * 1000);

  // Traveller-added camps (kept on this phone; CFG.shareUrl sends them to the shared database once accounts are switched on)
  const userCamps = () => store.get("cf-user-camps", []);
  function userCampsIn([s, w, n, e]) { return userCamps().filter((c) => c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e); }

  // Merge everything; an official or user camp within 150 m of a map camp adds to it instead of doubling up
  function mergeSources(osmCamps, extras, ramps = [], dumps = []) {
    osmCamps.forEach((c) => { c.source = c.source || "osm"; markPark(c); });
    const out = [...osmCamps];
    for (const x of extras) {
      const twin = out.find((c) => c.source === "osm" && hav([c.lat, c.lon], [x.lat, x.lon]) < 150);
      if (twin && x.source !== "user" && x.source !== "community") {
        twin.also = x.source; twin.closed = x.closed || twin.closed;
        for (const k of Object.keys(x.a)) if (twin.a[k] == null && x.a[k] != null) twin.a[k] = x.a[k];
        if (!twin.desc && x.desc) twin.desc = x.desc;
        if (twin.cost === "unknown" && x.cost !== "unknown") twin.cost = x.cost;
      } else out.push(x);
    }
    return enrich(out, ramps, dumps);
  }
  async function extrasIn(bbox) {
    const cloud = window.CFCloud?.enabled ? window.CFCloud.campsIn(bbox) : Promise.resolve([]);
    const jobs = [restAreasIn(bbox), vicForestIn(bbox), cloud].map((p) => p.catch(() => []));
    const [rest, vic, shared] = await Promise.all(jobs);
    const sharedIds = new Set(shared.map((c) => c.cloudId));
    const mineLocal = userCampsIn(bbox).filter((c) => !c.cloudId || !sharedIds.has(c.cloudId));
    return [...vic, ...rest, ...shared, ...mineLocal];
  }
  const bboxOf = (pts, padDeg = 0) => {
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    return [minOf(la) - padDeg, minOf(lo) - padDeg, maxOf(la) + padDeg, maxOf(lo) + padDeg];
  };

  // ---------------------------------------------------------------- built-in camp database (no live map server needed)
  // File format: { built, camps: [[id, lat, lon, tags]], ramps: [[lat, lon]], dumps: [[lat, lon]] }
  const campDB = (() => {
    const CELL = 0.5, cellOf = (la, lo) => `${Math.floor(la / CELL)},${Math.floor(lo / CELL)}`;
    let raw = null, grid = null, ready = null;
    const norm = new Map();
    const kv = (() => {
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open("cf-campdb", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode); const q = fn(t.objectStore("kv")); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
      return { get: (k) => run("readonly", (s) => s.get(k)), set: (k, v) => run("readwrite", (s) => s.put(v, k)) };
    })();
    const valid = (d) => d && Array.isArray(d.camps) && d.camps.length > 500;
    function use(d) {
      raw = d; norm.clear(); grid = new Map();
      const put = (kind, la, lo, item) => {
        const k = cellOf(la, lo); let g = grid.get(k);
        if (!g) grid.set(k, (g = { camps: [], ramps: [], dumps: [], fuel: [], water: [], low: [], towns: [] }));
        g[kind].push(item);
      };
      d.camps.forEach((c) => put("camps", c[1], c[2], c));
      (d.ramps || []).forEach((p, i) => put("ramps", p[0], p[1], { id: `ramp/${i}`, lat: p[0], lon: p[1] }));
      (d.dumps || []).forEach((p, i) => put("dumps", p[0], p[1], { id: `dump/${i}`, lat: p[0], lon: p[1] }));
      (d.fuel || []).forEach((p, i) => put("fuel", p[0], p[1], { id: `fuel/${i}`, lat: p[0], lon: p[1], name: p[2] || "Fuel station", addr: "", fuel: null }));
      (d.water || []).forEach((p, i) => put("water", p[0], p[1], { id: `water/${i}`, lat: p[0], lon: p[1], tank: !!p[2] }));
      (d.low || []).forEach((p, i) => put("low", p[0], p[1], { id: `low/${i}`, lat: p[0], lon: p[1], h: p[2] }));
      (d.towns || []).forEach((p) => put("towns", p[0], p[1], { lat: p[0], lon: p[1], name: p[2], rank: p[3] || 1 }));
    }
    // nearest town (villages count a bit less than real towns), within about 60 km
    function townNear(lat, lon) {
      if (!grid) return null;
      let best = null, bestS = Infinity;
      for (const g of cells([lat - 0.6, lon - 0.6, lat + 0.6, lon + 0.6])) for (const t of g.towns) {
        const d = hav([lat, lon], [t.lat, t.lon]); if (d > 60000) continue;
        const sc = d * (t.rank >= 2 ? 0.7 : 1);
        if (sc < bestS) { bestS = sc; best = { ...t, d }; }
      }
      return best;
    }
    async function load() {
      let cached = null;
      try { cached = await kv.get("data"); } catch { /* private mode etc. */ }
      let bundled = null;
      try { bundled = await fetchJSON(CFG.campData, {}, 15000); } catch { /* not bundled */ }
      const best = [cached, bundled].filter(valid).sort((a, b) => String(b.built).localeCompare(String(a.built)))[0];
      if (best) use(best);
      refresh(); // quietly, in the background
      return !!best;
    }
    async function refresh() {
      try {
        if (isOffline()) return;
        const last = +(await kv.get("checked").catch(() => 0)) || 0;
        if (raw && Date.now() - last < 7 * 864e5) return;
        const d = nativeFetch ? JSON.parse(await nativeFetch(CFG.campDataLive, { timeout: 60000 })) : await fetchJSON(CFG.campDataLive, {}, 60000);
        await kv.set("checked", Date.now()).catch(() => {});
        if (!valid(d) || (raw && String(d.built) <= String(raw.built))) return;
        await kv.set("data", d).catch(() => {});
        use(d);
      } catch { /* try again next launch */ }
    }
    function cells([s, w, n, e]) {
      const out = [];
      for (let a = Math.floor(s / CELL); a <= Math.floor(n / CELL); a++)
        for (let o = Math.floor(w / CELL); o <= Math.floor(e / CELL); o++) { const g = grid.get(`${a},${o}`); if (g) out.push(g); }
      return out;
    }
    const inBox = ([s, w, n, e]) => (p) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;
    function campOf(c) {
      let x = norm.get(c[0]);
      if (!x) { x = normalise({ id: c[0], lat: c[1], lon: c[2], tags: c[3] || {} }); if (!x.named) x.name = placeName(x, townNear(x.lat, x.lon)); norm.set(c[0], x); }
      return { ...x, a: { ...x.a } }; // copies, so merging extras never changes the database
    }
    // Same shape as parseElements(): { camps, ramps, dumps }
    function inArea(bbox, padDeg = 0.1) {
      const big = [bbox[0] - padDeg, bbox[1] - padDeg, bbox[2] + padDeg, bbox[3] + padDeg];
      const okBig = inBox(big);
      const camps = [], ramps = [], dumps = [];
      for (const g of cells(bbox)) for (const c of g.camps) if (c[1] >= bbox[0] && c[1] <= bbox[2] && c[2] >= bbox[1] && c[2] <= bbox[3]) camps.push(campOf(c));
      for (const g of cells(big)) { ramps.push(...g.ramps.filter(okBig)); dumps.push(...g.dumps.filter(okBig)); }
      return { camps, ramps, dumps };
    }
    return {
      ready: () => (ready ||= load()),
      has: () => !!raw,
      inArea,
      info: () => (raw ? { count: raw.camps.length, built: raw.built } : null),
      waterIn: (bb) => { if (!grid) return []; const out = []; for (const g of cells(bb)) for (const w of g.water) if (w.lat >= bb[0] && w.lat <= bb[2] && w.lon >= bb[1] && w.lon <= bb[3]) out.push({ ...w }); return out; },
      lowIn: (bb) => { if (!grid) return []; const out = []; for (const g of cells(bb)) for (const w of g.low) if (w.lat >= bb[0] && w.lat <= bb[2] && w.lon >= bb[1] && w.lon <= bb[3]) out.push({ ...w }); return out; },
      townNear,
      fuelIn: (pt, radius) => { if (!grid) return []; const d = radius / 100000; const out = []; for (const g of cells([pt.lat - d, pt.lon - d, pt.lat + d, pt.lon + d])) for (const f of g.fuel) if (hav([pt.lat, pt.lon], [f.lat, f.lon]) <= radius) out.push({ ...f }); return out; },
      _use: use,
    };
  })();
  campDB.ready();

  // Extra sources are a bonus: never wait long for them, never fail because of them
  const soon = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);

  // ---------------------------------------------------------------- offline packs (IndexedDB)
  const idb = (() => {
    let dbp;
    const open = () => (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open("camp-finder", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("packs", { keyPath: "id" });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("packs", mode); const s = t.objectStore("packs"); const r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
    return {
      put: (v) => tx("readwrite", (s) => s.put(v)),
      del: (id) => tx("readwrite", (s) => s.delete(id)),
      all: () => tx("readonly", (s) => s.getAll()),
    };
  })();
  async function offlineCampsIn([s, w, n, e]) {
    try {
      const packs = await idb.all();
      const m = new Map();
      for (const p of packs) for (const c of p.camps) if (c.lat >= s && c.lat <= n && c.lon >= w && c.lon <= e) m.set(c.id, c);
      return [...m.values()];
    } catch { return []; }
  }
  const isOffline = () => navigator.onLine === false;

  async function campsAlong(route, detourM, progress) {
    const line = buildLine(route);
    const pts = sample(line, Math.max(8000, Math.min(20000, detourM)));
    const chunk = 45, parts = [];
    for (let i = 0; i < pts.length; i += chunk - 1) parts.push(pts.slice(i, i + chunk));
    const all = { camps: new Map(), ramps: new Map(), dumps: new Map() };
    const padDeg = detourM / 100000 + 0.02;
    let extras = [], done = 0, usedOffline = false;
    await campDB.ready();
    if (campDB.has()) {
      // Built-in database: instant, works with no signal. Official and traveller camps join in if they answer quickly.
      const near = (c) => pts.some((p) => Math.abs(p[0] - c.lat) < padDeg + 0.2 && Math.abs(p[1] - c.lon) < padDeg + 0.25);
      const extraJobs = parts.map((part) => soon(extrasIn(bboxOf(part, padDeg)), 9000, []));
      for (const part of parts) {
        const res = campDB.inArea(bboxOf(part, padDeg), CFG.dumpKm / 100);
        res.camps.forEach((c) => { if (near(c)) all.camps.set(c.id, c); });
        res.ramps.forEach((c) => all.ramps.set(c.id, c));
        res.dumps.forEach((c) => all.dumps.set(c.id, c));
      }
      if (parts.length > 2) progress("Adding official camps and rest areas…");
      const exAll = (await Promise.all(extraJobs)).flat();
      const bb = bboxOf(line.pts, padDeg);
      exAll.push(...await offlineCampsIn(bb).then((l) => l.filter((c) => c.source !== "osm")));
      const uniq = [...new Map(exAll.map((x) => [x.id, x])).values()];
      const camps = mergeSources([...all.camps.values()], uniq, [...all.ramps.values()], [...all.dumps.values()]);
      for (const c of camps) Object.assign(c, project(line, c));
      return { line, camps: camps.filter((c) => c.off <= detourM * 1.15), offline: false };
    }
    try {
      for (const part of parts) {
        const poly = part.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(",");
        const extra = detourM + CFG.dumpKm * 1000;
        const q = `[out:json][timeout:80];(${CAMP_SEL}(around:${detourM},${poly});nwr["leisure"="slipway"](around:${extra},${poly});nwr["amenity"="sanitary_dump_station"](around:${extra},${poly}););out center tags;`;
        const [res, ex] = await Promise.all([overpass(q).then(parseElements), extrasIn(bboxOf(part, padDeg))]);
        res.camps.forEach((c) => all.camps.set(c.id, c));
        res.ramps.forEach((c) => all.ramps.set(c.id, c));
        res.dumps.forEach((c) => all.dumps.set(c.id, c));
        extras.push(...ex);
        done++;
        if (parts.length > 1) progress(`Searching for camps along the route… ${Math.round((done / parts.length) * 100)}%`);
      }
    } catch (err) {
      const bb = bboxOf(line.pts, padDeg);
      const saved = [...await offlineCampsIn(bb), ...userCampsIn(bb)];
      if (!saved.length) throw err;
      usedOffline = true; all.camps.clear(); extras = saved;
    }
    const uniq = [...new Map(extras.map((x) => [x.id, x])).values()];
    const camps = usedOffline ? uniq : mergeSources([...all.camps.values()], uniq, [...all.ramps.values()], [...all.dumps.values()]);
    for (const c of camps) Object.assign(c, project(line, c));
    return { line, camps: camps.filter((c) => c.off <= detourM * 1.15), offline: usedOffline };
  }

  function makePlan({ from, to, route, nights, opts, data }) {
    const { line, camps } = data;
    const usable = camps.filter((c) => rigOK(c, opts.rig) && !c.closed && (!settings.dog || (c.a.dogs !== false && !c.park)));
    const picks = [];
    const used = new Set();
    const seg = line.total / (nights + 1);
    let prevAlong = 0;
    for (let k = 1; k <= nights; k++) {
      // re-balance each night from where the last camp actually is
      let target = prevAlong + (line.total - prevAlong) / (nights - k + 2);
      if (line.turn) {   // return trip: about half the nights going, the last of them at your destination
        const outN = Math.max(1, Math.ceil(nights / 2));
        target = k <= outN ? prevAlong + (line.turn - prevAlong) / (outN - k + 1) : Math.max(prevAlong, line.turn) + (line.total - Math.max(prevAlong, line.turn)) / (nights - k + 2);
      }
      const win = Math.max(25000, seg * 0.45);
      const rank = (list) => list
        .map((c) => ({ c, s: score(c, opts.wants, opts.cost) - Math.abs(c.along - target) / 1500 - c.off / 2500 }))
        .sort((a, b) => b.s - a.s).map((x) => x.c);
      const ukey = (c) => c.id + (c._leg || "");
      const inWin = usable.filter((c) => Math.abs(c.along - target) <= win && !used.has(ukey(c)));
      let strict = rank(inWin.filter((c) => costOK(c, opts.cost) && ruledOut(c, opts.wants).length === 0));
      if (opts.cost === "cheap") { // free or unknown first, paid only if nothing else
        const freeish = strict.filter((c) => c.cost !== "paid");
        if (freeish.length) strict = [...freeish, ...strict.filter((c) => c.cost === "paid")];
      }
      let warn = "";
      let list = strict;
      if (!list.length) {
        list = rank(inWin.filter((c) => costOK(c, opts.cost)));
        if (list.length) warn = "No camp here matches every must-have. Best nearby option shown.";
      }
      if (!list.length && opts.cost === "free") {
        list = rank(inWin);
        if (list.length) warn = "No free camp found near this stop. Cheapest nearby options shown.";
      }
      if (!list.length) {
        const wide = usable.filter((c) => !used.has(ukey(c)) && Math.abs(c.along - target) <= seg * 0.9);
        list = rank(wide);
        if (list.length) warn = "Nothing close to the ideal stop. Nearest camp shown, so this day will be longer or shorter.";
      }
      const camp = list[0] || null;
      if (camp && !warn && opts.cost === "cheap" && camp.cost === "paid") warn = "No free camp with your must-haves near here, so the best paid one is shown. Free options without them are under other options.";
      if (camp && opts.cost === "cheap" && camp.cost === "paid") {
        const freeAlt = rank(inWin.filter((c) => c.cost !== "paid" && c.id !== camp.id)).slice(0, 2);
        list.splice(1, 0, ...freeAlt.filter((c) => !list.slice(1, 4).includes(c)));
      }
      if (camp && !warn) { const u = unrecorded(camp, opts.wants); if (u.length) warn = `Not recorded whether it has ${u.map((w) => SHORT_LABEL[w] || w).join(" or ").toLowerCase()}. Check before you rely on it.`; }
      if (camp) used.add(ukey(camp));
      prevAlong = camp ? camp.along : target;
      picks.push({ target, camp, alts: list.slice(1, 4), warn: camp ? warn : "No camps found for this night. Try a bigger detour or fewer must-haves." });
    }
    // "Need a refresh" nights: a real bed instead of camping
    const want = new Set();
    if (opts.bougie && nights) want.add(nights - 1);
    const spread = Math.min(opts.refresh || 0, nights - want.size);
    for (let j = 1; j <= spread; j++) { let k = Math.round(j * nights / (spread + 1)) - 1; while (want.has(k) && k > 0) k--; want.add(Math.max(0, k)); }
    picks.forEach((pk, k) => { if (want.has(k)) pk.refresh = { style: opts.bougie && k === nights - 1 ? "bougie" : (opts.refreshStyle || "motel"), options: null }; });
    return { from, to, route, line, nights, opts, picks, camps: usable, at: Date.now() };
  }


  // ---------------------------------------------------------------- icons & small renderers
  const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const RIGS = [
    { id: "tent", label: "Tent or swag" },
    { id: "rooftop", label: "Car or rooftop" },
    { id: "camper", label: "Camper trailer" },
    { id: "caravan", label: "Caravan" },
    { id: "motorhome", label: "Motor&shy;home" },
  ];
  const AMEN_ICON = { toilets: "toilets", water: "water", showers: "showers", dogs: "dogs", boatramp: "boatramp", dump: "dump", power: "power", fires: "fires" };
  const SHORT = { toilets: "Toilets", water: "Water", showers: "Showers", dogs: "Dogs", boatramp: "Boat ramp", dump: "Dump point", power: "Power", fires: "Fires" };

  function priceTag(c) {
    if (c.cost === "free") return `<span class="price free">${c.donation ? "DONATION" : "FREE"}</span>`;
    if (c.cost === "paid") {
      const amt = (c.charge.match(/\$?\s?(\d+(?:\.\d+)?)/) || [])[1];
      return `<span class="price paid">${amt ? "$" + amt : "PAID"}</span>`;
    }
    return `<span class="price unknown">PRICE ?</span>`;
  }
  function amenIcons(c) {
    const out = [];
    for (const id of ["toilets", "water", "showers", "dogs", "power", "fires"]) if (c.a[id] === true) out.push(`<span title="${SHORT[id]}">${icon(AMEN_ICON[id])}<span class="sr">${SHORT[id]}</span></span>`);
    if (c.rampM <= CFG.boatRampKm * 1000) out.push(`<span title="Boat ramp">${icon("boatramp")}${km(c.rampM)}</span>`);
    if (c.dumpM <= CFG.dumpKm * 1000) out.push(`<span title="Dump point">${icon("dump")}${c.dumpM === 0 ? "On site" : km(c.dumpM)}</span>`);
    return out.length ? `<div class="icons">${out.join("")}</div>` : "";
  }
  function metaLine(c, ctx = {}) {
    if (ctx.fromCenter != null) return `${c.kind}, ${km(ctx.fromCenter)} from map centre`;
    if (c.off != null) return c.off < 1000 ? `${c.kind}, right on your route` : `${c.kind}, ${km(c.off)} off your route`;
    return c.kind;
  }
  function tagsFor(c) {
    const t = [];
    if (c.closed) t.push(`<span class="tag bad">Closed</span>`);
    if (c.park) t.push(`<span class="tag">National park, permit needed</span>`);
    if (c.source === "rest") t.push(`<span class="tag">Rest area</span>`);
    if (c.source === "vicforest" || c.also === "vicforest") t.push(`<span class="tag">Official listing</span>`);
    if (c.source === "user") t.push(`<span class="tag mine">Added by you</span>`);
    if (c.source === "community") t.push(`<span class="tag mine">Traveller added</span>`);
    return t.length ? `<div class="tags">${t.join("")}</div>` : "";
  }
  function campCard(c, ctx) {
    return `<button type="button" class="camp-card${c.closed ? " is-closed" : ""}" data-id="${esc(c.id)}">
      <div class="cc-top"><div><div class="cc-name">${esc(c.name)}</div><div class="cc-meta">${starChip(c.id)}${esc(metaLine(c, ctx))}</div></div>${priceTag(c)}</div>
      ${tagsFor(c)}${amenIcons(c)}
    </button>`;
  }

  // ---------------------------------------------------------------- lock the screen
  // Pinching anywhere except the map does nothing (stops the whole app zooming); the map handles its own pinch.
  ["gesturestart", "gesturechange", "gestureend"].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1 && !e.target.closest?.("#map")) e.preventDefault(); }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (e) => { const now = Date.now(); if (now - lastTouchEnd < 300 && !e.target.closest?.("#map, input, textarea, button, a, select, label")) e.preventDefault(); lastTouchEnd = now; }, { passive: false });
  window.addEventListener("wheel", (e) => { if (e.ctrlKey && !e.target.closest?.("#map")) e.preventDefault(); }, { passive: false });
  window.addEventListener("scroll", () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });

  // ---------------------------------------------------------------- map
  // Smooth map: no tile fade, keep plenty of tiles around, and a low-detail copy underneath so zooming
  // never flashes grey while the sharp tiles load.
  const map = L.map("map", {
    zoomControl: false, attributionControl: true, preferCanvas: true, renderer: L.canvas({ padding: 0.8 }),
    fadeAnimation: false, bounceAtZoomLimits: false, minZoom: 3, maxZoom: 19, worldCopyJump: false,
    zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,   // pinch zoom stops exactly where your fingers do (no snapping jump)
    maxBounds: [[-85, 70], [45, 200]], maxBoundsViscosity: 0.85, // stay around Australia (room below for the panel)
  }).setView([-26.5, 134], 4);
  window.__map ||= map;
  const AU = [[-43.7, 113.1], [-10.6, 153.7]];
  // tiles keep loading while you drag (no blank squares), and the low-detail backdrop that fills gaps is only used when
  // zoomed out: stretched to street level it made the phone redraw enormous images and the map stuttered
  const tileOpts = { maxZoom: 19, keepBuffer: 6, updateWhenZooming: false, updateWhenIdle: false };
  const backdropOpts = { maxZoom: 11, maxNativeZoom: 7, keepBuffer: 4, updateWhenZooming: false, attribution: "" };
  // Map background: Stadia Maps "Outdoors" (shows tracks, terrain and national parks) when the key is set
  const OSM = CFG.stadiaKey ? `https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png?api_key=${CFG.stadiaKey}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_ATTR = CFG.stadiaKey ? '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  let streetBase = L.tileLayer(OSM, { ...backdropOpts, className: "tiles-backdrop" });
  let street = L.tileLayer(OSM, { ...tileOpts, attribution: OSM_ATTR });
  // Vector map (Stadia Outdoors drawn by the phone's graphics chip): smooth pinch zoom, sharp at every zoom, no squares
  // loading in. Falls back to the picture tiles above if WebGL or the map library isn't available, or with no signal.
  const glOK = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
  if (CFG.stadiaKey && glOK && window.maplibregl && L.maplibreGL && !isOffline()) {
    try {
      const vec = L.maplibreGL({
        style: `https://tiles.stadiamaps.com/styles/outdoors.json?api_key=${CFG.stadiaKey}`,
        transformRequest: (url) => (/stadiamaps\.com/.test(url) && !/api_key=/.test(url) ? { url: url + (url.includes("?") ? "&" : "?") + `api_key=${CFG.stadiaKey}` } : { url }),
        attribution: OSM_ATTR, interactive: false, attributionControl: false, fadeDuration: 0,
      });
      const raster = street;
      street = vec; streetBase = L.layerGroup();   // the vector map needs no low-detail backdrop
      // if the vector map can't load (no signal, blocked), quietly go back to the picture tiles
      let fellBack = false;
      const fallBack = () => { if (fellBack) return; fellBack = true; const onMap = map.hasLayer(street); if (onMap) map.removeLayer(street); street = raster; streetBase = L.tileLayer(OSM, { ...backdropOpts, className: "tiles-backdrop" }); if (onMap && !onSat) { streetBase.addTo(map); street.addTo(map); } };
      vec.on?.("add", () => { const gl = vec.getMaplibreMap?.(); if (!gl) return; gl.on("error", (e) => { if (!gl.isStyleLoaded() || /style/i.test(String(e?.error?.message || ""))) fallBack(); }); setTimeout(() => { if (!gl.isStyleLoaded()) fallBack(); }, 12000); });
    } catch { /* keep the picture tiles */ }
  }
  const satBase = L.tileLayer(ESRI, { ...backdropOpts, maxNativeZoom: 8, className: "tiles-backdrop" });
  const sat = L.tileLayer(ESRI, { ...tileOpts, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
  streetBase.addTo(map); street.addTo(map);
  let onSat = false;
  $("#layerBtn").addEventListener("click", (e) => {
    onSat = !onSat;
    e.currentTarget.setAttribute("aria-pressed", onSat);
    e.currentTarget.setAttribute("aria-label", onSat ? "Switch to map view" : "Switch to satellite view");
    if (onSat) { map.removeLayer(street); map.removeLayer(streetBase); satBase.addTo(map); sat.addTo(map); }
    else { map.removeLayer(sat); map.removeLayer(satBase); streetBase.addTo(map); street.addTo(map); }
  });
  // markers shouldn't slide around while you pinch
  map.on("zoomstart", () => map.getContainer().classList.add("is-zooming"));
  map.on("zoomend", () => setTimeout(() => map.getContainer().classList.remove("is-zooming"), 60));

  // The web view can report its size late on first launch: re-measure so Australia is centred.
  // once you've touched the map it never jumps back to Australia by itself (the keyboard opening used to trigger that)
  let userMovedMap = false;
  map.on("dragstart", () => (userMovedMap = true));
  map.getContainer().addEventListener("touchstart", () => (userMovedMap = true), { passive: true });
  map.getContainer().addEventListener("wheel", () => (userMovedMap = true), { passive: true });
  const fixMapSize = () => {
    const el = map.getContainer?.();
    if (el && (el.clientWidth < 100 || el.clientHeight < 100)) return; // not laid out yet
    map.invalidateSize();
    // you can zoom out to see all of Australia, but not much further
    if (map.getBoundsZoom && map.setMinZoom) { const fp = fitPad(); const pad = L.point(fp.paddingTopLeft).add(fp.paddingBottomRight); map.setMinZoom(Math.max(1.5, map.getBoundsZoom(AU, false, pad) - 0.5)); }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (!plan && !userMovedMap && !typing && view === "plan" && window.innerHeight > 200) map.fitBounds(AU, fitPad());
  };
  [60, 400, 1200, 2500].forEach((ms) => setTimeout(fixMapSize, ms));
  // keep Australia in the space above the panel whenever the panel or screen changes size, until you move the map
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (userMovedMap) return; clearTimeout(fixMapSize.t); fixMapSize.t = setTimeout(fixMapSize, 80); }); ro.observe($("#sheet")); ro.observe(map.getContainer()); }
  window.addEventListener("load", () => setTimeout(fixMapSize, 120));
  window.addEventListener("resize", () => { clearTimeout(fixMapSize.t); fixMapSize.t = setTimeout(fixMapSize, 120); });
  const tripLayer = L.layerGroup().addTo(map);
  const legLayer = L.layerGroup().addTo(map);
  const travelLayer = L.layerGroup().addTo(map);   // the part of your route you've already driven
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, chunkedLoading: true, animate: false });
  map.addLayer(cluster);

  const divIcon = (html, size) => L.divIcon({ className: "", html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
  function campMarker(c, opts = {}) {
    const ic = opts.night
      ? divIcon(`<div class="mk-night">${esc(opts.label)}</div>`, [34, 32])
      : divIcon(`<div class="mk ${c.closed ? "closed" : c.source === "user" ? "user" : c.source === "rest" ? "rest" : c.cost}"></div>`, [16, 16]);
    const m = L.marker([c.lat, c.lon], { icon: ic, title: c.name, keyboard: true, zIndexOffset: opts.night ? 1000 : 0 });
    m.on("click", () => openDetail(c));
    return m;
  }

  // safe-area aware padding for fitting the map around the panel
  function fitPad() {
    const wide = window.innerWidth >= 900;
    // everything from the top of the panel down is covered, so fit things into the space above it
    const top = $("#sheet").getBoundingClientRect().top || window.innerHeight * 0.4;
    const covered = Math.max(0, window.innerHeight - top);
    return wide ? { paddingTopLeft: [450, 40], paddingBottomRight: [70, 40] } : { paddingTopLeft: [16, 66], paddingBottomRight: [62, covered + 12] };
  }

  let me = null;
  let following = false;
  function locate(then) {
    if (!navigator.geolocation) { toast("Location isn't available on this device"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { onPosition(pos); store.set("cf-loc-ok", true); startTracking(); then(me); },
      () => toast("Turn on location for Camp Finder in your phone's settings"),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
    );
  }
  $("#locateBtn").addEventListener("click", () => {
    if (me && following) { setFollow(false); return; }
    locate((p) => { map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13)); setFollow(true); });
  });
  function setFollow(on) {
    following = on;
    $("#locateBtn").classList.toggle("is-follow", on);
    $("#locateBtn").setAttribute("aria-label", on ? "Stop following my location" : "Show my location");
    if (on && me) map.panTo([me.lat, me.lon]);
  }
  map.on("dragstart", () => { if (following) setFollow(false); });

  // Your position is shown as a little car that turns with the road
  const CAR_SVG = `<svg viewBox="-20 -20 40 40" aria-hidden="true"><rect x="-9" y="-15" width="18" height="30" rx="6" fill="#F5C518" stroke="#1A1608" stroke-width="2.4"/><rect x="-6.5" y="-9" width="13" height="7" rx="2" fill="#2B2F2D"/><rect x="-6.5" y="5" width="13" height="5" rx="1.5" fill="#2B2F2D"/><rect x="-10.5" y="-11" width="3" height="6" rx="1.2" fill="#1A1608"/><rect x="7.5" y="-11" width="3" height="6" rx="1.2" fill="#1A1608"/><rect x="-10.5" y="5" width="3" height="6" rx="1.2" fill="#1A1608"/><rect x="7.5" y="5" width="3" height="6" rx="1.2" fill="#1A1608"/><circle cx="-5" cy="-14" r="1.6" fill="#FFF7D1"/><circle cx="5" cy="-14" r="1.6" fill="#FFF7D1"/></svg>`;
  let meMarker = null, lastPos = null, heading = 0, tracking = null;
  function bearing(a, b) {
    const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  let lastFixAt = 0;
  function onPosition(pos) {
    const c = pos.coords;
    lastFixAt = Date.now();
    me = { lat: c.latitude, lon: c.longitude };
    if (c.heading != null && c.heading >= 0 && (c.speed == null || c.speed > 1)) heading = c.heading;
    else if (lastPos && hav([lastPos.lat, lastPos.lon], [me.lat, me.lon]) > 15) heading = bearing(lastPos, me);
    if (!lastPos || hav([lastPos.lat, lastPos.lon], [me.lat, me.lon]) > 15) lastPos = me;
    const html = `<div class="me-car" style="--rot:${Math.round(heading)}deg"><span class="halo"></span>${myCarTop()}</div>`;
    if (!meMarker) {
      meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: "me-icon", html, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: false, zIndexOffset: 2000, interactive: false }).addTo(map);
    } else {
      meMarker.setLatLng?.([me.lat, me.lon]);
      const el = meMarker.getElement?.()?.querySelector(".me-car");
      if (el) el.style.setProperty("--rot", `${Math.round(heading)}deg`);
    }
    if (following) map.panTo([me.lat, me.lon], { animate: true, duration: .8 });
    if (typeof recordPoint === "function") try { recordPoint(me); } catch {}
    if (typeof onRoadCheck === "function") try { onRoadCheck(me); } catch {}
    if (typeof famOnPos === "function") try { famOnPos(c); } catch {}
    if (typeof travelOnPos === "function") try { travelOnPos(me); } catch {}
  }
  function startTracking() {
    if (tracking != null || !navigator.geolocation?.watchPosition) return;
    tracking = navigator.geolocation.watchPosition(onPosition, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }

  // ---------------------------------------------------------------- sheet & tabs
  const sheet = $("#sheet");
  function setSheet(state) {
    sheet.classList.toggle("is-peek", state === "peek");
    sheet.classList.toggle("is-full", state === "full");
    if (state === "peek") updatePeek();
    setTimeout(() => map.invalidateSize({ pan: false }), 320);
  }
  const sheetState = () => (sheet.classList.contains("is-peek") ? "peek" : sheet.classList.contains("is-full") ? "full" : "half");
  // what the slim bar says when the panel is swiped down
  function updatePeek() {
    const t = $("#peekText"); if (!t) return;
    const from = $("#from")?.value, to = $("#to")?.value;
    const names = { explore: "Explore camps near you", discover: "Ready-made trips", saved: "Your saved camps", settings: "Settings" };
    if (typeof view !== "undefined" && view !== "plan") t.textContent = names[view] || "Open panel";
    else if (!$("#results")?.hidden && to) t.textContent = `${from ? short(from) : "You"} → ${short(to)}`;
    else t.textContent = "Where are you headed?";
  }
  $("#sheetHandle").addEventListener("click", () => setSheet(sheetState() === "peek" ? "half" : sheetState() === "full" ? "peek" : "full"));
  $("#peekBar").addEventListener("click", () => setSheet("half"));

  // Drag the panel up and down: from the grabber, the slim bar, or the content when it's scrolled to the top
  (() => {
    const scroller = $("#sheetScroll");
    let y0 = null, h0 = 0, lastY = 0, lastT = 0, vel = 0, raf = 0, nextH = 0, fromContent = false, dragged = false;
    const minH = () => 74, maxH = () => sheet.parentElement.getBoundingClientRect().height - 120;
    const begin = (y) => { y0 = lastY = y; lastT = performance.now(); vel = 0; h0 = sheet.getBoundingClientRect().height; dragged = false; };
    const move = (y) => {
      if (y0 == null) return false;
      const dy = y0 - y;
      if (!dragged && Math.abs(dy) < 6) return false;
      if (!dragged) { dragged = true; sheet.style.transition = "none"; sheet.classList.add("is-dragging"); }
      const now = performance.now(); vel = (lastY - y) / Math.max(1, now - lastT); lastY = y; lastT = now; // px per ms, + = up
      nextH = Math.min(maxH(), Math.max(minH(), h0 + dy));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; sheet.style.height = nextH + "px"; });
      return true;
    };
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      if (!dragged) return;
      cancelAnimationFrame(raf); raf = 0;
      const h = nextH, vh = sheet.parentElement.getBoundingClientRect().height;
      sheet.classList.remove("is-dragging"); sheet.style.transition = ""; 
      // flick = go one step in that direction; otherwise snap to the nearest
      let state;
      const order = ["peek", "half", "full"], cur = order.indexOf(sheetState());
      if (vel > 0.55) state = order[Math.min(2, Math.max(cur, h < vh * 0.4 ? 0 : 1) + 1)];
      else if (vel < -0.55) state = order[Math.max(0, Math.min(cur, h > vh * 0.75 ? 2 : 1) - 1)];
      else state = h < vh * 0.3 ? "peek" : h > vh * 0.72 ? "full" : "half";
      requestAnimationFrame(() => { sheet.style.height = ""; setSheet(state); });
    };
    // grabber + slim bar: pointer events
    [$("#sheetHandle"), $("#peekBar")].forEach((g) => {
      g.addEventListener("pointerdown", (e) => { begin(e.clientY); g.setPointerCapture(e.pointerId); });
      g.addEventListener("pointermove", (e) => move(e.clientY));
      g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
      g.addEventListener("click", (e) => { if (dragged) { e.stopImmediatePropagation(); e.preventDefault(); dragged = false; } }, true);
    });
    // content: pull down when already at the top to shrink the panel
    scroller.addEventListener("touchstart", (e) => { fromContent = scroller.scrollTop <= 0 && e.touches.length === 1; if (fromContent) begin(e.touches[0].clientY); }, { passive: true });
    scroller.addEventListener("touchmove", (e) => {
      if (!fromContent || y0 == null) return;
      const y = e.touches[0].clientY;
      if (!dragged && y < y0) { fromContent = false; y0 = null; return; } // scrolling up through the list: leave it alone
      if (move(y)) e.preventDefault();
    }, { passive: false });
    scroller.addEventListener("touchend", () => { if (fromContent) end(); fromContent = false; });
    scroller.addEventListener("touchcancel", () => { if (fromContent) end(); fromContent = false; });
  })();

  let view = "plan";
  $$(".tabbtn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  function setView(v) {
    view = v; setTimeout(updatePeek, 0);
    $$(".tabbtn").forEach((b) => { const on = b.dataset.view === v; b.classList.toggle("is-on", on); on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
    $$(".view").forEach((el) => (el.hidden = el.id !== `view-${v}`));
    closeDetail();
    $("#sheetScroll").scrollTop = 0;
    if (sheet.classList.contains("is-peek")) setSheet("half");
    if (v === "explore") { tripLayer.clearLayers(); legLayer.clearLayers(); loadExplore(); }
    else cluster.clearLayers();
    setTimeout(() => { try { if (journey) drawTravelled(); } catch {} }, 0);
    if (v === "plan" && plan) drawPlan();
    if (v === "saved") renderSaved();
    if (v === "settings") renderSettings();
    if (v === "saved") renderBadges();
    moveInk();
  }

  // ---------------------------------------------------------------- form controls
  const prefs = store.get("cf-prefs", { wants: ["toilets"], exWants: [], rig: "camper", exFree: true });
  $("#rigs").innerHTML = RIGS.map((r) => `<label class="rig"><input type="radio" name="rig" value="${r.id}" ${r.id === prefs.rig ? "checked" : ""}><span>${icon(r.id)}${r.label}</span></label>`).join("");
  $("#planWants").innerHTML = AMENITIES.map((a) => `<label><input type="checkbox" value="${a.id}" ${prefs.wants.includes(a.id) ? "checked" : ""}><span>${icon(AMEN_ICON[a.id], "ic sm")}${esc(a.label)}</span></label>`).join("");
  $("#explorePills").innerHTML =
    `<label class="pill"><input type="checkbox" id="exFree" ${prefs.exFree ? "checked" : ""}><span>Free only</span></label>` +
    AMENITIES.map((a) => `<label class="pill"><input type="checkbox" value="${a.id}" ${prefs.exWants.includes(a.id) ? "checked" : ""}><span>${icon(AMEN_ICON[a.id])}${SHORT[a.id]}</span></label>`).join("") +
    MORE_FILTERS.map((f) => `<label class="pill more"><input type="checkbox" data-more="${f.id}" ${(prefs.exMore || []).includes(f.id) ? "checked" : ""}><span><i aria-hidden="true">${f.icon}</i>${esc(f.label)}</span></label>`).join("");
  const moreOf = () => $$("#explorePills input[data-more]:checked").map((i) => i.dataset.more);
  const radio = (name) => $(`input[name="${name}"]:checked`)?.value;
  const wantsOf = (el) => $$("input[value]:checked", el).map((i) => i.value).filter((v) => AMENITIES.some((a) => a.id === v));
  function savePrefs() {
    Object.assign(prefs, { wants: wantsOf($("#planWants")), exWants: wantsOf($("#explorePills")), exMore: moreOf(), rig: radio("rig"), exFree: $("#exFree").checked });
    store.set("cf-prefs", prefs); paintCars();
  }
  $("#rigs").addEventListener("change", () => { prefs.rig = radio("rig") || prefs.rig; store.set("cf-prefs", prefs); paintCars(); });

  const nightsIn = $("#nights");
  function setNights(n) {
    n = Math.max(0, Math.min(120, n));
    nightsIn.value = n; $("#nightsOut").textContent = n;
    $("#nightsDown").disabled = n === 0; $("#nightsUp").disabled = n === 120;
    $("#nightsHelp").textContent = n === 0 ? "Straight through, no overnight stops" : `One camp for each night, ${n + 1} days of driving`;
  }
  $("#nightsDown").addEventListener("click", () => setNights(+nightsIn.value - 1));
  $("#nightsUp").addEventListener("click", () => setNights(+nightsIn.value + 1));
  setNights(6);
  const refreshIn = $("#refreshIn");
  function setRefresh(n) {
    const max = +nightsIn.value;
    n = Math.max(0, Math.min(max, n));
    refreshIn.value = n; $("#refreshOut").textContent = n;
    $("#refreshDown").disabled = n === 0; $("#refreshUp").disabled = n >= max;
    $("#refreshHelp").textContent = n === 0 ? "Swap a few camp nights for a real bed and a hot shower" : `${n} night${n > 1 ? "s" : ""} in a ${radio("rstyle") || "motel"}, spread through the trip`;
    $("#rstyleSeg").hidden = n === 0;
  }
  $("#refreshDown").addEventListener("click", () => setRefresh(+refreshIn.value - 1));
  $("#refreshUp").addEventListener("click", () => setRefresh(+refreshIn.value + 1));
  $("#rstyleSeg").addEventListener("change", () => setRefresh(+refreshIn.value));
  $("#nightsUp").addEventListener("click", () => setRefresh(+refreshIn.value));
  $("#nightsDown").addEventListener("click", () => setRefresh(+refreshIn.value));
  setRefresh(0);
  (() => { const d = new Date(); $("#leaveDate").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  $("#detourSeg").addEventListener("change", () => ($("#detourShown").textContent = (+radio("detour") / 1000) + " km"));

  // "Use my location": instant if we already know where you are, named after your town, clear when it can't
  const myPlaceName = (p) => { const t = campDB.townNear?.(p.lat, p.lon); return t ? `${t.name} (my location)` : "My location"; };
  let hereBusy = false;
  $("#useHere").addEventListener("click", () => {
    const f = $("#from"), b = $("#useHere");
    const set = (p) => { f.value = myPlaceName(p); f.dataset.lat = p.lat; f.dataset.lon = p.lon; b.hidden = true; b.classList.remove("busy"); b.textContent = "Use my location"; f.placeholder = "Starting from"; hereBusy = false; };
    if (me && lastFixAt && Date.now() - lastFixAt < 10 * 60000) return set(me);   // a recent fix: use it straight away
    if (hereBusy) return;
    if (!navigator.geolocation) return toast("Location isn't available on this phone");
    hereBusy = true; b.classList.add("busy"); b.innerHTML = `<span class="spinner"></span>Finding you`; f.placeholder = "Finding your location…";
    const fail = (msg) => { hereBusy = false; b.classList.remove("busy"); b.textContent = "Use my location"; f.placeholder = "Starting from"; if (me) return set(me); toast(msg); };
    const timer = setTimeout(() => fail("Couldn't get a GPS fix. Type your town instead, or try again outside."), 15000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); onPosition(pos); store.set("cf-loc-ok", true); startTracking(); set(me); },
      (err) => { clearTimeout(timer); fail(err && err.code === 1 ? "Location is turned off for Camp Finder. Turn it on in iPhone Settings → Camp Finder → Location." : "Couldn't find your location. Type your town instead."); },
      { enableHighAccuracy: true, timeout: 14000, maximumAge: 300000 }
    );
  });
  $("#from").addEventListener("input", () => ($("#useHere").hidden = !!$("#from").value));
  attachSuggest($("#from"), () => ($("#useHere").hidden = true));
  attachSuggest($("#to"));

  // ---------------------------------------------------------------- PLAN
  let plan = null;
  $("#planForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#planMsg"), btn = $("#findBtn");
    msg.className = "msg"; btn.disabled = true;
    const pl = $("#planning"), steps = $$("#plSteps li");
    let stepNow = -1;
    const step = (n, frac) => {
      steps.forEach((li, k) => { li.classList.toggle("done", k < n); li.classList.toggle("now", k === n); });
      const p = Math.min(1, (n + (frac || 0)) / steps.length);
      $("#plFill").style.width = `${p * 100}%`; pl.querySelector(".pl-car").style.setProperty("--p", p);
      stepNow = n;
    };
    const say = (t) => {
      btn.innerHTML = `<span class="spinner"></span>${esc(t)}`;
      const m = /(\d+)%/.exec(t);
      if (/Finding/.test(t)) step(0); else if (/route|drive/i.test(t) && !/camp/i.test(t)) step(1);
      else if (/camp/i.test(t) && stepNow <= 2) step(2, m ? +m[1] / 100 : 0);
    };
    $("#planForm").hidden = true; pl.hidden = false; step(0); $("#sheetScroll").scrollTop = 0;
    try {
      savePrefs();
      const nights = +nightsIn.value;
      if (settings.simple) { const r = $("#simpleRefresh").checked ? Math.max(1, Math.round(+nightsIn.value / 3)) : 0; refreshIn.value = Math.min(r, +nightsIn.value); }
      const opts = { rig: radio("rig"), cost: radio("cost"), detour: +radio("detour"), wants: wantsOf($("#planWants")), refresh: +$("#refreshIn").value, refreshStyle: radio("rstyle") || "motel", bougie: $("#bougie").checked, leave: $("#leaveDate").value || "", ret: !!$("#retTrip")?.checked };
      say("Finding places");
      const [from, to] = await Promise.all([resolvePlace($("#from")), resolvePlace($("#to"))]);
      say("Planning the route");
      // return trip: out via your "there" stops, back via your "back" stops, finishing where you started
      const outV = viaStops.filter((v) => v.leg !== "back"), backV = viaStops.filter((v) => v.leg === "back");
      const route = await osrm(opts.ret ? [from, ...outV, to, ...backV, from] : [from, ...viaStops, to]);
      say("Looking for camps");
      const data = await campsAlong(route, opts.detour, (t) => say(t.replace("Searching for camps along the route… ", "Looking for camps ")));
      if (opts.ret) { markTurn(data.line, route, to, outV.length + 1); data.camps = perLeg(data.line, data.camps, opts.detour * 1.15); }
      step(3);
      plan = makePlan({ from, to, route, nights, opts, data });
      plan.offline = data.offline;
      plan.stays = pendingStays || {}; pendingStays = null;
      msg.textContent = "";
      step(4); await sleep(animOn() ? 450 : 0);
      pl.hidden = true;
      showPlan();
    } catch (err) {
      pl.hidden = true; $("#planForm").hidden = false;
      console.warn("Trip planning failed:", err && (err.stack || err.message || err));
      msg.className = "msg is-error";
      msg.textContent = friendly(err);
    } finally { btn.disabled = false; btn.textContent = "Find camps"; }
  });

  // ---- Stay an extra night: plan.stays[i] = extra nights at night i's camp
  let pendingStays = null;
  const extraAt = (i) => Math.max(0, +(plan?.stays?.[i]) || 0);
  const extraBefore = (i) => { let n = 0; for (let k = 0; k < i; k++) n += extraAt(k); return n; };
  const totalDays = (p = plan) => p.nights + 1 + Object.values(p.stays || {}).reduce((a, n) => a + (+n || 0), 0);
  const dayNo = (i) => i + 1 + extraBefore(i);   // which day of the trip you drive leg i
  function stayRow(i, maxStay) {
    const n = 1 + extraAt(i), cap = Math.min(7, maxStay || 7);
    if (n === 1) return `<button class="stay-more" type="button" data-act="stay" data-i="${i}" data-d="1"${cap <= 1 ? " disabled" : ""}>🏕️ Stay an extra night</button>`;
    return `<div class="stay-row"><span>🏕️ <b>${n} nights</b> here · rest day${n > 2 ? "s" : ""}</span><button type="button" class="st-step" data-act="stay" data-i="${i}" data-d="-1" aria-label="One night fewer">−</button><button type="button" class="st-step" data-act="stay" data-i="${i}" data-d="1" aria-label="One more night"${n >= cap ? " disabled" : ""}>+</button></div>`;
  }

  function nightKm(i) {
    const prevAlong = i === 0 ? 0 : (plan.picks[i - 1].camp?.along ?? plan.picks[i - 1].target);
    const here = plan.picks[i].camp?.along ?? plan.picks[i].target;
    return here - prevAlong;
  }
  const short = (s) => String(s).split(",")[0];

  function showPlan() {
    const p = plan;
    $("#planForm").hidden = true; $("#results").hidden = false;
    $("#tripTitle").textContent = `${short(p.from.name)} to ${short(p.to.name)}${p.opts.ret ? " and back" : ""}`;
    const days = totalDays(p);
    $("#tripMeta").textContent = `${km(p.route.distance)} and ${hrs(p.route.duration)} of driving over ${days} day${days > 1 ? "s" : ""}`;
    renderItinerary();
    renderBudget();
    renderTripExtras();
    const along = [...new Map(p.camps.map((c) => [c.id, c])).values()].sort((a, b) => a.along - b.along);
    $("#alongCount").textContent = along.length;
    $("#alongList").innerHTML = along.map((c) => `<li>${campCard(c)}</li>`).join("") || `<li class="empty">No camps within your detour distance. Try a longer detour.</li>`;
    $("#saveTrip").classList.remove("is-on");
    $("#offlineTrip").classList.toggle("is-on", !!p.legs);
    const on = $("#tripOffline");
    on.hidden = !p.offline;
    on.innerHTML = p.offline ? `${icon("offline", "ic sm")}Showing your offline download. Camp details and saved directions work without signal; the map background needs signal.` : "";
    $("#sheetScroll").scrollTop = 0;
    drawPlan();
    planExtras(p);
  }

  // ---- Things to see on the way: popular sights near your route, pick the ones you want
  const POI_DETOUR = 50000;   // hand-picked sights up to 50 km off the route
  const seeIds = new Set();   // sights you've added to this trip
  const POIS = (window.CF_POIS || []).map(([name, lat, lon, emoji, blurb, star]) => ({ id: `poi:${name}`, name, lat, lon, emoji, blurb, star }));
  function poisAlong(p) {
    if (p._pois) return p._pois;
    const pad = 0.6, lats = p.line.pts.map((x) => x[0]), lons = p.line.pts.map((x) => x[1]);
    const bb = [minOf(lats) - pad, minOf(lons) - pad, maxOf(lats) + pad, maxOf(lons) + pad];
    const cand = POIS.filter((x) => x.lat >= bb[0] && x.lat <= bb[2] && x.lon >= bb[1] && x.lon <= bb[3]);
    // on a return trip a sight can be on the way there, the way back, or both (way-back ids end in "@back")
    const list = perLeg(p.line, cand, 400000, true).filter((x) => x.off <= POI_DETOUR || seeIds.has(x.id));
    for (const g of p._gpois || []) if (!list.some((x) => (x._leg || "") === (g._leg || "") && hav([x.lat, x.lon], [g.lat, g.lon]) < 2500)) list.push(g);
    list.sort((a, b) => a.along - b.along);
    return (p._pois = list);
  }
  const dayOfAlong = (p, along) => { for (let i = 0; i < p.picks.length; i++) { const a = p.picks[i].camp?.along ?? p.picks[i].target; if (along <= a) return i; } return p.picks.length; };
  function poiTeaserHtml(p) {
    const list = poisAlong(p); if (!list.length) return "";
    const picked = list.filter((x) => seeIds.has(x.id));
    const top = [...list].sort((a, b) => (b.star || 0) - (a.star || 0) || (b.count || 0) - (a.count || 0)).slice(0, 3);
    return `<li class="poi-teaser"><span class="pt-ic">📸</span><div><b>${picked.length ? `Seeing ${picked.length} thing${picked.length > 1 ? "s" : ""} on the way` : "Things to see on the way"}</b>
      <p>${picked.length ? picked.map((x) => esc(x.name)).slice(0, 3).join(", ") : `${top.map((x) => esc(x.name)).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`}</p></div>
      <button type="button" class="btn" data-act="pois">${picked.length ? "Change" : "Pick"}</button></li>`;
  }
  function seeTodayLine(i) {
    if (!seeIds.size || !plan) return "";
    const today = poisAlong(plan).filter((x) => seeIds.has(x.id) && dayOfAlong(plan, x.along) === i);
    return today.length ? `<p class="see-line">📸 See today: ${today.map((x) => `<button type="button" data-poi="${esc(x.id)}">${x.emoji} ${esc(x.name)}</button>`).join("")}</p>` : "";
  }
  // the most-reviewed attractions on Google Maps along the route (only when online with the key)
  async function googlePois(p) {
    if (!CFG.googleKey || p._gpois) return p._gpois || [];
    const centers = []; const step = Math.max(90000, p.line.total / 22);
    for (let a = 0; a <= p.line.total; a += step) centers.push(pointAt(p.line, a));
    const found = new Map();
    await Promise.all(centers.map(async (c) => {
      try {
        const j = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST", fieldMask: "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.editorialSummary,places.primaryTypeDisplayName,places.googleMapsUri",
          body: { includedTypes: ["tourist_attraction", "national_park", "beach", "hiking_area"], rankPreference: "POPULARITY", maxResultCount: 10, locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: 30000 } } },
        });
        for (const g of j.places || []) if ((g.userRatingCount || 0) >= 400 && (g.rating || 0) >= 4.3) found.set(g.id, g);
      } catch { /* skip this stretch */ }
    }));
    const out = [...found.values()].map((g) => ({ id: `g:${g.id}`, name: g.displayName?.text || "Attraction", lat: g.location.latitude, lon: g.location.longitude, emoji: "⭐",
      blurb: g.editorialSummary?.text || g.primaryTypeDisplayName?.text || "Popular with visitors", rating: g.rating, count: g.userRatingCount, uri: g.googleMapsUri, star: g.userRatingCount > 3000 ? 3 : 2 }));
    p._gpois = perLeg(p.line, out, 25000, true); p._pois = null;
    return p._gpois;
    return out;
  }
  function openPois(focusId) {
    const p = plan; if (!p) return;
    const draft = new Set(seeIds);
    const row = (x) => {
      const day = dayOfAlong(p, x.along) + 1;
      const detour = x.off < 1500 ? "On your route" : `${km(x.off)} off route · about ${hrs((x.off * 2) / 22)} return`;
      return `<li class="poi-row${draft.has(x.id) ? " on" : ""}" id="row-${CSS.escape(x.id)}"><label>
        <input type="checkbox" value="${esc(x.id)}" ${draft.has(x.id) ? "checked" : ""}>
        <span class="pr-ic">${x.emoji}</span>
        <span class="pr-body"><b>${esc(x.name)}${x.star >= 3 ? ` <i class="must">Must see</i>` : ""}</b><small>${esc(x.blurb)}</small>
        <em>Day ${day} · ${detour}${x.rating ? ` · ★ ${x.rating.toFixed(1)} (${x.count.toLocaleString("en-AU")})` : ""}</em></span></label></li>`;
    };
    const draw = () => {
      const list = poisAlong(p);
      // return trip: two sections, so you can pick what to see going and what to see coming home
      const head = (t, sub) => `<li class="poi-head"><b>${t}</b><small>${sub}</small></li>`;
      const there = list.filter((x) => !x._leg), back = list.filter((x) => x._leg === "back");
      $("#poiList").innerHTML = (p.line.turn
        ? (there.length ? head(`On the way to ${esc(short(p.to.name))}`, `${there.length} sight${there.length > 1 ? "s" : ""}`) + there.map(row).join("") : "") +
          (back.length ? head(`On the way back to ${esc(short(p.from.name))}`, `${back.length} sight${back.length > 1 ? "s" : ""}`) + back.map(row).join("") : "")
        : list.map(row).join("")) || `<li class="empty">No well-known sights found near this route.</li>`;
      updateBtn();
    };
    const updateBtn = () => { const n = draft.size; $("#poiApply").textContent = n ? `Add ${n} to my trip` : seeIds.size ? "Remove all from my trip" : "Pick the ones you want to see"; $("#poiApply").disabled = !n && !seeIds.size; };
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Things to see on the way</h2>
      <p class="d-kind">${p.line.turn ? "Pick what you want to see on the way there and on the way back. Sights on a road you drive both ways show in both lists." : "Popular sights near your route, in the order you'll pass them. Tick the ones you want and we'll route you past them."}</p>
      <p class="help" id="poiMore">${CFG.googleKey ? `<span class="spinner"></span>Finding the most popular spots on Google…` : ""}</p>
      <ul class="poi-list" id="poiList"></ul>
      <div class="poi-bar"><button class="cta" type="button" id="poiApply">Pick the ones you want to see</button></div></div>`);
    draw();
    if (focusId) setTimeout(() => { const el = document.getElementById(`row-${CSS.escape(focusId)}`); el?.scrollIntoView({ block: "center" }); el?.classList.add("flash"); }, 60);
    $("#poiList").addEventListener("change", (e) => { const cb = e.target.closest("input[type=checkbox]"); if (!cb) return; cb.checked ? draft.add(cb.value) : draft.delete(cb.value); cb.closest(".poi-row").classList.toggle("on", cb.checked); updateBtn(); });
    if (CFG.googleKey) googlePois(p).then((g) => { if (!$("#poiMore")) return; $("#poiMore").textContent = g.length ? `Includes ${g.length} of the most-reviewed spots on Google Maps.` : ""; draw(); }).catch(() => { if ($("#poiMore")) $("#poiMore").textContent = ""; });
    $("#poiApply").addEventListener("click", () => applySights(draft));
  }
  // re-plan the trip so it routes past the sights you picked
  function applySights(ids) {
    const p = plan; if (!p) return;
    const all = poisAlong(p);
    seeIds.clear(); ids.forEach((id) => seeIds.add(id));
    const chosen = all.filter((x) => seeIds.has(x.id)).slice(0, 10);
    // a few km away counts as on the way: no detour
    const keep = viaStops.filter((v) => !v.poi);
    const wasVia = new Set(viaStops.filter((v) => v.poi).map((v) => v.name + (v.leg || "")));
    const legAlong = (v) => (p.line.turn ? projectAll(p.line, v)[v.leg === "back" ? 1 : 0].along : project(p.line, v).along);
    const vias = [...keep.map((v) => ({ ...v, along: legAlong(v) })), ...chosen.filter((x) => x.off >= 1500 || wasVia.has(x.name + (x._leg || ""))).map((x) => ({ name: x.name, lat: x.lat, lon: x.lon, poi: true, leg: x._leg || "", along: x.along }))]
      .sort((a, b) => a.along - b.along).map(({ along, ...v }) => v);
    viaStops = vias; renderVia();
    closeDetail();
    toast(chosen.length ? `Adding ${chosen.length} sight${chosen.length > 1 ? "s" : ""} to your trip` : "Sights removed");
    $("#results").hidden = true; $("#planForm").hidden = false;
    $("#planForm").requestSubmit ? $("#planForm").requestSubmit() : $("#findBtn").click();
  }
  // One sight, opened straight from the map or the day it's on
  async function openPoi(id) {
    const p = plan; if (!p) return;
    const x = poisAlong(p).find((q) => q.id === id) || POIS.find((q) => q.id === String(id).replace(/@back$/, "")); if (!x) return openPois();
    const along = x.along ?? project(p.line, x).along, off = x.off ?? project(p.line, x).off;
    const day = dayOfAlong(p, along) + 1, on = seeIds.has(x.id);
    const detour = off < 1500 ? "Right on your route" : `${km(off)} off your route · about ${hrs((off * 2) / 22)} there and back`;
    const learn = x.uri || `https://www.google.com/search?q=${encodeURIComponent(`${x.name} ${stateOf(x.lat, x.lon)}`)}`;
    showDetail(`<div class="poi-detail"><div class="pd-photo" id="pdPhoto"><span class="pd-emoji">${x.emoji}</span></div>
      <div class="d-pad" style="padding-top:14px">
        <h2 class="d-title">${esc(x.name)}${x.star >= 3 ? ` <i class="must">Must see</i>` : ""}</h2>
        <p class="d-kind">${p.line.turn ? (x._leg === "back" ? "Way back · " : "Way there · ") : ""}Day ${day} · ${detour}${x.rating ? ` · ★ ${x.rating.toFixed(1)} on Google (${x.count.toLocaleString("en-AU")})` : ""}</p>
        <p class="pd-blurb">${esc(x.blurb || "")}</p>
        <div class="stop-actions">
          <button class="cta" type="button" id="pdToggle">${on ? "Remove from my trip" : "➕ Add to my trip"}</button>
        </div>
        <div class="stop-actions">
          <a class="btn line" href="https://maps.apple.com/?daddr=${x.lat},${x.lon}&dirflg=d&q=${encodeURIComponent(x.name)}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
          <a class="btn line" href="${esc(learn)}" target="_blank" rel="noopener">${icon("search")}Learn more</a>
          <button class="btn line" type="button" id="pdAll">All sights</button>
        </div>
        <p class="caveat" id="pdCredit"></p>
      </div></div>`);
    if (window.innerWidth < 900) map.setView([x.lat, x.lon], Math.max(map.getZoom(), 10));
    $("#pdToggle").addEventListener("click", () => { const ids = new Set(seeIds); on ? ids.delete(x.id) : ids.add(x.id); applySights(ids); });
    $("#pdAll").addEventListener("click", () => openPois(x.id));
    try {
      const ph = (await soon(googlePhotos({ id: `poi:${x.id}`, name: x.name, named: true, lat: x.lat, lon: x.lon }, 1), 8000, []))[0];
      if (ph && $("#pdPhoto")) { $("#pdPhoto").innerHTML = `<img src="${esc(ph.src)}" alt="">`; $("#pdCredit").textContent = `Photo: ${ph.credit}`; }
    } catch { /* the emoji stays */ }
  }

  // ---- Arrive before dark: sunset at each night's camp and the time to leave by
  const TOWING_SLOW = 1.12; // towing is a bit slower than the car-only drive times
  function legSeconds(i) {
    const p = plan, dist = nightKm(i);
    const base = p.route.distance ? p.route.duration * dist / p.route.distance : dist / 22;
    const drive = base * (towing(p.opts.rig) ? TOWING_SLOW : 1);
    return drive + Math.floor(drive / 7200) * 900; // a 15 minute break every 2 hours
  }
  function daylightLine(i, at) {
    if (!at || !window.CFGeo) return "";
    const d = new Date(); d.setDate(d.getDate() + dayOffset(plan) + i + extraBefore(i)); d.setHours(12, 0, 0, 0);
    const sunset = sunTimes(at.lat, at.lon, d);
    if (!isFinite(sunset)) return "";
    const secs = legSeconds(i);
    const leaveBy = new Date(sunset.getTime() - 45 * 60000 - secs * 1000);
    const startPt = i === 0 ? plan.from : (plan.picks[i - 1].camp || pointAt(plan.line, plan.picks[i - 1].target));
    const leaveMin = CFGeo.localMinutes(sunset, at.lat, at.lon) - 45 - secs / 60; // minutes after midnight
    const tooLong = secs > 10 * 3600 || leaveMin < 6 * 60;
    return `<p class="daylight${tooLong ? " long" : ""}">🌅 Sunset ${CFGeo.localTime(sunset, at.lat, at.lon)} at camp · ${hrs(secs)} with breaks · <b>${tooLong ? "Long day: consider an extra night" : `Leave by ${CFGeo.localTime(leaveBy, startPt.lat, startPt.lon)}`}</b></p>`;
  }

  // ---- Fuel check: is there any stretch longer than your range?
  function fuelGaps(p) {
    if (p._gaps) return p._gaps;
    const found = new Map();
    for (let a = 0; a <= p.line.total; a += 40000) for (const st of (campDB.fuelIn ? campDB.fuelIn(pointAt(p.line, a), 32000) : [])) found.set(st.id || `${st.lat},${st.lon}`, st);
    (p.fuel || []).forEach((fs) => (fs.options || []).forEach((o) => found.set(o.id, o)));
    const list = perLeg(p.line, [...found.values()], 5000).sort((a, b) => a.along - b.along);
    // nearby stations count as one stop
    const stations = []; for (const st of list) if (!stations.length || st.along - stations.at(-1).along > 1500) stations.push(st);
    const pts = [{ along: 0, name: short(p.from.name), start: true }, ...stations, { along: p.line.total, name: short(p.to.name), end: true }];
    const gaps = [];
    for (let k = 1; k < pts.length; k++) gaps.push({ from: pts[k - 1], to: pts[k], len: pts[k].along - pts[k - 1].along });
    const worst = gaps.reduce((a, g) => (g.len > (a?.len || 0) ? g : a), null);
    return (p._gaps = { stations, gaps, worst, known: stations.length > 0 || p.line.total < 150000 });
  }
  function fuelCheckHtml(p) {
    const range = rangeKm(p.opts.rig) * 1000;
    if (!isFinite(range)) return "";
    const g = fuelGaps(p); if (!g.worst) return "";
    const tow = towing(p.opts.rig) && settings.tow ? " towing" : "";
    const where = `${esc(short(g.worst.from.name || "fuel"))} → ${esc(short(g.worst.to.name || "fuel"))}`;
    if (!g.known) return `<li class="fuel-check warn"><span class="fck-ic">⛽</span><div><b>Fuel check</b><p>We don't know the fuel stations on this route. Fill up whenever you can and carry spare fuel.</p></div></li>`;
    if (g.worst.len > range) {
      const per100 = settings.use * (towing(p.opts.rig) ? 1 + settings.tow / 100 : 1);
      const spare = Math.ceil(((g.worst.len - range) / 1000 + 50) * per100 / 100);
      return `<li class="fuel-check bad"><span class="fck-ic">⛽</span><div><b>Fuel warning: you can't make it on one tank</b><p>${km(g.worst.len)} with no fuel (${where}). Your range${tow} is about ${km(range)}. Carry at least <b>${spare} L</b> spare (${Math.ceil(spare / 20)} × 20 L jerry can${spare > 20 ? "s" : ""}) and fill up before this stretch.</p></div></li>`;
    }
    if (g.worst.len > range * 0.75) return `<li class="fuel-check warn"><span class="fck-ic">⛽</span><div><b>Fuel check: tight</b><p>Longest stretch without fuel is ${km(g.worst.len)} (${where}). Your range${tow} is about ${km(range)}. Fill up at every chance before it.</p></div></li>`;
    return `<li class="fuel-check ok"><span class="fck-ic">⛽</span><div><b>Fuel check: you're fine</b><p>Longest stretch without fuel is ${km(g.worst.len)} (${where}). Your range${tow} is about ${km(range)}.</p></div></li>`;
  }
  // stations that are the last fuel before a long stretch (used for alerts on the road)
  function lastFuelList(p) {
    const g = fuelGaps(p), out = [];
    for (const gap of g.gaps) if (gap.len >= 150000 && !gap.from.start) out.push({ name: gap.from.name, lat: gap.from.lat, lon: gap.from.lon, gapKm: Math.round(gap.len / 1000), next: short(gap.to.name || "") });
    return out.slice(0, 40);
  }

  function renderItinerary() {
    const p = plan; if (!p) return;
    const stops = [];
    const fuel = [...(p.fuel || [])];
    const fuelUpTo = (along) => { while (fuel.length && fuel[0].along <= along) stops.push(fuelStopHtml(fuel.shift())); };
    stops.push(`<li class="stop"><div class="plate start" aria-hidden="true"></div><div class="stop-body"><div class="stop-place">${esc(short(p.from.name))}</div></div></li>`);
    let turned = !p.line.turn;
    p.picks.forEach((pk, i) => {
      if (!turned && (pk.camp?.along ?? pk.target) > p.line.turn + 2000) {
        turned = true;
        stops.push(`<li class="stop turn"><div class="plate turn" aria-hidden="true">↩</div><div class="stop-body"><div class="stop-place">${esc(short(p.to.name))}</div><p class="help">Turn around and head home to ${esc(short(p.from.name))}</p></div></li>`);
      }
      fuelUpTo(pk.camp?.along ?? pk.target);
      const leg = `<p class="stop-leg">Day ${dayNo(i)}: ${km(nightKm(i))}${legExtra(nightKm(i))}${weatherChip(i)}</p>${daylightLine(i, pk.camp || pointAt(p.line, pk.target))}${seeTodayLine(i)}`;
      if (pk.refresh) { stops.push(refreshStopHtml(pk, i, leg)); return; }
      if (!pk.camp) {
        stops.push(`<li class="stop"><div class="plate" aria-label="Night ${i + 1}">${i + 1}</div><div class="stop-body">${leg}<p class="note">${esc(pk.warn)}</p></div></li>`);
        return;
      }
      stops.push(`<li class="stop"><div class="plate" aria-label="Night ${i + 1}">${i + 1}</div><div class="stop-body">
        ${leg}
        ${pk.warn ? `<p class="note">${esc(pk.warn)}</p>` : ""}
        ${campCard(pk.camp)}
        ${stayRow(i, maxStayDays(pk.camp))}
        <div class="stop-actions">
          <button class="btn" data-act="leg" data-i="${i}" type="button">${icon("route")}Directions</button>
          <a class="btn line" href="${navUrl(pk.camp, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
          <a class="btn line learn" href="${esc(learnUrl(pk.camp))}" target="_blank" rel="noopener" data-learn="${esc(pk.camp.id)}">${icon("search")}Learn more</a>
        </div>
        ${pk.alts.length ? `<details class="alt-wrap"><summary>${pk.alts.length} other camp${pk.alts.length > 1 ? "s" : ""} near here ${icon("chev", "ic sm")}</summary>
          ${pk.alts.map((c) => `<div class="alt">${campCard(c)}<button class="btn" data-act="swap" data-i="${i}" data-id="${esc(c.id)}" type="button">${icon("swap")}Stay here instead</button></div>`).join("")}
        </details>` : ""}
      </div></li>`);
    });
    const lastAlong = p.picks.at(-1)?.camp?.along ?? p.picks.at(-1)?.target ?? 0;
    fuelUpTo(p.line.total);
    stops.push(`<li class="stop"><div class="plate end" aria-hidden="true"></div><div class="stop-body"><p class="stop-leg">Day ${totalDays(p)}: ${km(p.line.total - lastAlong)}${legExtra(p.line.total - lastAlong)}</p>${seeTodayLine(p.nights)}<div class="stop-place" style="padding-top:0">${esc(short((p.opts.ret ? p.from : p.to).name))}${p.opts.ret ? " (home)" : ""}</div></div></li>`);
    { const pt = poiTeaserHtml(p); if (pt) stops.unshift(pt); }
    if (p.fuelState === "done") { const fc = fuelCheckHtml(p); if (fc) stops.unshift(fc); }
    if (p.fuelState === "loading") stops.splice(1, 0, `<li class="stop fuel-wait"><div class="plate fuel" aria-hidden="true">${icon("fuel")}</div><div class="stop-body"><p class="help"><span class="spinner"></span>Working out where you'll need fuel</p></div></li>`);
    $("#nightList").innerHTML = stops.join("");
    cardPhotos();
  }


  function drawPlan() {
    tripLayer.clearLayers(); legLayer.clearLayers();
    const p = plan; if (!p) return;
    L.polyline(p.line.pts, { color: "#ffffff", weight: 9, opacity: .9 }).addTo(tripLayer);
    const line = L.polyline(p.line.pts, { color: "#0E5A3E", weight: 5, opacity: .95 }).addTo(tripLayer);
    L.marker([p.from.lat, p.from.lon], { icon: divIcon(`<div class="mk-start"></div>`, [18, 18]), interactive: false }).addTo(tripLayer);
    L.marker([p.to.lat, p.to.lon], { icon: divIcon(`<div class="mk-end"></div>`, [18, 18]), interactive: false }).addTo(tripLayer);
    const pickIds = new Set(p.picks.map((x) => x.camp?.id));
    const drawn = new Set();
    for (const c of p.camps) if (!pickIds.has(c.id) && !drawn.has(c.id)) { drawn.add(c.id); campMarker(c).addTo(tripLayer); }
    p.picks.forEach((pk, i) => { if (pk.camp) campMarker(pk.camp, { night: true, label: String(i + 1) }).addTo(tripLayer); });
    for (const poi of poisAlong(p).slice(0, 40)) {
      const m = L.marker([poi.lat, poi.lon], { icon: divIcon(`<div class="mk-poi${seeIds.has(poi.id) ? " on" : ""}">${poi.emoji}</div>`, [30, 30]), title: poi.name, zIndexOffset: 500 });
      m.on("click", () => openPoi(poi.id)); m.addTo(tripLayer);
    }
    map.fitBounds(line.getBounds(), fitPad());
    try { if (journey) drawTravelled(); } catch { /* journey not set up yet while the app starts */ }
  }

  $("#nightList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b?.dataset.act === "swap") {
      const i = +b.dataset.i, pk = plan.picks[i];
      const alt = pk.alts.find((c) => c.id === b.dataset.id);
      pk.alts = [pk.camp, ...pk.alts.filter((c) => c.id !== alt.id)];
      pk.camp = alt; pk.warn = "";
      if (plan.legs) { plan.legs[i] = null; plan.legs[i + 1] = null; } // saved directions were to the old camp
      showPlan(); toast(`Night ${i + 1}: ${alt.name}`);
      return;
    }
    if (b?.dataset.act === "stay") {
      const i = +b.dataset.i, n = Math.max(0, Math.min(6, extraAt(i) + +b.dataset.d));
      plan.stays = { ...(plan.stays || {}) }; if (n) plan.stays[i] = n; else delete plan.stays[i];
      const days = totalDays(plan);
      $("#tripMeta").textContent = `${km(plan.route.distance)} and ${hrs(plan.route.duration)} of driving over ${days} day${days > 1 ? "s" : ""}`;
      renderItinerary(); renderBudget(); loadWeather(plan).then(() => renderItinerary()).catch(() => {});
      toast(`Night ${i + 1}: ${n + 1} night${n ? "s" : ""} here`);
      return;
    }
    if (b?.dataset.act === "leg") { showLeg(+b.dataset.i); return; }
    if (b?.dataset.act === "pois") { openPois(); return; }
    if (b?.dataset.poi) { openPoi(b.dataset.poi); return; }
    if (b?.dataset.act === "fuelpick") { const fs = plan.fuel[+b.dataset.f]; const o = fs.options.find((x) => x.id === b.dataset.id); fs.options = [o, ...fs.options.filter((x) => x !== o)]; renderItinerary(); renderBudget(); return; }
    if (b?.dataset.act === "staypick") { const pk = plan.picks[+b.dataset.i]; const o = pk.refresh.options.find((x) => x.id === b.dataset.id); pk.refresh.options = [o, ...pk.refresh.options.filter((x) => x !== o)]; renderItinerary(); renderBudget(); return; }
    if (b?.dataset.act === "camphere") { const pk = plan.picks[+b.dataset.i]; pk.refresh = null; renderItinerary(); renderBudget(); toast(`Night ${+b.dataset.i + 1}: camping instead`); return; }
    const card = e.target.closest(".camp-card");
    if (card) openDetail(findCamp(card.dataset.id));
  });
  $("#alongList").addEventListener("click", (e) => { const card = e.target.closest(".camp-card"); if (card) openDetail(findCamp(card.dataset.id)); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  function findCamp(id) {
    return (plan?.camps || []).find((c) => c.id === id) || exploreCamps.find((c) => c.id === id) || store.get("cf-camps", []).find((c) => c.id === id) || userCamps().find((c) => c.id === id);
  }
  $("#editTrip").addEventListener("click", () => { $("#planForm").hidden = false; $("#results").hidden = true; tripLayer.clearLayers(); legLayer.clearLayers(); try { if (journey) drawTravelled(); } catch {} });
  $("#saveTrip").addEventListener("click", (e) => {
    const trips = store.get("cf-trips", []);
    trips.unshift({
      id: Date.now(), from: plan.from, to: plan.to, nights: plan.nights, opts: plan.opts, km: plan.route.distance,
      picks: plan.picks.map((p) => p.camp && { id: p.camp.id, name: p.camp.name }),
      vias: viaStops.map(({ name, lat, lon, poi }) => ({ name, lat, lon, poi: !!poi })), see: [...seeIds], stays: plan.stays || {},
    });
    store.set("cf-trips", trips.slice(0, 30));
    e.currentTarget.classList.add("is-on"); toast("Trip saved");
  });

  // ---- Send a trip plan: a link anyone can open (gonelappin.au/plan.html#id), no app needed
  const PLAN_PAGE = "https://gonelappin.au/plan.html";
  function planPayload(p) {
    const r = (n, d = 4) => +(+n).toFixed(d);
    const pt = (x) => x && { name: short(x.name || ""), lat: r(x.lat), lon: r(x.lon) };
    const step = Math.max(2000, p.line.total / 600);
    const t = tripCosts(p);
    return {
      v: 1, made: new Date().toISOString().slice(0, 10),
      from: pt(p.from), to: pt(p.to), km: Math.round(p.route.distance / 1000), hours: Math.round(p.route.duration / 360) / 10,
      days: totalDays(p), rig: p.opts.rig, leave: p.opts.leave || "", ret: !!p.opts.ret,
      line: sample(p.line, step).map(([la, lo]) => [r(la), r(lo)]),
      nights: p.picks.map((pk, i) => {
        const st = pk.refresh?.options?.[0], c = st || pk.camp, x = c || pointAt(p.line, pk.target);
        return { day: dayNo(i), km: Math.round(nightKm(i) / 1000), name: c ? c.name : "No camp found", lat: r(x.lat), lon: r(x.lon), stay: 1 + extraAt(i),
          kind: st ? (st.kind || "Place to stay") : c?.kind || "", cost: st ? "paid" : c?.cost || "", fee: c ? (t?.nightsList?.[i]?.v ? Math.round(t.nightsList[i].v) : 0) : 0,
          a: c?.a ? Object.keys(c.a).filter((k) => c.a[k] === true) : [] };
      }),
      see: poisAlong(p).filter((x) => seeIds.has(x.id)).slice(0, 30).map((x) => ({ name: x.name, emoji: x.emoji, lat: r(x.lat, 3), lon: r(x.lon, 3) })),
      cost: t ? Math.round(t.total) : null,
    };
  }
  async function sharePlan() {
    if (!plan) return;
    const C = window.CFCloud;
    if (!C?.enabled || !C.createPlan) return toast("Sharing isn't switched on in this version yet");
    if (isOffline()) return toast("You need signal to send a trip plan");
    const btn = $("#sharePlan"); btn.disabled = true;
    try {
      const key = tripKey(plan), cached = store.get("cf-plan-links", {});
      const data = planPayload(plan), sig = JSON.stringify(data.nights) + data.line.length + JSON.stringify(data.see);
      let id = cached[key]?.sig === sig ? cached[key].id : null;
      if (!id) { id = await C.createPlan(data); cached[key] = { id, sig }; store.set("cf-plan-links", cached); }
      const link = `${PLAN_PAGE}#${id}`;
      const text = `Here's my trip plan: ${short(plan.from.name)} to ${short(plan.to.name)}, ${totalDays(plan)} days. Camps for every night on Camp Finder:`;
      if (navigator.share) await navigator.share({ title: "Trip plan", text, url: link }).catch(() => {});
      else { await navigator.clipboard?.writeText(`${text} ${link}`).catch(() => {}); toast("Link copied"); }
    } catch (e) { console.warn("plan share failed", e); toast("Couldn't make the link right now. Try again in a minute."); }
    finally { btn.disabled = false; }
  }
  $("#sharePlan").addEventListener("click", sharePlan);

  // ---------------------------------------------------------------- directions
  function navUrl(c, app) {
    return app === "apple"
      ? `https://maps.apple.com/?daddr=${c.lat},${c.lon}&dirflg=d&q=${encodeURIComponent(c.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}&travelmode=driving`;
  }
  function showLeg(i) {
    const start = i === 0 ? plan.from : plan.picks[i - 1].camp || plan.from;
    const stored = plan.legs?.[i];
    directions(start, plan.picks[i].camp, short(start.name), stored ? { distance: stored.distance, duration: stored.duration, geometry: { coordinates: stored.pts }, legs: [{ steps: stored.steps }] } : null);
  }
  function manIcon(s) {
    if (s.text) {
      const x = s.text.toLowerCase();
      if (/arrive|destination/.test(x)) return "m-arrive";
      if (/roundabout/.test(x)) return "m-round";
      if (/u-turn|make a u/.test(x)) return "m-uturn";
      if (/\bleft\b/.test(x)) return "m-left";
      if (/\bright\b/.test(x)) return "m-right";
      return "m-straight";
    }
    const t = s.maneuver.type, m = s.maneuver.modifier || "";
    if (t === "depart") return "m-depart";
    if (t === "arrive") return "m-arrive";
    if (/roundabout|rotary/.test(t)) return "m-round";
    if (m === "uturn") return "m-uturn";
    if (/left/.test(m)) return "m-left";
    if (/right/.test(m)) return "m-right";
    return "m-straight";
  }
  function stepHtml(s) {
    let text = esc(stepText(s));
    const road = s.name || "";
    if (road) text = text.replace(esc(road), `<b>${esc(road)}</b>`);
    const ref = (s.ref || "").split(";")[0].trim();
    if (ref && /^[MABC]\d{1,3}$/.test(ref)) text += ` <span class="shield">${esc(ref)}</span>`;
    return text;
  }
  async function directions(from, camp, fromName, storedRoute = null) {
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">To ${esc(camp.name)}</h2><p class="d-kind">From ${esc(fromName || "start")}</p><p class="msg"><span class="spinner"></span>Planning the route</p></div>`);
    try {
      const r = storedRoute || await osrm([from, camp], true);
      legLayer.clearLayers();
      const pts = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
      L.polyline(pts, { color: "#ffffff", weight: 10, opacity: .9 }).addTo(legLayer);
      const pl = L.polyline(pts, { color: "#D9A400", weight: 6, opacity: 1 }).addTo(legLayer);
      map.fitBounds(pl.getBounds(), fitPad());
      const steps = r.legs.flatMap((l) => l.steps);
      $("#detailBody").innerHTML = `<div class="d-pad" style="padding-top:22px">
        <h2 class="d-title">To ${esc(camp.name)}</h2>
        <p class="d-kind">From ${esc(fromName || "start")}</p>
        <div class="dir-sum"><div><b>${km(r.distance)}</b><span>distance</span></div><div><b>${hrs(r.duration)}</b><span>driving</span></div>${fuelFor(r.distance) ? `<div><b>${money(fuelFor(r.distance).cost)}</b><span>fuel</span></div>` : ""}</div>
        <div class="d-actions">
          <a class="cta" href="${navUrl(camp, "apple")}" target="_blank" rel="noopener">${icon("nav")}Apple Maps</a>
          <a class="btn" href="${navUrl(camp, "google")}" target="_blank" rel="noopener">Google Maps</a>
          <button class="icon-btn" style="width:48px;height:48px" type="button" id="backToCamp" aria-label="Camp details">${icon("photo")}</button>
        </div>
        <ol class="steps">${steps.map((s) => `<li><span class="m">${icon(manIcon(s))}</span><span class="t">${stepHtml(s)}</span><span class="d">${s.distance > 0 ? km(s.distance) : ""}</span></li>`).join("")}</ol>
        <p class="caveat">Drive times are for a car and don't allow for towing, roadworks or dirt roads. Check road conditions before you head off.</p>
      </div>`;
      $("#backToCamp").addEventListener("click", () => openDetail(camp));
    } catch (err) {
      $("#detailBody").innerHTML = `<div class="d-pad" style="padding-top:22px"><h2 class="d-title">To ${esc(camp.name)}</h2>
        <p class="msg is-error">${esc(friendly(err))}</p>
        <div class="d-actions"><a class="cta" href="${navUrl(camp, "apple")}" target="_blank" rel="noopener">${icon("nav")}Apple Maps</a><a class="btn" href="${navUrl(camp, "google")}" target="_blank" rel="noopener">Google Maps</a></div></div>`;
    }
  }

  // ---------------------------------------------------------------- camp detail
  function showDetail(html) { $("#detailBody").innerHTML = html; const d = $("#detail"); d.hidden = false; d.scrollTop = 0; $("#app").classList.add("detail-open"); }
  function closeDetail() { $("#detail").hidden = true; $("#app").classList.remove("detail-open"); }
  $("#detailClose").addEventListener("click", closeDetail);

  function amenTile(id, state, extra = "") {
    const word = extra || (state === true ? "Yes" : state === false ? "No" : "Not recorded");
    const cls = state === true ? "" : state === false ? "no" : "unk";
    return `<div class="${cls}">${icon(AMEN_ICON[id])}<span><b>${SHORT[id]}</b><small>${word}</small></span></div>`;
  }
  async function openDetail(c) {
    if (!c) return;
    const saved = store.get("cf-camps", []).some((x) => x.id === c.id);
    const cost = c.cost === "free" ? (c.donation ? "Free, donations welcome" : "Free") : c.cost === "paid" ? (c.charge || "Paid, price not listed") : "Not recorded";
    const site = c.website && /^https?:\/\//i.test(c.website) ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 38))}</a>` : "";
    const ownPhoto = c.image && /^https:\/\/.+\.(jpe?g|png|webp)$/i.test(c.image) ? c.image : "";
    const ramp = isFinite(c.rampM) && c.rampM <= 20000;
    const dump = isFinite(c.dumpM) && c.dumpM <= 30000;
    const fact = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
    showDetail(`
      <div class="gallery" id="gallery">${ownPhoto ? `<a href="${esc(ownPhoto)}" target="_blank" rel="noopener"><img src="${esc(ownPhoto)}" alt="${esc(c.name)}"></a>` : ""}<div class="none" id="galleryWait"><span class="spinner"></span></div></div>
      <div class="d-pad">
        <p class="d-credit" id="photoNote"></p>
        <div class="d-head"><div><h2 class="d-title" data-camp="${esc(c.id)}">${esc(gNames.get(c.id) || c.name)}</h2><p class="d-kind">${esc(metaLine(c))}</p></div>${priceTag(c)}</div>
        <div class="d-actions">
          <a class="cta" href="${navUrl(c, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
          <button class="btn" id="dirBtn" type="button">${icon("route")}Directions</button>
          <a class="icon-btn" style="width:48px;height:48px" id="learnMore" href="${esc(learnUrl(c))}" target="_blank" rel="noopener" aria-label="Learn more on Google">${icon("search")}</a>
          <button class="icon-btn ${saved ? "is-on" : ""}" style="width:48px;height:48px" id="saveCamp" type="button" aria-label="${saved ? "Saved" : "Save camp"}" aria-pressed="${saved}">${icon("bookmark")}</button>
        </div>
        <section class="rate" id="rateBox" aria-label="Ratings and reviews">
          <div class="rate-sum"><span class="stars-lg" id="rateStars">${starsHtml(0)}</span><b id="rateAvg"></b><span class="help" id="rateCount">Loading ratings</span></div>
        </section>
        <div class="amen-grid">
          ${amenTile("toilets", c.a.toilets)}${amenTile("water", c.a.water)}${amenTile("showers", c.a.showers)}${amenTile("dogs", c.a.dogs)}
          ${amenTile("power", c.a.power)}${amenTile("fires", c.a.fires)}
          ${amenTile("boatramp", ramp ? true : null, ramp ? km(c.rampM) + " away" : "None nearby")}
          ${amenTile("dump", dump ? true : null, c.dumpM === 0 ? "On site" : dump ? km(c.dumpM) + " away" : "None nearby")}
        </div>
        ${c.closed ? `<div class="notice bad"><b>Closed</b><span>${esc(c.closed)}</span></div>` : ""}
        ${c.park ? `<div class="notice"><b>National park camping</b><span>You need a camping permit before you arrive${c.park.state === "QLD" ? ", and fees apply" : ""}. Book with ${esc(c.park.who || "the parks service")}.</span>${c.park.url ? `<a class="btn line" href="${esc(c.park.url)}" target="_blank" rel="noopener">Book with ${esc(c.park.who)}</a>` : ""}</div>` : ""}
        <div class="checkin" id="checkinBox">
          <p class="crowd-now" id="crowdNow" hidden></p>
          <div class="ci-crowd"><span>Here now?</span>${CROWD.map(([k, l]) => `<button type="button" data-crowd="${k}">${l}</button>`).join("")}</div>
          <div class="ci-head"><b>Been here lately?</b><span id="ciLatest" class="help"></span></div>
          <div class="ci-btns">
            <button class="btn" type="button" data-ci="free">Still free</button>
            <button class="btn" type="button" data-ci="price_changed">Price changed</button>
            <button class="btn" type="button" data-ci="closed">Closed</button>
            <button class="btn" type="button" data-ci="full">Full</button>
          </div>
        </div>
        <div class="checkin signal" id="signalBox">
          <div class="ci-head"><b>Phone signal here</b><span id="sigSum" class="sig-sum"></span></div>
          <div class="ci-btns">${CARRIERS.map(([k, n]) => `<button class="btn" type="button" data-carrier="${k}">${n}</button>`).join("")}</div>
          <div class="ci-btns" id="sigBars" hidden><button class="btn" type="button" data-bars="0">No signal</button><button class="btn" type="button" data-bars="2">Weak</button><button class="btn" type="button" data-bars="4">Good</button></div>
        </div>
        ${c.rule ? `<div class="notice"><b>Overnight stays</b><span>${esc(c.rule)}</span></div>` : ""}
        ${rulesNear(c.lat, c.lon).map((r) => `<div class="notice warn"><b>Local rule: ${esc(r.place)}</b><span>${esc(r.text)}</span><a href="${esc(r.src)}" target="_blank" rel="noopener">Source</a></div>`).join("")}
        <dl class="facts">
          ${fact("Price", esc(cost))}
          ${fact("Suits", esc(suits(c)))}
          ${fact("Max stay", esc(c.maxstay || (c.kind === "Roadside rest area" ? "Usually 20 to 24 hours (check the signs)" : "")))}
          ${fact("Open", esc(c.hours))}
          ${fact("Run by", esc(c.operator))}
          ${fact("Phone", esc(c.phone))}
          ${fact("Website", site)}
          ${fact("Notes", esc(c.desc))}
          ${fact("Location", `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`)}
        </dl>
        <p class="caveat">${sourceLine(c)} Details can be out of date. Check signs, prices, closures and fire bans when you arrive.
          Something wrong? <button class="linkish" type="button" id="campFb">Tell us</button>${c.source === "osm" ? ` or <a href="https://www.openstreetmap.org/${esc(c.id)}" target="_blank" rel="noopener">fix it on OpenStreetMap</a>` : ""}.
          ${c.source === "user" ? `<button class="btn line" type="button" id="editMine">Edit</button> <button class="btn line" type="button" id="delMine">Remove</button>` : ""}
          ${c.source === "community" ? `<button class="btn line" type="button" id="reportCamp">Report a problem</button>` : ""}</p>
      </div>`);
    if (window.innerWidth < 900) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12));
    $("#campFb")?.addEventListener("click", () => openFeedback("camp", `${c.name} (${c.id}, ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})\n`));
    $("#dirBtn").addEventListener("click", () => {
      const i = plan && view === "plan" ? plan.picks.findIndex((p) => p.camp?.id === c.id) : -1;
      if (i >= 0) return showLeg(i);
      if (me) return directions(me, c, "your location");
      locate((p) => directions(p, c, "your location"));
    });
    $("#saveCamp").addEventListener("click", (e) => {
      const btn = e.currentTarget, list = store.get("cf-camps", []);
      const on = list.some((x) => x.id === c.id);
      store.set("cf-camps", on ? list.filter((x) => x.id !== c.id) : [c, ...list].slice(0, 200));
      btn.classList.toggle("is-on", !on); btn.setAttribute("aria-pressed", !on); btn.setAttribute("aria-label", on ? "Save camp" : "Saved");
      toast(on ? "Removed from saved" : "Camp saved");
    });
    wireCheckins(c);
    $("#reportCamp")?.addEventListener("click", async (e) => {
      if (!window.CFCloud?.signedIn()) return toast("Sign in on the Saved tab to report a camp");
      try { await window.CFCloud.reportCamp(c.cloudId); e.currentTarget.disabled = true; e.currentTarget.textContent = "Reported"; toast("Thanks. Camps with several reports are hidden."); }
      catch { toast("Couldn't send the report. Try again later."); }
    });
    $("#editMine")?.addEventListener("click", () => openAddCamp(c));
    $("#delMine")?.addEventListener("click", (e) => {
      if (e.currentTarget.dataset.sure !== "1") { e.currentTarget.dataset.sure = "1"; e.currentTarget.textContent = "Tap again to remove"; return; }
      store.set("cf-user-camps", userCamps().filter((x) => x.id !== c.id));
      if (c.cloudId && window.CFCloud?.signedIn()) window.CFCloud.deleteCamp(c.cloudId).catch(() => toast("Removed here. Couldn't remove the shared copy right now."));
      closeDetail(); refreshAfterUserChange(); toast("Camp removed");
    });
    wireRating(c);
    wireSignal(c);
    loadGallery(c, ownPhoto);
  }
  // ---------------------------------------------------------------- photos: travellers, Google, Wikimedia
  async function loadGallery(c, ownPhoto) {
    const g = $("#gallery"); if (!g) return;
    const key = c.id;
    const shots = []; // { src, href, credit }
    const add = (list) => { for (const p of list) if (p && p.src && !shots.some((x) => x.src === p.src)) shots.push(p); };
    const render = (done) => {
      if (!$("#gallery") || $("#gallery").dataset.key !== key) return;
      const tiles = shots.map((p, i) => `<figure class="ph">${p.href ? `<a href="${esc(p.href)}" target="_blank" rel="noopener">` : ""}<img ${i ? 'loading="lazy"' : ""} src="${esc(p.src)}" alt="Photo of ${esc(c.name)}">${p.href ? "</a>" : ""}${p.credit ? `<figcaption>${esc(p.credit)}</figcaption>` : ""}${p.mine ? `<button class="ph-del" type="button" data-del="${p.id}" aria-label="Remove my photo">×</button>` : ""}</figure>`).join("");
      const addTile = `<button type="button" class="ph-add" id="phAdd">${icon("photo")}<span>${shots.length ? "Add your photo" : "Be the first to add a photo"}</span></button>`;
      g.innerHTML = tiles + (done ? addTile : `<div class="none"><span class="spinner"></span></div>`);
      if (done) wirePhotoAdd(c);
      g.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
        e.preventDefault(); const p = shots.find((x) => String(x.id) === b.dataset.del);
        try { await window.CFCloud.deletePhoto(p); shots.splice(shots.indexOf(p), 1); render(true); toast("Photo removed"); } catch { toast("Couldn't remove it right now"); }
      }));
      $("#photoNote").textContent = shots.some((p) => p.google) ? "Some photos from Google. Photographer shown on each." : "";
    };
    g.dataset.key = key; g.scrollLeft = 0;
    if (c.photo) add([{ src: c.photo, credit: "Added by a traveller" }]);
    if (ownPhoto) add([{ src: ownPhoto, href: ownPhoto, credit: "From the camp listing" }]);
    render(false);
    const jobs = [
      soon(window.CFCloud?.enabled ? window.CFCloud.photosFor(key) : Promise.resolve([]), 8000, []).then((l) => l.map((p) => ({ src: p.url, credit: "Traveller photo", mine: p.mine, id: p.id }))),
      soon(googlePhotos(c), 12000, []),
      soon(photosNear(c), 10000, []).then((l) => l.map((p) => ({ src: p.thumb, href: p.page, credit: p.by ? `Nearby · ${p.by} · Wikimedia` : "Nearby · Wikimedia Commons" }))),
    ];
    // travellers first, then Google, then nearby free photos
    const [mine, goog, wiki] = await Promise.all(jobs.map((j, i) => j.then((v) => { if (i === 0) { add(v); render(false); } return v; })));
    add(mine); add(goog); add(wiki);
    render(true);
  }
  function wirePhotoAdd(c) {
    const btn = $("#phAdd"); if (!btn) return;
    btn.addEventListener("click", () => {
      if (!window.CFCloud?.enabled) return toast("Photo sharing is being switched on soon");
      if (!window.CFCloud.signedIn()) { toast("Sign in (free) to add photos"); return goSignIn(); }
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.addEventListener("change", async () => {
        const f = inp.files?.[0]; if (!f) return;
        btn.disabled = true; btn.querySelector("span").textContent = "Uploading…";
        try {
          const data = await shrinkImage(f, 1600);
          if (!data) throw new Error("bad image");
          await window.CFCloud.addPhoto(c.id, data);
          toast("Thanks! Your photo is up.");
          await loadGallery(c, ""); const gg = $("#gallery"); if (gg) gg.scrollTo({ left: 0, behavior: "smooth" });
        } catch { toast("Couldn't upload that photo. Try again with signal."); btn.disabled = false; btn.querySelector("span").textContent = "Add your photo"; }
      });
      inp.click();
    });
  }
  function goSignIn() { closeDetail(); $("#tab-saved")?.click(); setTimeout(() => $("#acctEmail")?.focus(), 300); }

  // Google Places photos (licensed; switched on by CFG.googleKey). Place IDs are kept; photo links are not.
  const gIds = store.get("cf-gpid2", {});   // v2: unnamed camps now matched to nearby campgrounds
  async function gfetch(url, { method = "GET", body, fieldMask } = {}) {
    const headers = { "X-Goog-Api-Key": CFG.googleKey };
    if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
    if (body) headers["Content-Type"] = "application/json";
    if (nativeFetch) return JSON.parse(await nativeFetch(url, { method, body: body && JSON.stringify(body), contentType: body && "application/json", headers, timeout: 10000 }));
    return fetchJSON(url, { method, headers, body: body && JSON.stringify(body) }, 10000);
  }
  const gCache = new Map(), gPlace = new Map();
  async function googlePlaceId(c) {
    let id = gIds[c.id];
    if (id === undefined || (id === "" && Date.now() - (gIds[c.id + "@t"] || 0) > 14 * 864e5)) {
      let hit = null;
      if (c.named) {
        const j = await gfetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST", fieldMask: "places.id,places.location",
          body: { textQuery: c.name, pageSize: 3, regionCode: "AU", locationBias: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: 3000 } } },
        });
        // only accept a match that's actually at this camp
        hit = (j.places || []).find((p) => p.location && hav([c.lat, c.lon], [p.location.latitude, p.location.longitude]) <= 3600);
      }
      if (!hit) {
        // no name (or no match by name): the nearest campground or RV park Google knows right at this spot
        const j = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST", fieldMask: "places.id,places.location",
          body: { includedTypes: ["campground", "rv_park"], maxResultCount: 3, rankPreference: "DISTANCE", locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: c.named ? 800 : 1200 } } },
        });
        hit = (j.places || []).find((p) => p.location && hav([c.lat, c.lon], [p.location.latitude, p.location.longitude]) <= (c.named ? 900 : 1300));
      }
      id = hit?.id || "";
      gIds[c.id] = id; if (!id) gIds[c.id + "@t"] = Date.now();
      store.set("cf-gpid2", gIds);
    }
    return id;
  }
  const gPhotoNames = new Map();
  async function googlePhotos(c, limit = CFG.googlePhotos) {
    if (!CFG.googleKey) return [];
    const have = gCache.get(c.id);
    if (have && (have.length >= limit || have.done)) return have.slice(0, limit);
    const id = await googlePlaceId(c);
    if (!id) { const e = []; e.done = true; gCache.set(c.id, e); return []; }
    let names = gPhotoNames.get(c.id);
    if (!names) {
      const det = await gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { fieldMask: (CFG.googleReviews ? "photos,rating,userRatingCount,reviews,googleMapsUri" : "photos") + (c.named ? "" : ",displayName") });
      if (!c.named && det.displayName?.text) nameFromGoogle(c, det.displayName.text);
      if (det.rating) { gPlace.set(c.id, { rating: det.rating, count: det.userRatingCount || 0, reviews: det.reviews || [], uri: det.googleMapsUri || "" }); renderGoogleRating(c, gPlace.get(c.id)); }
      names = det.photos || []; gPhotoNames.set(c.id, names);
    }
    const out = have ? [...have] : [];
    const todo = names.slice(out.length, limit);
    const more = (await Promise.all(todo.map(async (p) => {
      try {
        const m = await gfetch(`https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=900&skipHttpRedirect=true`);
        const who = (p.authorAttributions || [])[0];
        return m.photoUri ? { src: m.photoUri, href: who?.uri || "", credit: `${who?.displayName || "Google user"} · Google`, google: true } : null;
      } catch { return null; }
    }))).filter(Boolean);
    out.push(...more);
    out.done = out.length >= names.length;
    gCache.set(c.id, out);
    return out.slice(0, limit);
  }
  // An unnamed camp that Google knows by name: show that name (kept only while the app is open, per Google's terms)
  const gNames = new Map();
  function nameFromGoogle(c, name) {
    gNames.set(c.id, name);
    for (const x of [findCamp(c.id), c]) if (x && !x.named) { x.name = name; x.gnamed = true; }
    $$(`.camp-card[data-id="${CSS.escape(c.id)}"] .cc-name`).forEach((el) => (el.textContent = name));
    const t = $(`#detailBody .d-title[data-camp="${CSS.escape(c.id)}"]`); if (t) t.textContent = name;
  }
  // "Learn more": the camp's Google Maps page when we know it, otherwise a Google search for it
  function learnUrl(c) {
    const g = gPlace.get(c.id);
    if (g?.uri) return g.uri;
    if (c.named) return `https://www.google.com/search?q=${encodeURIComponent(`${c.name} ${c.kind === "Roadside rest area" ? "rest area" : "camping"} ${stateOf(c.lat, c.lon)}`)}`;
    return `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
  }
  function googleChip(c) {
    const g = gPlace.get(c.id);
    return g?.rating ? `<span class="g-chip">★ ${g.rating.toFixed(1)} <small>Google (${g.count.toLocaleString("en-AU")})</small></span>` : "";
  }
  // A photo on each night's camp card in a trip (one Google photo each)
  async function cardPhotos() {
    const cards = $$("#nightList .camp-card[data-id]:not([data-ph])");
    await Promise.all(cards.map(async (el) => {
      el.dataset.ph = "1";
      const c = findCamp(el.dataset.id); if (!c) return;
      let src = c.photo || "";
      if (!src && window.CFCloud?.enabled) { try { src = (await window.CFCloud.photosFor(c.id))[0]?.url || ""; } catch {} }
      if (!src) { try { src = (await soon(googlePhotos(c, 1), 8000, []))[0]?.src || ""; } catch {} }
      if (src && el.isConnected && !el.querySelector(".cc-photo")) el.insertAdjacentHTML("afterbegin", `<img class="cc-photo" src="${esc(src)}" alt="" loading="lazy">`);
      if (el.isConnected && !el.querySelector(".g-chip") && gPlace.get(c.id)?.rating) el.querySelector(".cc-meta")?.insertAdjacentHTML("beforeend", googleChip(c));
      const lm = el.closest(".stop-body")?.querySelector(`[data-learn="${CSS.escape(c.id)}"]`); if (lm) lm.href = learnUrl(c);
    }));
    crowdTags();
  }

  // ---------------------------------------------------------------- ratings and reviews
  const ratingCache = new Map();
  function starsHtml(v) {
    let h = "";
    for (let i = 1; i <= 5; i++) h += `<i class="${v >= i - 0.25 ? "on" : v >= i - 0.75 ? "half" : ""}">★</i>`;
    return h;
  }
  function starChip(id) {
    const r = ratingCache.get(id);
    return `<span class="cc-stars" data-rk="${esc(id)}">${r && r.n ? `<i>★</i>${r.avg.toFixed(1)} <small>(${r.n})</small> · ` : ""}</span>`;
  }
  // Fill star chips on any camp cards on screen, a batch at a time
  let starTimer;
  const pendingStars = new Set();
  function hydrateStars() {
    if (!window.CFCloud?.enabled) return;
    document.querySelectorAll(".cc-stars[data-rk]:empty").forEach((el) => { if (!ratingCache.has(el.dataset.rk)) pendingStars.add(el.dataset.rk); });
    clearTimeout(starTimer);
    starTimer = setTimeout(async () => {
      const keys = [...pendingStars]; pendingStars.clear();
      if (keys.length) {
        try {
          const res = await window.CFCloud.ratingSummaries(keys);
          keys.forEach((k) => ratingCache.set(k, res[k] || { avg: 0, n: 0 }));
        } catch { return; }
      }
      document.querySelectorAll(".cc-stars[data-rk]").forEach((el) => { const r = ratingCache.get(el.dataset.rk); if (r && r.n && !el.innerHTML) el.innerHTML = `<i>★</i>${r.avg.toFixed(1)} <small>(${r.n})</small> · `; });
    }, 250);
  }
  new MutationObserver(() => { if (document.querySelector(".cc-stars[data-rk]:empty")) hydrateStars(); }).observe(document.body, { childList: true, subtree: true });

  const RIG_WORD = { tent: "Tent", rooftop: "Rooftop tent", camper: "Camper trailer", caravan: "Caravan", motorhome: "Motorhome" };
  async function wireRating(c) {
    const box = $("#rateBox"); if (!box) return;
    if (!window.CFCloud?.enabled) {
      $("#rateCount").textContent = "Ratings and reviews are coming soon.";
      renderGoogleRating(c, gPlace.get(c.id));
      return;
    }
    let data;
    try { data = await window.CFCloud.ratingsFor(c.id); } catch { $("#rateCount").textContent = "Ratings couldn't load just now."; return; }
    if (!$("#rateBox") || $("#rateBox") !== box) return;
    ratingCache.set(c.id, { avg: data.avg, n: data.n });
    const mine = data.mine;
    box.innerHTML = `
      <div class="rate-sum"><span class="stars-lg">${starsHtml(data.avg)}</span>${data.n ? `<b>${data.avg.toFixed(1)}</b>` : ""}<span class="help">${data.n ? `${data.n} rating${data.n === 1 ? "" : "s"}` : "No ratings yet"}</span></div>
      <div class="rate-mine">
        <span>${mine ? "Your rating" : "Rate this camp"}</span>
        <div class="star-in" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((i) => `<button type="button" role="radio" aria-checked="${mine?.stars === i}" aria-label="${i} star${i > 1 ? "s" : ""}" data-star="${i}" class="${mine && mine.stars >= i ? "on" : ""}">★</button>`).join("")}</div>
      </div>
      <div class="rate-form" id="rateForm" ${mine ? "" : "hidden"}>
        <textarea id="rateText" maxlength="600" rows="3" placeholder="What's it like? Shade, flat sites, phone signal, the road in, how busy…">${esc(mine?.review || "")}</textarea>
        <div class="rate-btns"><button class="cta" type="button" id="rateSave">${mine ? "Update review" : "Post rating"}</button>${mine ? `<button class="btn line" type="button" id="rateDel">Remove</button>` : ""}</div>
      </div>
      ${data.list.filter((r) => r.review).length ? `<ul class="reviews">${data.list.filter((r) => r.review).slice(0, 12).map((r) => `<li><div class="rv-head"><span class="stars-sm">${starsHtml(r.stars)}</span><span class="help">${esc(RIG_WORD[r.rig] ? RIG_WORD[r.rig] + " traveller" : "Traveller")}${r.mine ? " (you)" : ""} · ${new Date(r.updated_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" })}</span></div><p>${esc(r.review)}</p></li>`).join("")}</ul>` : ""}`;
    let picked = mine?.stars || 0;
    box.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => {
      if (!window.CFCloud.signedIn()) { toast("Sign in (free) to rate camps"); return goSignIn(); }
      picked = +b.dataset.star;
      box.querySelectorAll("[data-star]").forEach((x) => { x.classList.toggle("on", +x.dataset.star <= picked); x.setAttribute("aria-checked", +x.dataset.star === picked); });
      $("#rateForm").hidden = false;
    }));
    $("#rateSave")?.addEventListener("click", async (e) => {
      if (!picked) return toast("Tap the stars first");
      e.currentTarget.disabled = true;
      try {
        await window.CFCloud.rate(c.id, picked, $("#rateText").value.trim(), prefs.rig || "");
        toast("Thanks for rating this camp");
        ratingCache.delete(c.id);
        wireRating(c);
      } catch { e.currentTarget.disabled = false; toast("Couldn't save your rating. Try again with signal."); }
    });
    renderGoogleRating(c, gPlace.get(c.id));
    $("#rateDel")?.addEventListener("click", async () => {
      try { await window.CFCloud.deleteRating(c.id); ratingCache.delete(c.id); wireRating(c); toast("Rating removed"); } catch { toast("Couldn't remove it right now"); }
    });
  }

  function sourceLine(c) {
    const src = SOURCES[c.source] || SOURCES.osm;
    const extra = c.also && SOURCES[c.also] ? ` and ${SOURCES[c.also].by}` : "";
    if (c.source === "user") return c.cloudId ? "You added this camp. Other travellers can see it." : "You added this camp. Only you can see it until you sign in.";
    if (c.source === "community") return `Added by a traveller${c.added ? ` on ${new Date(c.added).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`;
    return `From ${src.url ? `<a href="${src.url}" target="_blank" rel="noopener">${esc(src.by)}</a>` : esc(src.by)}${esc(extra)}.`;
  }
  function suits(c) {
    const s = [];
    if (c.tents !== false) s.push("tents");
    if (c.caravans !== false && !c.backcountry) s.push("caravans");
    if (c.motorhome !== false && !c.backcountry) s.push("motorhomes");
    return s.length ? s.join(", ").replace(/^./, (x) => x.toUpperCase()) : "Check on arrival";
  }

  // ---------------------------------------------------------------- EXPLORE
  let exploreCamps = [];
  let exploreOffline = false;
  const exCache = new Map();
  attachSuggest($("#exploreSearch"), (r) => { map.setView([r.lat, r.lon], 11); setSheet("half"); });
  $("#explorePills").addEventListener("change", () => { savePrefs(); renderExplore(); });
  let exTimer;
  map.on("moveend", () => { if (view === "explore") { clearTimeout(exTimer); exTimer = setTimeout(loadExplore, 450); } });

  function tileKeys(b) {
    const keys = [];
    for (let la = Math.floor(b.getSouth() * 2) / 2; la < b.getNorth(); la += 0.5)
      for (let lo = Math.floor(b.getWest() * 2) / 2; lo < b.getEast(); lo += 0.5) keys.push(`${la.toFixed(1)},${lo.toFixed(1)}`);
    return keys;
  }
  async function loadExplore() {
    if (view !== "explore") return;
    if (map.getZoom() < CFG.exploreMinZoom) {
      $("#exploreCount").textContent = "Zoom in on the map, or search a town, to see its camps.";
      $("#exploreList").innerHTML = ""; cluster.clearLayers();
      return;
    }
    const keys = tileKeys(map.getBounds()).filter((k) => !exCache.has(k));
    await campDB.ready();
    if (keys.length && campDB.has()) {
      if (keys.length > 40) { $("#exploreCount").textContent = "Zoom in a little further to load camps."; return; }
      const lats = keys.map((k) => +k.split(",")[0]), lons = keys.map((k) => +k.split(",")[1]);
      const bbox = [minOf(lats), minOf(lons), maxOf(lats) + 0.5, maxOf(lons) + 0.5];
      const tileOf = (c) => `${(Math.floor(c.lat * 2) / 2).toFixed(1)},${(Math.floor(c.lon * 2) / 2).toFixed(1)}`;
      const fill = (camps) => {
        const byKey = new Map(keys.map((k) => [k, []]));
        for (const c of camps) { const k = tileOf(c); if (byKey.has(k)) byKey.get(k).push(c); }
        byKey.forEach((v, k) => exCache.set(k, v));
        const all = new Map();
        for (const v of exCache.values()) for (const c of v) all.set(c.id, c);
        exploreCamps = [...all.values()]; exploreOffline = false; renderExplore();
      };
      const res = campDB.inArea(bbox, 0.1);
      const local = userCampsIn(bbox);
      fill(mergeSources(res.camps, local, res.ramps, res.dumps));
      // then add official camps, rest areas and traveller camps when they arrive
      const offl = (await offlineCampsIn(bbox)).filter((c) => c.source !== "osm");
      const ex = await soon(extrasIn(bbox), 9000, []);
      const extra = [...new Map([...offl, ...ex].map((x) => [x.id, x])).values()];
      if (extra.length && view === "explore") fill(mergeSources(campDB.inArea(bbox, 0.1).camps, extra, res.ramps, res.dumps));
      return;
    }
    if (keys.length > 16) { $("#exploreCount").textContent = "Zoom in a little further to load camps."; return; }
    if (keys.length) {
      $("#exploreCount").innerHTML = `<span class="spinner"></span>Loading camps in this area`;
      const lats = keys.map((k) => +k.split(",")[0]), lons = keys.map((k) => +k.split(",")[1]);
      const s = minOf(lats), w = minOf(lons), n = maxOf(lats) + 0.5, e = maxOf(lons) + 0.5;
      const bb = `${s},${w},${n},${e}`, bbx = `${s - 0.1},${w - 0.1},${n + 0.1},${e + 0.1}`;
      const q = `[out:json][timeout:60];(${CAMP_SEL}(${bb});nwr["leisure"="slipway"](${bbx});nwr["amenity"="sanitary_dump_station"](${bbx}););out center tags;`;
      try {
        const [res, ex] = await Promise.all([overpass(q).then(parseElements), extrasIn([s, w, n, e])]);
        const camps = mergeSources(res.camps, ex, res.ramps, res.dumps);
        const byKey = new Map(keys.map((k) => [k, []]));
        for (const c of camps) {
          const k = `${(Math.floor(c.lat * 2) / 2).toFixed(1)},${(Math.floor(c.lon * 2) / 2).toFixed(1)}`;
          if (byKey.has(k)) byKey.get(k).push(c);
        }
        byKey.forEach((v, k) => exCache.set(k, v));
        exploreOffline = false;
      } catch (err) {
        const saved = [...await offlineCampsIn([s, w, n, e]), ...userCampsIn([s, w, n, e])];
        if (!saved.length) { $("#exploreCount").textContent = isOffline() ? "No signal, and this area isn't downloaded. Download areas before you lose signal." : friendly(err); return; }
        exploreOffline = true;
        exploreCamps = saved; renderExplore(); return;
      }
    }
    const all = new Map();
    for (const v of exCache.values()) for (const c of v) all.set(c.id, c);
    exploreCamps = [...all.values()];
    renderExplore();
  }
  function renderExplore() {
    if (view !== "explore" || map.getZoom() < CFG.exploreMinZoom) return;
    const freeOnly = $("#exFree").checked, rig = prefs.rig, wants = wantsOf($("#explorePills")), more = moreOf();
    const b = map.getBounds(), ctr = map.getCenter();
    const inView = exploreCamps.filter((c) => b.contains([c.lat, c.lon]));
    const shown = inView.filter((c) => (!freeOnly || c.cost === "free") && rigOK(c, rig) && missing(c, wants).length === 0 && more.every((f) => moreOK(c, f)));
    shown.forEach((c) => (c._d = hav([ctr.lat, ctr.lng], [c.lat, c.lon])));
    shown.sort((a, b2) => score(b2, wants, freeOnly ? "free" : "any") - score(a, wants, freeOnly ? "free" : "any") || a._d - b2._d);
    cluster.clearLayers();
    cluster.addLayers(shown.map((c) => campMarker(c)));
    const hidden = inView.length - shown.length;
    $("#exploreCount").textContent = shown.length
      ? `${shown.length} ${freeOnly ? "free " : ""}camp${shown.length === 1 ? "" : "s"} on the map${hidden ? `, ${hidden} more hidden by your filters` : ""}`
      : inView.length ? `${inView.length} camp${inView.length === 1 ? "" : "s"} here, but none match your filters.` : "No camps recorded in this area yet.";
    const gNear = guidesNear([[ctr.lat, ctr.lng]]);
    const rc = rulesNear(ctr.lat, ctr.lng);
    $("#exploreRule").innerHTML = gNear.map((g) => guideCard(g, tripKey(plan))).join("") + rc.map((r) => `<div class="notice warn"><b>Local rule: ${esc(r.place)}</b><span>${esc(r.text)}</span><a href="${esc(r.src)}" target="_blank" rel="noopener">Source</a></div>`).join("");
    $("#offlineArea").hidden = exploreOffline || !inView.length;
    if (exploreOffline) $("#exploreCount").textContent = `Offline: showing ${shown.length} downloaded camp${shown.length === 1 ? "" : "s"}`;
    $("#exploreList").innerHTML = shown.slice(0, 80).map((c) => `<li>${campCard(c, { fromCenter: c._d })}</li>`).join("");
  }
  $("#exploreList").addEventListener("click", (e) => { const card = e.target.closest(".camp-card"); if (card) openDetail(findCamp(card.dataset.id)); });

  // ---------------------------------------------------------------- SAVED
  function renderSaved() {
    const trips = store.get("cf-trips", []), camps = store.get("cf-camps", []);
    $("#savedTrips").innerHTML = trips.length ? trips.map((t) => `<li class="trip-item">
        <b>${esc(short(t.from.name))} to ${esc(short(t.to.name))}</b>
        <span class="help">${km(t.km)}, ${t.nights} night${t.nights === 1 ? "" : "s"}</span>
        <span class="row"><button class="btn" data-load="${t.id}" type="button">Open</button><button class="icon-btn" data-del="${t.id}" type="button" aria-label="Delete trip">${icon("close")}</button></span>
      </li>`).join("")
      : `<li class="empty">Plan a trip and tap the bookmark to keep it here.</li>`;
    $("#savedCamps").innerHTML = camps.length ? camps.map((c) => `<li>${campCard(c)}</li>`).join("") : `<li class="empty">Tap the bookmark on any camp to keep it here.</li>`;
    const mine = userCamps();
    $("#mineCamps").innerHTML = mine.length ? mine.map((c) => `<li>${campCard(c)}</li>`).join("") : `<li class="empty">Know a good spot? Add it by dropping a pin on the map or entering its coordinates.</li>`;
    renderOffline();
    renderAccount();
    renderJournal();
  }
  $("#savedTrips").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]"), load = e.target.closest("[data-load]");
    const trips = store.get("cf-trips", []);
    if (del) { store.set("cf-trips", trips.filter((t) => String(t.id) !== del.dataset.del)); renderSaved(); return; }
    if (!load) return;
    const t = trips.find((x) => String(x.id) === load.dataset.load); if (!t) return;
    setView("plan");
    const f = $("#from"), to = $("#to");
    f.value = t.from.name; f.dataset.lat = t.from.lat; f.dataset.lon = t.from.lon; $("#useHere").hidden = true;
    to.value = t.to.name; to.dataset.lat = t.to.lat; to.dataset.lon = t.to.lon;
    setNights(t.nights);
    viaStops = (t.vias || []).map((v) => ({ ...v })); seeIds.clear(); (t.see || []).forEach((id) => seeIds.add(id)); renderVia();
    pendingStays = t.stays && Object.keys(t.stays).length ? { ...t.stays } : null;
    const pick = (name, v) => { const el = $(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
    pick("rig", t.opts.rig); pick("cost", t.opts.cost); pick("detour", t.opts.detour); pick("tripType", t.opts.ret ? "ret" : "one");
    $$("#planWants input").forEach((i) => (i.checked = t.opts.wants.includes(i.value)));
    $("#planForm").hidden = false; $("#results").hidden = true;
    $("#planForm").requestSubmit();
  });
  $("#savedCamps").addEventListener("click", (e) => { const card = e.target.closest(".camp-card"); if (card) openDetail(findCamp(card.dataset.id)); });
  $("#mineCamps").addEventListener("click", (e) => { const card = e.target.closest(".camp-card"); if (card) openDetail(userCamps().find((c) => c.id === card.dataset.id)); });

  // ---------------------------------------------------------------- ADD A CAMP (drop a pin or type coordinates)
  let pinFor = null; // existing camp being edited, or null for new
  const fmt5 = (n) => (+n).toFixed(5);
  function startPinMode(existing = null) {
    pinFor = existing;
    closeDetail();
    if (existing) map.setView([existing.lat, existing.lon], 16);
    else if (map.getZoom() < 12) map.setView(me ? [me.lat, me.lon] : map.getCenter(), me ? 15 : 12);
    setSheet("peek");
    $("#pinMode").hidden = false; $("#app").classList.add("pinning");
    updatePinCoords();
  }
  function endPinMode() { $("#pinMode").hidden = true; $("#app").classList.remove("pinning"); setSheet("half"); }
  function updatePinCoords() { const c = map.getCenter(); $("#pinCoords").textContent = `${fmt5(c.lat)}, ${fmt5(c.lng)}`; }
  map.on("move", () => { if (!$("#pinMode").hidden) updatePinCoords(); });
  $("#addBtn").addEventListener("click", () => startPinMode());
  $("#addFromSaved").addEventListener("click", () => startPinMode());
  $("#pinCancel").addEventListener("click", endPinMode);
  $("#pinUse").addEventListener("click", () => { const c = map.getCenter(); endPinMode(); openAddCamp(pinFor, { lat: c.lat, lon: c.lng }); });
  $("#pinType").addEventListener("click", () => { endPinMode(); openAddCamp(pinFor, null, true); });

  // Accepts "-24.21, 151.90", "-24.21 151.90", "24°12'36"S 151°54'E" and Google Maps links
  function parseCoords(text) {
    const t = String(text || "").trim();
    const at = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|ll|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (at) return check(+at[1], +at[2]);
    const dms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi)];
    if (dms.length === 2) {
      const v = dms.map((m) => { let d = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; if (/[SW]/i.test(m[4])) d = -d; return { d, ax: /[NS]/i.test(m[4]) ? "lat" : "lon" }; });
      const lat = v.find((x) => x.ax === "lat")?.d, lon = v.find((x) => x.ax === "lon")?.d;
      return check(lat, lon);
    }
    const nums = t.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2) {
      let lat = +nums[0], lon = +nums[1];
      if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
      if (lat > 0 && lat < 45 && lon > 110) lat = -lat; // Australians often drop the minus sign
      return check(lat, lon);
    }
    return null;
    function check(lat, lon) {
      if (!isFinite(lat) || !isFinite(lon)) return null;
      if (lat > -45 && lat < -9 && lon > 112 && lon < 155) return { lat, lon };
      return { lat, lon, outside: true };
    }
  }

  function openAddCamp(existing = null, at = null, typeCoords = false) {
    const c = existing || {};
    const pos = at || (existing ? { lat: c.lat, lon: c.lon } : null);
    const chk = (id, label, on) => `<label><input type="checkbox" name="am" value="${id}" ${on ? "checked" : ""}><span>${icon(AMEN_ICON[id], "ic sm")}${label}</span></label>`;
    const rigChk = (id, label, on) => `<label><input type="checkbox" name="suit" value="${id}" ${on ? "checked" : ""}><span>${label}</span></label>`;
    const price = c.cost === "paid" ? "paid" : c.donation ? "donation" : "free";
    showDetail(`<div class="d-pad" style="padding-top:22px">
      <h2 class="d-title">${existing ? "Edit camp" : "Add a camp"}</h2>
      <p class="d-kind">${existing ? "Changes are saved on this phone." : "Share a spot you've stayed at. It's saved on this phone and shows on your map and trips."}</p>
      <form id="addForm" class="add-form" novalidate>
        <div class="field">
          <label for="acCoords">Location</label>
          <div class="coord-row">
            <input id="acCoords" type="text" inputmode="decimal" placeholder="-24.21234, 151.90123" value="${pos ? `${fmt5(pos.lat)}, ${fmt5(pos.lon)}` : ""}" ${typeCoords ? "autofocus" : ""}>
            <button class="icon-btn" type="button" id="acPin" aria-label="Drop a pin on the map">${icon("pin")}</button>
          </div>
          <p class="help" id="acCoordHelp">Paste coordinates or a Google Maps link, or tap the pin to place it on the map.</p>
        </div>
        <div class="field"><label for="acName">Camp name</label><input id="acName" type="text" maxlength="80" placeholder="e.g. Futter Creek free camp" value="${esc(c.named === false ? "" : c.name || "")}"></div>
        <fieldset class="group"><legend class="label">Price</legend>
          <div class="seg" id="acPriceSeg">
            <label><input type="radio" name="acPrice" value="free" ${price === "free" ? "checked" : ""}><span>Free</span></label>
            <label><input type="radio" name="acPrice" value="donation" ${price === "donation" ? "checked" : ""}><span>Donation</span></label>
            <label><input type="radio" name="acPrice" value="paid" ${price === "paid" ? "checked" : ""}><span>Paid</span></label>
          </div>
          <div class="field" id="acChargeWrap" ${price === "paid" ? "" : "hidden"} style="margin-top:8px"><label for="acCharge">Cost per night</label><input id="acCharge" type="text" placeholder="e.g. $10 per vehicle" value="${esc(c.charge || "")}"></div>
        </fieldset>
        <fieldset class="group"><legend class="label">Suits</legend>
          <div class="amen-pick">${rigChk("tents", "Tents", c.tents !== false)}${rigChk("caravans", "Caravans", c.caravans === true)}${rigChk("motorhome", "Motorhomes", c.motorhome === true)}${rigChk("big", "Big rigs", c.bigRig === true)}</div>
        </fieldset>
        <fieldset class="group"><legend class="label">What's there</legend>
          <div class="amen-pick">${chk("toilets", "Toilets", c.a?.toilets)}${chk("water", "Drinking water", c.a?.water)}${chk("showers", "Showers", c.a?.showers)}${chk("dogs", "Dogs allowed", c.a?.dogs)}${chk("power", "Power", c.a?.power)}${chk("fires", "Campfires", c.a?.fires)}${chk("dump", "Dump point", c.a?.dumpOnSite)}${chk("boatramp", "Boat ramp", c.ramp)}</div>
        </fieldset>
        <div class="field"><label for="acStay">Maximum stay</label><input id="acStay" type="text" placeholder="e.g. 48 hours" value="${esc(c.maxstay || "")}"></div>
        <div class="field"><label for="acNotes">Notes</label><textarea id="acNotes" rows="3" placeholder="Road in, phone signal, best sites, anything worth knowing">${esc(c.desc || "")}</textarea></div>
        <div class="field"><label for="acPhoto">Photo</label><input id="acPhoto" type="file" accept="image/*"><img id="acPreview" class="ac-preview" alt="" ${c.photo ? `src="${esc(c.photo)}"` : "hidden"}></div>
        <button class="cta" type="submit">${existing ? "Save changes" : "Add camp"}</button>
        <p class="msg" id="acMsg" role="status" aria-live="polite"></p>
      </form></div>`);
    let photo = c.photo || "";
    const coordIn = $("#acCoords");
    const showCoordState = () => {
      const r = parseCoords(coordIn.value), help = $("#acCoordHelp");
      if (!coordIn.value.trim()) { help.textContent = "Paste coordinates or a Google Maps link, or tap the pin to place it on the map."; help.className = "help"; return; }
      if (!r) { help.textContent = "Couldn't read those coordinates. Try a format like -24.21234, 151.90123"; help.className = "help is-error"; return; }
      help.textContent = r.outside ? "That spot is outside Australia. Check the numbers." : `Pin at ${fmt5(r.lat)}, ${fmt5(r.lon)}`;
      help.className = r.outside ? "help is-error" : "help";
    };
    coordIn.addEventListener("input", showCoordState); showCoordState();
    $("#acPin").addEventListener("click", () => {
      const r = parseCoords(coordIn.value);
      if (r && !r.outside) map.setView([r.lat, r.lon], 16);
      startPinMode(existing);
    });
    $("#acPriceSeg").addEventListener("change", () => ($("#acChargeWrap").hidden = $('input[name="acPrice"]:checked').value !== "paid"));
    $("#acPhoto").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      photo = await shrinkImage(f, 1100);
      const img = $("#acPreview"); img.src = photo; img.hidden = false;
    });
    $("#addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = $("#acMsg"); msg.className = "msg";
      const r = parseCoords(coordIn.value);
      if (!r) { msg.className = "msg is-error"; msg.textContent = "Add the camp's location: drop a pin or enter coordinates."; return; }
      if (r.outside) { msg.className = "msg is-error"; msg.textContent = "That location is outside Australia. Check the coordinates."; return; }
      const name = $("#acName").value.trim();
      if (!name) { msg.className = "msg is-error"; msg.textContent = "Give the camp a name so you can find it again."; $("#acName").focus(); return; }
      const am = new Set($$('input[name="am"]:checked').map((i) => i.value));
      const suit = new Set($$('input[name="suit"]:checked').map((i) => i.value));
      const priceV = $('input[name="acPrice"]:checked').value;
      const camp = {
        id: existing?.id || `user/${Date.now().toString(36)}`, lat: r.lat, lon: r.lon, tags: {}, source: "user",
        name, named: true, kind: "Traveller-added camp",
        cost: priceV === "paid" ? "paid" : "free", donation: priceV === "donation", charge: priceV === "paid" ? $("#acCharge").value.trim() : "",
        a: { toilets: am.has("toilets") || null, water: am.has("water") || null, showers: am.has("showers") || null, dogs: am.has("dogs") || null, power: am.has("power") || null, fires: am.has("fires") || null, dumpOnSite: am.has("dump") || null },
        ramp: am.has("boatramp"), rampM: am.has("boatramp") ? 0 : Infinity, dumpM: am.has("dump") ? 0 : Infinity,
        tents: suit.has("tents"), caravans: suit.has("caravans") || null, motorhome: suit.has("motorhome") || null, bigRig: suit.has("big"), backcountry: false,
        maxstay: $("#acStay").value.trim(), access: "", website: "", phone: "", operator: "", hours: "",
        desc: $("#acNotes").value.trim(), image: "", commons: "", photo,
        added: existing?.added || new Date().toISOString(), updated: new Date().toISOString(),
      };
      const list = userCamps().filter((x) => x.id !== camp.id);
      list.unshift(camp);
      if (!store.set("cf-user-camps", list)) { msg.className = "msg is-error"; msg.textContent = "Your phone's storage is full. Remove the photo and try again."; return; }
      if (existing?.cloudId) camp.cloudId = existing.cloudId;
      const finish = (c, msgText) => {
        const l = userCamps().filter((x) => x.id !== c.id && x.id !== camp.id); l.unshift(c);
        try { store.set("cf-user-camps", l); } catch { /* keep going */ }
        refreshAfterUserChange(); toast(msgText); openDetail(c);
      };
      if (window.CFCloud?.signedIn()) {
        msg.innerHTML = `<span class="spinner"></span>Sharing with other travellers`;
        window.CFCloud.saveCamp(camp)
          .then((shared) => finish({ ...shared, id: camp.id, source: "user", photo: shared.photo || camp.photo }, existing ? "Camp updated for everyone" : "Camp shared with other travellers"))
          .catch(() => finish(camp, "Saved on this phone. Couldn't share it right now."));
        return;
      }
      refreshAfterUserChange();
      toast(existing ? "Camp updated" : "Camp added");
      openDetail(camp);
    });
  }
  function shrinkImage(file, max) {
    return new Promise((res) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); res(cv.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => res("");
      img.src = url;
    });
  }
  function refreshAfterUserChange() {
    exCache.clear();
    if (view === "explore") loadExplore();
    if (view === "saved") renderSaved();
    if (plan) { const mine = userCamps(); plan.camps = plan.camps.filter((c) => c.source !== "user" || mine.some((m) => m.id === c.id)); }
  }

  // ---------------------------------------------------------------- OFFLINE DOWNLOADS
  const sizeOf = (o) => { const n = JSON.stringify(o).length; return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`; };
  async function saveTripOffline() {
    if (!plan) return;
    const btn = $("#offlineTrip"); btn.disabled = true;
    try {
      const steps = [];
      for (let i = 0; i < plan.picks.length + 1; i++) {
        const from = i === 0 ? plan.from : plan.picks[i - 1].camp || plan.from;
        const to = i < plan.picks.length ? plan.picks[i].camp : plan.to;
        if (!to) { steps.push(null); continue; }
        try { const r = await osrm([from, to], true); steps.push({ distance: r.distance, duration: r.duration, steps: r.legs.flatMap((l) => l.steps).map((s) => ({ maneuver: s.maneuver, name: s.name, ref: s.ref, text: s.text, distance: s.distance })), pts: r.geometry.coordinates }); }
        catch { steps.push(null); }
      }
      const pack = {
        id: `trip-${Date.now()}`, type: "trip", name: `${short(plan.from.name)} to ${short(plan.to.name)}`, created: new Date().toISOString(),
        camps: plan.camps.map(({ _d, ...c }) => c),
        plan: { from: plan.from, to: plan.to, nights: plan.nights, opts: plan.opts, route: { distance: plan.route.distance, duration: plan.route.duration, geometry: plan.route.geometry }, picks: plan.picks.map((p) => ({ target: p.target, warn: p.warn, camp: p.camp?.id || null, alts: p.alts.map((a) => a.id) })), legs: steps },
      };
      await idb.put(pack);
      toast(`Saved for offline: ${pack.camps.length} camps and directions`);
      refreshOfflinePill?.();
      btn.classList.add("is-on");
    } catch { toast("Couldn't save the download. Check your phone's storage."); }
    finally { btn.disabled = false; }
  }
  $("#offlineTrip").addEventListener("click", saveTripOffline);

  async function saveAreaOffline() {
    const b = map.getBounds(), btn = $("#offlineArea");
    const inView = exploreCamps.filter((c) => b.contains([c.lat, c.lon]));
    if (!inView.length) return toast("No camps here to download");
    btn.disabled = true;
    try {
      const name = (await searchNearName(map.getCenter())) || `Area near ${fmt5(map.getCenter().lat)}, ${fmt5(map.getCenter().lng)}`;
      await idb.put({ id: `area-${Date.now()}`, type: "area", name, created: new Date().toISOString(), bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], camps: inView.map(({ _d, ...c }) => c) });
      toast(`Saved ${inView.length} camps around ${name} for offline`);
    } catch { toast("Couldn't save the download. Check your phone's storage."); }
    finally { btn.disabled = false; }
  }
  async function searchNearName(ll) {
    try {
      const j = await fetchJSON(`https://photon.komoot.io/reverse?lat=${ll.lat}&lon=${ll.lng}&lang=en`, {}, 6000);
      const p = j.features?.[0]?.properties || {};
      return p.city || p.town || p.village || p.name || p.county || "";
    } catch { return ""; }
  }
  $("#offlineArea").addEventListener("click", saveAreaOffline);

  async function renderOffline() {
    let packs = [];
    try { packs = (await idb.all()).sort((a, b) => b.created.localeCompare(a.created)); } catch { /* storage unavailable */ }
    $("#offlinePacks").innerHTML = packs.length ? packs.map((p) => `<li class="trip-item">
        <b>${esc(p.name)}</b>
        <span class="help">${p.type === "trip" ? "Trip" : "Area"}, ${p.camps.length} camps, ${sizeOf(p)}</span>
        <span class="row">${p.type === "trip" ? `<button class="btn" data-open-pack="${esc(p.id)}" type="button">Open</button>` : `<button class="btn" data-show-pack="${esc(p.id)}" type="button">Show</button>`}<button class="icon-btn" data-del-pack="${esc(p.id)}" type="button" aria-label="Delete download">${icon("close")}</button></span>
      </li>`).join("")
      : `<li class="empty">Download a trip or an area to see its camps with no signal. Use the download button on a planned trip, or Download area in Explore.</li>`;
  }
  $("#offlinePacks").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del-pack]"), openP = e.target.closest("[data-open-pack]"), show = e.target.closest("[data-show-pack]");
    const packs = await idb.all().catch(() => []);
    if (del) { await idb.del(del.dataset.delPack); renderOffline(); toast("Download deleted"); return; }
    if (show) {
      const p = packs.find((x) => x.id === show.dataset.showPack); if (!p) return;
      setView("explore");
      const [s, w, n, e2] = p.bbox; map.fitBounds([[s, w], [n, e2]]);
      return;
    }
    if (openP) {
      const p = packs.find((x) => x.id === openP.dataset.openPack); if (!p) return;
      const byId = new Map(p.camps.map((c) => [c.id, c]));
      const line = buildLine(p.plan.route);
      plan = {
        from: p.plan.from, to: p.plan.to, nights: p.plan.nights, opts: p.plan.opts, route: p.plan.route, line, camps: p.camps,
        picks: p.plan.picks.map((x) => ({ target: x.target, warn: x.warn, camp: x.camp ? byId.get(x.camp) : null, alts: x.alts.map((id) => byId.get(id)).filter(Boolean) })),
        legs: p.plan.legs, offline: true,
      };
      setView("plan"); showPlan();
    }
  });

  // ---------------------------------------------------------------- CHECK-INS ("is it still free?")
  const CI_TEXT = { free: "Still free", price_changed: "Price changed", closed: "Closed", full: "Full", great: "Great spot" };
  // "How busy is it right now?" reports, kept low-key
  const CROWD = [["quiet", "😌 Quiet"], ["some", "🙂 A few"], ["busy", "😬 Busy"], ["full", "⛔ Full"]];
  const CROWD_TEXT = { quiet: "Quiet", some: "A few people", busy: "Busy", full: "Full" };
  const crowdOf = (r) => (r?.note || "").startsWith("crowd:") ? r.note.slice(6) : null;
  const crowdLine = (r) => { const k = crowdOf(r); if (!k || Date.now() - Date.parse(r.created_at) > 36 * 3600e3) return ""; return `${CROWD_TEXT[k] || k} right now · ${agoTime(r.created_at)}`; };
  async function sendCrowd(campId, k) {
    if (!window.CFCloud?.enabled) throw new Error("off");
    if (!window.CFCloud.signedIn()) { toast("Sign in (free) to report"); goSignIn(); throw new Error("signin"); }
    await window.CFCloud.checkin(campId, k === "full" ? "full" : "great", `crowd:${k}`);
  }
  const crowdCache = new Map();
  async function crowdTags() {
    if (!window.CFCloud?.enabled) return;
    const cards = $$(".camp-card[data-id]:not([data-cw])");
    cards.forEach((el) => (el.dataset.cw = "1"));
    const ids = [...new Set(cards.map((el) => el.dataset.id))].filter((id) => !crowdCache.has(id));
    if (ids.length) { try { const rows = await window.CFCloud.crowdFor(ids); ids.forEach((id) => crowdCache.set(id, rows.find((r) => r.camp_key === id) || null)); } catch { return; } }
    cards.forEach((el) => { const r = crowdCache.get(el.dataset.id), line = r && crowdLine(r); if (line && el.isConnected && !el.querySelector(".cc-crowd")) el.querySelector(".cc-meta")?.insertAdjacentHTML("beforeend", `<span class="cc-crowd ${crowdOf(r)}">${esc(CROWD_TEXT[crowdOf(r)])} now</span>`); });
  }
  function ago(iso) {
    const d = (Date.now() - Date.parse(iso)) / 86400000;
    if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < 30) return `${Math.floor(d)} days ago`;
    if (d < 365) return `${Math.floor(d / 30)} month${d >= 60 ? "s" : ""} ago`; return "over a year ago";
  }
  async function wireCheckins(c) {
    const box = $("#checkinBox"); if (!box) return;
    const latest = $("#ciLatest");
    if (!window.CFCloud?.enabled) { latest.textContent = "Check-ins will appear here once sharing is switched on."; }
    else window.CFCloud.latestCheckins(c.id).then((list) => {
      if (!$("#ciLatest")) return;
      const cw = list.find((r) => crowdLine(r)), plain = list.filter((r) => !crowdOf(r));
      if (cw) { $("#crowdNow").hidden = false; $("#crowdNow").textContent = crowdLine(cw); }
      latest.textContent = plain.length ? `${CI_TEXT[plain[0].status]}, reported ${ago(plain[0].created_at)}${plain.length > 1 ? ` (${plain.length} recent reports)` : ""}` : "No reports yet. Be the first.";
    }).catch(() => (latest.textContent = ""));
    box.addEventListener("click", async (e) => {
      const cb = e.target.closest("[data-crowd]");
      if (cb) {
        try { await sendCrowd(c.id, cb.dataset.crowd); $("#crowdNow").hidden = false; $("#crowdNow").textContent = `${CROWD_TEXT[cb.dataset.crowd]} right now · just now (you)`; crowdCache.delete(c.id); toast("Thanks! That helps other travellers"); }
        catch (err) { if (err?.message === "off") toast("Check-ins aren't switched on in this version yet"); else if (err?.message !== "signin") toast("Couldn't send that. Try again with signal."); }
        return;
      }
      const b = e.target.closest("[data-ci]"); if (!b) return;
      if (!window.CFCloud?.enabled) return toast("Check-ins aren't switched on in this version yet");
      if (!window.CFCloud.signedIn()) return toast("Sign in on the Saved tab to report");
      try {
        await window.CFCloud.checkin(c.id, b.dataset.ci);
        latest.textContent = `${CI_TEXT[b.dataset.ci]}, reported today by you`;
        toast("Thanks, that helps other travellers");
      } catch { toast("Couldn't send that. Try again when you have signal."); }
    });
  }

  // ---------------------------------------------------------------- ACCOUNT
  function renderAccount() {
    const box = $("#accountBox"); if (!box) return;
    const C = window.CFCloud;
    if (!C?.enabled) {
      box.innerHTML = `<div class="acct"><b>Account</b><p class="help">Sharing camps between travellers isn't switched on in this version yet. Everything you add is kept on this phone.</p></div>`;
      return;
    }
    if (C.signedIn()) {
      box.innerHTML = `<div class="acct"><b>Signed in</b><p class="help">${esc(C.email())}. Camps you add are shared with other travellers, and your trip bookings sync across devices.</p>
        <div class="acct-btns"><button class="btn line" type="button" id="acctOut">Sign out</button><button class="btn line danger" type="button" id="acctDel">Delete account</button></div></div>`;
      $("#acctOut").addEventListener("click", async () => { await C.signOut().catch(() => {}); renderAccount(); toast("Signed out"); });
      $("#acctDel").addEventListener("click", async (e) => {
        if (e.currentTarget.dataset.sure !== "1") { e.currentTarget.dataset.sure = "1"; e.currentTarget.textContent = "Tap again to delete your account"; return; }
        try { await C.deleteAccount(); renderAccount(); toast("Account deleted"); } catch (err) { toast(err.message); }
      });
      return;
    }
    box.innerHTML = `<form class="acct" id="acctForm" novalidate><b>Sign in or create an account</b>
      <p class="help">Share the camps you add, report if spots are still free, and keep your trips on every device. We'll email you a 6-digit code, no password needed.</p>
      <div class="coord-row"><label class="sr" for="acctEmail">Email</label><input id="acctEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"><button class="btn gold" type="submit" id="acctSend">Send link</button></div>
      <div class="coord-row" id="acctCodeRow" hidden><label class="sr" for="acctCode">Code</label><input id="acctCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="6-digit code"><button class="btn gold" type="button" id="acctVerify">Sign in</button></div>
      <p class="msg" id="acctMsg" role="status" aria-live="polite"></p>
      <details class="acct-pw"><summary>Sign in with a password</summary>
        <div class="coord-row"><label class="sr" for="acctPw">Password</label><input id="acctPw" type="password" autocomplete="current-password" placeholder="Password"><button class="btn line" type="button" id="acctPwGo">Sign in</button></div>
      </details></form>`;
    const msg = $("#acctMsg");
    $("#acctPwGo").addEventListener("click", async () => {
      const email = $("#acctEmail").value.trim(), pw = $("#acctPw").value;
      if (!email || !pw) { msg.className = "msg is-error"; msg.textContent = "Enter your email above and your password."; return; }
      msg.className = "msg"; msg.innerHTML = `<span class="spinner"></span>Signing in`;
      try { await C.signInPassword(email, pw); await afterSignIn(); renderAccount(); toast("Signed in"); }
      catch { msg.className = "msg is-error"; msg.textContent = "That email and password didn't work. Most accounts use the emailed code instead."; }
    });
    $("#acctForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#acctEmail").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.className = "msg is-error"; msg.textContent = "Enter your email address."; return; }
      msg.className = "msg"; msg.innerHTML = `<span class="spinner"></span>Sending your sign-in email`;
      try { await C.sendCode(email); msg.innerHTML = `Email sent to <b>${esc(email)}</b>. Open it <b>on this phone</b> and tap the sign-in link. It brings you straight back here, signed in.<br><small>If your email shows a 6-digit code instead, type it below.</small>`; $("#acctCodeRow").hidden = false; }
      catch (err) { msg.className = "msg is-error"; msg.textContent = err.message; }
    });
    $("#acctVerify").addEventListener("click", async () => {
      const email = $("#acctEmail").value.trim(), code = $("#acctCode").value.trim();
      msg.className = "msg"; msg.innerHTML = `<span class="spinner"></span>Signing in`;
      try { await C.verifyCode(email, code); await afterSignIn(); renderAccount(); toast("Signed in"); }
      catch (err) { msg.className = "msg is-error"; msg.textContent = /expired|invalid/i.test(err.message) ? "That code didn't work. Check it, or send a new one." : err.message; }
    });
  }
  async function afterSignIn() {
    const C = window.CFCloud; if (!C?.signedIn()) return;
    // share camps that were only on this phone
    const local = userCamps();
    for (const c of local.filter((x) => !x.cloudId)) {
      try { const sh = await C.saveCamp(c); c.cloudId = sh.cloudId; if (sh.photo) c.photo = sh.photo; } catch { /* try again next time */ }
    }
    store.set("cf-user-camps", local);
    // merge trip notes, newest wins
    try {
      const remote = await C.loadTripNotes(), mine = notesAll();
      for (const [k, v] of Object.entries(remote)) if (!mine[k] || (v.updated || "") > (mine[k].updated || "")) mine[k] = v;
      store.set("cf-trip-notes", mine);
      for (const [k, v] of Object.entries(mine)) if (!remote[k] || (v.updated || "") > (remote[k].updated || "")) C.saveTripNotes(k, v).catch(() => {});
    } catch { /* offline */ }
    refreshAfterUserChange();
  }
  window.CFCloud?.onChange?.(() => { if (view === "saved") renderAccount(); });
  window.addEventListener("cf-auth-link", async (e) => {
    if (e.detail.ok) { await afterSignIn(); $("#tab-saved")?.click(); renderAccount(); toast("You're signed in"); }
    else toast(/expired|invalid/i.test(e.detail.text) ? "That sign-in link has expired. Send a new one from the Saved tab." : "Sign-in didn't work. Send a new link from the Saved tab.", 4500);
  });

  // ---------------------------------------------------------------- DESTINATION GUIDES and TRIP BOOKINGS
  const GUIDES = window.CF_GUIDES || [];
  const BOOK_TYPES = { ferry: "Ferry or barge", permit: "Vehicle permit", camping: "Camping booking", accommodation: "Accommodation", other: "Other" };
  const guideById = (id) => GUIDES.find((g) => g.id === id);
  function guidesNear(points) {
    return GUIDES.filter((g) => points.some(([la, lo]) => hav([la, lo], [g.area.lat, g.area.lon]) <= g.area.km * 1000));
  }
  function guidesForPlan(p) {
    if (!p) return [];
    const pts = [[p.to.lat, p.to.lon], [p.from.lat, p.from.lon], ...sample(p.line, 25000)];
    const byName = GUIDES.filter((g) => g.aliases.some((a) => `${p.to.name} ${p.from.name}`.toLowerCase().includes(a)));
    return [...new Set([...byName, ...guidesNear(pts)])];
  }
  const tripKey = (p) => p ? `${short(p.from.name)}|${short(p.to.name)}`.toLowerCase() : "no-trip";
  const notesAll = () => store.get("cf-trip-notes", {});
  const notesFor = (key) => notesAll()[key] || { bookings: [], ticks: {} };
  function saveNotes(key, n) { const all = notesAll(); all[key] = { ...n, updated: new Date().toISOString() }; store.set("cf-trip-notes", all); if (window.CFCloud?.signedIn()) window.CFCloud.saveTripNotes(key, all[key]).catch(() => {}); }

  function readyCount(g, key) { const t = notesFor(key).ticks[g.id] || []; return `${t.length} of ${g.checklist.length} ready`; }
  function guideCard(g, key) {
    return `<div class="guide-card slim">
      <div class="gc-main"><div class="gc-kicker">Trip essentials · ${readyCount(g, key)}</div><div class="gc-name">${esc(g.name)}</div></div>
      <button class="btn gold" type="button" data-guide="${esc(g.id)}">Open</button>
    </div>`;
  }
  function bookingRow(b) {
    const when = [b.date && new Date(b.date + "T00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }), b.time].filter(Boolean).join(", ");
    return `<li class="booking"><div class="bk-main"><b>${esc(b.title || BOOK_TYPES[b.type])}</b><span>${esc(BOOK_TYPES[b.type] || "")}${when ? `, ${esc(when)}` : ""}</span>${b.ref ? `<span>Ref: <span class="ref">${esc(b.ref)}</span></span>` : ""}${b.notes ? `<span class="bk-notes">${esc(b.notes)}</span>` : ""}</div>
      <button class="icon-btn" type="button" data-edit-booking="${esc(b.id)}" aria-label="Edit booking">${icon("edit")}</button></li>`;
  }
  function renderTripExtras() {
    const box = $("#tripExtras"); if (!box || !plan) return;
    const key = tripKey(plan), gs = guidesForPlan(plan), n = notesFor(key);
    box.innerHTML = `${gs.map((g) => guideCard(g, key)).join("")}
      <div class="bookings-box">
        <div class="bb-head"><b>Bookings for this trip</b><button class="btn line small-btn" type="button" data-add-booking="">${icon("plus", "ic sm")}Add</button></div>
        ${n.bookings.length ? `<ul class="bookings">${n.bookings.map(bookingRow).join("")}</ul>` : `<p class="help">Ferries, permits and camp bookings, kept offline with this trip.</p>`}
      </div>`;
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-guide]"); if (g) { openGuide(guideById(g.dataset.guide)); return; }
    const add = e.target.closest("[data-add-booking]"); if (add) { openBookingForm(null, add.dataset.addBooking || "other", add.dataset.title || ""); return; }
    const ed = e.target.closest("[data-edit-booking]"); if (ed) { const b = notesFor(tripKey(plan)).bookings.find((x) => x.id === ed.dataset.editBooking); if (b) openBookingForm(b); }
  });

  function openGuide(g) {
    if (!g) return;
    const key = tripKey(plan), n = notesFor(key), ticks = new Set(n.ticks[g.id] || []);
    const itemHtml = (it) => `<div class="g-item">
        <b>${esc(it.name)}</b><p>${esc(it.text)}</p>
        <div class="g-actions">
          ${it.link ? `<a class="btn" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.linkText || "Open")}</a>` : ""}
          ${it.phone ? `<a class="btn line" href="tel:${esc(it.phone.replace(/\s/g, ""))}">Call ${esc(it.phone)}</a>` : ""}
          ${it.book && plan ? `<button class="btn line" type="button" data-add-booking="${esc(it.book)}" data-title="${esc(it.name.split(":")[0].replace(/\s*\(.*\)\s*/, ""))}">${icon("plus", "ic sm")}Record booking</button>` : ""}
        </div></div>`;
    showDetail(`<div class="d-pad" style="padding-top:22px">
      <div class="gc-kicker">Trip essentials</div>
      <h2 class="d-title">${esc(g.name)}</h2>
      <p class="d-kind">${esc(g.summary)}</p>
      ${g.sections.map((s) => `<h3 class="g-h">${esc(s.title)}</h3>${s.items.map(itemHtml).join("")}`).join("")}
      <h3 class="g-h">Checklist</h3>
      <ul class="g-check" id="gCheck">${g.checklist.map((c, i) => `<li><label><input type="checkbox" data-i="${i}" ${ticks.has(i) ? "checked" : ""}><span>${esc(c)}</span></label></li>`).join("")}</ul>
      ${plan ? `<p class="help">Ticks are saved with your ${esc(short(plan.from.name))} to ${esc(short(plan.to.name))} trip.</p>` : ""}
      <p class="caveat">Details checked ${new Date(g.checked).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. Prices, times and closures change, so confirm with each operator. Sources: ${g.sources.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join(", ")}.</p>
    </div>`);
    $("#gCheck").addEventListener("change", (e) => {
      const i = +e.target.dataset.i, nn = notesFor(key), set = new Set(nn.ticks[g.id] || []);
      e.target.checked ? set.add(i) : set.delete(i);
      nn.ticks = { ...nn.ticks, [g.id]: [...set].sort((a, b) => a - b) };
      saveNotes(key, nn); renderTripExtras();
    });
  }

  function openBookingForm(existing = null, type = "other", title = "") {
    if (!plan) { toast("Plan a trip first, then add its bookings"); return; }
    const b = existing || { type, title };
    showDetail(`<div class="d-pad" style="padding-top:22px">
      <h2 class="d-title">${existing ? "Edit booking" : "Record a booking"}</h2>
      <p class="d-kind">${esc(short(plan.from.name))} to ${esc(short(plan.to.name))}</p>
      <form id="bkForm" class="add-form" novalidate>
        <div class="field"><label for="bkType">Type</label><select id="bkType" class="select">${Object.entries(BOOK_TYPES).map(([k, v]) => `<option value="${k}" ${b.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label for="bkTitle">What is it</label><input id="bkTitle" type="text" maxlength="80" placeholder="e.g. Manta Ray barge, Central Station camping" value="${esc(b.title || "")}"></div>
        <div class="row-2"><div class="field"><label for="bkDate">Date</label><input id="bkDate" type="date" value="${esc(b.date || "")}"></div><div class="field"><label for="bkTime">Time</label><input id="bkTime" type="time" value="${esc(b.time || "")}"></div></div>
        <div class="field"><label for="bkRef">Booking or permit number</label><input id="bkRef" type="text" maxlength="60" autocapitalize="characters" value="${esc(b.ref || "")}"></div>
        <div class="field"><label for="bkNotes">Notes</label><textarea id="bkNotes" rows="3" placeholder="Check-in time, site number, what's included">${esc(b.notes || "")}</textarea></div>
        <button class="cta" type="submit">${existing ? "Save booking" : "Add booking"}</button>
        ${existing ? `<button class="btn line" type="button" id="bkDel" style="margin-top:10px">Remove booking</button>` : ""}
      </form></div>`);
    $("#bkForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = tripKey(plan), n = notesFor(key);
      const rec = { id: existing?.id || `bk-${Date.now().toString(36)}`, type: $("#bkType").value, title: $("#bkTitle").value.trim(), date: $("#bkDate").value, time: $("#bkTime").value, ref: $("#bkRef").value.trim(), notes: $("#bkNotes").value.trim() };
      n.bookings = [rec, ...n.bookings.filter((x) => x.id !== rec.id)].sort((a, b) => (a.date || "9") .localeCompare(b.date || "9"));
      saveNotes(key, n); renderTripExtras(); closeDetail(); toast(existing ? "Booking saved" : "Booking added");
    });
    $("#bkDel")?.addEventListener("click", (e) => {
      if (e.currentTarget.dataset.sure !== "1") { e.currentTarget.dataset.sure = "1"; e.currentTarget.textContent = "Tap again to remove"; return; }
      const key = tripKey(plan), n = notesFor(key); n.bookings = n.bookings.filter((x) => x.id !== existing.id);
      saveNotes(key, n); renderTripExtras(); closeDetail(); toast("Booking removed");
    });
  }

  // ---------------------------------------------------------------- example trip button
  function showTryExample() { $("#tryExample").hidden = !!($("#from").value.trim() && $("#to").value.trim()); }
  ["#from", "#to"].forEach((s) => $(s).addEventListener("input", showTryExample));
  $("#tryExample").addEventListener("click", () => {
    const f = $("#from"), t = $("#to");
    f.value = "Bundaberg, Queensland"; f.dataset.lat = -24.8661; f.dataset.lon = 152.3489; $("#useHere").hidden = true;
    t.value = "Agnes Water, Queensland"; t.dataset.lat = -24.2117; t.dataset.lon = 151.9035;
    viaStops = []; seeIds.clear(); renderVia();
    setNights(1); showTryExample();
  });

  // ---------------------------------------------------------------- first open: example trip
  if (!store.get("cf-seen", false)) {
    const f = $("#from"), t = $("#to");
    f.value = "Bundaberg, Queensland"; f.dataset.lat = -24.8661; f.dataset.lon = 152.3489; $("#useHere").hidden = true;
    t.value = "Cairns, Queensland"; t.dataset.lat = -16.9186; t.dataset.lon = 145.7781;
    $("#planMsg").textContent = "We've filled in an example trip. Change it to yours, or tap Find camps to see how it works.";
    store.set("cf-seen", true);
  }
  showTryExample();

  // ================================================================ settings, budget, opening animation, welcome
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const VEH = window.CF_VEHICLES || { Other: [["Custom", "diesel", 10, 80]] };
  const DEFAULT_PRICE = { diesel: 2.75, petrol: 2.30, lpg: 1.20 };
  const settings = Object.assign({
    make: "", model: "", fuel: "diesel", use: 10.5, tank: 80, prices: { ...DEFAULT_PRICE }, tow: 30,
    campUnknown: 35, daily: 0, maxKm: 500, anim: true, follow: false, sat: false, welcomeAlways: false,
  }, store.get("cf-settings", {}));
  const saveSettings = () => store.set("cf-settings", settings);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animOn = () => settings.anim && !reducedMotion;
  const applyMotion = () => document.documentElement.classList.toggle("motion", animOn());
  applyMotion();
  const applyMode = () => { document.documentElement.classList.toggle("simple", !!settings.simple); if (typeof moveInk === "function") setTimeout(moveInk, 50); };
  applyMode();
  const money = (v) => !v ? "$0" : "$" + (v >= 100 ? Math.round(v).toLocaleString("en-AU") : v.toFixed(v >= 10 ? 0 : 2));
  const towing = (rig) => rig === "caravan" || rig === "camper";

  // ---------------------------------------------------------------- your own car, everywhere a car is drawn
  const myCar = () => ({ make: settings.make, model: settings.model, color: settings.color || "gold", rig: (typeof prefs !== "undefined" && prefs.rig) || "camper" });
  const myCarTop = () => window.CFCar ? window.CFCar.top(myCar()).svg : CAR_SVG;
  function paintCars() {
    if (!window.CFCar) return;
    const car = myCar();
    // loading screen: your car (towing your caravan or camper if you have one)
    const pl = document.querySelector(".pl-car");
    if (pl) { const sv = CFCar.side(car); pl.setAttribute("viewBox", sv.viewBox); pl.innerHTML = sv.inner; pl.style.setProperty("--cw", `${Math.round(92 * sv.width / 132)}px`); pl.style.height = `${Math.round(45 * sv.height / 64)}px`; pl.style.marginTop = `${-Math.round(45 * (sv.height - 64) / 64)}px`; }
    // splash: the little car driving around Australia
    const sp = document.getElementById("spCarBody");
    if (sp) { sp.setAttribute("transform", "rotate(90) scale(1)"); sp.innerHTML = CFCar.top(car).inner; }
    // your car on the map
    const el = typeof meMarker !== "undefined" && meMarker?.getElement?.()?.querySelector(".me-car");
    if (el) { el.querySelector("svg")?.remove(); el.insertAdjacentHTML("beforeend", CFCar.top(car).svg); }
    // previews in Settings and the welcome screens
    ["#stCarPrev", "#wlCarPrev"].forEach((sel) => { const box = document.querySelector(sel); if (box) box.innerHTML = CFCar.side(car).svg; });
    const cap = document.getElementById("stCarCap");
    if (cap) { const b = CFCar.bodyFor(car.make, car.model, car.rig); const rigName = { caravan: "towing a caravan", camper: "towing a camper trailer", rooftop: "with a rooftop tent", motorhome: "" }[car.rig] || ""; cap.textContent = `${car.model ? car.model : CFCar.LABEL[b]}${rigName && b !== "motorhome" ? ", " + rigName : ""}`; }
    ["#stColors", "#wlColors"].forEach((sel) => {
      const box = document.querySelector(sel); if (!box) return;
      if (!box.childElementCount) {
        box.innerHTML = Object.entries(CFCar.COLORS).map(([k, v]) => `<button type="button" role="radio" class="sw" data-c="${k}" style="--sw:${v}" aria-label="${CFCar.NAMES[k]}"></button>`).join("");
        box.addEventListener("click", (e) => { const b = e.target.closest(".sw"); if (!b) return; settings.color = b.dataset.c; saveSettings(); paintCars(); });
      }
      box.querySelectorAll(".sw").forEach((b) => b.setAttribute("aria-checked", b.dataset.c === car.color));
    });
  }
  function fuelFor(meters, rig = plan?.opts?.rig || prefs.rig) {
    if (!settings.use) return null;
    const k = meters / 1000;
    const litres = k * settings.use / 100 * (towing(rig) ? 1 + settings.tow / 100 : 1);
    return { litres, cost: litres * (settings.prices[settings.fuel] || 0) };
  }
  const rangeKm = (rig = plan?.opts?.rig || prefs.rig) => settings.tank && settings.use ? settings.tank / (settings.use * (towing(rig) ? 1 + settings.tow / 100 : 1)) * 100 * 0.9 : Infinity;
  function legExtra(meters) {
    const f = fuelFor(meters);
    let out = f ? ` <span class="leg-cost">· ~${money(f.cost)} fuel</span>` : "";
    const k = meters / 1000;
    if (k > rangeKm()) out += ` <span class="leg-warn">· plan a fuel stop</span>`;
    else if (settings.maxKm && k > settings.maxKm) out += ` <span class="leg-warn">· long day</span>`;
    return out;
  }
  // Price for one night. known = the camp lists its price; otherwise it's an estimate from the price guide.
  function campFee(c) {
    if (!c || c.cost === "free") return { v: 0, known: true, why: "Free camp" };
    const m = /(\d+(?:\.\d+)?)/.exec(c.charge || "");
    if (m) {
      let v = +m[1];
      const pp = /person|pp\b|adult/i.test(c.charge);
      if (pp) v *= 2;
      return { v, known: true, why: pp ? `Listed price for 2 people (${c.charge})` : `Listed price (${c.charge})` };
    }
    if (c.park) return { v: (PRICES.stay.national_park_person || 7.75) * 2, known: false, why: `National park permit, about ${money(PRICES.stay.national_park_person || 7.75)} per person (2 people)` };
    if (c.kind === "Caravan / RV site") return { v: PRICES.stay.caravan_powered, known: false, why: "Price not listed: average powered site" };
    if (c.cost === "unknown") return { v: 0, known: false, why: "Price not recorded, likely free" };
    return { v: settings.campUnknown || PRICES.stay.camp_paid, known: false, why: "Paid camp, price not listed (your estimate)" };
  }
  function nightCost(pk) {
    if (pk.refresh) { const st = STAY[pk.refresh.style] || STAY.motel; return { v: st.price(), known: false, why: `${st.label}, average for the area (estimate)`, name: pk.refresh.options?.[0]?.name || st.label }; }
    return { ...campFee(pk.camp), name: pk.camp?.name || "No camp found" };
  }
  function liveFuelPrice(p) {
    const ps = (p.fuel || []).map((f) => f.options?.[0]?.fuel?.price).filter(Boolean);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  }
  function countUp(el, to, fmt) {
    if (!el) return;
    if (!animOn()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function tripCosts(p) {
    const f = fuelFor(p.route.distance); if (!f) return null;
    const live = liveFuelPrice(p);
    const price = live || settings.prices[settings.fuel];
    const fuel = f.litres * price;
    const nightsList = p.picks.map((pk, i) => { const c = nightCost(pk), n = 1 + Math.max(0, +(p.stays?.[i]) || 0); return { i, ...c, n, v: c.v * n }; });
    const camps = nightsList.filter((n) => !p.picks[n.i].refresh).reduce((a, n) => a + n.v, 0);
    const stays = nightsList.filter((n) => p.picks[n.i].refresh).reduce((a, n) => a + n.v, 0);
    const days = totalDays(p), daily = (settings.daily || 0) * days;
    return { f, live, price, fuel, nightsList, camps, stays, daily, days, total: fuel + camps + stays + daily };
  }
  function renderBudget() {
    const box = $("#tripBudget"); if (!box || !plan) return;
    const t = tripCosts(plan);
    if (!t) { box.innerHTML = ""; return; }
    const fills = settings.tank ? t.f.litres / settings.tank : 0;
    const refreshN = plan.picks.filter((pk) => pk.refresh).length;
    const vname = settings.model ? `${settings.make === "Other" ? "" : settings.make + " "}${settings.model}` : "your vehicle";
    box.innerHTML = `<div class="budget" id="budgetCard" role="button" tabindex="0" aria-label="See the cost breakdown">
      <div class="bg-top"><span>Trip cost estimate</span><b class="bg-total" id="bgTotal">$0</b></div>
      <div class="bg-rows">
        <div><b id="bgFuel">$0</b><small>Fuel · ${Math.round(t.f.litres)} L</small></div>
        <div><b>${money(t.camps)}</b><small>Camps</small></div>
        <div><b>${refreshN ? money(t.stays) : t.daily ? money(t.daily) : "—"}</b><small>${refreshN ? `${refreshN} refresh night${refreshN > 1 ? "s" : ""}` : t.daily ? `Spending · ${t.days} days` : "Beds"}</small></div>
      </div>
      <p class="bg-note">${esc(vname)}, ${settings.use} L/100 km${towing(plan.opts.rig) && settings.tow ? ` +${settings.tow}% towing` : ""} at ${money(t.price)}/L ${t.live ? "(live prices on your route)" : "(your set price)"}${fills >= 0.5 ? ` · about ${fills < 1.5 ? "1 tank" : Math.round(fills) + " tanks"}` : ""}. <button type="button" id="bgMore">See breakdown</button></p>
    </div>`;
    countUp($("#bgTotal"), t.total, money);
    countUp($("#bgFuel"), t.fuel, money);
    const open = (e) => { if (e.target.id === "bgMore" || e.currentTarget === e.target || e.target.closest(".budget")) openBudget(); };
    $("#budgetCard").addEventListener("click", open);
  }
  function openBudget() {
    const t = tripCosts(plan); if (!t) return;
    const row = (a, b, c = "") => `<div class="br-row"><span>${a}${c ? `<small>${c}</small>` : ""}</span><b>${b}</b></div>`;
    showDetail(`<div class="d-pad" style="padding-top:22px">
      <h2 class="d-title">Trip costs</h2><p class="d-kind">${esc(short(plan.from.name))} to ${esc(short(plan.to.name))} · ${t.days} days</p>
      <div class="br-total"><span>Estimated total</span><b>${money(t.total)}</b></div>
      <h3 class="h2">Fuel</h3>
      ${row(`${Math.round(t.f.litres)} litres of ${esc(settings.fuel)}`, money(t.fuel), `${km(plan.route.distance)} at ${settings.use} L/100 km${towing(plan.opts.rig) && settings.tow ? `, +${settings.tow}% for towing` : ""}, ${money(t.price)}/L ${t.live ? "average of live prices at your fuel stops" : "from your Settings"}`)}
      ${(plan.fuel || []).filter((f) => f.options?.[0]).map((f, k) => row(`Fuel stop ${k + 1}: ${esc(f.options[0].name)}`, f.options[0].fuel ? `${money(f.options[0].fuel.price)}/L` : "—", `${km(f.along)} from the start`)).join("")}
      <h3 class="h2">Nights</h3>
      ${t.nightsList.map((n) => row(`Night ${n.i + 1}: ${esc(n.name)}${n.n > 1 ? ` × ${n.n}` : ""}`, n.v ? (n.known ? money(n.v) : "~" + money(n.v)) : "$0", esc(n.why))).join("")}
      ${t.daily ? `<h3 class="h2">Spending money</h3>${row(`${t.days} days at ${money(settings.daily)}`, money(t.daily))}` : ""}
      <p class="caveat">Prices marked ~ are estimates from Camp Finder's price guide (updated ${esc(PRICES.updated || "regularly")}), used when a place doesn't list its price. Fuel uses live government price feeds (WA, NSW, TAS, QLD) and Google Maps prices where available. Always check the price when you book.</p>
      <button class="btn" type="button" id="brSettings">${icon("gear")}Change vehicle, fuel price or budget</button>
    </div>`);
    $("#brSettings").addEventListener("click", () => { setView("settings"); $$(".set-fold").slice(0, 1).forEach((d) => (d.open = true)); });
  }

  // ================================================================ price guide (reviewed monthly), fuel stops, refresh nights
  let PRICES = { updated: "", fuel: { ...DEFAULT_PRICE }, stay: { camp_paid: 30, national_park_person: 7.75, caravan_powered: 45, caravan_unpowered: 35, cabin: 135, motel: 155, hotel: 210, bougie: 280 } };
  (async () => {
    const ok = (d) => d && d.stay && d.fuel;
    let best = null;
    try { const b = await fetchJSON(CFG.priceData, {}, 8000); if (ok(b)) best = b; } catch { /* bundled copy missing */ }
    try { const c = store.get("cf-prices", null); if (ok(c) && (!best || String(c.updated) > String(best.updated))) best = c; } catch {}
    if (best) PRICES = best;
    try {
      if (isOffline() || Date.now() - (store.get("cf-prices-checked", 0)) < 7 * 864e5) return;
      const live = nativeFetch ? JSON.parse(await nativeFetch(CFG.priceDataLive, { timeout: 20000 })) : await fetchJSON(CFG.priceDataLive, {}, 20000);
      store.set("cf-prices-checked", Date.now());
      if (ok(live) && String(live.updated) >= String(PRICES.updated)) { PRICES = live; store.set("cf-prices", live); }
    } catch { /* next time */ }
  })();

  const FUEL_TYPES = { diesel: ["DIESEL", "PREMIUM_DIESEL", "TRUCK_DIESEL", "BIO_DIESEL"], petrol: ["SP91", "REGULAR_UNLEADED", "SP91_E10", "SP95", "MIDGRADE", "SP98", "PREMIUM"], lpg: ["LPG"] };
  function priceFor(fo) {
    for (const t of FUEL_TYPES[settings.fuel] || []) {
      const f = (fo?.fuelPrices || []).find((x) => x.type === t);
      if (f?.price) return { price: (+f.price.units || 0) + (f.price.nanos || 0) / 1e9, type: t, updated: f.updateTime };
    }
    return null;
  }
  const agoTime = (iso) => { if (!iso) return ""; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? "just now" : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} day${h < 48 ? "" : "s"} ago`; };
  function pointAt(line, along) {
    let i = line.cum.findIndex((c) => c >= along); if (i < 0) i = line.pts.length - 1;
    return { lat: line.pts[i][0], lon: line.pts[i][1] };
  }

  // Government price schemes (WA FuelWatch, NSW/TAS FuelCheck, QLD) via Camp Finder's database: every station that has to report its prices
  const GOV_FUEL = { petrol: ["ulp", "e10", "p95", "p98"], diesel: ["diesel", "pdiesel"], lpg: ["lpg"] };
  const GOV_NAME = { ulp: "Unleaded 91", e10: "E10", p95: "Premium 95", p98: "Premium 98", diesel: "Diesel", pdiesel: "Premium diesel", lpg: "LPG" };
  function govPrice(row) {
    for (const t of GOV_FUEL[settings.fuel] || []) { const v = +row.prices?.[t]; if (v > 0.5 && v < 5) return { price: v, type: GOV_NAME[t], updated: row.updated_at, gov: true }; }
    return null;
  }
  async function govStationsNear(pt, radius) {
    if (!window.CFCloud?.fuelPricesIn || isOffline()) return [];
    try {
      const rows = await soon(CFCloud.fuelPricesIn(pt.lat, pt.lon, radius), 6000, []);
      return rows.filter((r) => hav([pt.lat, pt.lon], [r.lat, r.lon]) <= radius).map((r) => ({
        id: `gov:${r.id}`, name: r.name || r.brand || "Fuel station", brand: r.brand || "", lat: r.lat, lon: r.lon, addr: r.address || "", fuel: govPrice(r) }));
    } catch { return []; }
  }
  // Petrol stations near a point: government price feeds + Google Maps (with live prices) + the built-in map data, merged
  async function stationsNear(pt, radius) {
    const govP = govStationsNear(pt, radius);
    let list = [];
    if (CFG.googleKey) {
      try {
        const j = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST", fieldMask: "places.id,places.displayName,places.location,places.fuelOptions,places.formattedAddress,places.googleMapsUri,places.currentOpeningHours.openNow",
          body: { includedTypes: ["gas_station"], maxResultCount: 20, rankPreference: "DISTANCE", locationRestriction: { circle: { center: { latitude: pt.lat, longitude: pt.lon }, radius } } },
        });
        list = (j.places || []).map((g) => ({ id: g.id, name: g.displayName?.text || "Fuel station", lat: g.location.latitude, lon: g.location.longitude, addr: g.formattedAddress || "", uri: g.googleMapsUri || "", open: g.currentOpeningHours?.openNow, fuel: priceFor(g.fuelOptions) }));
      } catch { /* fall through to the built-in list */ }
    }
    if (!list.length) list = campDB.fuelIn ? campDB.fuelIn(pt, radius) : [];
    const gov = await govP;
    // the government price wins (stations must report it); unmatched government stations are added
    for (const g of gov) {
      const m = list.find((x) => hav([x.lat, x.lon], [g.lat, g.lon]) < 150);
      if (m) { if (g.fuel) m.fuel = g.fuel; if (!m.name || m.name === "Fuel station") m.name = g.name; m.gov = true; }
      else list.push(g);
    }
    return list;
  }
  async function computeFuelStops(p) {
    const range = rangeKm(p.opts.rig) * 1000;
    if (!isFinite(range) || range < 50000) return [];
    const out = []; let pos = 0, guard = 0;
    const maxStops = Math.ceil(p.line.total / (range * 0.3)) + 5;
    while (p.line.total - pos > range * 0.92 && guard++ < maxStops) {
      const lo = pos + range * 0.5, hi = Math.min(p.line.total, pos + range * 0.85);
      const pts = [0.35, 0.8].map((f) => pointAt(p.line, lo + (hi - lo) * f));
      const found = new Map();
      for (const pt of pts) for (const st of await stationsNear(pt, 25000)) found.set(st.id, st);
      const cands = perLeg(p.line, [...found.values()], 6000).filter((st) => st.along > pos + range * 0.3 && st.along < pos + range * 0.95);
      if (!cands.length) {
        out.push({ along: lo, warn: true, options: [], text: `No fuel found between ${km(lo)} and ${km(hi)} from the start. Fill up before this stretch and carry spare fuel.` });
        pos = hi; continue;
      }
      // cheapest without a big detour; with no prices, the furthest safe one
      const priced = cands.some((c) => c.fuel);
      cands.sort((a, b) => (priced ? ((a.fuel?.price ?? 9) + a.off / 20000) - ((b.fuel?.price ?? 9) + b.off / 20000) : b.along - a.along));
      out.push({ along: cands[0].along, options: cands.slice(0, 4) });
      pos = cands[0].along;
    }
    if (p.line.total - pos > range * 0.92) out.push({ along: pos + range * 0.5, warn: true, options: [], text: `We couldn't plan fuel for the rest of the trip from ${km(pos)}. Fill up at every chance and check your range.` });
    return out;
  }
  function fuelStopHtml(fs) {
    const f = plan.fuel.indexOf(fs);
    if (fs.warn) return `<li class="stop fuel"><div class="plate fuel warn" aria-hidden="true">${icon("fuel")}</div><div class="stop-body"><p class="note">${esc(fs.text)}</p></div></li>`;
    const o = fs.options[0];
    const litres = settings.tank ? Math.round(settings.tank * 0.8) : 0;
    return `<li class="stop fuel"><div class="plate fuel" aria-hidden="true">${icon("fuel")}</div><div class="stop-body">
      <p class="stop-leg">Fuel stop · ${km(fs.along)} from the start</p>
      <div class="fuel-card">
        <div class="fc-top"><div><b>${esc(o.name)}</b><small>${o.off < 400 ? "On your route" : `${km(o.off)} off your route`}${o.open === false ? " · closed now" : ""}</small></div>
          ${o.fuel ? `<div class="fc-price"><b>${money(o.fuel.price)}</b><small>${esc(settings.fuel)} /L</small></div>` : `<div class="fc-price none"><small>No price listed</small></div>`}</div>
        <p class="fc-sub">${o.fuel ? `${o.fuel.gov ? "Official price, updated" : "Updated"} ${agoTime(o.fuel.updated)}${litres ? ` · about ${money(o.fuel.price * litres)} to fill up` : ""}` : "Price not listed for this station"}</p>
        <div class="stop-actions"><a class="btn" href="${navUrl({ lat: o.lat, lon: o.lon, name: o.name }, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a></div>
      </div>
      ${fs.options.length > 1 ? `<details class="alt-wrap"><summary>${fs.options.length - 1} other station${fs.options.length > 2 ? "s" : ""} here ${icon("chev", "ic sm")}</summary>${fs.options.slice(1).map((x) => `<div class="alt fuel-alt"><span><b>${esc(x.name)}</b><small>${x.fuel ? `${money(x.fuel.price)}/L · ` : ""}${x.off < 400 ? "on route" : km(x.off) + " off route"}</small></span><button class="btn" type="button" data-act="fuelpick" data-f="${f}" data-id="${esc(x.id)}">Use this</button></div>`).join("")}</details>` : ""}
    </div></li>`;
  }

  // ---- Need a refresh: motels, cabins and hotels for chosen nights
  const STAY = {
    cabin: { label: "Caravan park cabin", types: ["campground", "rv_park", "lodging"], price: () => PRICES.stay.cabin },
    motel: { label: "Motel", types: ["motel"], price: () => PRICES.stay.motel },
    hotel: { label: "Hotel", types: ["hotel"], price: () => PRICES.stay.hotel },
    bougie: { label: "Feeling bougie", types: ["hotel", "resort_hotel", "motel"], price: () => PRICES.stay.bougie },
  };
  async function findStays(p, pk) {
    const st = STAY[pk.refresh.style] || STAY.motel;
    const pt = pointAt(p.line, pk.target);
    if (CFG.googleKey) {
      try {
        const j = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST", fieldMask: "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName",
          body: { includedTypes: st.types, maxResultCount: 15, locationRestriction: { circle: { center: { latitude: pt.lat, longitude: pt.lon }, radius: 40000 } } },
        });
        let list = (j.places || []).map((g) => ({ id: g.id, name: g.displayName?.text || "Place to stay", lat: g.location.latitude, lon: g.location.longitude, rating: g.rating || 0, count: g.userRatingCount || 0, addr: g.formattedAddress || "", uri: g.googleMapsUri || "", web: g.websiteUri || "", phone: g.nationalPhoneNumber || "", kind: g.primaryTypeDisplayName?.text || st.label }))
          .map((x) => ({ ...x, ...project(p.line, x) })).filter((x) => x.off < 15000);
        const score = (x) => (pk.refresh.style === "bougie" ? x.rating * 3 : x.rating * 1.5) + Math.min(2, Math.log10(1 + x.count)) - Math.abs(x.along - pk.target) / 40000 - x.off / 8000;
        list.sort((a, b) => score(b) - score(a));
        if (pk.refresh.style === "bougie") list = [...list.filter((x) => x.rating >= 4.2), ...list.filter((x) => x.rating < 4.2)];
        if (list.length) return list.slice(0, 4);
      } catch { /* fall back */ }
    }
    // offline: caravan parks from the built-in camp list (most have cabins)
    return p.camps.filter((c) => c.kind === "Caravan / RV site" && Math.abs(c.along - pk.target) < 60000)
      .sort((a, b) => Math.abs(a.along - pk.target) - Math.abs(b.along - pk.target)).slice(0, 4)
      .map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, rating: 0, count: 0, addr: "", uri: "", web: c.website, phone: c.phone, kind: "Caravan park (cabins usually available)", along: c.along, off: c.off }));
  }
  function refreshStopHtml(pk, i, leg) {
    const st = STAY[pk.refresh.style] || STAY.motel;
    const o = pk.refresh.options?.[0];
    const head = `<div class="refresh-tag">${pk.refresh.style === "bougie" ? "✨ Feeling bougie" : "🛏️ Need a refresh"} · ${esc(st.label)}</div>`;
    let body;
    if (!pk.refresh.options) body = `<p class="help"><span class="spinner"></span>Finding a ${esc(st.label.toLowerCase())} near here</p>`;
    else if (!o) body = `<p class="note">No ${esc(st.label.toLowerCase())} found near this stop.</p>${pk.camp ? campCard(pk.camp) : ""}`;
    else body = `<div class="stay-card">
        <div class="fc-top"><div><b>${esc(o.name)}</b><small>${esc(o.kind)}${o.rating ? ` · ★ ${o.rating.toFixed(1)} (${o.count.toLocaleString("en-AU")})` : ""}</small></div><div class="fc-price"><b>~${money(st.price())}</b><small>per night, est.</small></div></div>
        ${o.addr ? `<p class="fc-sub">${esc(o.addr)}</p>` : ""}
        <div class="stop-actions">
          ${o.web ? `<a class="btn" href="${esc(o.web)}" target="_blank" rel="noopener">Book or check prices</a>` : o.uri ? `<a class="btn" href="${esc(o.uri)}" target="_blank" rel="noopener">See on Google Maps</a>` : ""}
          ${o.phone ? `<a class="btn line" href="tel:${esc(o.phone.replace(/\s/g, ""))}">Call</a>` : ""}
          <a class="btn line" href="${navUrl({ lat: o.lat, lon: o.lon, name: o.name }, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
        </div>
      </div>
      ${pk.refresh.options.length > 1 ? `<details class="alt-wrap"><summary>${pk.refresh.options.length - 1} other option${pk.refresh.options.length > 2 ? "s" : ""} ${icon("chev", "ic sm")}</summary>${pk.refresh.options.slice(1).map((x) => `<div class="alt fuel-alt"><span><b>${esc(x.name)}</b><small>${x.rating ? `★ ${x.rating.toFixed(1)} · ` : ""}${esc(x.kind)}</small></span><button class="btn" type="button" data-act="staypick" data-i="${i}" data-id="${esc(x.id)}">Stay here</button></div>`).join("")}</details>` : ""}
      ${pk.camp ? `<button class="btn line small-btn" type="button" data-act="camphere" data-i="${i}">Camp at ${esc(pk.camp.name)} instead</button>` : ""}`;
    return `<li class="stop refresh"><div class="plate refresh" aria-label="Night ${i + 1}">${i + 1}</div><div class="stop-body">${leg}${head}${body}</div></li>`;
  }
  async function planExtras(p) {
    if (p !== plan) return;
    if (!p.alerts) loadAlerts(p); else renderAlerts();
    const jobs = [];
    p.picks.forEach((pk) => { if (pk.refresh && !pk.refresh.options) jobs.push(findStays(p, pk).then((o) => { pk.refresh.options = o; })); });
    if (!p.fuel) { p.fuelState = "loading"; renderItinerary(); jobs.push(computeFuelStops(p).then((f) => { p.fuel = f; }).catch(() => { p.fuel = []; }).finally(() => { p.fuelState = "done"; })); }
    if (!jobs.length) return;
    renderItinerary();
    await Promise.all(jobs.map((j) => j.catch(() => {})));
    if (p === plan) { renderItinerary(); renderBudget(); }
  }

  // ================================================================ weather, bushfires, road links, rig check
  const WX = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"], 51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"], 61: ["🌧️", "Rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 95: ["⛈️", "Storms"], 96: ["⛈️", "Storms, hail"], 99: ["⛈️", "Storms, hail"] };
  const dayOffset = (p) => { const d = p.opts.leave ? new Date(p.opts.leave + "T00:00:00") : new Date(); d.setHours(0, 0, 0, 0); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 864e5); };
  async function loadWeather(p) {
    const spots = p.picks.map((pk, i) => ({ i, lat: (pk.refresh?.options?.[0] || pk.camp || pointAt(p.line, pk.target)).lat, lon: (pk.refresh?.options?.[0] || pk.camp || pointAt(p.line, pk.target)).lon }));
    spots.push({ i: p.picks.length, lat: p.to.lat, lon: p.to.lon });
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${spots.map((s) => s.lat.toFixed(3)).join(",")}&longitude=${spots.map((s) => s.lon.toFixed(3)).join(",")}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max&timezone=auto&forecast_days=16`;
    const j = await getJSON(url);
    const arr = Array.isArray(j) ? j : [j];
    const off = dayOffset(p);
    p.weather = spots.map((s, k) => {
      let extra = 0; for (let q = 0; q < s.i; q++) extra += Math.max(0, +(p.stays?.[q]) || 0);
      const d = arr[k]?.daily; const idx = off + s.i + extra;
      if (!d || idx < 0 || idx >= (d.time || []).length) return null;
      return { date: d.time[idx], code: d.weather_code[idx], max: d.temperature_2m_max[idx], min: d.temperature_2m_min[idx], rain: d.precipitation_probability_max[idx], mm: d.precipitation_sum[idx], gust: d.wind_gusts_10m_max[idx] };
    });
  }
  function weatherChip(i) {
    const w = plan?.weather?.[i]; if (!w) return "";
    const [e, t] = WX[w.code] || ["🌡️", ""];
    const warn = w.max >= 40 ? " hot" : (w.rain >= 70 && w.mm >= 10) || w.code >= 95 || w.gust >= 70 ? " wet" : "";
    return `<span class="wx${warn}" title="${esc(t)}">${e} ${Math.round(w.max)}°/${Math.round(w.min)}° · ${w.rain ?? 0}%</span>`;
  }
  function weatherAlerts(p) {
    const out = [];
    (p.weather || []).forEach((w, i) => {
      if (!w) return;
      const where = i < p.picks.length ? `night ${i + 1}${p.picks[i].camp ? ` (${p.picks[i].camp.name})` : ""}` : short(p.to.name);
      if (w.rain >= 70 && w.mm >= 10) out.push({ lvl: 2, icon: "🌧️", title: `Heavy rain likely at ${where}`, text: `${Math.round(w.mm)} mm forecast. Dirt roads and low crossings can close; check before you go.` });
      if (w.code >= 95) out.push({ lvl: 2, icon: "⛈️", title: `Storms forecast at ${where}`, text: "Avoid camping under big trees and secure your awning." });
      if (w.max >= 40) out.push({ lvl: 2, icon: "🥵", title: `Extreme heat at ${where}`, text: `${Math.round(w.max)}°C forecast. Carry extra water and avoid driving in the hottest part of the day.` });
      if (w.gust >= 70) out.push({ lvl: 1, icon: "💨", title: `Strong winds at ${where}`, text: `Gusts to ${Math.round(w.gust)} km/h. Take care towing and pick a sheltered spot.` });
    });
    return out;
  }
  // Bushfire incidents near the route from the state emergency feeds
  const statesOf = (p) => [...new Set(sample(p.line, 50000).map(([la, lo]) => stateOf(la, lo)))];
  function pointOfGeom(g) {
    if (!g) return null;
    if (g.type === "Point") return { lon: g.coordinates[0], lat: g.coordinates[1] };
    if (g.type === "GeometryCollection") { for (const x of g.geometries || []) { const pt = pointOfGeom(x); if (pt) return pt; } return null; }
    if (g.type === "Polygon" || g.type === "MultiPolygon") { const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0]; const n = ring.length; return { lon: ring.reduce((a, c) => a + c[0], 0) / n, lat: ring.reduce((a, c) => a + c[1], 0) / n }; }
    return null;
  }
  const FIRE_LVL = (s) => /emergency/i.test(s) ? 3 : /watch and act/i.test(s) ? 2 : /advice|going|out of control|being controlled/i.test(s) ? 1 : 0;
  async function loadFires(p) {
    const R = window.CF_ROAD; if (!R) return [];
    const out = [];
    await Promise.all(statesOf(p).filter((st) => R.feeds[st]).map(async (st) => {
      try {
        const j = await soon(getJSON(R.feeds[st]), 12000, null); if (!j) return;
        for (const f of j.features || []) {
          const pr = f.properties || {};
          const kind = `${pr.category || ""} ${pr.category1 || ""} ${pr.category2 || ""} ${pr.feedType || ""} ${pr.WarningLevel || ""}`;
          if (st === "VIC" && !/fire|burn|bushfire/i.test(kind)) continue;
          const pt = pointOfGeom(f.geometry); if (!pt) continue;
          const pos = project(p.line, pt);
          if (pos.off > 20000) continue;
          const level = pr.category || pr.action || pr.WarningLevel || pr.status || pr.category2 || "";
          if (/planned burn/i.test(kind) && pos.off > 5000) continue;
          const title = pr.title || pr.sourceTitle || pr.WarningTitle || pr.Header || pr.Locality || "Fire";
          out.push({ lvl: Math.max(1, FIRE_LVL(level + " " + (pr.description || ""))), icon: /planned burn/i.test(kind) ? "🟠" : "🔥", title: `${/planned burn/i.test(kind) ? "Planned burn" : "Fire"}: ${title}`, text: `${level ? level + " · " : ""}${pos.off < 1000 ? "on your route" : km(pos.off) + " from your route"}, about ${km(pos.along)} from the start.`, link: pr.link || pr.url || R.fires[st]?.[1] || "" });
        }
      } catch { /* feed unavailable: links below still work */ }
    }));
    return out.sort((a, b) => b.lvl - a.lvl).slice(0, 6);
  }
  // Rig check: low clearances from the map data and steep climbs from elevation
  const RIG_HEIGHT = { tent: 2.1, rooftop: 2.4, camper: 2.5, caravan: 3.0, motorhome: 3.3 };
  const rigHeight = (rig) => settings.height || RIG_HEIGHT[rig] || 2.5;
  function lowClearances(p) {
    if (!campDB.lowIn) return [];
    const h = rigHeight(p.opts.rig);
    const out = [];
    for (const part of [p.line.pts.filter((_, k) => k % 25 === 0)]) {
      const bb = bboxOf(part.length ? part : p.line.pts, 0.02);
      for (const c of campDB.lowIn(bb)) {
        if (c.h >= h + 0.15) continue;
        const pos = project(p.line, c);
        if (pos.off < 40) out.push({ ...c, ...pos });
      }
    }
    const seen = new Set();
    return out.filter((c) => { const k = Math.round(c.along / 2000); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  }
  async function steepClimbs(p) {
    const step = Math.max(1500, p.line.total / 499), pts = [];
    for (let a = 0; a <= p.line.total; a += step) pts.push({ along: a, ...pointAt(p.line, a) });
    const elev = [];
    for (let k = 0; k < pts.length; k += 100) {
      const ch = pts.slice(k, k + 100);
      const j = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${ch.map((x) => x.lat.toFixed(4)).join(",")}&longitude=${ch.map((x) => x.lon.toFixed(4)).join(",")}`);
      elev.push(...(j.elevation || []));
    }
    const out = [];
    const real = step;
    for (let k = 1; k < elev.length; k++) {
      const g = (elev[k] - elev[k - 1]) / real * 100;
      if (Math.abs(g) >= 8) out.push({ along: pts[k].along, grade: g, h: elev[k] });
    }
    // merge neighbours into one climb or descent
    const merged = [];
    for (const s of out) { const last = merged.at(-1); if (last && s.along - last.end <= step * 1.5 && Math.sign(s.grade) === Math.sign(last.grade)) { last.end = s.along; last.grade = Math.abs(s.grade) > Math.abs(last.grade) ? s.grade : last.grade; } else merged.push({ start: s.along - step, end: s.along, grade: s.grade }); }
    return merged.sort((a, b) => Math.abs(b.grade) - Math.abs(a.grade)).slice(0, 5).sort((a, b) => a.start - b.start);
  }
  async function loadAlerts(p) {
    const box = $("#tripAlerts"); if (!box) return;
    p.alerts = p.alerts || { loading: true };
    renderAlerts();
    const [w, fires, climbs] = await Promise.all([
      soon(loadWeather(p).then(() => true), 15000, false),
      soon(loadFires(p), 15000, []),
      soon(steepClimbs(p).catch((e) => { console.warn("Elevation check failed:", e && e.message); return []; }), 20000, []),
    ]);
    if (p !== plan) return;
    p.alerts = { fires, climbs, low: lowClearances(p), weather: weatherAlerts(p), weatherOk: w };
    renderAlerts(); renderItinerary();
  }
  function renderAlerts() {
    const box = $("#tripAlerts"), p = plan; if (!box || !p) return;
    const a = p.alerts || {};
    if (a.loading) { box.innerHTML = `<div class="alerts"><p class="help"><span class="spinner"></span>Checking weather, fires and the road for your rig</p></div>`; return; }
    const items = [...(a.fires || []), ...(a.weather || [])].sort((x, y) => y.lvl - x.lvl);
    const h = rigHeight(p.opts.rig);
    (a.low || []).forEach((c) => items.push({ lvl: 2, icon: "⚠️", title: `Possible low clearance: ${c.h} m`, text: `About ${km(c.along)} from the start. Your rig is set at ${h} m. Check the sign; this may be on a road that passes over or under your route.` }));
    (a.climbs || []).forEach((c) => items.push({ lvl: Math.abs(c.grade) >= 12 ? 2 : 1, icon: c.grade > 0 ? "⛰️" : "⬇️", title: `${c.grade > 0 ? "Steep climb" : "Steep descent"}, about ${Math.round(Math.abs(c.grade))}%`, text: `Around ${km(c.start)} from the start.${towing(p.opts.rig) ? " Use a lower gear and watch your temperatures when towing." : ""}` }));
    if (settings.dog) items.push({ lvl: 0, icon: "🐕", title: "Dog mode is on", text: "Camps that don't allow dogs and national park camps were left out. Dogs aren't allowed in most national parks, even in the car on some roads, so check the rules for parks on your route." });
    const st = statesOf(p), R = window.CF_ROAD || { roads: {}, fires: {} };
    const links = st.map((s) => R.roads[s] ? `<a href="${R.roads[s][1]}" target="_blank" rel="noopener">${esc(R.roads[s][0])}</a>` : "").filter(Boolean).join(" · ");
    const fireLinks = st.map((s) => R.fires[s] ? `<a href="${R.fires[s][1]}" target="_blank" rel="noopener">${esc(R.fires[s][0])}</a>` : "").filter(Boolean).join(" · ");
    // short by default: one line per thing, tap a line for the details
    const serious = items.filter((x) => x.lvl >= 1).length;
    const row = (x) => `<details class="al lvl${x.lvl}"><summary><span class="al-ic">${x.icon}</span><b>${esc(x.title)}</b></summary><small>${esc(x.text)}${x.link ? ` <a href="${esc(x.link)}" target="_blank" rel="noopener">Details</a>` : ""}</small></details>`;
    const first = items.slice(0, 3), rest = items.slice(3);
    box.innerHTML = `<div class="alerts">
      <div class="al-head"><b>${serious ? `${serious} thing${serious > 1 ? "s" : ""} to know` : "Road check: all clear"}</b><span class="help">${a.weatherOk ? "Weather, fires and your rig" : "Fires and your rig"}</span></div>
      ${items.length ? first.map(row).join("") + (rest.length ? `<details class="al-more"><summary>${rest.length} more</summary>${rest.map(row).join("")}</details>` : "") : `<p class="help">No fires, low clearances${a.weatherOk ? " or severe weather" : ""} for your ${h} m rig.</p>`}
      <details class="al-more links"><summary>Road and fire updates</summary><p class="al-links">Road conditions: ${links || "check the state road authority"}<br>Fire warnings: ${fireLinks}</p></details>
    </div>`;
  }

  // ================================================================ need water / dump point / fuel
  function nearbyNeeds(kind, from) {
    let list = [];
    const bb = [from.lat - 0.9, from.lon - 0.9, from.lat + 0.9, from.lon + 0.9];
    if (kind === "dump") list = (campDB.inArea(bb, 0).dumps || []).map((d) => ({ ...d, name: "Dump point" }));
    if (kind === "water") {
      list = (campDB.waterIn ? campDB.waterIn(bb) : []).map((w) => ({ ...w, name: w.tank ? "Water fill point" : "Drinking water tap" }));
      list.push(...campDB.inArea(bb, 0).camps.filter((c) => c.a.water === true).map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, name: `Water at ${c.name}` })));
    }
    if (kind === "fuel") list = (campDB.fuelIn ? campDB.fuelIn(from, 90000) : []);
    // ahead on the planned route first, then closest
    const onTrip = journey && plan;
    const here = onTrip ? project(plan.line, from).along : 0;
    list.forEach((x) => { x.d = hav([from.lat, from.lon], [x.lat, x.lon]); if (onTrip) Object.assign(x, project(plan.line, x)); });
    if (onTrip) list = list.filter((x) => x.off < 8000 && x.along > here - 1500).sort((a, b) => a.along - b.along);
    else list.sort((a, b) => a.d - b.d);
    return list.slice(0, 6);
  }
  async function showNeeds(kind) {
    const title = { water: "Water nearby", dump: "Dump points nearby", fuel: "Fuel nearby" }[kind];
    const go = async (from, label) => {
      let list = nearbyNeeds(kind, from);
      if (kind === "fuel" && (CFG.googleKey || window.CFCloud?.fuelPricesIn) && !isOffline()) { const live = await soon(stationsNear(from, 30000), 8000, []); if (live.length) list = live.map((x) => ({ ...x, d: hav([from.lat, from.lon], [x.lat, x.lon]) })).sort((a, b) => a.d - b.d).slice(0, 6); }
      showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">${title}</h2><p class="d-kind">${esc(label)}</p>
        ${list.length ? `<ul class="need-list">${list.map((x) => `<li><div><b>${esc(x.name)}</b><small>${x.along != null && journey ? `${km(Math.max(0, x.along - project(plan.line, from).along))} ahead on your route` : `${km(x.d)} away`}${x.fuel ? ` · ${money(x.fuel.price)}/L ${esc(settings.fuel)}` : ""}</small></div><a class="btn" href="${navUrl({ lat: x.lat, lon: x.lon, name: x.name }, "apple")}" target="_blank" rel="noopener">${icon("nav")}Go</a></li>`).join("")}</ul>`
          : `<p class="msg">Nothing found within about 90 km. ${kind === "water" ? "Town visitor centres, roadhouses and caravan parks usually let you fill up." : kind === "dump" ? "Caravan parks often allow dump use for a small fee." : ""}</p>`}
        <p class="caveat">From OpenStreetMap${kind === "fuel" && CFG.googleKey ? " and Google Maps" : ""}. Check water is drinkable and dump points are open before relying on them.</p></div>`);
    };
    if (me) return go(me, journey ? "Ahead of you on your route" : "Closest to you");
    showDetail(`<div class="d-pad" style="padding-top:22px"><p class="msg"><span class="spinner"></span>Finding you</p></div>`);
    locate((pt) => go(pt, "Closest to you"));
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-need]"); if (b) showNeeds(b.dataset.need); });

  // ================================================================ journeys, live sharing and the travel journal
  const jkv = (() => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open("cf-journal", 1); r.onupgradeneeded = () => r.result.createObjectStore("j", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("j", mode); const q = fn(t.objectStore("j")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
    return { put: (v) => run("readwrite", (s) => s.put(v)), get: (id) => run("readonly", (s) => s.get(id)), all: () => run("readonly", (s) => s.getAll()), del: (id) => run("readwrite", (s) => s.delete(id)) };
  })();
  const nativeJourney = nativeCall("journey", "__cfJourneyDone");
  const jcall = (cmd, extra = {}) => nativeJourney ? nativeJourney({ cmd, ...extra, reply: true }, 8000).catch(() => null) : Promise.resolve(null);
  // The journey's details live in localStorage (small), its points and notes in IndexedDB (no 5 MB limit),
  // so a long trip with photos can never fill up storage and lose anything.
  const journeyMeta = (j) => { const m = {}; for (const k in j) if (k !== "points" && k !== "notes") m[k] = j[k]; return m; };
  let journey = store.get("cf-journey", null);
  if (journey) { journey.points ||= []; journey.notes ||= []; }
  const journeyLoaded = journey ? jkv.get(journey.id).then((full) => {
    if (!full || !journey || full.id !== journey.id) return;
    if ((full.points || []).length >= journey.points.length) journey.points = full.points;
    if ((full.notes || []).length >= journey.notes.length) journey.notes = full.notes;
  }).catch(() => {}) : Promise.resolve();
  let jsaveT;
  const saveJourney = () => {
    if (!journey) return;
    store.set("cf-journey", journeyMeta(journey));
    clearTimeout(jsaveT); const j = journey;
    jsaveT = setTimeout(() => jkv.put({ ...j }).catch(() => {}), 300);
  };
  const trackKm = (pts) => { let d = 0; for (let k = 1; k < pts.length; k++) d += hav([pts[k - 1][1], pts[k - 1][2]], [pts[k][1], pts[k][2]]); return d; };

  function campAlertList(p) {
    return [...p.camps].filter((c) => c.cost === "free" && !c.closed && c.source !== "rest")
      .map((c) => ({ c, s: score(c, p.opts.wants, "free") + ((ratingCache.get(c.id)?.avg || 0) * 6) }))
      .sort((a, b) => b.s - a.s).slice(0, 40)
      .map(({ c }) => ({ name: c.name, lat: c.lat, lon: c.lon, why: [c.a.toilets ? "toilets" : "", c.a.water ? "water" : "", c.a.dogs ? "dogs OK" : "", ratingCache.get(c.id)?.avg ? `rated ${ratingCache.get(c.id).avg.toFixed(1)}★` : ""].filter(Boolean).join(", ") || "free camp" }));
  }
  async function startJourney() {
    if (!plan) return;
    journey = {
      id: `j-${Date.now()}`, name: `${short(plan.from.name)} to ${short(plan.to.name)}`, started: new Date().toISOString(),
      from: plan.from, to: plan.to, nights: plan.picks.map((pk) => ({ name: pk.refresh?.options?.[0]?.name || pk.camp?.name || "", lat: (pk.refresh?.options?.[0] || pk.camp)?.lat, lon: (pk.refresh?.options?.[0] || pk.camp)?.lon })),
      route: plan.route.geometry.coordinates.filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 300)) === 0),
      points: [], notes: [], share: null, fuelAlerts: lastFuelList(plan), alerted: [], asked: [],
      nightSpots: plan.picks.map((pk) => pk.camp && { id: pk.camp.id, name: pk.camp.name, lat: pk.camp.lat, lon: pk.camp.lon }).filter(Boolean),
    };
    saveJourney();
    await jcall("start", { id: journey.id, notify: true, camps: settings.campAlerts ? campAlertList(plan) : [], fuel: journey.fuelAlerts });
    const firstGap = fuelGaps(plan).gaps[0];
    if (firstGap && firstGap.len >= 150000) setTimeout(() => roadAlert("⛽", "Fill up before you leave", `No fuel for ${km(firstGap.len)} after ${short(plan.from.name)}.`), 1500);
    startTracking(); setFollow(true);
    await jkv.put({ ...journey }).catch(() => {});
    showJourneyBar(); toast("Journey started. Safe travels!");
    if (famMe) { famLastPos = 0; famPushFull(); }
  }
  // One sync at a time, and only points newer than the last one we have, so nothing is counted twice
  let syncing = null, lastBadgeRun = 0;
  function syncJourney() {
    if (!journey) return Promise.resolve();
    if (syncing) return syncing;
    syncing = (async () => {
      await journeyLoaded;
      if (!journey) return;
      const lastT = journey.points.at(-1)?.[0] || 0;
      const pts = await jcall("points", { id: journey.id, from: journey.points.length });
      if (journey && Array.isArray(pts) && pts.length) journey.points.push(...pts.filter((p) => p[0] > lastT));
      saveJourney();
      updateJourneyBar();
      if (Date.now() - lastBadgeRun > 5 * 60000) { lastBadgeRun = Date.now(); updateBadges(true); } // badges every 5 minutes is plenty
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // ---- On the road: "last fuel" alerts and a quiet "how busy is it?" when you arrive at camp
  function roadAlert(ic, title, text, actions = "") {
    const el = $("#roadAlert");
    el.innerHTML = `<span class="ra-ic">${ic}</span><div class="ra-body"><b>${esc(title)}</b><span>${esc(text)}</span>${actions}</div><button type="button" class="ra-x" aria-label="Dismiss">✕</button>`;
    el.hidden = false; el.classList.remove("out");
    clearTimeout(roadAlert.t); roadAlert.t = setTimeout(() => hideRoadAlert(), actions ? 30000 : 15000);
    navigator.vibrate?.(60);
  }
  function hideRoadAlert() { const el = $("#roadAlert"); el.classList.add("out"); setTimeout(() => (el.hidden = true), 300); }
  $("#roadAlert").addEventListener("click", (e) => {
    if (e.target.closest(".ra-x")) return hideRoadAlert();
    const b = e.target.closest("[data-crowd]");
    if (b) { sendCrowd(b.dataset.camp, b.dataset.crowd).then(() => { hideRoadAlert(); toast("Thanks! That helps other travellers"); }).catch(() => toast("Couldn't send that. Try again with signal.")); }
  });
  function onRoadCheck(pos) {
    if (!journey) return;
    const d = (x) => hav([pos.lat, pos.lon], [x.lat, x.lon]);
    // last fuel before a long stretch
    for (const f of journey.fuelAlerts || []) {
      const key = `f:${f.lat},${f.lon}`;
      if (!journey.alerted.includes(key) && d(f) < 2500) {
        journey.alerted.push(key); saveJourney();
        roadAlert("⛽", `Last fuel for ${f.gapKm} km`, `${f.name} is the last fuel before ${f.next || "a long stretch"}. Top up here.`);
        return;
      }
    }
    // arrived at tonight's camp: ask once, quietly, how busy it is (signed-in people only)
    if (!window.CFCloud?.enabled || !window.CFCloud.signedIn()) return;
    const hour = new Date().getHours();
    if (hour < 13 || hour > 21) return;
    for (const c of journey.nightSpots || []) {
      if (journey.asked.includes(c.id) || d(c) > 350) continue;
      journey.asked.push(c.id); saveJourney();
      roadAlert("🏕️", `At ${c.name}?`, "How busy is it? One tap helps others.",
        `<span class="ra-acts">${CROWD.map(([k, l]) => `<button type="button" data-crowd="${k}" data-camp="${esc(c.id)}">${l}</button>`).join("")}</span>`);
      return;
    }
  }
  function recordPoint(pos) { // used when there's no native recorder (and while the app is open)
    if (!journey || nativeJourney) return;
    const last = journey.points.at(-1);
    if (last && hav([last[1], last[2]], [pos.lat, pos.lon]) < 120) return;
    journey.points.push([Math.round(Date.now() / 1000), +pos.lat.toFixed(5), +pos.lon.toFixed(5)]);
    if (journey.points.length % 5 === 0) saveJourney();
    updateJourneyBar();
  }
  function showJourneyBar() { $("#journeyBar").hidden = !journey; $("#app").classList.toggle("on-journey", !!journey); updateJourneyBar(); }
  // ---- Driven so far: the route changes colour behind you as you travel it
  let travel = null;   // { key, line, done, n, last }
  function travelLine() {
    if (!journey) return null;
    if (plan && journey.name === `${short(plan.from.name)} to ${short(plan.to.name)}`) return { key: `p:${plan.line.total}`, line: plan.line, own: !(tripLayer.getLayers?.() || [1]).length };
    if ((journey.route || []).length > 1) return { key: `j:${journey.id}`, line: (journey._line ||= buildLine({ geometry: { coordinates: journey.route } })), own: true };
    return null;
  }
  // move "done" forward only: a point counts if it's near the route and not an impossible jump ahead
  function travelAdvance(t, lat, lon, prev) {
    // on a return trip, take the position on whichever leg is just ahead of where you've got to
    const all = projectAll(t.line, { lat, lon }).filter((q) => q.off <= 1500 && q.along > t.done);
    const pr = all.sort((a, b) => a.along - b.along)[0] || { off: Infinity, along: 0 };
    if (pr.off > 1500 || pr.along <= t.done) return;
    const step = prev ? hav(prev, [lat, lon]) : 0;
    if (t.done === 0 ? pr.along < 60000 || pr.along < step + 25000 : pr.along - t.done < step * 1.6 + 25000) t.done = pr.along;
  }
  function drawTravelled(live) {
    const tl = travelLine();
    if (!tl) { travelLayer.clearLayers(); travel = null; return; }
    if (!travel || travel.key !== tl.key) travel = { key: tl.key, line: tl.line, done: 0, n: 0, last: null };
    const pts = journey.points || [];
    for (; travel.n < pts.length; travel.n++) { const p = pts[travel.n]; travelAdvance(travel, p[1], p[2], travel.last); travel.last = [p[1], p[2]]; }
    if (live) travelAdvance(travel, live.lat, live.lon, travel.last);
    travelLayer.clearLayers();
    const line = travel.line;
    if (tl.own) { // no plan on screen: show the journey's route too
      L.polyline(line.pts, { color: "#ffffff", weight: 8, opacity: .85, interactive: false }).addTo(travelLayer);
      L.polyline(line.pts, { color: "#0E5A3E", weight: 4.5, opacity: .9, interactive: false }).addTo(travelLayer);
    }
    if (travel.done > 0) {
      let i = line.cum.findIndex((c) => c >= travel.done); if (i < 0) i = line.pts.length - 1;
      const driven = line.pts.slice(0, i + 1);
      if (driven.length > 1) {
        L.polyline(driven, { color: "#ffffff", weight: 10, opacity: .95, interactive: false }).addTo(travelLayer);
        L.polyline(driven, { color: "#E07A1F", weight: 6, opacity: 1, interactive: false }).addTo(travelLayer);
      }
    }
  }
  const travelPct = () => (travel && travel.line.total ? Math.min(100, Math.round((travel.done / travel.line.total) * 100)) : 0);
  let travelLiveT = 0;
  window.__cfTravelAt = (m) => { const t = travelLine(); if (!t) return -1; travelLiveT = 0; travelOnPos(pointAt(t.line, m)); return travelPct(); };
  function travelOnPos(pos) { if (journey && Date.now() - travelLiveT > 5000) { travelLiveT = Date.now(); drawTravelled(pos); updateJourneyStats(); } }

  function updateJourneyBar() {
    if (!journey) { drawTravelled(); return; }
    drawTravelled();
    updateJourneyStats();
  }
  function updateJourneyStats() {
    if (!journey) return;
    const day = Math.floor((Date.now() - Date.parse(journey.started)) / 864e5) + 1;
    const pct = travelPct();
    $("#jbTitle").textContent = journey.name;
    $("#jbStats").textContent = `Day ${day} · ${km(trackKm(journey.points))} driven${pct ? ` · ${pct}% of the way` : ""}${journey.share ? " · sharing live" : ""}`;
    $("#startJourney").textContent = "Journey in progress";
    $("#startJourney").disabled = true;
  }
  async function endJourney() {
    const b = $("#jbEnd");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap to end"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "End"; }, 3000); return; }
    await syncJourney();
    await jcall("stop");
    if (journey.share && window.CFCloud?.updateShare) window.CFCloud.updateShare(journey.share, me, null, true).catch(() => {});
    journey.ended = new Date().toISOString();
    clearTimeout(jsaveT); await jkv.put({ ...journey }).catch(() => {});
    const done = journey; journey = null; store.set("cf-journey", null); doneJourneys = null;
    showJourneyBar();
    $("#startJourney").disabled = false; $("#startJourney").innerHTML = `${icon("nav")}Start journey`;
    updateBadges(true);
    if (famMe) famPushFull();
    toast(`Journey saved to your journal: ${km(trackKm(done.points))}`);
    setTimeout(() => openJournal(done, true), 600);
  }
  $("#startJourney").addEventListener("click", startJourney);
  $("#jbEnd").addEventListener("click", endJourney);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncJourney(); });
  setInterval(() => { if (journey && !document.hidden) syncJourney(); }, 60000);
  if (journey) { showJourneyBar(); startTracking(); jcall("status").then((s) => { if (s && !s.active) jcall("start", { id: journey.id, notify: !!settings.campAlerts, camps: [] }); }); syncJourney(); }

  // Live sharing with family
  const SHARE_PAGE = "https://gonelappin.au/share.html";
  async function shareJourney() {
    if (!journey) return;
    const C = window.CFCloud;
    if (!C?.enabled) return toast("Sharing isn't switched on in this version yet");
    if (!C.signedIn()) { toast("Sign in (free) to share your trip"); return goSignIn(); }
    try {
      if (!journey.share) {
        const tonight = journey.nights.find((n) => n.name)?.name || short(journey.to.name);
        const route = journey.route.map(([lo, la]) => [+la.toFixed(4), +lo.toFixed(4)]);
        journey.share = await C.createShare(journey.name, { route, to: journey.to.name, nights: journey.nights.map((n) => n.name) }, tonight);
        saveJourney();
        await jcall("share", { share: { url: C.url, key: C.anonKey, id: journey.share.id, secret: journey.share.secret } });
        if (me) C.updateShare(journey.share, me, tonight).catch(() => {});
      }
      const link = `${SHARE_PAGE}#${journey.share.id}`;
      const text = `Follow my trip ${journey.name} live on Camp Finder: ${link}`;
      if (navigator.share) await navigator.share({ title: "My trip", text, url: link }).catch(() => {});
      else { await navigator.clipboard?.writeText(link).catch(() => {}); toast("Link copied. Paste it in a text to family."); }
      updateJourneyBar();
    } catch (e) { toast("Couldn't create the share link right now"); }
  }
  $("#jbShare").addEventListener("click", shareJourney);
  setInterval(() => { if (journey?.share && me && !nativeJourney && window.CFCloud?.updateShare) window.CFCloud.updateShare(journey.share, me, null).catch(() => {}); }, 300000);

  // ================================================================ Family sharing (like Life360, for road trips)
  // You turn it on and get an invite code. Family type the code into their Camp Finder and can watch
  // you live on the map: speed, how far away you are, the trip you're on, where you've camped,
  // kilometres, states and badges. Pause or turn it off any time; a new code locks out old ones.
  const FAM_ME = "cf-family-me", FAM_FOLLOW = "cf-family-follow";
  let famMe = store.get(FAM_ME, null);          // { id, secret, code, name, paused }
  let famFollow = store.get(FAM_FOLLOW, []);    // [{ code, name }]
  const famData = new Map();                    // code -> what they last shared
  const famMarkers = new Map();
  const famLayer = L.layerGroup().addTo(map);
  const famTripLayer = L.layerGroup().addTo(map);
  let famWatch = null, famLastPos = 0, famLastPosAt = null, famLastFull = 0;
  const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : "");
  const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const r4 = (n) => +(+n).toFixed(4);
  const famCloud = () => window.CFCloud?.enabled && window.CFCloud.getFamily ? window.CFCloud : null;
  const agoText = (iso) => { if (!iso) return "never"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const whereText = (lat, lon) => { const t = campDB.townNear?.(lat, lon); if (t) return t.d < 3000 ? `in ${t.name}` : `near ${t.name}`; return window.CFGeo ? `in ${CFGeo.STATE_NAME[CFGeo.stateAt(lat, lon)] || "Australia"}` : ""; };

  // ---- what you share
  function spotName(j, lat, lon) {
    const ns = (j.nightSpots || []).find((c) => c && hav([c.lat, c.lon], [lat, lon]) < 1500); if (ns) return ns.name;
    if (campDB.has()) {
      const near = campDB.inArea([lat - 0.015, lon - 0.015, lat + 0.015, lon + 0.015], 0).camps.map((c) => ({ c, d: hav([c.lat, c.lon], [lat, lon]) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 1200) return near.c.name;
    }
    const t = campDB.townNear?.(lat, lon);
    return t ? (t.d < 3000 ? t.name : `Near ${t.name}`) : "Overnight stop";
  }
  // Where you stopped overnight: a gap of 5+ hours between points means you slept there
  function campedList(js) {
    const out = [];
    for (const j of js) {
      const pts = (j.points || []).filter((p) => p && p.length >= 3);
      for (let k = 1; k < pts.length; k++) {
        if (pts[k][0] - pts[k - 1][0] < 5 * 3600) continue;
        const [t, lat, lon] = pts[k - 1], prev = out.at(-1);
        if (prev && hav([prev.lat, prev.lon], [lat, lon]) < 1500 && t - prev.t < 40 * 3600) { prev.nights++; prev.t = t; continue; }
        out.push({ name: spotName(j, lat, lon), lat: r4(lat), lon: r4(lon), t, nights: 1 });
      }
    }
    return out;
  }
  async function famStats() {
    const js = await allJourneys();
    const res = window.CFBadges ? CFBadges.compute(js) : { stats: {}, list: [] };
    const got = store.get("cf-badges", {});
    const badges = res.list.filter((b) => b.earned).map((b) => ({ name: b.name, icon: b.icon, short: b.short || "", tier: b.tier, at: got[b.id] || "" }));
    const s = res.stats || {};
    return { km: Math.round(s.km || 0), hours: Math.round(s.hours || 0), nights: s.nights || 0, journeys: s.journeys || 0, states: s.states || [], badges: badges.slice(-80), camped: campedList(js).slice(-40) };
  }
  function famTrip() {
    if (!journey) return null;
    const pts = journey.points || [];
    const visited = (c) => pts.some((p) => Math.abs(p[1] - c.lat) < 0.02 && Math.abs(p[2] - c.lon) < 0.02 && hav([p[1], p[2]], [c.lat, c.lon]) < 1500);
    const nights = (journey.nights || []).filter((n) => n && n.lat != null).map((n) => ({ name: n.name || "Camp", lat: r4(n.lat), lon: r4(n.lon), done: visited(n) }));
    const step = Math.max(1, Math.ceil(pts.length / 400)), track = [];
    for (let i = 0; i < pts.length; i += step) track.push([r4(pts[i][1]), r4(pts[i][2])]);
    if (pts.length) track.push([r4(pts.at(-1)[1]), r4(pts.at(-1)[2])]);
    const pt = (x) => ({ name: short(x.name || ""), lat: r4(x.lat), lon: r4(x.lon) });
    return { name: journey.name, from: pt(journey.from), to: pt(journey.to), started: journey.started, route: (journey.route || []).map(([lo, la]) => [r4(la), r4(lo)]), nights, track, tonight: nights.find((n) => !n.done)?.name || short(journey.to.name) };
  }
  const famNative = () => jcall("family", { family: famMe && !famMe.paused && famCloud() ? { url: CFCloud.url, key: CFCloud.anonKey, id: famMe.id, secret: famMe.secret } : null });
  async function famPushFull() {
    const C = famCloud(); if (!famMe || famMe.paused || !C) return;
    famLastFull = Date.now();
    const trip = famTrip();
    await C.updateFamily(famMe, { name: famMe.name, car: myCar(), stats: await famStats(), trip: trip || undefined, clear_trip: !trip }).catch(() => {});
  }
  // while the app is open (the phone does it in the background on a journey)
  function famOnPos(c) {
    const C = famCloud(); if (!famMe || famMe.paused || !C || isOffline()) return;
    const moving = (c.speed || 0) > 2, since = Date.now() - famLastPos;
    const moved = famLastPosAt ? hav(famLastPosAt, [c.latitude, c.longitude]) : Infinity;
    if (since < (moving ? 20000 : 300000) && !(moved > 400 && since > 10000)) return;
    famLastPos = Date.now(); famLastPosAt = [c.latitude, c.longitude];
    C.updateFamily(famMe, { lat: c.latitude, lon: c.longitude, speed: c.speed != null && c.speed >= 0 ? c.speed : 0, heading: c.heading != null && c.heading >= 0 ? c.heading : (typeof heading === "number" ? heading : null), accuracy: c.accuracy || null }).catch(() => {});
    if (Date.now() - famLastFull > 5 * 60000) famPushFull();
  }
  async function famTurnOn(name) {
    const C = famCloud(); if (!C) return toast("Family sharing isn't switched on in this version yet");
    if (!C.signedIn()) { toast("Sign in (free) to share with family"); return goSignIn(); }
    const r = await C.createFamily(name, myCar());
    famMe = { ...r, name, paused: false }; store.set(FAM_ME, famMe);
    settings.famName = name; saveSettings();
    await famNative();
    if (!me) locate(() => {}); else famOnPos({ latitude: me.lat, longitude: me.lon, speed: 0 });
    famPushFull();
  }
  function famInvite() {
    if (!famMe) return;
    const text = `Follow my trips live 🚙 Watch here: https://gonelappin.au/family.html#${famMe.code}\nOr in the Camp Finder app: My stuff → Family, and type my code ${fmtCode(famMe.code)}`;
    if (navigator.share) navigator.share({ title: "Follow my trip", text }).catch(() => {});
    else { navigator.clipboard?.writeText(text).catch(() => {}); toast("Invite copied. Paste it in a text."); }
  }

  // ---- watching family
  async function famRefresh(codes = famFollow.map((f) => f.code)) {
    const C = famCloud(); if (!C || isOffline() || document.hidden) return;
    await Promise.all(codes.map(async (code) => {
      try {
        const d = await C.getFamily(code);
        if (!d) { famData.set(code, { gone: true }); return; }
        const old = famData.get(code);
        if (old?.trip && d.trip && JSON.stringify(old.trip.route?.[0]) === JSON.stringify(d.trip.route?.[0])) d._line = old._line;
        d.fetched = Date.now(); famData.set(code, d);
        const f = famFollow.find((x) => x.code === code); if (f && d.name && f.name !== d.name) { f.name = d.name; store.set(FAM_FOLLOW, famFollow); }
      } catch { /* keep what we had */ }
    }));
    famDraw();
    if (view === "saved" && store.get("cf-seg") === "family") renderFamily(true);
  }
  // Between updates the car keeps moving: along their planned route if they're on it, otherwise straight ahead
  function famPredict(d) {
    if (d.lat == null) return null;
    let at = { lat: d.lat, lon: d.lon }, hd = d.heading;
    const age = Math.min(90, Math.max(0, (Date.now() - Date.parse(d.pos_at || d.updated_at)) / 1000));
    if ((d.speed || 0) > 2 && age > 0 && Date.now() - Date.parse(d.pos_at || 0) < 180000) {
      const dist = d.speed * age;
      if (d.trip?.route?.length > 1) {
        d._line ||= buildLine({ geometry: { coordinates: d.trip.route.map(([la, lo]) => [lo, la]) } });
        const pr = project(d._line, at);
        if (pr.off < 400) { const nxt = pointAt(d._line, Math.min(d._line.total, pr.along + dist)); if (hav([at.lat, at.lon], [nxt.lat, nxt.lon]) > 5) hd = bearing(at, nxt); at = nxt; return { ...at, hd }; }
      }
      if (hd != null) { const R = 6371000, b = toRad(hd), la = toRad(at.lat), lo = toRad(at.lon), dr = dist / R;
        const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
        const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
        at = { lat: la2 * 180 / Math.PI, lon: lo2 * 180 / Math.PI }; }
    }
    return { ...at, hd };
  }
  function famStatus(d) {
    if (!d || d.gone) return { ic: "⚠️", text: "This code doesn't work any more" };
    if (d.paused) return { ic: "⏸️", text: "Sharing is paused" };
    if (d.lat == null) return { ic: "⏳", text: "Waiting for their first location" };
    const stale = Date.now() - Date.parse(d.pos_at || d.updated_at) > 3 * 3600000;
    const kmh = Math.round((d.speed || 0) * 3.6);
    const atCamp = (d.trip?.nights || []).find((n) => hav([n.lat, n.lon], [d.lat, d.lon]) < 600);
    if (!stale && kmh >= 8) return { ic: "🚙", text: `Driving ${kmh} km/h ${whereText(d.lat, d.lon)}`, moving: true, kmh };
    if (atCamp) return { ic: "🏕️", text: `At camp: ${atCamp.name}` };
    return { ic: stale ? "📵" : "🅿️", text: `${stale ? "Last seen" : "Stopped"} ${whereText(d.lat, d.lon)}${stale ? ". Probably out of signal" : ""}` };
  }
  function famIcon(d, name, sub) {
    const car = window.CFCar ? CFCar.top({ ...(d.car || {}), withTrailer: true }).svg : CAR_SVG;
    return `<div class="fam-mk"><div class="fam-car" style="--rot:${Math.round(d._hd ?? d.heading ?? 0)}deg">${car}</div><span class="fam-tag"><b>${esc(name)}</b>${sub ? ` · ${esc(sub)}` : ""}</span></div>`;
  }
  function famDraw() {
    const seen = new Set();
    for (const f of famFollow) {
      const d = famData.get(f.code); if (!d || d.gone || d.paused || d.lat == null) continue;
      seen.add(f.code);
      const p = famPredict(d) || d; d._hd = p.hd ?? d.heading;
      const st = famStatus(d), sub = st.moving ? `${st.kmh} km/h` : "";
      let m = famMarkers.get(f.code);
      const html = famIcon(d, (d.name || f.name || "Family").split(" ")[0], sub);
      if (!m) {
        m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "fam-icon", html, iconSize: [46, 46], iconAnchor: [23, 23] }), zIndexOffset: 1800, title: d.name });
        m.on("click", () => famOpen(f.code)); m.addTo(famLayer); famMarkers.set(f.code, m); m._html = html;
      } else {
        m.setLatLng([p.lat, p.lon]);
        if (m._html !== html) { m.setIcon?.(L.divIcon({ className: "fam-icon", html, iconSize: [46, 46], iconAnchor: [23, 23] })); m._html = html; }
      }
      if (famWatch === f.code && !map._cfDragging) map.panTo([p.lat, p.lon], { animate: true, duration: 0.9 });
    }
    for (const [code, m] of famMarkers) if (!seen.has(code)) { famLayer.removeLayer(m); famMarkers.delete(code); }
  }
  map.on("dragstart", () => { if (famWatch) { famWatch = null; renderFamily(); } });
  function famDrawTrip(d) {
    famTripLayer.clearLayers();
    if (!d || !d.trip) return;
    if (d.trip.route?.length > 1) L.polyline(d.trip.route, { color: "#0E5A3E", weight: 4, opacity: .55, dashArray: "6 8" }).addTo(famTripLayer);
    if (d.trip.track?.length > 1) L.polyline(d.trip.track, { color: "#E07A1F", weight: 5, opacity: .9 }).addTo(famTripLayer);
    (d.trip.nights || []).forEach((n, i) => L.marker([n.lat, n.lon], { icon: divIcon(`<div class="fam-night${n.done ? " done" : ""}">${i + 1}</div>`, [24, 24]), title: n.name, interactive: false }).addTo(famTripLayer));
  }
  function famOpen(code) {
    famWatch = code;
    const d = famData.get(code);
    famDrawTrip(d);
    if (d?.lat != null) map.setView([d.lat, d.lon], Math.max(map.getZoom(), 11));
    setView("saved"); setSeg("family"); setSheet("half");
    setTimeout(() => $(".fam-card.is-watch")?.scrollIntoView({ block: "start", behavior: animOn() ? "smooth" : "auto" }), 80);
    famRefresh([code]);
  }

  // ---- the Family page
  function medalMini(b) { return `<span class="fam-medal" title="${esc(b.name)}">${b.tier === "state" ? `<b>${esc(b.short)}</b>` : esc(b.icon)}</span>`; }
  function famCard(f) {
    const d = famData.get(f.code), st = famStatus(d), name = d?.name || f.name || "Family";
    const dist = me && d?.lat != null ? `${km(hav([me.lat, me.lon], [d.lat, d.lon]))} from you` : "";
    const watching = famWatch === f.code;
    const s = d?.stats || {}, t = d?.trip;
    const car = window.CFCar && d?.car ? CFCar.side(d.car).svg : "";
    let more = "";
    if (watching && d && !d.gone && !d.paused) {
      const done = (t?.nights || []).filter((n) => n.done).length;
      more = `<div class="fam-more">
        ${st.moving ? `<div class="fam-speed"><b>${st.kmh}</b><span>km/h</span></div>` : ""}
        ${t ? `<div class="fam-trip"><span class="fam-k">On a trip</span><b>${esc(t.from.name)} → ${esc(t.to.name)}</b><small>Night ${Math.min(done + 1, t.nights.length || 1)} of ${t.nights.length || 1} · Tonight: ${esc(t.tonight || "")}</small>
          <div class="fam-prog"><i style="width:${Math.round((done / Math.max(1, t.nights.length)) * 100)}%"></i></div></div>` : ""}
        <div class="fam-stats"><div><b>${(s.km || 0).toLocaleString("en-AU")}</b><span>km driven</span></div><div><b>${s.nights || 0}</b><span>nights away</span></div><div><b>${(s.states || []).length}</b><span>states</span></div><div><b>${(s.badges || []).length}</b><span>badges</span></div></div>
        ${(s.badges || []).length ? `<h4 class="fam-h">Badges</h4><div class="fam-medals">${s.badges.slice(-24).reverse().map(medalMini).join("")}</div>` : ""}
        ${(s.camped || []).length ? `<h4 class="fam-h">Where they've camped</h4><ul class="fam-camps">${s.camped.slice(-12).reverse().map((c) => `<li data-fam-go="${c.lat},${c.lon}"><span>🏕️</span><b>${esc(c.name)}</b><small>${new Date(c.t * 1000).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}${c.nights > 1 ? ` · ${c.nights} nights` : ""}</small></li>`).join("")}</ul>` : ""}
      </div>`;
    }
    return `<li class="fam-card${watching ? " is-watch" : ""}" data-fam="${esc(f.code)}">
      <div class="fam-top">${car ? `<span class="fam-pic">${car}</span>` : ""}<div class="fam-who"><b>${esc(name)}</b><span>${st.ic} ${esc(st.text)}</span><small>${[dist, d && !d.gone ? `updated ${agoText(d.pos_at || d.updated_at)}` : ""].filter(Boolean).join(" · ")}</small></div></div>
      ${more}
      <div class="fam-btns">${d && !d.gone && !d.paused && d.lat != null ? `<button class="btn${watching ? " line" : " gold"}" type="button" data-fam-watch="${esc(f.code)}">${watching ? "Stop watching" : "👀 Watch live"}</button>` : ""}<button class="btn line" type="button" data-fam-del="${esc(f.code)}">Remove</button></div>
    </li>`;
  }
  function renderFamily(quiet = false) {
    const box = $("#famBox"); if (!box) return;
    if (quiet && box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return; // don't wipe what they're typing
    const C = famCloud(), moreOpen = !!box.querySelector(".fs-more[open]");
    const mine = famMe ? `<div class="fam-share on${famMe.paused ? " paused" : ""}">
        <div class="fs-head"><span class="fs-dot"></span><b>${famMe.paused ? "Sharing paused" : "Family can see you"}</b></div>
        <p class="help">Your invite code. Family type this into Camp Finder to follow you.</p>
        <div class="fs-code" aria-label="Invite code">${fmtCode(famMe.code)}</div>
        <div class="fs-btns"><button class="cta" type="button" id="famInvite">Send invite</button><button class="btn line" type="button" id="famPause">${famMe.paused ? "▶️ Resume" : "⏸️ Pause"}</button></div>
        <details class="fs-more"><summary>Settings and privacy</summary>
          <p class="help">They see your live location and speed, the trip you're on, where you've camped, your kilometres, states and badges. Not your notes or photos.</p>
          <p class="help">On a journey your phone updates every 20 seconds while driving. Otherwise it updates when you move a few hundred metres, if you've allowed location "Always" in iPhone Settings.</p>
          <div class="fs-btns"><button class="btn line" type="button" id="famNewCode">New code</button><button class="btn line danger" type="button" id="famOff">Turn off sharing</button></div>
          <small class="help">A new code stops old codes working, so anyone you gave it to can't see you any more.</small>
        </details></div>`
      : `<div class="fam-share">
        <div class="fs-head"><span class="fs-ic">📍</span><b>Share your trips with family</b></div>
        <p class="help">Let family watch you travel live, like Life360 for road trips: where you are, how fast you're going, tonight's camp, your kilometres and badges. You get a code to send them. Pause or turn it off any time.</p>
        <label class="field-lab" for="famName">Your name (what family see)</label>
        <input id="famName" type="text" maxlength="40" autocomplete="name" value="${esc(settings.famName || (C?.email?.() || "").split("@")[0] || "")}" placeholder="e.g. Mum and Dad">
        <button class="cta" type="button" id="famOn" style="width:100%;margin-top:10px">${C && !C.signedIn() ? "Sign in to turn on" : "Turn on family sharing"}</button>
      </div>`;
    const follow = `<h2 class="h2">Family you follow</h2>
      <ul class="list fam-list">${famFollow.map(famCard).join("") || `<li class="empty">No one yet. When family send you their code, add it here to watch their trip.</li>`}</ul>
      <form class="fam-add" id="famAdd"><label class="sr" for="famCode">Their invite code</label><input id="famCode" type="text" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH"><button class="btn gold" type="submit">Follow</button></form>
      <p class="msg" id="famMsg" role="status"></p>`;
    // people you follow come first once you have some; your own sharing below
    box.innerHTML = famFollow.length ? `${follow}<h2 class="h2">Share your trips</h2>${mine}` : `${mine}${follow}`;
    if (moreOpen) box.querySelector(".fs-more")?.setAttribute("open", "");
  }
  $("#view-saved").addEventListener("click", async (e) => {
    const t = e.target;
    try {
      if (t.closest("#famOn")) { const n = ($("#famName")?.value || "").trim(); if (!n) { $("#famName").focus(); return toast("Add your name so family know it's you"); } t.closest("#famOn").disabled = true; await famTurnOn(n); renderFamily(); if (famMe) toast("Family sharing is on. Send them your code!"); return; }
      if (t.closest("#famInvite")) return famInvite();
      if (t.closest("#famPause")) { famMe.paused = !famMe.paused; store.set(FAM_ME, famMe); await famCloud()?.updateFamily(famMe, { paused: famMe.paused }); await famNative(); if (!famMe.paused) { famLastPos = 0; famPushFull(); if (me) famOnPos({ latitude: me.lat, longitude: me.lon, speed: 0 }); } renderFamily(); toast(famMe.paused ? "Paused: family can't see where you are" : "Sharing again"); return; }
      if (t.closest("#famNewCode")) { const c = await famCloud().newFamilyCode(famMe); if (c) { famMe.code = c; store.set(FAM_ME, famMe); renderFamily(); toast(`New code ${fmtCode(c)}. Old codes no longer work.`); } return; }
      if (t.closest("#famOff")) { const b = t.closest("#famOff"); if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to turn off"; return; } await famCloud()?.stopFamily(famMe).catch(() => {}); famMe = null; store.set(FAM_ME, null); await famNative(); renderFamily(); toast("Family sharing is off and your location was deleted"); return; }
      const w = t.closest("[data-fam-watch]"); if (w) { if (famWatch === w.dataset.famWatch) { famWatch = null; famTripLayer.clearLayers(); renderFamily(); } else famOpen(w.dataset.famWatch); return; }
      const del = t.closest("[data-fam-del]"); if (del) { famFollow = famFollow.filter((f) => f.code !== del.dataset.famDel); store.set(FAM_FOLLOW, famFollow); famData.delete(del.dataset.famDel); if (famWatch === del.dataset.famDel) { famWatch = null; famTripLayer.clearLayers(); } famDraw(); renderFamily(); return; }
      const go = t.closest("[data-fam-go]"); if (go) { const [la, lo] = go.dataset.famGo.split(",").map(Number); famWatch = null; map.setView([la, lo], 13); return; }
    } catch (err) { toast(err?.message === "Sign in first." ? "Sign in (free) first" : "Couldn't do that right now. Check your signal."); renderFamily(); }
  });
  $("#view-saved").addEventListener("submit", async (e) => {
    if (e.target.id !== "famAdd") return;
    e.preventDefault();
    const code = cleanCode($("#famCode").value), msg = $("#famMsg");
    if (code.length !== 8) { msg.className = "msg is-error"; msg.textContent = "Codes are 8 letters and numbers, like ABCD-EFGH."; return; }
    if (famFollow.some((f) => f.code === code)) { msg.textContent = "You already follow them."; return; }
    if (famMe && code === famMe.code) { msg.textContent = "That's your own code. Send it to family instead."; return; }
    const C = famCloud(); if (!C) { msg.textContent = "Family sharing isn't switched on in this version yet."; return; }
    msg.className = "msg"; msg.innerHTML = `<span class="spinner"></span>Looking up the code`;
    try {
      const d = await C.getFamily(code);
      if (!d) { msg.className = "msg is-error"; msg.textContent = "No one is sharing with that code. Check it with them."; return; }
      famFollow.push({ code, name: d.name || "Family" }); store.set(FAM_FOLLOW, famFollow);
      d.fetched = Date.now(); famData.set(code, d);
      famDraw(); renderFamily(); toast(`Following ${d.name || "them"}`);
      if (d.lat != null) famOpen(code);
    } catch { msg.className = "msg is-error"; msg.textContent = "Couldn't check the code. You need signal."; }
  });
  // keep everything fresh: watching someone every 15 s, otherwise every minute; cars glide in between
  setInterval(() => { if (famWatch) famRefresh([famWatch]); }, 15000);
  setInterval(() => { if (famFollow.length) famRefresh(); }, 60000);
  setInterval(() => { if (famMarkers.size && !document.hidden) famDraw(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && famFollow.length) famRefresh(); });
  if (famFollow.length) setTimeout(() => famRefresh(), 2500);
  window.__cfFam = () => ({ markers: famMarkers.size, watching: famWatch });
  if (famMe) setTimeout(() => { famNative(); famPushFull(); if (store.get("cf-loc-ok", false)) startTracking(); }, 3000);

  // Travel journal
  function addJournalEntry(j) {
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Add to journal</h2><p class="d-kind">${esc(j.name)}</p>
      <form id="jnForm" class="jn-form">
        <textarea id="jnText" rows="4" maxlength="2000" placeholder="What happened today? Best camp, a great view, the bloke at the servo…"></textarea>
        <div class="jn-photos" id="jnPhotos"></div>
        <div class="stop-actions"><button class="btn" type="button" id="jnPhoto">${icon("photo")}Add photos</button><button class="cta" type="submit">Save</button></div>
      </form></div>`);
    const photos = [];
    $("#jnPhoto").addEventListener("click", () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.addEventListener("change", async () => {
        for (const f of [...inp.files].slice(0, 6)) { const d = await shrinkImage(f, 1400); if (d) photos.push(d); }
        $("#jnPhotos").innerHTML = photos.map((d) => `<img src="${d}" alt="">`).join("");
      });
      inp.click();
    });
    $("#jnForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#jnText").value.trim();
      if (!text && !photos.length) return toast("Write something or add a photo");
      j.notes.push({ at: new Date().toISOString(), text, photos, lat: me?.lat, lon: me?.lon });
      if (journey && journey.id === j.id) { journey.notes = j.notes; saveJourney(); }
      try { await jkv.put({ ...j }); } catch { return toast("Your phone's storage is full"); }
      toast("Saved to your journal"); closeDetail(); if (view === "saved") renderJournal();
    });
  }
  $("#jbJournal").addEventListener("click", () => journey && addJournalEntry(journey));
  async function renderJournal() {
    const box = $("#journalList"); if (!box) return;
    let all = [];
    try { all = (await jkv.all()).sort((a, b) => b.started.localeCompare(a.started)); } catch {}
    box.innerHTML = all.length ? all.map((j) => `<li class="trip-item">
        <b>${esc(j.name)}${j.ended ? "" : " · on now"}</b>
        <span class="help">${new Date(j.started).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · ${km(trackKm(j.points))} · ${j.notes.length} entr${j.notes.length === 1 ? "y" : "ies"}</span>
        <span class="row"><button class="btn" type="button" data-journal="${esc(j.id)}">Open</button></span>
      </li>`).join("") : `<li class="empty">Start a journey from a trip and it's recorded here automatically, with your notes and photos.</li>`;
  }
  $("#journalList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-journal]"); if (!b) return;
    const j = await jkv.get(b.dataset.journal); if (!j) return;
    openJournal(j);
  });
  function openJournal(j, justEnded = false) {
    tripLayer.clearLayers(); legLayer.clearLayers();
    const pts = j.points.map((p) => [p[1], p[2]]);
    if (j.route?.length) L.polyline(j.route.map(([lo, la]) => [la, lo]), { color: "#0E5A3E", weight: 3, opacity: .35, dashArray: "4 6" }).addTo(legLayer);
    if (pts.length > 1) { const pl = L.polyline(pts, { color: "#D9A400", weight: 6 }).addTo(legLayer); map.fitBounds(pl.getBounds(), fitPad()); }
    const days = j.ended ? Math.max(1, Math.ceil((Date.parse(j.ended) - Date.parse(j.started)) / 864e5)) : Math.floor((Date.now() - Date.parse(j.started)) / 864e5) + 1;
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">${esc(j.name)}</h2>
      <p class="d-kind">${new Date(j.started).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}${j.ended ? "" : " · still on the road"}</p>
      <div class="dir-sum"><div><b>${km(trackKm(j.points))}</b><span>driven</span></div><div><b>${days}</b><span>day${days > 1 ? "s" : ""}</span></div><div><b>${j.notes.length}</b><span>entries</span></div></div>
      ${j.points.length > 1 || j.route?.length ? `<button class="cta recap-cta" type="button" id="jnRecap">🎬 ${justEnded ? "Make your trip video" : "Trip video"}</button>` : ""}
      <div class="stop-actions"><button class="btn" type="button" id="jnAdd">${icon("plus")}Add a note or photos</button><button class="btn line" type="button" id="jnDel">Delete</button></div>
      <ol class="jn-entries">${[...j.notes].reverse().map((n) => `<li><small>${new Date(n.at).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small>${n.text ? `<p>${esc(n.text)}</p>` : ""}${n.photos?.length ? `<div class="jn-photos">${n.photos.map((d) => `<img src="${d}" alt="Journal photo">`).join("")}</div>` : ""}</li>`).join("") || `<li class="empty">No entries yet.</li>`}</ol>
    </div>`);
    $("#jnAdd").addEventListener("click", () => addJournalEntry(j));
    $("#jnRecap")?.addEventListener("click", () => makeRecap(j));
    $("#jnDel").addEventListener("click", async (e) => {
      if (e.currentTarget.dataset.sure !== "1") { e.currentTarget.dataset.sure = "1"; e.currentTarget.textContent = "Tap again to delete"; return; }
      if (journey?.id === j.id) return toast("End the journey first");
      await jkv.del(j.id).catch(() => {}); doneJourneys = null; closeDetail(); renderJournal(); toast("Journal deleted");
    });
  }

  // ---- My stuff: Saved / Badges / Journal
  function setSeg(name) {
    $$("#view-saved [data-seg]").forEach((b) => b.setAttribute("aria-selected", b.dataset.seg === name));
    $$("#view-saved [data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
    store.set("cf-seg", name);
    if (name === "badges") renderBadges();
    if (name === "journal") renderJournal();
    if (name === "family") { renderFamily(); if (famFollow.length) famRefresh(); }
    $("#sheetScroll").scrollTop = 0;
  }
  $("#view-saved .seg-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-seg]"); if (b) setSeg(b.dataset.seg); });
  setTimeout(() => setSeg(store.get("cf-seg", "saved")), 0);

  // ================================================================ badges
  const STATE_COL = { QLD: "#7A1F3D", NSW: "#4FA3D9", VIC: "#1F3B7A", TAS: "#2E6B43", SA: "#C8372D", WA: "#E3A21A", NT: "#B5582C", ACT: "#2F6FD6" };
  const TIER_COL = { bronze: "#C98A4B", silver: "#A9B4BA", gold: "#E3B23C", platinum: "#7FD1CF", special: "#2FA36B" };
  let badgeState = { list: [], stats: null };
  const medalColor = (b) => (b.tier === "state" ? STATE_COL[b.short] : TIER_COL[b.tier]) || "#E3B23C";
  function medalHtml(b, big = false) {
    const isState = b.tier === "state";
    return `<span class="medal${big ? " big" : ""}${b.earned ? "" : " locked"}${isState ? " state" : ""}" style="--mc:${medalColor(b)};--p:${Math.round((b.progress || 0) * 100)}">
      <span class="m-ring"></span><span class="m-face">${isState ? `<b>${esc(b.short)}</b>` : esc(b.icon)}</span></span>`;
  }
  // finished journeys only change when one ends or is deleted, so keep just their points in memory
  let doneJourneys = null;
  async function allJourneys() {
    if (!doneJourneys) { try { doneJourneys = (await jkv.all()).filter((j) => j.ended && (!journey || j.id !== journey.id)).map((j) => ({ id: j.id, points: j.points, started: j.started, ended: j.ended, nightSpots: j.nightSpots || [] })); } catch { doneJourneys = []; } }
    return journey ? [...doneJourneys, journey] : [...doneJourneys];
  }
  async function updateBadges(announce = false) {
    if (!window.CFBadges) return;
    const js = await allJourneys();
    const res = CFBadges.compute(js);
    badgeState = res;
    const had = store.get("cf-badges", null), firstRun = had == null, got = had || {};
    const fresh = res.list.filter((b) => b.earned && !got[b.id]);
    fresh.forEach((b) => (got[b.id] = new Date().toISOString()));
    if (fresh.length || firstRun) store.set("cf-badges", got);
    if (announce && !firstRun && fresh.length) queueBadges(fresh);
    if (view === "saved") renderBadges();
    return res;
  }
  const badgeQueue = [];
  function queueBadges(list) { badgeQueue.push(...list); if ($("#badgePop").hidden) nextBadge(); }
  function nextBadge() {
    const b = badgeQueue.shift(); if (!b) return;
    const more = badgeQueue.length;
    $("#bpMedal").innerHTML = medalHtml(b, true);
    $("#bpName").textContent = b.name;
    $("#bpDesc").textContent = b.desc + (more ? ` (+${more} more)` : "");
    const pop = $("#badgePop"); pop.hidden = false; pop.classList.remove("out");
    navigator.vibrate?.([40, 60, 40]);
  }
  function closeBadgePop(thenAll) {
    const pop = $("#badgePop"); pop.classList.add("out");
    setTimeout(() => { pop.hidden = true; if (thenAll) { badgeQueue.length = 0; setView("saved"); setSeg("badges"); } else nextBadge(); }, 260);
  }
  $("#bpOk").addEventListener("click", () => closeBadgePop(false));
  $("#bpAll").addEventListener("click", () => closeBadgePop(true));
  function renderBadges() {
    const box = $("#badgeBox"); if (!box) return;
    const { list, stats } = badgeState;
    if (!stats) { box.innerHTML = `<p class="help">Loading…</p>`; updateBadges(); return; }
    const earned = list.filter((b) => b.earned).length;
    const LEVELS = [[0, "New on the Road"], [3, "Weekender"], [8, "Explorer"], [15, "Road Tripper"], [25, "Grey Nomad"], [40, "Big Lapper"], [55, "Outback Legend"]];
    let li = 0; LEVELS.forEach((l, i) => { if (earned >= l[0]) li = i; });
    const next = LEVELS[li + 1], from = LEVELS[li][0];
    const pct = next ? Math.round(((earned - from) / (next[0] - from)) * 100) : 100;
    const hero = `<div class="bx-hero"><div class="bx-lvl"><span>Level ${li + 1}</span><b>${LEVELS[li][1]}</b></div>
      <div class="bx-bar"><i style="width:${pct}%"></i></div><p>${next ? `${next[0] - earned} more badge${next[0] - earned === 1 ? "" : "s"} to <b>${next[1]}</b>` : "You've reached the top level. Legend!"}</p></div>`;
    const groups = [["km", "Distance"], ["hours", "Time behind the wheel"], ["nights", "Nights on the road"], ["states", "States and territories"], ["places", "Special places"], ["journeys", "Journeys"]];
    box.innerHTML = hero + `<div class="bx-stats"><div><b>${Math.round(stats.km).toLocaleString("en-AU")}</b><span>km driven</span></div><div><b>${Math.round(stats.hours)}</b><span>hours</span></div><div><b>${stats.states.length}</b><span>of 8 states</span></div><div><b>${earned}</b><span>badges</span></div></div>
      ${groups.map(([g, title]) => { const items = list.filter((b) => b.group === g); if (!items.length) return ""; return `<h3 class="bx-h">${title} <small>${items.filter((b) => b.earned).length}/${items.length}</small></h3><div class="bx-grid">${items.map((b) => `<button type="button" class="bx-item${b.earned ? " got" : ""}" data-badge="${esc(b.id)}">${medalHtml(b)}<span>${esc(b.name)}</span></button>`).join("")}</div>`; }).join("")}
      ${stats.journeys ? "" : `<p class="help bx-empty">Start a journey from any trip and your kilometres, hours and states count towards badges automatically.</p>`}`;
  }
  $("#badgeBox").addEventListener("click", (e) => {
    const el = e.target.closest("[data-badge]"); if (!el) return;
    const b = badgeState.list.find((x) => x.id === el.dataset.badge); if (!b) return;
    const when = store.get("cf-badges", {})[b.id];
    showDetail(`<div class="d-pad bx-detail" style="padding-top:26px">${medalHtml(b, true)}<h2 class="d-title">${esc(b.name)}</h2><p class="d-kind">${esc(b.desc)}</p>
      ${b.earned ? `<p class="bx-when">Earned${when ? ` ${new Date(when).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}` : ""} 🎉</p>`
        : `<div class="bx-prog"><span style="width:${Math.round(b.progress * 100)}%"></span></div><p class="help">${Math.round(b.progress * 100)}% there${b.target ? ` · ${esc(b.target)}` : ""}</p>`}</div>`);
  });

  // ================================================================ trip recap video
  function recapData(j) {
    let track = (j.points || []).map((p) => [p[1], p[2]]);
    if (track.length < 2 && j.route?.length) track = j.route.map(([lo, la]) => [la, lo]);
    const kmDriven = trackKm(j.points || []) / 1000 || (() => { let d = 0; for (let k = 1; k < track.length; k++) d += hav(track[k - 1], track[k]); return d / 1000; })();
    const start = new Date(j.started), end = j.ended ? new Date(j.ended) : new Date();
    const days = Math.max(1, Math.round((new Date(end.toDateString()) - new Date(start.toDateString())) / 864e5) + 1);
    const states = [...new Set(track.filter((_, k) => k % 5 === 0).map((p) => CFGeo.stateAt(p[0], p[1])))];
    const fmt = (d, o) => d.toLocaleDateString("en-AU", o);
    const sub = days > 1 ? `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}` : fmt(start, { day: "numeric", month: "long", year: "numeric" });
    const photos = (j.notes || []).flatMap((n) => n.photos || []).slice(0, 6);
    const got = store.get("cf-badges", {});
    const t0 = start.getTime() - 3600e3, t1 = end.getTime() + 6 * 3600e3;
    let won = badgeState.list.filter((b) => b.earned && got[b.id] && Date.parse(got[b.id]) >= t0 && Date.parse(got[b.id]) <= t1);
    if (!won.length) won = badgeState.list.filter((b) => b.earned && b.group === "states" && b.tier === "state" && states.includes(b.short));
    const badges = won.slice(-6).map((b) => ({ icon: b.tier === "state" ? b.short : b.icon, color: medalColor(b) }));
    return { title: j.name, sub, track, stats: { km: kmDriven, days, nights: Math.max(0, days - 1), states }, photos, badges, carSvg: window.CFCar ? CFCar.top(myCar()).svg : "" };
  }
  async function makeRecap(j) {
    if (!window.CFRecap) return toast("Trip videos aren't available in this version");
    await updateBadges();
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Your trip video</h2><p class="d-kind">${esc(j.name)}</p><div class="recap-stage" id="recapStage"><span class="spinner"></span></div>
      <div class="d-actions"><button class="cta" type="button" id="recapSave">⬇️ Save / share</button><button class="btn" type="button" id="recapPlay">▶ Play again</button></div>
      <p class="help" id="recapMsg">Share it to Facebook, Instagram or send it to family.</p></div>`);
    const r = await CFRecap.create(recapData(j));
    const stage = $("#recapStage"); if (!stage) return;
    stage.innerHTML = ""; stage.appendChild(r.canvas);
    r.play();
    $("#recapPlay").addEventListener("click", () => r.play());
    $("#recapSave").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; $("#recapPlay").disabled = true;
      const name = `${j.name.replace(/[^\w ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "trip"}-camp-finder`;
      try {
        const blob = await r.record((p) => { btn.textContent = `Making your video… ${Math.round(p * 100)}%`; });
        btn.textContent = "Opening share…";
        await shareBlob(blob, `${name}.${/mp4/.test(blob.type) ? "mp4" : "webm"}`);
        $("#recapMsg").textContent = "Video ready. Pick where to send it.";
      } catch (err) {
        const pic = await r.still();
        await shareBlob(pic, `${name}.jpg`).catch(() => {});
        $("#recapMsg").textContent = "Video saving isn't available on this phone, so here's a picture of your trip instead.";
      }
      btn.disabled = false; $("#recapPlay").disabled = false; btn.textContent = "⬇️ Save / share";
    });
  }
  async function shareBlob(blob, name) {
    const nativeShare = window.webkit?.messageHandlers?.shareFile;
    if (nativeShare) {
      // send the file across in 1.5 MB pieces so a long trip video doesn't choke the bridge
      const toB64 = (part) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(part); });
      const id = Date.now().toString(36), CH = 1536 * 1024;
      nativeShare.postMessage({ op: "begin", id, name, mime: blob.type });
      for (let off = 0; off < blob.size; off += CH) nativeShare.postMessage({ op: "chunk", id, b64: await toB64(blob.slice(off, off + CH)) });
      nativeShare.postMessage({ op: "end", id });
      return;
    }
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "My trip" }).catch(() => {}); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ================================================================ phone signal at camps
  const CARRIERS = [["telstra", "Telstra"], ["optus", "Optus"], ["vodafone", "Vodafone"], ["starlink", "Starlink"]];
  async function wireSignal(c) {
    const box = $("#signalBox"); if (!box) return;
    const sum = $("#sigSum");
    const show = (list) => {
      if (!$("#sigSum")) return;
      const by = {};
      for (const r of list) (by[r.carrier] ||= []).push(r);
      sum.innerHTML = CARRIERS.filter(([k]) => by[k]).map(([k, n]) => { const r = by[k]; const avg = r.reduce((a, x) => a + x.bars, 0) / r.length; return `<span class="sig ${avg >= 2.5 ? "good" : avg >= 1 ? "ok" : "none"}">${n}: ${avg >= 2.5 ? "good" : avg >= 1 ? "weak" : "none"} <small>(${r.length})</small></span>`; }).join("") || `<span class="help">No signal reports yet.</span>`;
    };
    if (window.CFCloud?.enabled) window.CFCloud.signalFor(c.id).then(show).catch(() => {}); else show([]);
    let carrier = null;
    box.addEventListener("click", async (e) => {
      const cb = e.target.closest("[data-carrier]"), bb = e.target.closest("[data-bars]");
      if (cb) { carrier = cb.dataset.carrier; box.querySelectorAll("[data-carrier]").forEach((x) => x.classList.toggle("is-on", x === cb)); $("#sigBars").hidden = false; return; }
      if (bb && carrier) {
        if (!window.CFCloud?.enabled) return toast("Signal reports are coming soon");
        if (!window.CFCloud.signedIn()) { toast("Sign in (free) to report signal"); return goSignIn(); }
        try { await window.CFCloud.reportSignal(c.id, carrier, +bb.dataset.bars); toast("Thanks, that helps other travellers"); window.CFCloud.signalFor(c.id).then(show); $("#sigBars").hidden = true; }
        catch { toast("Couldn't send that. Try again with signal."); }
      }
    });
  }

  // ================================================================ Camp tonight
  function sunTimes(lat, lon, date = new Date()) { // NOAA approximation, returns local Date for sunset
    const rad = Math.PI / 180, day = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 864e5);
    const g = 2 * Math.PI / 365 * (day - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
    const setUTC = 720 - 4 * (lon - ha) - eq; // minutes from UTC midnight
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); // the local day you asked about
    return new Date(d.getTime() + setUTC * 60000);
  }
  async function campTonight() {
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Camp tonight</h2><p class="msg"><span class="spinner"></span>Finding you and the best camps nearby</p></div>`);
    const go = async (pt) => {
      await campDB.ready();
      const bb = [pt.lat - 0.8, pt.lon - 0.8, pt.lat + 0.8, pt.lon + 0.8];
      const res = campDB.inArea(bb, 0.1);
      const local = userCampsIn(bb);
      let list = mergeSources(res.camps, local, res.ramps, res.dumps)
        .filter((c) => !c.closed && rigOK(c, prefs.rig) && (!settings.dog || (c.a.dogs !== false && !c.park)));
      const onTrip = journey && plan ? project(plan.line, pt).along : null;
      list.forEach((c) => {
        c._d = hav([pt.lat, pt.lon], [c.lat, c.lon]);
        c._ahead = onTrip != null ? (() => { const pr = project(plan.line, c); return pr.off < 15000 && pr.along > onTrip - 2000; })() : true;
      });
      list = list.filter((c) => c._d <= 80000);
      const rank = (c) => score(c, prefs.wants || [], "cheap") + (ratingCache.get(c.id)?.avg || 0) * 6 - c._d / 2500 + (c._ahead ? 12 : 0) + (c.source === "rest" ? -10 : 0);
      list.sort((a, b) => rank(b) - rank(a));
      const top = list.slice(0, 6);
      const sun = sunTimes(pt.lat, pt.lon);
      const left = (sun - Date.now()) / 60000;
      const sunTxt = left > 0 ? `Sunset ${sun.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}, about ${left >= 60 ? `${Math.floor(left / 60)} h ${Math.round(left % 60)} min` : `${Math.round(left)} min`} of daylight left` : "It's after sunset. Take it easy on the road and watch for wildlife.";
      showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Camp tonight</h2><p class="d-kind">🌅 ${esc(sunTxt)}</p>
        ${top.length ? `<ul class="tonight-list">${top.map((c, k) => `<li data-id="${esc(c.id)}">
            <div class="tl-ph" id="tlPh${k}"></div>
            <div class="tl-body"><b>${esc(c.name)}</b><small>${km(c._d)} away · about ${hrs(c._d * 1.3 / 80 * 3.6)} drive${c._ahead && onTrip != null ? " · on your route" : ""}</small>
              <div class="tl-tags">${priceTag(c)}${amenIcons(c)}</div>
              <div class="stop-actions"><a class="cta" href="${navUrl(c, "apple")}" target="_blank" rel="noopener">${icon("nav")}Go</a><button class="btn" type="button" data-tl="${esc(c.id)}">Details</button></div>
            </div></li>`).join("")}</ul>`
          : `<p class="msg">No camps found within 80 km that suit a ${esc((RIGS.find((r) => r.id === prefs.rig)?.label || "").replace("&shy;", ""))}. Caravan parks in the next town are your best bet.</p>`}
        <p class="caveat">Straight-line distance; drive times are rough. Check signs when you arrive.</p></div>`);
      $$("[data-tl]").forEach((b) => b.addEventListener("click", () => openDetail(top.find((c) => c.id === b.dataset.tl))));
      top.slice(0, 4).forEach(async (c, k) => {
        let src = c.photo || "";
        if (!src) { try { src = (await soon(googlePhotos(c, 1), 8000, []))[0]?.src || ""; } catch {} }
        const el = $(`#tlPh${k}`); if (el && src) el.innerHTML = `<img src="${esc(src)}" alt="">`;
      });
    };
    if (me) go(me); else locate(go);
  }
  $("#tonightBtn").addEventListener("click", campTonight);

  // ================================================================ voice search
  const nativeSpeech = window.webkit?.messageHandlers?.speech;
  const WebSR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let webRec = null;
  if (!nativeSpeech && !WebSR) $("#micBtn").hidden = true;
  let listening = false, safety = null;
  function voiceUI(on) {
    const box = $("#voiceInline");
    listening = on; clearTimeout(safety);
    box.hidden = !on; box.classList.remove("done"); box.classList.toggle("is-listening", on); box.style.setProperty("--lvl", 0);
    $("#micBtn").classList.toggle("is-on", on);
    // while listening: a big Search button you can tap as soon as you've finished talking
    $("#vcActions").hidden = !on; $("#vcSearch").hidden = !on; $("#vcGo").hidden = true; $("#vcAgain").hidden = true;
    if (on) {
      $("#vcHint").innerHTML = 'Listening… say <b>"Bundaberg to Cairns"</b>, then tap <b>Search</b>';
      setView("plan");
      if (!$("#results").hidden) { $("#results").hidden = true; $("#planForm").hidden = false; }
      if (sheet.classList.contains("is-peek")) setSheet("half");
      $("#sheetScroll").scrollTop = 0;
      $("#vcText").textContent = ""; $("#vcHint").hidden = false;
    }
  }
  async function useVoice(text) {
    const t = text.trim().replace(/[.?!]$/, "");
    if (!t) return;
    voiceUI(false);
    if (/camp(site)? (tonight|near (me|here))|where can i (camp|stay)|somewhere to (camp|stay)/i.test(t)) { setView("plan"); return campTonight(); }
    if (/^(need|find|where'?s?( is)?( the)?( nearest)?)\s.*(water|tap)/i.test(t) || /\bwater\b/i.test(t) && t.split(" ").length <= 3) return showNeeds("water");
    if (/dump/i.test(t)) return showNeeds("dump");
    if (/\b(fuel|petrol|diesel|servo)\b/i.test(t)) return showNeeds("fuel");
    let m = /^(?:(?:take me|drive|go|i'?m going|we'?re going|plan(?: a trip)?)\s+)?(?:from\s+)?(.+?)\s+to\s+(.+)$/i.exec(t);
    let fromQ = m ? m[1] : "", toQ = m ? m[2] : t.replace(/^(take me|drive|go|i'?m going|we'?re going|plan a trip|plan)\s+(to\s+)?/i, "");
    if (/^(here|my location|where i am)$/i.test(fromQ)) fromQ = "";
    setView("plan"); if (!$("#results").hidden) { $("#results").hidden = true; $("#planForm").hidden = false; }
    const fill = async (input, q) => {
      const r = await searchPlaces(q).catch(() => []);
      if (!r.length) { toast(`Couldn't find "${q}"`); return false; }
      input.value = r[0].area ? `${r[0].name}, ${r[0].area.split(", ").pop()}` : r[0].name;
      input.dataset.lat = r[0].lat; input.dataset.lon = r[0].lon; return true;
    };
    viaStops = []; seeIds.clear(); renderVia();
    const okTo = await fill($("#to"), toQ);
    let okFrom = true;
    if (fromQ) okFrom = await fill($("#from"), fromQ);
    else if (!$("#from").dataset.lat) {
      const f = $("#from");
      const here = me || await new Promise((res) => { locate((p) => res(p)); setTimeout(() => res(null), 12000); });
      if (here) { f.value = myPlaceName(here); f.dataset.lat = here.lat; f.dataset.lon = here.lon; $("#useHere").hidden = true; }
      else { voiceResult("I couldn't find where you are. Say where you're starting from too, like \"Bundaberg to Cairns\".", false); return; }
    }
    if (okTo && okFrom) {
      // show what we heard with a big Go button
      const fromName = $("#from").dataset.lat ? short($("#from").value) : "your location";
      voiceResult(`${esc(fromName)} → ${esc(short($("#to").value))}`, true);
    } else voiceResult("I couldn't find that place. Try again, or type it in.", false);
  }
  function voiceResult(html, canGo) {
    listening = false; clearTimeout(safety); clearTimeout(voiceTimer);
    const box = $("#voiceInline"); box.hidden = false; box.classList.add("done"); box.classList.remove("is-listening");
    $("#vcHint").hidden = false; $("#vcHint").innerHTML = canGo ? "Got it:" : "Hmm…";
    $("#vcText").innerHTML = html;
    $("#vcActions").hidden = false; $("#vcSearch").hidden = true; $("#vcGo").hidden = !canGo; $("#vcAgain").hidden = false;
    $("#micBtn").classList.remove("is-on");
  }
  let voiceTimer, heard = "";
  // Stop listening and search with whatever has been heard so far
  function finishVoice() {
    if (!listening) return;
    clearTimeout(voiceTimer);
    if (nativeSpeech) {
      nativeSpeech.postMessage({ cmd: "finish" });
      // if the phone doesn't answer quickly, use what we've already shown
      safety = setTimeout(() => window.__cfSpeech({ text: heard, final: true }), 1500);
    } else { try { webRec?.stop(); } catch {} window.__cfSpeech({ text: heard, final: true }); }
  }
  window.__cfSpeechLevel = (v) => { if (listening) $("#voiceInline").style.setProperty("--lvl", v); };
  window.__cfSpeech = (r) => {
    if (!listening) return;
    clearTimeout(voiceTimer);
    if (r.text) heard = r.text;
    if (r.final) {
      listening = false; clearTimeout(safety);
      const text = r.text || heard;
      if (!text) return voiceResult(esc(r.error || "I didn't hear anything. Tap Try again, or type it in."), false);
      $("#voiceInline").classList.remove("is-listening");
      $("#vcActions").hidden = true;
      $("#vcHint").hidden = false; $("#vcHint").textContent = "Searching…";
      $("#vcText").innerHTML = `${esc(text)} <span class="spinner"></span>`;
      useVoice(text).catch(() => voiceResult("Something went wrong. Try again, or type it in.", false));
      return;
    }
    if (r.error && !heard) return voiceResult(esc(r.error), false);
    $("#vcHint").textContent = "I heard:";
    $("#vcText").textContent = heard;
    // finished talking? search automatically after a short pause
    if (heard) voiceTimer = setTimeout(finishVoice, 2200);
  };
  function startVoice() {
    heard = ""; try { webRec?.abort(); } catch {}
    voiceUI(true);
    // never leave someone staring at "Listening…" forever
    safety = setTimeout(() => { if (listening && !heard) { nativeSpeech?.postMessage({ cmd: "stop" }); voiceResult("I didn't hear anything. Check the microphone is allowed, then tap Try again, or type it in.", false); } }, 12000);
    if (nativeSpeech) return nativeSpeech.postMessage({ cmd: "start" });
    try {
      webRec = new WebSR(); webRec.lang = "en-AU"; webRec.interimResults = true;
      webRec.onresult = (e) => { const r = e.results[e.results.length - 1]; window.__cfSpeech({ text: [...e.results].map((x) => x[0].transcript).join(" "), final: r.isFinal }); };
      webRec.onerror = () => window.__cfSpeech({ text: "", final: true, error: "Didn't catch that. Try again, or type it in." });
      webRec.onend = () => { if (listening) window.__cfSpeech({ text: heard, final: true }); };
      webRec.start();
    } catch { voiceUI(false); toast("Voice search isn't available on this device"); }
  }
  $("#micBtn").addEventListener("click", () => (listening ? finishVoice() : startVoice()));
  $("#vcSearch").addEventListener("click", finishVoice);
  $("#vcGo").addEventListener("click", () => { voiceUI(false); $("#planForm").requestSubmit ? $("#planForm").requestSubmit() : $("#findBtn").click(); });
  $("#vcAgain").addEventListener("click", startVoice);
  $("#vcCancel").addEventListener("click", () => { voiceUI(false); nativeSpeech?.postMessage({ cmd: "stop" }); try { webRec?.abort(); } catch {} });

  // ================================================================ Discover: ready-made trips
  let viaStops = [];
  function renderVia() {
    const row = $("#viaRow");
    row.hidden = !viaStops.length;
    row.innerHTML = viaStops.length ? `<span class="help">Via</span>${viaStops.map((v, k) => `<span class="via-chip">${esc(v.name)}${v.leg === "back" ? " <small>(back)</small>" : ""}</span>`).join("")}<button type="button" class="via-clear" id="viaClear" aria-label="Remove stops">✕</button>` : "";
    $("#viaClear")?.addEventListener("click", () => { viaStops = []; seeIds.clear(); renderVia(); });
  }
  function renderDiscover() {
    const T = window.CF_TRIPS || [];
    $("#tripGrid").innerHTML = T.map((t) => `<button type="button" class="trip-card" data-trip="${t.id}" style="--a:${t.art[0]};--b:${t.art[1]}">
        <span class="tc-art"><span class="tc-emoji">${t.emoji}</span><span class="tc-km">${t.km.toLocaleString("en-AU")} km</span></span>
        <span class="tc-body"><b>${esc(t.name)}</b><small>${esc(t.tagline)}</small><span class="tc-meta">${t.nights} night${t.nights > 1 ? "s" : ""} · ${esc(t.road)}</span></span>
      </button>`).join("");
  }
  $("#tripGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-trip]"); if (b) openTrip(b.dataset.trip); });
  function openTrip(id) {
    const t = (window.CF_TRIPS || []).find((x) => x.id === id); if (!t) return;
    tripLayer.clearLayers(); legLayer.clearLayers();
    const pts = t.stops.map((s) => [s.lat, s.lon]);
    const pl = L.polyline(pts, { color: "#D9A400", weight: 5, dashArray: "6 8" }).addTo(legLayer);
    t.stops.forEach((s) => L.circleMarker([s.lat, s.lon], { radius: 6, color: "#fff", weight: 2.5, fillColor: "#0E5A3E", fillOpacity: 1 }).addTo(legLayer));
    map.fitBounds(pl.getBounds(), fitPad());
    showDetail(`<div class="trip-hero" style="--a:${t.art[0]};--b:${t.art[1]}"><span>${t.emoji}</span></div><div class="d-pad">
      <h2 class="d-title">${esc(t.name)}</h2><p class="d-kind">${esc(t.tagline)}</p>
      <div class="dir-sum"><div><b>${t.km.toLocaleString("en-AU")} km</b><span>roughly</span></div><div><b>${t.nights}</b><span>nights suggested</span></div></div>
      <div class="trip-start">
        <h3 class="h2">Where are you starting from?</h3>
        <div class="ts-seg" role="radiogroup" aria-label="Starting point">
          <button type="button" role="radio" data-start="me">📍 My location</button>
          <button type="button" role="radio" data-start="town">🏠 A town</button>
          <button type="button" role="radio" data-start="trip">Start in ${esc(t.stops[0].name)}</button>
        </div>
        <input class="ts-town" id="tsTown" type="text" placeholder="Type your town, e.g. Bundaberg" autocomplete="off" hidden>
        <label class="ts-home"><input type="checkbox" id="tsHome"> Drive back home at the end</label>
        <p class="help" id="tsNote"></p>
      </div>
      <button class="cta" type="button" id="planTrip" style="width:100%;margin:12px 0">${icon("route")}Plan this trip</button>
      <dl class="facts"><div><dt>Best time</dt><dd>${esc(t.season)}</dd></div><div><dt>Roads</dt><dd>${esc(t.road)}</dd></div><div><dt>Route</dt><dd>${t.stops.map((s) => esc(s.name)).join(" → ")}</dd></div></dl>
      <h3 class="h2">Highlights</h3><ul class="trip-hl">${t.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
      <div class="notice"><b>Good to know</b><span>${esc(t.tips)}</span></div>
      ${t.guide ? `<button class="btn line" type="button" id="tripGuide">Open the ${esc(t.name)} guide</button>` : ""}
    </div>`);
    $("#tripGuide")?.addEventListener("click", () => openGuide(guideById(t.guide)));
    // Starting point: your location, your home town, or the trip's own start
    const first = t.stops[0], last = t.stops.at(-1);
    const loop = hav([first.lat, first.lon], [last.lat, last.lon]) < 30000;
    let startMode = store.get("cf-trip-start", null) || (me ? "me" : "town");
    const town = $("#tsTown"); town.value = store.get("cf-home-town", "");
    const pick = (mode) => {
      startMode = mode;
      $$(".ts-seg [data-start]").forEach((b) => b.setAttribute("aria-checked", b.dataset.start === mode));
      town.hidden = mode !== "town";
      $(".ts-home").hidden = mode === "trip" || loop;
      $("#tsNote").textContent = mode === "trip" ? `The plan starts in ${first.name}.` : loop ? `It's a round trip, so the plan starts and finishes at ${mode === "me" ? "where you are" : "your town"}.` : `The plan includes the drive from ${mode === "me" ? "where you are" : "your town"} to ${first.name}.`;
      if (mode === "town" && !town.value) setTimeout(() => town.focus(), 50);
    };
    $$(".ts-seg [data-start]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.start)));
    pick(startMode);
    $("#planTrip").addEventListener("click", async () => {
      const btn = $("#planTrip");
      const set = (el, s) => { el.value = s.name; el.dataset.lat = s.lat; el.dataset.lon = s.lon; };
      let start = null; // where the person actually sets off from
      if (startMode === "me") {
        btn.disabled = true; btn.textContent = "Finding you…";
        start = me ? { name: "My location", lat: me.lat, lon: me.lon } : await new Promise((res) => { locate((p) => res({ name: "My location", lat: p.lat, lon: p.lon })); setTimeout(() => res(null), 13000); });
        btn.disabled = false; btn.innerHTML = `${icon("route")}Plan this trip`;
        if (!start) { toast("Couldn't find your location. Pick “A town” instead."); return; }
      } else if (startMode === "town") {
        const q = town.value.trim();
        if (!q) { town.focus(); toast("Type the town you're leaving from"); return; }
        btn.disabled = true; btn.textContent = "Finding your town…";
        const r = await searchPlaces(q).catch(() => []);
        btn.disabled = false; btn.innerHTML = `${icon("route")}Plan this trip`;
        if (!r.length) { toast(`Couldn't find "${q}"`); return; }
        start = { name: r[0].area ? `${r[0].name}, ${r[0].area.split(", ").pop()}` : r[0].name, lat: r[0].lat, lon: r[0].lon };
        store.set("cf-home-town", q);
      }
      store.set("cf-trip-start", startMode);
      let stops = t.stops.slice();
      let extraKm = 0;
      if (start) {
        const d = (a, b) => hav([a.lat, a.lon], [b.lat, b.lon]);
        const near = d(start, first) < 30000;
        if (loop) {
          // a round trip: join the loop at the point nearest home and go all the way round back home
          const L = t.stops.slice(0, -1), n = L.length;
          let best = 0, cost = Infinity;
          for (let i = 0; i < n; i++) { const a = L[i], b = L[(i + 1) % n], c = d(a, start) + d(start, b) - d(a, b); if (c < cost) { cost = c; best = i; } }
          const ring = [...L.slice(best + 1), ...L.slice(0, best + 1)].filter((s) => d(s, start) >= 30000);
          stops = [start, ...ring, start];
          extraKm = cost / 1000 * 1.25;
        } else {
          extraKm = near ? 0 : d(start, first) / 1000 * 1.25;
          stops = near ? [start, ...stops.slice(1)] : [start, ...stops];
          if ($("#tsHome").checked) { stops.push(start); extraKm += d(last, start) / 1000 * 1.25; }
        }
      }
      set($("#from"), stops[0]); set($("#to"), stops.at(-1));
      viaStops = stops.slice(1, -1); renderVia();
      setNights(t.nights + Math.round(extraKm / 450));
      closeDetail(); setView("plan");
      $("#results").hidden = true; $("#planForm").hidden = false;
      $("#planForm").requestSubmit ? $("#planForm").requestSubmit() : $("#findBtn").click();
    });
  }
  renderDiscover();
  paintCars();
  setTimeout(() => updateBadges(false), 1500);
  ["#from", "#to"].forEach((sel) => $(sel).addEventListener("input", () => { seeIds.clear(); if (viaStops.length) { viaStops = []; renderVia(); } }));
  $("#tripType").addEventListener("change", () => { seeIds.clear(); if (viaStops.some((v) => v.poi)) { viaStops = viaStops.filter((v) => !v.poi); renderVia(); } });

  // ================================================================ first-time sign in
  // shows every time the app opens until you're signed in (Skip just closes it for now)
  async function showLogin() {
    const C = window.CFCloud;
    if (C?.enabled && C.whenReady) await Promise.race([C.whenReady(), sleep(2500)]);
    return new Promise((resolve) => {
      const w = $("#login");
      if (!C?.enabled || C.signedIn()) return resolve();
      w.hidden = false; w.classList.remove("out");
      const msg = $("#lgMsg");
      const finish = async (signedIn) => {
        w.classList.add("out"); await sleep(animOn() ? 560 : 0); w.hidden = true;
        if (signedIn) { await afterSignIn(); toast("You're signed in. Welcome!"); }
        resolve();
      };
      $("#lgSend").onclick = async () => {
        const email = $("#lgEmail").value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "Enter your email address"; return; }
        $("#lgSend").disabled = true; msg.innerHTML = `<span class="spinner"></span>Sending`;
        try {
          await C.sendCode(email);
          msg.textContent = ""; $("#lgStep1").hidden = true; $("#lgStep2").hidden = false;
          $("#lgSent").innerHTML = `We've sent a sign-in link to <b>${esc(email)}</b>. Open it on this phone and tap <b>Log In</b>.`;
        } catch (e) { msg.textContent = /rate|seconds/i.test(e.message) ? "Too many emails just now. Wait a minute and try again." : "Couldn't send the email. Check your signal and try again."; }
        finally { $("#lgSend").disabled = false; }
      };
      $("#lgVerify").onclick = async () => {
        try { await C.verifyCode($("#lgEmail").value.trim(), $("#lgCode").value.trim()); finish(true); }
        catch { msg.textContent = "That code didn't work. Check it, or send a new link."; }
      };
      $("#lgBack").onclick = () => { $("#lgStep2").hidden = true; $("#lgStep1").hidden = false; msg.textContent = ""; };
      $("#lgSkip").onclick = () => finish(false);
      $("#lgTerms").onclick = () => { w.hidden = true; openLegal("terms"); const back = () => { w.hidden = false; $("#detailClose").removeEventListener("click", back); }; $("#detailClose").addEventListener("click", back); };
      $("#lgPrivacy").onclick = () => { w.hidden = true; openLegal("privacy"); const back = () => { w.hidden = false; $("#detailClose").removeEventListener("click", back); }; $("#detailClose").addEventListener("click", back); };
      // tapping the email link while this screen is open
      window.addEventListener("cf-auth-link", (e) => { if (!w.hidden && e.detail.ok) finish(true); });
    });
  }

  // ================================================================ offline hub
  async function offlineSummary() {
    let packs = [];
    try { packs = await idb.all(); } catch {}
    const info = campDB.info();
    return { packs, info, trips: packs.filter((p) => p.type === "trip").length, areas: packs.filter((p) => p.type === "area").length };
  }
  async function refreshOfflinePill() {
    const s = await offlineSummary();
    $("#offlinePill").classList.toggle("ready", s.packs.length > 0);
    $("#offlinePill span").textContent = s.packs.length ? `Offline · ${s.packs.length}` : "Offline";
    if ($("#stOffline")) $("#stOffline").textContent = `${s.info ? `${s.info.count.toLocaleString("en-AU")} camps are always saved on your phone. ` : ""}${s.trips} trip${s.trips === 1 ? "" : "s"} and ${s.areas} area${s.areas === 1 ? "" : "s"} downloaded.`;
  }
  async function openOffline() {
    const s = await offlineSummary();
    const built = s.info ? new Date(s.info.built).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Offline use</h2><p class="d-kind">Get ready before you lose signal</p>
      <div class="off-status">
        <div><span class="ok">✅</span><span><b>${s.info ? s.info.count.toLocaleString("en-AU") : "All"} camps across Australia</b><small>Always on your phone, with fuel, water and dump points. Updated ${esc(built)}.</small></span></div>
        <div><span class="ok">${s.trips ? "✅" : "⬜"}</span><span><b>${s.trips ? `${s.trips} trip${s.trips > 1 ? "s" : ""} downloaded` : "No trips downloaded yet"}</b><small>A downloaded trip keeps your route, turn-by-turn directions, camps and fuel stops.</small></span></div>
        <div><span class="ok">${s.areas ? "✅" : "⬜"}</span><span><b>${s.areas ? `${s.areas} area${s.areas > 1 ? "s" : ""} downloaded` : "No areas downloaded yet"}</b><small>Every camp in the part of the map you choose, with its details.</small></span></div>
      </div>
      <div class="off-actions">
        ${plan ? `<button class="cta" type="button" id="offTrip">${icon("download")}Download this trip: ${esc(short(plan.from.name))} to ${esc(short(plan.to.name))}</button>` : `<p class="help">Plan a trip first, then come back here to download it.</p>`}
        <button class="btn" type="button" id="offArea">${icon("download")}Download the area on the map</button>
      </div>
      <h3 class="h2">Your downloads</h3>
      <ul class="list" id="offList"></ul>
      <p class="caveat">Without signal the map background shows only places you've already looked at, and Google photos need signal. Camp details, directions you've downloaded and your journey recording all work offline.</p>
    </div>`);
    const list = $("#offList");
    const packs = s.packs.sort((a, b) => b.created.localeCompare(a.created));
    list.innerHTML = packs.length ? packs.map((p) => `<li class="trip-item"><b>${esc(p.name)}</b><span class="help">${p.type === "trip" ? "Trip" : "Area"} · ${p.camps.length} camps · ${sizeOf(p)}</span><span class="row">${p.type === "trip" ? `<button class="btn" data-open-pack="${esc(p.id)}" type="button">Open</button>` : `<button class="btn" data-show-pack="${esc(p.id)}" type="button">Show</button>`}<button class="icon-btn" data-del-pack="${esc(p.id)}" type="button" aria-label="Delete download">${icon("close")}</button></span></li>`).join("") : `<li class="empty">Nothing downloaded yet.</li>`;
    list.addEventListener("click", (e) => { const b = e.target.closest("[data-open-pack],[data-show-pack],[data-del-pack]"); if (!b) return; const ul = $("#offlinePacks"); ul.innerHTML = list.innerHTML; ul.querySelector(`[${[...b.attributes].find((a) => a.name.startsWith("data-")).name}="${CSS.escape(Object.values(b.dataset)[0])}"]`)?.click(); setTimeout(() => { refreshOfflinePill(); if (!$("#detail").hidden && $("#offList")) openOffline(); }, 300); });
    $("#offTrip")?.addEventListener("click", async (e) => { e.currentTarget.disabled = true; e.currentTarget.innerHTML = `<span class="spinner"></span>Downloading directions and camps`; await saveTripOffline(); refreshOfflinePill(); openOffline(); });
    $("#offArea").addEventListener("click", async () => {
      closeDetail();
      if (map.getZoom() < CFG.exploreMinZoom) { setView("explore"); toast("Zoom in on the area you want, then tap Download area", 4000); return; }
      setView("explore"); await loadExplore(); await saveAreaOffline(); refreshOfflinePill();
    });
  }
  $("#offlinePill").addEventListener("click", openOffline);
  $("#stOfflineOpen").addEventListener("click", openOffline);
  refreshOfflinePill();

  function openHelp() {
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">How to use Camp Finder</h2><p class="d-kind">Four easy steps</p>
      <ol class="help-list">
        <li><div><b>Type where you're starting and where you're going</b>Start typing a town and tap it in the list. Or tap "Use my location".</div></li>
        <li><div><b>Choose how many nights, and what you're travelling with</b>Tent, caravan, motorhome and so on. We only pick camps that suit it.</div></li>
        <li><div><b>Tap the big yellow "Find camps" button</b>You'll get one camp for each night, with photos, toilets, water and the price.</div></li>
        <li><div><b>Tap "Start journey" when you leave</b>Then use the big buttons at the top for water, a dump point or to share where you are with family.</div></li>
      </ol>
      <p class="help" style="margin-top:14px">Tap any camp to see photos and get directions. The ⚙️ Settings tab lets you make the text bigger with Simple mode.</p>
      <button class="cta" type="button" id="helpMode" style="width:100%;margin-top:12px">${settings.simple ? "Switch to Full mode" : "Switch to Simple mode (bigger and easier)"}</button>
    </div>`);
    $("#helpMode").addEventListener("click", () => { settings.simple = !settings.simple; saveSettings(); applyMode(); closeDetail(); toast(settings.simple ? "Simple mode on" : "Full mode on"); });
  }
  $("#helpBtn").addEventListener("click", openHelp);

  // ---- Send feedback (goes to the feedback table in Supabase, with what phone and app it came from)
  const FB_KINDS = [["bug", "🐞 Something's broken"], ["camp", "🏕️ Camp info is wrong"], ["idea", "💡 Idea"], ["other", "💬 Other"]];
  function openFeedback(kind = "bug", prefill = "") {
    const C = window.CFCloud;
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">Send feedback</h2><p class="d-kind">It goes straight to the person who builds Camp Finder.</p>
      <form id="fbForm" class="fb-form">
        <div class="fb-kinds" role="radiogroup" aria-label="What is it about?">${FB_KINDS.map(([k, l]) => `<label class="pill"><input type="radio" name="fbk" value="${k}" ${k === kind ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <label class="sr" for="fbText">Your feedback</label>
        <textarea id="fbText" rows="6" maxlength="4000" required placeholder="What happened, or what would make the app better?">${esc(prefill)}</textarea>
        <label class="field-lab" for="fbContact">Email, if you'd like a reply (optional)</label>
        <input id="fbContact" type="email" autocomplete="email" maxlength="200" value="${esc(C?.email?.() || "")}">
        <p class="help">We'll also send your app version, phone type and settings (no location) to help fix things.</p>
        <button class="cta" type="submit" style="width:100%">Send</button>
        <p class="msg" id="fbMsg" role="status"></p>
      </form></div>`);
    $("#fbForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#fbText").value.trim(); if (!text) return;
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
      const device = { ua: navigator.userAgent.slice(0, 300), screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, native: !!window.webkit?.messageHandlers?.journey, simple: !!settings.simple, rig: prefs.rig, car: [settings.make, settings.model].filter(Boolean).join(" "), online: navigator.onLine, view, trip: plan ? `${short(plan.from.name)} to ${short(plan.to.name)}` : "", data: campDB.info()?.built || "", lang: navigator.language };
      try {
        if (!C?.enabled || !C.sendFeedback) throw new Error("off");
        await C.sendFeedback(text, $("#fbContact").value.trim(), $("input[name=fbk]:checked")?.value || "other", device);
        closeDetail(); toast("Thanks! Feedback sent 🙌");
      } catch {
        // no signal: fall back to an email
        const body = `${text}\n\n---\n${Object.entries(device).map(([k, v]) => `${k}: ${v}`).join("\n")}`;
        $("#fbMsg").innerHTML = `Couldn't send right now. <a href="mailto:hello@gonelappin.au?subject=${encodeURIComponent("Camp Finder feedback")}&body=${encodeURIComponent(body)}">Email it instead</a>.`;
        btn.disabled = false; btn.textContent = "Try again";
      }
    });
  }

  function openLegal(kind) {
    const L = window.CF_LEGAL; if (!L) return;
    const html = (L[kind] || "").replaceAll("{contact}", esc(L.contact));
    showDetail(`<div class="d-pad legal" style="padding-top:22px"><h2 class="d-title">${kind === "terms" ? "Terms and conditions" : "Privacy policy"}</h2><p class="d-kind">Last updated ${esc(L.updated)}</p>${html}</div>`);
  }

  // ---- settings screen
  function fillMakes(sel, make) {
    sel.innerHTML = `<option value="">Choose make</option>` + Object.keys(VEH).map((m) => `<option ${m === make ? "selected" : ""}>${esc(m)}</option>`).join("");
  }
  function fillModels(sel, make, model) {
    const list = VEH[make] || [];
    sel.innerHTML = list.length ? list.map(([n]) => `<option ${n === model ? "selected" : ""}>${esc(n)}</option>`).join("") : `<option value="">Model</option>`;
    sel.disabled = !list.length;
  }
  function pickVehicle(make, model) {
    const v = (VEH[make] || []).find((x) => x[0] === model) || (VEH[make] || [])[0];
    settings.make = make; settings.model = v ? v[0] : "";
    if (v) { settings.fuel = v[1]; settings.use = v[2]; settings.tank = v[3]; }
    saveSettings(); paintCars();
  }
  function renderSettings() {
    fillMakes($("#stMake"), settings.make); fillModels($("#stModel"), settings.make, settings.model);
    $("#stFuel").value = settings.fuel; $("#stUse").value = settings.use; $("#stTank").value = settings.tank;
    $("#stPrice").value = settings.prices[settings.fuel]; $("#stTow").value = settings.tow; $("#stTowOut").textContent = `+${settings.tow}%`;
    $("#stCamp").value = settings.campUnknown; $("#stDaily").value = settings.daily || ""; $("#stMaxKm").value = settings.maxKm;
    $("#stHeight").value = settings.height || RIG_HEIGHT[prefs.rig] || ""; $("#stLength").value = settings.length || "";
    $("#stDog").checked = !!settings.dog; $("#stCampAlerts").checked = !!settings.campAlerts;
    $("#stWelcomeEvery").checked = !!settings.welcomeAlways;
    const mp = $(`#modePick input[value="${settings.simple ? "simple" : "full"}"]`); if (mp) mp.checked = true; $("#stAnim").checked = settings.anim; $("#stFollow").checked = settings.follow; $("#stSat").checked = settings.sat;
    const C = window.CFCloud;
    $("#stAccount").textContent = !C?.enabled ? "Accounts aren't switched on in this version." : C.signedIn() ? `Signed in as ${C.email()}.` : "Not signed in. Sign in to rate camps, post photos and keep your trips on every device.";
    const info = campDB.info();
    $("#stData").textContent = info ? `Camp database: ${info.count.toLocaleString("en-AU")} camps, updated ${new Date(info.built).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}. Updates download automatically each week.` : "";
    $("#stPrices").textContent = `Price guide for camps and stays updated ${PRICES.updated || "regularly"}. Fuel prices come live from the state government price schemes and Google Maps where available.`;
    renderVehicleSummary();
  }
  function renderVehicleSummary() {
    const per100 = settings.use * (settings.prices[settings.fuel] || 0);
    const rng = rangeKm("tent"), rngTow = rangeKm("caravan");
    $("#stSummary").innerHTML = `<div><b>${money(per100)}</b><span>per 100 km</span></div><div><b>${isFinite(rng) ? Math.round(rng).toLocaleString("en-AU") + " km" : "—"}</b><span>range</span></div><div><b>${isFinite(rngTow) ? Math.round(rngTow).toLocaleString("en-AU") + " km" : "—"}</b><span>range towing</span></div>`;
  }
  (() => {
    const num = (id, key, min, max) => $(id).addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) settings[key] = Math.max(min, Math.min(max, v)); saveSettings(); renderVehicleSummary(); });
    $("#stMake").addEventListener("change", (e) => { pickVehicle(e.target.value, ""); renderSettings(); toast(settings.model ? `${settings.model}: ${settings.use} L/100 km` : "Vehicle cleared"); });
    $("#stModel").addEventListener("change", (e) => { pickVehicle(settings.make, e.target.value); renderSettings(); });
    $("#stFuel").addEventListener("change", (e) => { settings.fuel = e.target.value; saveSettings(); renderSettings(); });
    num("#stUse", "use", 3, 40); num("#stTank", "tank", 20, 400);
    num("#stCamp", "campUnknown", 0, 300); num("#stDaily", "daily", 0, 2000); num("#stMaxKm", "maxKm", 100, 1500);
    $("#stPrice").addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) settings.prices[settings.fuel] = Math.min(5, v); saveSettings(); renderVehicleSummary(); });
    $("#stTow").addEventListener("input", (e) => { settings.tow = +e.target.value; $("#stTowOut").textContent = `+${settings.tow}%`; saveSettings(); renderVehicleSummary(); });
    $("#stAnim").addEventListener("change", (e) => { settings.anim = e.target.checked; saveSettings(); applyMotion(); });
    $("#stFollow").addEventListener("change", (e) => { settings.follow = e.target.checked; saveSettings(); if (settings.follow) locate(() => setFollow(true)); else setFollow(false); });
    $("#stSat").addEventListener("change", (e) => { settings.sat = e.target.checked; saveSettings(); if (settings.sat !== onSat) $("#layerBtn").click(); });
    $("#stWelcome").addEventListener("click", () => showWelcome());
    $("#modePick").addEventListener("change", (e) => { settings.simple = e.target.value === "simple"; saveSettings(); applyMode(); toast(settings.simple ? "Simple mode: bigger and easier" : "Full mode: every feature"); });
    num("#stHeight", "height", 1.5, 4.6); num("#stLength", "length", 3, 30);
    $("#stDog").addEventListener("change", (e) => { settings.dog = e.target.checked; saveSettings(); toast(settings.dog ? "Dog mode on: plan a trip to see dog-friendly camps" : "Dog mode off"); });
    $("#stCampAlerts").addEventListener("change", (e) => { settings.campAlerts = e.target.checked; saveSettings(); });
    $("#stWelcomeEvery").addEventListener("change", (e) => { settings.welcomeAlways = e.target.checked; saveSettings(); });
    $("#stGoAccount").addEventListener("click", () => setView("saved"));
    $("#stFeedback").addEventListener("click", () => openFeedback());
    $("#stFamily").addEventListener("click", () => { setView("saved"); setSeg("family"); });
    $("#stTerms").addEventListener("click", () => openLegal("terms"));
    $("#stPrivacy").addEventListener("click", () => openLegal("privacy"));
  })();
  if (settings.sat && !onSat) $("#layerBtn").click();
  if (store.get("cf-loc-ok", false)) { startTracking(); if (settings.follow) setFollow(true); }

  // ---- sliding tab indicator
  function moveInk() {
    const on = $(".tabbtn.is-on"), ink = $("#tabInk"); if (!on || !ink) return;
    const r = on.getBoundingClientRect(), pr = on.parentElement.getBoundingClientRect();
    ink.style.setProperty("--x", `${r.left - pr.left + r.width / 2 - 17}px`);
  }
  window.addEventListener("resize", moveInk); setTimeout(moveInk, 50);

  // ---- opening animation, then the welcome screens, every time the app opens
  async function playIntro(first) {
    const sp = $("#splash"); if (!sp) return;
    if (!first) { sp.classList.remove("gone", "out"); void sp.offsetWidth; sp.querySelectorAll("animateMotion").forEach((a) => a.beginElement?.()); }
    const placeHole = () => { const e = $("#spEnd")?.getBoundingClientRect(); if (e && e.width) { sp.style.setProperty("--ox", `${e.left + e.width / 2}px`); sp.style.setProperty("--oy", `${e.top + e.height / 2}px`); } };
    const started = performance.now();
    let skipped = false;
    sp.addEventListener("click", () => (skipped = true), { once: true });
    const minShow = animOn() ? 3700 : 400;
    while (!skipped && performance.now() - started < minShow) await sleep(60);
    await Promise.race([campDB.ready(), sleep(1500)]);
    placeHole(); sp.classList.add("out");
    await sleep(animOn() ? 880 : 0);
    sp.classList.add("gone");
    moveInk(); fixMapSize();
    if (first) { await showLogin(); fixMapSize(); }
    if (settings.welcomeAlways || !hasCar()) showWelcome();   // keeps coming back until you've picked your car
  }
  playIntro(true);
  // iPhones keep apps open in the background, so replay the intro when you come back after a while
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 3 * 60 * 1000 && $("#welcome").hidden) playIntro(false);
  });

  const hasCar = () => !!(settings.make && (settings.model || settings.make === "Other"));
  function showWelcome() {
    const w = $("#welcome"), track = $("#wlTrack"), slides = $$(".wl-slide", w), dots = $$("#wlDots i");
    w.classList.remove("out"); w.hidden = false; track.scrollLeft = 0;
    $("#wlRigs").innerHTML = RIGS.map((r) => `<label><input type="radio" name="wlRig" value="${r.id}" ${r.id === prefs.rig ? "checked" : ""}><span>${icon(r.id)}${r.label.replace("&shy;", "")}</span></label>`).join("");
    $("#wlRigs").onchange = (e) => {
      prefs.rig = e.target.value; store.set("cf-prefs", prefs); paintCars();
      const f = $(`input[name=rig][value="${prefs.rig}"]`); if (f) f.checked = true;
      $(".ar-rig use").setAttribute("href", `#i-${prefs.rig}`);
    };
    $(".ar-rig use").setAttribute("href", `#i-${prefs.rig}`);
    fillMakes($("#wlMake"), settings.make); fillModels($("#wlModel"), settings.make, settings.model);
    $("#wlMake").onchange = (e) => { pickVehicle(e.target.value, ""); fillModels($("#wlModel"), settings.make, settings.model); };
    $("#wlModel").onchange = (e) => pickVehicle(settings.make, e.target.value);
    const wm = $(`#wlMode input[value="${settings.simple ? "simple" : "full"}"]`); if (wm) wm.checked = true;
    $("#wlMode").onchange = (e) => { settings.simple = e.target.value === "simple"; saveSettings(); applyMode(); };
    const at = () => Math.round(track.scrollLeft / track.clientWidth);
    const mark = () => {
      const i = at();
      dots.forEach((d, k) => d.classList.toggle("on", k === i));
      $("#wlNext").textContent = i === slides.length - 1 ? "Let's go" : "Next";
      const s = slides[i];
      if (s && !s.classList.contains("seen")) {
        s.classList.add("seen");
        $$("[data-count]", s).forEach((el) => countUp(el, +el.dataset.count, (v) => Math.round(v).toLocaleString("en-AU")));
      }
    };
    slides.forEach((s) => s.classList.remove("seen"));
    track.onscroll = () => { clearTimeout(track._t); track._t = setTimeout(mark, 60); };
    setTimeout(mark, 30);
    const done = async () => {
      store.set("cf-welcomed", true);
      w.classList.add("out"); await sleep(animOn() ? 560 : 0); w.hidden = true;
      if (plan) showPlan(); else fixMapSize();
    };
    $("#wlNext").onclick = () => { const i = at(); if (i >= slides.length - 1) return done(); track.scrollTo({ left: (i + 1) * track.clientWidth, behavior: animOn() ? "smooth" : "auto" }); };
    $("#wlSkip").onclick = done;
  }

  // ---- Google rating and reviews (shown with photos when the Google key is switched on)
  function renderGoogleRating(c, place) {
    if (place?.uri && $("#learnMore")) $("#learnMore").href = place.uri;
    const box = $("#rateBox"); if (!box || !place || !place.rating || $("#gRate")) return;
    const revs = (place.reviews || []).filter((r) => r.text?.text).slice(0, 5);
    box.insertAdjacentHTML("beforeend", `<div class="g-rate" id="gRate">
      <div class="rate-sum"><span class="stars-sm">${starsHtml(place.rating)}</span><b>${place.rating.toFixed(1)}</b><span class="help">on Google · ${place.count.toLocaleString("en-AU")} review${place.count === 1 ? "" : "s"}</span></div>
      ${revs.length ? `<ul class="reviews">${revs.map((r) => `<li><div class="rv-head"><span class="stars-sm">${starsHtml(r.rating || 0)}</span><b>${esc(r.authorAttribution?.displayName || "Google user")}</b><span class="help">${esc(r.relativePublishTimeDescription || "")}</span></div><p>${esc(r.text.text.length > 420 ? r.text.text.slice(0, 420) + "…" : r.text.text)}</p></li>`).join("")}</ul>` : ""}
      <p class="g-attr">Reviews from Google${place.uri ? ` · <a href="${esc(place.uri)}" target="_blank" rel="noopener">See all on Google Maps</a>` : ""}</p>
    </div>`);
  }

  window.__cf = { campDB, settings, fuelFor, campFee, parseCoords, normalise, rigOK, has, score, stepText, makePlan, buildLine, project, sample, parseElements, enrich };
})();
