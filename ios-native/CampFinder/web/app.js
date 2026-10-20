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
    googleKey: "",
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
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
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

  function normalise(p) {
    const t = p.tags;
    let cost = "unknown";
    if (no(t.fee) || /^(free|donation)$/i.test(t.fee || "")) cost = "free";
    else if (yes(t.fee) || t.charge) cost = "paid";
    const dogs = tri(t.dog ?? t.dogs ?? t.pets);
    const fires = tri(t.openfire ?? t.fireplace ?? t.campfire);
    return {
      ...p,
      name: t.name || t["name:en"] || (t.tourism === "caravan_site" ? "Unnamed RV / caravan stop" : "Unnamed camp"),
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
  function project(line, c) {
    // nearest vertex (route geometry is dense enough for camp-scale accuracy)
    let best = Infinity, at = 0;
    const step = line.pts.length > 6000 ? 2 : 1;
    for (let i = 0; i < line.pts.length; i += step) {
      const d = hav(line.pts[i], [c.lat, c.lon]);
      if (d < best) { best = d; at = line.cum[i]; }
    }
    return { off: best, along: at };
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
  function stateOf(lat, lon) {
    if (lon > 138 && lat > (lon > 152.5 ? -28.2 : -29)) return "QLD";
    if (lon >= 129 && lon <= 138 && lat > -26) return "NT";
    if (lon < 129) return "WA";
    if (lat < -39.2 && lon > 143.5) return "TAS";
    if (lon >= 129 && lon < 141) return "SA";
    if (lat > -34.0 || lon > 150.0 || (lat > -36.0 && lon > 141)) return "NSW";
    return "VIC";
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
    return [Math.min(...la) - padDeg, Math.min(...lo) - padDeg, Math.max(...la) + padDeg, Math.max(...lo) + padDeg];
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
        if (!g) grid.set(k, (g = { camps: [], ramps: [], dumps: [] }));
        g[kind].push(item);
      };
      d.camps.forEach((c) => put("camps", c[1], c[2], c));
      (d.ramps || []).forEach((p, i) => put("ramps", p[0], p[1], { id: `ramp/${i}`, lat: p[0], lon: p[1] }));
      (d.dumps || []).forEach((p, i) => put("dumps", p[0], p[1], { id: `dump/${i}`, lat: p[0], lon: p[1] }));
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
      if (!x) norm.set(c[0], (x = normalise({ id: c[0], lat: c[1], lon: c[2], tags: c[3] || {} })));
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
    const usable = camps.filter((c) => rigOK(c, opts.rig) && !c.closed);
    const picks = [];
    const used = new Set();
    const seg = line.total / (nights + 1);
    let prevAlong = 0;
    for (let k = 1; k <= nights; k++) {
      // re-balance each night from where the last camp actually is
      const target = prevAlong + (line.total - prevAlong) / (nights - k + 2);
      const win = Math.max(25000, seg * 0.45);
      const rank = (list) => list
        .map((c) => ({ c, s: score(c, opts.wants, opts.cost) - Math.abs(c.along - target) / 1500 - c.off / 2500 }))
        .sort((a, b) => b.s - a.s).map((x) => x.c);
      const inWin = usable.filter((c) => Math.abs(c.along - target) <= win && !used.has(c.id));
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
        const wide = usable.filter((c) => !used.has(c.id) && Math.abs(c.along - target) <= seg * 0.9);
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
      if (camp) used.add(camp.id);
      prevAlong = camp ? camp.along : target;
      picks.push({ target, camp, alts: list.slice(1, 4), warn: camp ? warn : "No camps found for this night. Try a bigger detour or fewer must-haves." });
    }
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

  // ---------------------------------------------------------------- map
  const map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([-25.5, 134], 4);
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  });
  let onSat = false;
  $("#layerBtn").addEventListener("click", (e) => {
    onSat = !onSat;
    e.currentTarget.setAttribute("aria-pressed", onSat);
    e.currentTarget.setAttribute("aria-label", onSat ? "Switch to map view" : "Switch to satellite view");
    if (onSat) { map.removeLayer(street); sat.addTo(map); } else { map.removeLayer(sat); street.addTo(map); }
  });

  // The web view can report its size late on first launch: re-measure so Australia is centred.
  let userMovedMap = false;
  map.on("dragstart", () => (userMovedMap = true));
  const fixMapSize = () => {
    map.invalidateSize();
    if (!plan && !userMovedMap && view === "plan" && window.innerHeight > 200) map.fitBounds([[-43.5, 113], [-10.5, 153.6]], fitPad());
  };
  [60, 400, 1200, 2500].forEach((ms) => setTimeout(fixMapSize, ms));
  window.addEventListener("load", () => setTimeout(fixMapSize, 120));
  window.addEventListener("resize", () => setTimeout(fixMapSize, 50));
  const tripLayer = L.layerGroup().addTo(map);
  const legLayer = L.layerGroup().addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, chunkedLoading: true });
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
    const sheetH = $("#sheet").getBoundingClientRect().height || window.innerHeight * 0.6;
    return wide ? { paddingTopLeft: [450, 40], paddingBottomRight: [70, 40] } : { paddingTopLeft: [24, 70], paddingBottomRight: [70, sheetH + 70] };
  }

  let me = null;
  let following = false;
  function locate(then) {
    if (!navigator.geolocation) { toast("Location isn't available on this device"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { onPosition(pos); store.set("cf-loc-ok", true); startTracking(); then(me); },
      () => toast("Turn on location for Camp Finder in your phone's settings"),
      { enableHighAccuracy: true, timeout: 12000 }
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
  function onPosition(pos) {
    const c = pos.coords;
    me = { lat: c.latitude, lon: c.longitude };
    if (c.heading != null && c.heading >= 0 && (c.speed == null || c.speed > 1)) heading = c.heading;
    else if (lastPos && hav([lastPos.lat, lastPos.lon], [me.lat, me.lon]) > 15) heading = bearing(lastPos, me);
    if (!lastPos || hav([lastPos.lat, lastPos.lon], [me.lat, me.lon]) > 15) lastPos = me;
    const html = `<div class="me-car" style="--rot:${Math.round(heading)}deg"><span class="halo"></span>${CAR_SVG}</div>`;
    if (!meMarker) {
      meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: "me-icon", html, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: false, zIndexOffset: 2000, interactive: false }).addTo(map);
    } else {
      meMarker.setLatLng?.([me.lat, me.lon]);
      const el = meMarker.getElement?.()?.querySelector(".me-car");
      if (el) el.style.setProperty("--rot", `${Math.round(heading)}deg`);
    }
    if (following) map.panTo([me.lat, me.lon], { animate: true, duration: .8 });
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
    setTimeout(() => map.invalidateSize(), 320);
  }
  $("#sheetHandle").addEventListener("click", () => {
    setSheet(sheet.classList.contains("is-peek") ? "half" : sheet.classList.contains("is-full") ? "peek" : "full");
  });
  // drag the grabber to resize
  (() => {
    let y0 = null, h0 = 0;
    const g = $("#sheetHandle");
    g.addEventListener("pointerdown", (e) => { y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; sheet.style.transition = "none"; g.setPointerCapture(e.pointerId); });
    g.addEventListener("pointermove", (e) => { if (y0 == null) return; sheet.style.height = Math.max(140, h0 + (y0 - e.clientY)) + "px"; });
    g.addEventListener("pointerup", (e) => {
      if (y0 == null) return;
      const dy = y0 - e.clientY; y0 = null; sheet.style.transition = ""; sheet.style.height = "";
      if (Math.abs(dy) < 8) return; // treated as a tap by the click handler
      const h = h0 + dy, vh = window.innerHeight;
      setSheet(h < vh * 0.35 ? "peek" : h > vh * 0.72 ? "full" : "half");
      g.dataset.dragged = "1"; setTimeout(() => delete g.dataset.dragged, 50);
    });
    g.addEventListener("click", (e) => { if (g.dataset.dragged) e.stopImmediatePropagation(); }, true);
  })();

  let view = "plan";
  $$(".tabbtn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  function setView(v) {
    view = v;
    $$(".tabbtn").forEach((b) => { const on = b.dataset.view === v; b.classList.toggle("is-on", on); on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
    $$(".view").forEach((el) => (el.hidden = el.id !== `view-${v}`));
    closeDetail();
    $("#sheetScroll").scrollTop = 0;
    if (sheet.classList.contains("is-peek")) setSheet("half");
    if (v === "explore") { tripLayer.clearLayers(); legLayer.clearLayers(); loadExplore(); }
    else cluster.clearLayers();
    if (v === "plan" && plan) drawPlan();
    if (v === "saved") renderSaved();
    if (v === "settings") renderSettings();
    moveInk();
  }

  // ---------------------------------------------------------------- form controls
  const prefs = store.get("cf-prefs", { wants: ["toilets"], exWants: [], rig: "camper", exFree: true });
  $("#rigs").innerHTML = RIGS.map((r) => `<label class="rig"><input type="radio" name="rig" value="${r.id}" ${r.id === prefs.rig ? "checked" : ""}><span>${icon(r.id)}${r.label}</span></label>`).join("");
  $("#planWants").innerHTML = AMENITIES.map((a) => `<label><input type="checkbox" value="${a.id}" ${prefs.wants.includes(a.id) ? "checked" : ""}><span>${icon(AMEN_ICON[a.id], "ic sm")}${esc(a.label)}</span></label>`).join("");
  $("#explorePills").innerHTML =
    `<label class="pill"><input type="checkbox" id="exFree" ${prefs.exFree ? "checked" : ""}><span>Free only</span></label>` +
    AMENITIES.map((a) => `<label class="pill"><input type="checkbox" value="${a.id}" ${prefs.exWants.includes(a.id) ? "checked" : ""}><span>${icon(AMEN_ICON[a.id])}${SHORT[a.id]}</span></label>`).join("");
  const radio = (name) => $(`input[name="${name}"]:checked`)?.value;
  const wantsOf = (el) => $$("input[value]:checked", el).map((i) => i.value).filter((v) => AMENITIES.some((a) => a.id === v));
  function savePrefs() {
    Object.assign(prefs, { wants: wantsOf($("#planWants")), exWants: wantsOf($("#explorePills")), rig: radio("rig"), exFree: $("#exFree").checked });
    store.set("cf-prefs", prefs);
  }

  const nightsIn = $("#nights");
  function setNights(n) {
    n = Math.max(0, Math.min(30, n));
    nightsIn.value = n; $("#nightsOut").textContent = n;
    $("#nightsDown").disabled = n === 0; $("#nightsUp").disabled = n === 30;
    $("#nightsHelp").textContent = n === 0 ? "Straight through, no overnight stops" : `One camp for each night, ${n + 1} days of driving`;
  }
  $("#nightsDown").addEventListener("click", () => setNights(+nightsIn.value - 1));
  $("#nightsUp").addEventListener("click", () => setNights(+nightsIn.value + 1));
  setNights(6);
  $("#detourSeg").addEventListener("change", () => ($("#detourShown").textContent = (+radio("detour") / 1000) + " km"));

  $("#useHere").addEventListener("click", () => {
    const f = $("#from");
    f.value = "Finding you…";
    locate((p) => { f.value = "My location"; f.dataset.lat = p.lat; f.dataset.lon = p.lon; });
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
      const opts = { rig: radio("rig"), cost: radio("cost"), detour: +radio("detour"), wants: wantsOf($("#planWants")) };
      say("Finding places");
      const [from, to] = await Promise.all([resolvePlace($("#from")), resolvePlace($("#to"))]);
      say("Planning the route");
      const route = await osrm([from, to]);
      say("Looking for camps");
      const data = await campsAlong(route, opts.detour, (t) => say(t.replace("Searching for camps along the route… ", "Looking for camps ")));
      step(3);
      plan = makePlan({ from, to, route, nights, opts, data });
      plan.offline = data.offline;
      msg.textContent = "";
      step(4); await sleep(animOn() ? 450 : 0);
      pl.hidden = true;
      showPlan();
    } catch (err) {
      pl.hidden = true; $("#planForm").hidden = false;
      msg.className = "msg is-error";
      msg.textContent = friendly(err);
    } finally { btn.disabled = false; btn.textContent = "Find camps"; }
  });

  function nightKm(i) {
    const prevAlong = i === 0 ? 0 : (plan.picks[i - 1].camp?.along ?? plan.picks[i - 1].target);
    const here = plan.picks[i].camp?.along ?? plan.picks[i].target;
    return here - prevAlong;
  }
  const short = (s) => String(s).split(",")[0];

  function showPlan() {
    const p = plan;
    $("#planForm").hidden = true; $("#results").hidden = false;
    $("#tripTitle").textContent = `${short(p.from.name)} to ${short(p.to.name)}`;
    const days = p.nights + 1;
    $("#tripMeta").textContent = `${km(p.route.distance)} and ${hrs(p.route.duration)} of driving over ${days} day${days > 1 ? "s" : ""}`;
    const stops = [];
    stops.push(`<li class="stop"><div class="plate start" aria-hidden="true"></div><div class="stop-body"><div class="stop-place">${esc(short(p.from.name))}</div></div></li>`);
    p.picks.forEach((pk, i) => {
      const leg = `<p class="stop-leg">Day ${i + 1}: ${km(nightKm(i))}${legExtra(nightKm(i))}</p>`;
      if (!pk.camp) {
        stops.push(`<li class="stop"><div class="plate" aria-label="Night ${i + 1}">${i + 1}</div><div class="stop-body">${leg}<p class="note">${esc(pk.warn)}</p></div></li>`);
        return;
      }
      stops.push(`<li class="stop"><div class="plate" aria-label="Night ${i + 1}">${i + 1}</div><div class="stop-body">
        ${leg}
        ${pk.warn ? `<p class="note">${esc(pk.warn)}</p>` : ""}
        ${campCard(pk.camp)}
        <div class="stop-actions">
          <button class="btn" data-act="leg" data-i="${i}" type="button">${icon("route")}Directions</button>
          <a class="btn line" href="${navUrl(pk.camp, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
        </div>
        ${pk.alts.length ? `<details class="alt-wrap"><summary>${pk.alts.length} other camp${pk.alts.length > 1 ? "s" : ""} near here ${icon("chev", "ic sm")}</summary>
          ${pk.alts.map((c) => `<div class="alt">${campCard(c)}<button class="btn" data-act="swap" data-i="${i}" data-id="${esc(c.id)}" type="button">${icon("swap")}Stay here instead</button></div>`).join("")}
        </details>` : ""}
      </div></li>`);
    });
    const lastAlong = p.picks.at(-1)?.camp?.along ?? 0;
    stops.push(`<li class="stop"><div class="plate end" aria-hidden="true"></div><div class="stop-body"><p class="stop-leg">Day ${p.nights + 1}: ${km(p.line.total - lastAlong)}${legExtra(p.line.total - lastAlong)}</p><div class="stop-place" style="padding-top:0">${esc(short(p.to.name))}</div></div></li>`);
    $("#nightList").innerHTML = stops.join("");
    renderBudget();
    renderTripExtras();
    const along = [...p.camps].sort((a, b) => a.along - b.along);
    $("#alongCount").textContent = along.length;
    $("#alongList").innerHTML = along.map((c) => `<li>${campCard(c)}</li>`).join("") || `<li class="empty">No camps within your detour distance. Try a longer detour.</li>`;
    $("#saveTrip").classList.remove("is-on");
    $("#offlineTrip").classList.toggle("is-on", !!p.legs);
    const on = $("#tripOffline");
    on.hidden = !p.offline;
    on.innerHTML = p.offline ? `${icon("offline", "ic sm")}Showing your offline download. Camp details and saved directions work without signal; the map background needs signal.` : "";
    $("#sheetScroll").scrollTop = 0;
    drawPlan();
  }

  function drawPlan() {
    tripLayer.clearLayers(); legLayer.clearLayers();
    const p = plan; if (!p) return;
    L.polyline(p.line.pts, { color: "#ffffff", weight: 9, opacity: .9 }).addTo(tripLayer);
    const line = L.polyline(p.line.pts, { color: "#0E5A3E", weight: 5, opacity: .95 }).addTo(tripLayer);
    L.marker([p.from.lat, p.from.lon], { icon: divIcon(`<div class="mk-start"></div>`, [18, 18]), interactive: false }).addTo(tripLayer);
    L.marker([p.to.lat, p.to.lon], { icon: divIcon(`<div class="mk-end"></div>`, [18, 18]), interactive: false }).addTo(tripLayer);
    const pickIds = new Set(p.picks.map((x) => x.camp?.id));
    for (const c of p.camps) if (!pickIds.has(c.id)) campMarker(c).addTo(tripLayer);
    p.picks.forEach((pk, i) => { if (pk.camp) campMarker(pk.camp, { night: true, label: String(i + 1) }).addTo(tripLayer); });
    map.fitBounds(line.getBounds(), fitPad());
  }

  $("#nightList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b?.dataset.act === "swap") {
      const i = +b.dataset.i, pk = plan.picks[i];
      const alt = pk.alts.find((c) => c.id === b.dataset.id);
      pk.alts = [pk.camp, ...pk.alts.filter((c) => c.id !== alt.id)];
      pk.camp = alt; pk.warn = "";
      showPlan(); toast(`Night ${i + 1}: ${alt.name}`);
      return;
    }
    if (b?.dataset.act === "leg") { showLeg(+b.dataset.i); return; }
    const card = e.target.closest(".camp-card");
    if (card) openDetail(findCamp(card.dataset.id));
  });
  $("#alongList").addEventListener("click", (e) => { const card = e.target.closest(".camp-card"); if (card) openDetail(findCamp(card.dataset.id)); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  function findCamp(id) {
    return (plan?.camps || []).find((c) => c.id === id) || exploreCamps.find((c) => c.id === id) || store.get("cf-camps", []).find((c) => c.id === id) || userCamps().find((c) => c.id === id);
  }
  $("#editTrip").addEventListener("click", () => { $("#planForm").hidden = false; $("#results").hidden = true; tripLayer.clearLayers(); legLayer.clearLayers(); });
  $("#saveTrip").addEventListener("click", (e) => {
    const trips = store.get("cf-trips", []);
    trips.unshift({
      id: Date.now(), from: plan.from, to: plan.to, nights: plan.nights, opts: plan.opts, km: plan.route.distance,
      picks: plan.picks.map((p) => p.camp && { id: p.camp.id, name: p.camp.name }),
    });
    store.set("cf-trips", trips.slice(0, 30));
    e.currentTarget.classList.add("is-on"); toast("Trip saved");
  });

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
        <div class="d-head"><div><h2 class="d-title">${esc(c.name)}</h2><p class="d-kind">${esc(metaLine(c))}</p></div>${priceTag(c)}</div>
        <div class="d-actions">
          <a class="cta" href="${navUrl(c, "apple")}" target="_blank" rel="noopener">${icon("nav")}Navigate</a>
          <button class="btn" id="dirBtn" type="button">${icon("route")}Directions</button>
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
          <div class="ci-head"><b>Been here lately?</b><span id="ciLatest" class="help"></span></div>
          <div class="ci-btns">
            <button class="btn" type="button" data-ci="free">Still free</button>
            <button class="btn" type="button" data-ci="price_changed">Price changed</button>
            <button class="btn" type="button" data-ci="closed">Closed</button>
            <button class="btn" type="button" data-ci="full">Full</button>
          </div>
        </div>
        ${c.rule ? `<div class="notice"><b>Overnight stays</b><span>${esc(c.rule)}</span></div>` : ""}
        ${rulesNear(c.lat, c.lon).map((r) => `<div class="notice warn"><b>Local rule: ${esc(r.place)}</b><span>${esc(r.text)}</span><a href="${esc(r.src)}" target="_blank" rel="noopener">Source</a></div>`).join("")}
        <dl class="facts">
          ${fact("Price", esc(cost))}
          ${fact("Suits", esc(suits(c)))}
          ${fact("Max stay", esc(c.maxstay))}
          ${fact("Open", esc(c.hours))}
          ${fact("Run by", esc(c.operator))}
          ${fact("Phone", esc(c.phone))}
          ${fact("Website", site)}
          ${fact("Notes", esc(c.desc))}
          ${fact("Location", `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`)}
        </dl>
        <p class="caveat">${sourceLine(c)} Details can be out of date. Check signs, prices, closures and fire bans when you arrive.
          ${c.source === "osm" ? `Something wrong? <a href="https://www.openstreetmap.org/${esc(c.id)}" target="_blank" rel="noopener">Update it on OpenStreetMap</a>.` : ""}
          ${c.source === "user" ? `<button class="btn line" type="button" id="editMine">Edit</button> <button class="btn line" type="button" id="delMine">Remove</button>` : ""}
          ${c.source === "community" ? `<button class="btn line" type="button" id="reportCamp">Report a problem</button>` : ""}</p>
      </div>`);
    if (window.innerWidth < 900) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12));
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
  const gIds = store.get("cf-gpid", {});
  async function gfetch(url, { method = "GET", body, fieldMask } = {}) {
    const headers = { "X-Goog-Api-Key": CFG.googleKey };
    if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
    if (body) headers["Content-Type"] = "application/json";
    if (nativeFetch) return JSON.parse(await nativeFetch(url, { method, body: body && JSON.stringify(body), contentType: body && "application/json", headers, timeout: 10000 }));
    return fetchJSON(url, { method, headers, body: body && JSON.stringify(body) }, 10000);
  }
  const gCache = new Map(), gPlace = new Map();
  async function googlePhotos(c) {
    if (!CFG.googleKey) return [];
    if (gCache.has(c.id)) return gCache.get(c.id);
    let id = gIds[c.id];
    if (id === undefined || (id === "" && Date.now() - (gIds[c.id + "@t"] || 0) > 30 * 864e5)) {
      const d = 0.006;
      const j = await gfetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST", fieldMask: "places.id",
        body: { textQuery: c.named ? c.name : "campground", pageSize: 1, regionCode: "AU",
          locationRestriction: { rectangle: { low: { latitude: c.lat - d, longitude: c.lon - d }, high: { latitude: c.lat + d, longitude: c.lon + d } } } },
      });
      id = j.places?.[0]?.id || "";
      gIds[c.id] = id; if (!id) gIds[c.id + "@t"] = Date.now();
      store.set("cf-gpid", gIds);
    }
    if (!id) { gCache.set(c.id, []); return []; }
    const det = await gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { fieldMask: CFG.googleReviews ? "photos,rating,userRatingCount,reviews,googleMapsUri" : "photos" });
    if (det.rating) { gPlace.set(c.id, { rating: det.rating, count: det.userRatingCount || 0, reviews: det.reviews || [], uri: det.googleMapsUri || "" }); renderGoogleRating(c, gPlace.get(c.id)); }
    const photos = (det.photos || []).slice(0, CFG.googlePhotos);
    const out = (await Promise.all(photos.map(async (p) => {
      try {
        const m = await gfetch(`https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=900&skipHttpRedirect=true`);
        const who = (p.authorAttributions || [])[0];
        return m.photoUri ? { src: m.photoUri, href: who?.uri || "", credit: `${who?.displayName || "Google user"} · Google`, google: true } : null;
      } catch { return null; }
    }))).filter(Boolean);
    gCache.set(c.id, out);
    return out;
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
      const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats) + 0.5, Math.max(...lons) + 0.5];
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
      const s = Math.min(...lats), w = Math.min(...lons), n = Math.max(...lats) + 0.5, e = Math.max(...lons) + 0.5;
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
    const freeOnly = $("#exFree").checked, rig = prefs.rig, wants = wantsOf($("#explorePills"));
    const b = map.getBounds(), ctr = map.getCenter();
    const inView = exploreCamps.filter((c) => b.contains([c.lat, c.lon]));
    const shown = inView.filter((c) => (!freeOnly || c.cost === "free") && rigOK(c, rig) && missing(c, wants).length === 0);
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
    const pick = (name, v) => { const el = $(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
    pick("rig", t.opts.rig); pick("cost", t.opts.cost); pick("detour", t.opts.detour);
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
        <div class="field"><label for="acName">Camp name</label><input id="acName" type="text" maxlength="80" placeholder="e.g. Futter Creek free camp" value="${esc(c.name && c.name !== "Unnamed camp" ? c.name : "")}"></div>
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
      try { store.set("cf-user-camps", list); localStorage.getItem("cf-user-camps"); }
      catch { msg.className = "msg is-error"; msg.textContent = "Your phone's storage is full. Remove the photo and try again."; return; }
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
      latest.textContent = list.length ? `${CI_TEXT[list[0].status]}, reported ${ago(list[0].created_at)}${list.length > 1 ? ` (${list.length} recent reports)` : ""}` : "No reports yet. Be the first.";
    }).catch(() => (latest.textContent = ""));
    box.addEventListener("click", async (e) => {
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
      <p class="msg" id="acctMsg" role="status" aria-live="polite"></p></form>`;
    const msg = $("#acctMsg");
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
    return `<div class="guide-card">
      <div class="gc-top"><div><div class="gc-kicker">Trip essentials</div><div class="gc-name">${esc(g.name)}</div></div><span class="gc-ready">${readyCount(g, key)}</span></div>
      <p class="gc-sum">${esc(g.summary)}</p>
      <button class="btn gold" type="button" data-guide="${esc(g.id)}">Open guide</button>
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
        ${n.bookings.length ? `<ul class="bookings">${n.bookings.map(bookingRow).join("")}</ul>` : `<p class="help">Record ferries, permits, camp and resort bookings with their reference numbers. They're kept with this trip and work offline.</p>`}
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
  const DEFAULT_PRICE = { diesel: 2.05, petrol: 1.95, lpg: 1.05 };
  const settings = Object.assign({
    make: "", model: "", fuel: "diesel", use: 10.5, tank: 80, prices: { ...DEFAULT_PRICE }, tow: 30,
    campUnknown: 35, daily: 0, maxKm: 500, anim: true, follow: false, sat: false, welcomeEveryTime: true,
  }, store.get("cf-settings", {}));
  const saveSettings = () => store.set("cf-settings", settings);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animOn = () => settings.anim && !reducedMotion;
  const applyMotion = () => document.documentElement.classList.toggle("motion", animOn());
  applyMotion();
  const money = (v) => !v ? "$0" : "$" + (v >= 100 ? Math.round(v).toLocaleString("en-AU") : v.toFixed(v >= 10 ? 0 : 2));
  const towing = (rig) => rig === "caravan" || rig === "camper";
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
  function campFee(c) {
    if (!c || c.cost === "free") return { v: 0, known: true };
    if (c.cost === "unknown") return { v: 0, known: false };
    const m = /(\d+(?:\.\d+)?)/.exec(c.charge || "");
    if (!m) return { v: settings.campUnknown, known: false };
    let v = +m[1];
    if (/person|pp\b|adult/i.test(c.charge)) v *= 2;
    return { v, known: true };
  }
  function countUp(el, to, fmt) {
    if (!el) return;
    if (!animOn()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function renderBudget() {
    const box = $("#tripBudget"); if (!box || !plan) return;
    const f = fuelFor(plan.route.distance);
    if (!f) { box.innerHTML = ""; return; }
    let fees = 0, unknown = 0, paidN = 0;
    plan.picks.forEach((pk) => { const fee = campFee(pk.camp); fees += fee.v; if (!fee.known) unknown++; if (fee.v > 0) paidN++; });
    const days = plan.nights + 1, daily = (settings.daily || 0) * days;
    const total = f.cost + fees + daily;
    const fills = settings.tank ? f.litres / settings.tank : 0;
    const vname = settings.model ? `${settings.make === "Other" ? "" : settings.make + " "}${settings.model}` : "your vehicle";
    box.innerHTML = `<div class="budget">
      <div class="bg-top"><span>Trip cost estimate</span><b class="bg-total" id="bgTotal">$0</b></div>
      <div class="bg-rows">
        <div><b id="bgFuel">$0</b><small>Fuel · ${Math.round(f.litres)} L</small></div>
        <div><b>${money(fees)}</b><small>Camps · ${paidN} paid</small></div>
        <div><b>${daily ? money(daily) : "—"}</b><small>${daily ? `Spending · ${days} days` : "Spending"}</small></div>
      </div>
      <p class="bg-note">${esc(vname)}, ${settings.use} L/100 km${towing(plan.opts.rig) && settings.tow ? ` +${settings.tow}% towing` : ""}, ${money(settings.prices[settings.fuel])}/L ${settings.fuel}${fills >= 0.5 ? ` · about ${fills < 1.5 ? "1 tank" : Math.round(fills) + " tanks"}` : ""}${unknown ? ` · ${unknown} camp price${unknown > 1 ? "s" : ""} not listed` : ""}. <button type="button" id="bgEdit">Change</button></p>
    </div>`;
    countUp($("#bgTotal"), total, money);
    countUp($("#bgFuel"), f.cost, money);
    $("#bgEdit").addEventListener("click", () => setView("settings"));
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
    saveSettings();
  }
  function renderSettings() {
    fillMakes($("#stMake"), settings.make); fillModels($("#stModel"), settings.make, settings.model);
    $("#stFuel").value = settings.fuel; $("#stUse").value = settings.use; $("#stTank").value = settings.tank;
    $("#stPrice").value = settings.prices[settings.fuel]; $("#stTow").value = settings.tow; $("#stTowOut").textContent = `+${settings.tow}%`;
    $("#stCamp").value = settings.campUnknown; $("#stDaily").value = settings.daily || ""; $("#stMaxKm").value = settings.maxKm;
    $("#stWelcomeEvery").checked = settings.welcomeEveryTime; $("#stAnim").checked = settings.anim; $("#stFollow").checked = settings.follow; $("#stSat").checked = settings.sat;
    const C = window.CFCloud;
    $("#stAccount").textContent = !C?.enabled ? "Accounts aren't switched on in this version." : C.signedIn() ? `Signed in as ${C.email()}.` : "Not signed in. Sign in to rate camps, post photos and keep your trips on every device.";
    const info = campDB.info();
    $("#stData").textContent = info ? `Camp database: ${info.count.toLocaleString("en-AU")} camps, updated ${new Date(info.built).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}. Updates download automatically each week.` : "";
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
    $("#stWelcomeEvery").addEventListener("change", (e) => { settings.welcomeEveryTime = e.target.checked; saveSettings(); });
    $("#stGoAccount").addEventListener("click", () => setView("saved"));
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
    moveInk();
    if (settings.welcomeEveryTime || !store.get("cf-welcomed", false)) showWelcome();
  }
  playIntro(true);
  // iPhones keep apps open in the background, so replay the intro when you come back after a while
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 3 * 60 * 1000 && $("#welcome").hidden) playIntro(false);
  });

  function showWelcome() {
    const w = $("#welcome"), track = $("#wlTrack"), slides = $$(".wl-slide", w), dots = $$("#wlDots i");
    w.classList.remove("out"); w.hidden = false; track.scrollLeft = 0;
    $("#wlRigs").innerHTML = RIGS.map((r) => `<label><input type="radio" name="wlRig" value="${r.id}" ${r.id === prefs.rig ? "checked" : ""}><span>${icon(r.id)}${r.label.replace("&shy;", "")}</span></label>`).join("");
    $("#wlRigs").onchange = (e) => {
      prefs.rig = e.target.value; store.set("cf-prefs", prefs);
      const f = $(`input[name=rig][value="${prefs.rig}"]`); if (f) f.checked = true;
      $(".ar-rig use").setAttribute("href", `#i-${prefs.rig}`);
    };
    $(".ar-rig use").setAttribute("href", `#i-${prefs.rig}`);
    fillMakes($("#wlMake"), settings.make); fillModels($("#wlModel"), settings.make, settings.model);
    $("#wlMake").onchange = (e) => { pickVehicle(e.target.value, ""); fillModels($("#wlModel"), settings.make, settings.model); };
    $("#wlModel").onchange = (e) => pickVehicle(settings.make, e.target.value);
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
      if (plan) showPlan();
    };
    $("#wlNext").onclick = () => { const i = at(); if (i >= slides.length - 1) return done(); track.scrollTo({ left: (i + 1) * track.clientWidth, behavior: animOn() ? "smooth" : "auto" }); };
    $("#wlSkip").onclick = done;
  }

  // ---- Google rating and reviews (shown with photos when the Google key is switched on)
  function renderGoogleRating(c, place) {
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
