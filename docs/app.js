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
    exploreMinZoom: 9,
    boatRampKm: 5,
    dumpKm: 10,
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

  // ---------------------------------------------------------------- data: Overpass
  const CAMP_SEL = 'nwr["tourism"~"^(camp_site|caravan_site)$"]';
  async function overpass(query) {
    let lastErr;
    for (const ep of CFG.overpass) {
      try {
        return await fetchJSON(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        }, 90000);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Overpass unavailable");
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
  function costOK(c, mode) { return mode === "any" || mode === "cheap" || c.cost === "free"; }

  function score(c, wants, costMode) {
    let s = 0;
    if (c.cost === "free") s += 40; else if (c.cost === "unknown") s += 14; else s += costMode === "any" ? 20 : 0;
    for (const id of ["toilets", "water", "showers", "dogs", "power", "fires"]) if (c.a[id] === true) s += 4;
    s += wants.filter((w) => has(c, w)).length * 12;
    if (c.named) s += 5;
    if (c.website || c.phone) s += 2;
    if (c.desc) s += 2;
    if (c.rampM <= CFG.boatRampKm * 1000) s += 3;
    return s;
  }

  // ---------------------------------------------------------------- routing
  async function osrm(points, steps = false) {
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
  async function searchPlaces(q) {
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

  // ---------------------------------------------------------------- map
  const map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([-23.5, 134], 4);
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  });
  let onSat = false;
  $("#layerBtn").addEventListener("click", () => {
    onSat = !onSat;
    if (onSat) { map.removeLayer(street); sat.addTo(map); } else { map.removeLayer(sat); street.addTo(map); }
  });
  L.control.zoom({ position: "topleft" }).addTo(map);

  const tripLayer = L.layerGroup().addTo(map);
  const legLayer = L.layerGroup().addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true });
  map.addLayer(cluster);

  function pinIcon(cls, label = "") {
    return L.divIcon({ className: "", html: `<div class="pin ${cls}"><b>${esc(label)}</b></div>`, iconSize: [28, 28], iconAnchor: [14, 28] });
  }
  function campMarker(c, opts = {}) {
    const m = L.marker([c.lat, c.lon], { icon: pinIcon(opts.night ? "night" : c.cost, opts.label || "") , title: c.name });
    m.on("click", () => openDetail(c, opts.ctx));
    return m;
  }

  let me = null;
  $("#locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Location isn't available on this device.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        L.circleMarker([me.lat, me.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#2F6FD6", fillOpacity: 1 }).addTo(map);
        map.setView([me.lat, me.lon], 11);
      },
      () => toast("Couldn't get your location. Check location permission for your browser."),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });

  // ---------------------------------------------------------------- sheet & tabs
  const sheet = $("#sheet");
  $("#sheetHandle").addEventListener("click", () => {
    if (sheet.classList.contains("is-peek")) { sheet.classList.remove("is-peek"); }
    else if (sheet.classList.contains("is-full")) { sheet.classList.remove("is-full"); sheet.classList.add("is-peek"); }
    else sheet.classList.add("is-full");
    setTimeout(() => map.invalidateSize(), 300);
  });
  let view = "plan";
  $$(".tab").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  function setView(v) {
    view = v;
    $$(".tab").forEach((b) => { const on = b.dataset.view === v; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
    $$(".view").forEach((el) => (el.hidden = el.id !== `view-${v}`));
    if (v === "explore") { tripLayer.clearLayers(); legLayer.clearLayers(); cluster.clearLayers(); loadExplore(); }
    if (v === "plan") { cluster.clearLayers(); if (plan) drawPlan(); }
    if (v === "saved") renderSaved();
  }

  function chipsInto(fs, prefix, saved) {
    fs.insertAdjacentHTML("beforeend", AMENITIES.map((a) =>
      `<label class="chip"><input type="checkbox" id="${prefix}-${a.id}" value="${a.id}" ${saved.includes(a.id) ? "checked" : ""}><span>${a.label}</span></label>`).join(""));
  }
  const prefs = store.get("cf-prefs", { wants: ["toilets"], exWants: [] });
  chipsInto($("#planChips"), "pc", prefs.wants);
  chipsInto($("#exploreChips"), "ec", prefs.exWants);
  const wantsOf = (fs) => $$("input:checked", fs).map((i) => i.value);

  // ---------------------------------------------------------------- PLAN
  let plan = null; // { from, to, route, line, nights, picks: [{target, camp, alts, warn}], camps }
  attachSuggest($("#from"));
  attachSuggest($("#to"));

  $("#planForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#planMsg"), btn = $("#findBtn");
    msg.className = "form-msg"; btn.disabled = true;
    const say = (t) => (msg.innerHTML = `<span class="spinner"></span>${esc(t)}`);
    try {
      const nights = Math.max(0, Math.min(30, parseInt($("#nights").value || "0", 10)));
      const opts = { rig: $("#rig").value, cost: $("#cost").value, detour: +$("#detour").value, wants: wantsOf($("#planChips")) };
      store.set("cf-prefs", { ...prefs, wants: opts.wants });
      say("Finding places…");
      const [from, to] = await Promise.all([resolvePlace($("#from")), resolvePlace($("#to"))]);
      say("Working out the route…");
      const route = await osrm([from, to]);
      say("Searching for camps along the route…");
      const data = await campsAlong(route, opts.detour, (t) => say(t));
      plan = makePlan({ from, to, route, nights, opts, data });
      msg.textContent = "";
      showPlan();
    } catch (err) {
      msg.className = "form-msg is-error";
      msg.textContent = friendly(err);
    } finally { btn.disabled = false; }
  });

  function friendly(err) {
    const m = String(err?.message || err);
    if (/abort|timeout/i.test(m)) return "That took too long. The free map servers may be busy, so try again in a minute.";
    if (/Failed to fetch|NetworkError|HTTP 429|HTTP 50/i.test(m)) return "Couldn't reach the map servers. Check your signal and try again.";
    if (/No route/i.test(m)) return "Couldn't find a driving route between those places.";
    return m;
  }

  async function campsAlong(route, detourM, progress) {
    const line = buildLine(route);
    const pts = sample(line, Math.max(8000, Math.min(20000, detourM)));
    const chunk = 45, parts = [];
    for (let i = 0; i < pts.length; i += chunk - 1) parts.push(pts.slice(i, i + chunk));
    const all = { camps: new Map(), ramps: new Map(), dumps: new Map() };
    let done = 0;
    for (const part of parts) {
      const poly = part.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(",");
      const extra = detourM + CFG.dumpKm * 1000;
      const q = `[out:json][timeout:80];(${CAMP_SEL}(around:${detourM},${poly});nwr["leisure"="slipway"](around:${extra},${poly});nwr["amenity"="sanitary_dump_station"](around:${extra},${poly}););out center tags;`;
      const res = parseElements(await overpass(q));
      res.camps.forEach((c) => all.camps.set(c.id, c));
      res.ramps.forEach((c) => all.ramps.set(c.id, c));
      res.dumps.forEach((c) => all.dumps.set(c.id, c));
      done++;
      if (parts.length > 1) progress(`Searching for camps along the route… ${Math.round((done / parts.length) * 100)}%`);
    }
    const camps = enrich([...all.camps.values()], [...all.ramps.values()], [...all.dumps.values()]);
    for (const c of camps) Object.assign(c, project(line, c));
    return { line, camps: camps.filter((c) => c.off <= detourM * 1.15) };
  }

  function makePlan({ from, to, route, nights, opts, data }) {
    const { line, camps } = data;
    const usable = camps.filter((c) => rigOK(c, opts.rig));
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
      let strict = rank(inWin.filter((c) => costOK(c, opts.cost) && missing(c, opts.wants).length === 0));
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
      if (camp) used.add(camp.id);
      prevAlong = camp ? camp.along : target;
      picks.push({ target, camp, alts: list.slice(1, 4), warn: camp ? warn : "No camps found for this night. Try a bigger detour or fewer must-haves." });
    }
    return { from, to, route, line, nights, opts, picks, camps: usable, at: Date.now() };
  }

  function nightKm(i) {
    const prevAlong = i === 0 ? 0 : (plan.picks[i - 1].camp?.along ?? plan.picks[i - 1].target);
    const here = plan.picks[i].camp?.along ?? plan.picks[i].target;
    return here - prevAlong;
  }

  function campRow(c, ctx = {}) {
    const a = c.a;
    const chip = (ok, label) => ok === true ? `<span>${label}</span>` : ok === false ? `<span class="no">${label}</span>` : "";
    const extra = [];
    if (c.rampM <= CFG.boatRampKm * 1000) extra.push(`<span>Boat ramp ${km(c.rampM)}</span>`);
    if (c.dumpM <= CFG.dumpKm * 1000) extra.push(`<span>${c.dumpM === 0 ? "Dump point on site" : "Dump point " + km(c.dumpM)}</span>`);
    const badge = c.cost === "free" ? `<span class="badge free">${c.donation ? "Donation" : "Free"}</span>`
      : c.cost === "paid" ? `<span class="badge paid">${esc(c.charge ? c.charge.slice(0, 18) : "Paid")}</span>`
      : `<span class="badge unknown">Cost unknown</span>`;
    const sub = [c.kind, c.off != null ? `${km(c.off)} off route` : "", ctx.fromCenter != null ? `${km(ctx.fromCenter)} away` : "", c.maxstay ? `Max stay ${c.maxstay}` : ""].filter(Boolean).join(" · ");
    return `<div class="camp" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)} details">
      <div class="camp-name">${esc(c.name)}</div>${badge}
      <div class="camp-sub">${esc(sub)}</div>
      <div class="amen">${chip(a.toilets, "Toilets")}${chip(a.water, "Water")}${chip(a.showers, "Showers")}${chip(a.dogs, "Dogs OK")}${chip(a.power, "Power")}${chip(a.fires, "Fires")}${extra.join("")}</div>
    </div>`;
  }

  function showPlan() {
    const p = plan;
    $("#planForm").hidden = true; $("#results").hidden = false;
    $("#tripTitle").textContent = `${p.from.name} to ${p.to.name}`;
    const perDay = p.line.total / (p.nights + 1);
    $("#tripMeta").textContent = `${km(p.route.distance)} · ${hrs(p.route.duration)} driving · ${p.nights} night${p.nights === 1 ? "" : "s"} · about ${km(perDay)} a day`;
    const list = $("#nightList");
    list.innerHTML = p.picks.map((pk, i) => `
      <li class="night">
        <div class="night-head"><span class="night-num">${i + 1}</span><b>Night ${i + 1}</b><span class="km">${km(nightKm(i))} drive</span></div>
        ${pk.warn ? `<div class="night-warn">${esc(pk.warn)}</div>` : ""}
        ${pk.camp ? campRow(pk.camp) : ""}
        ${pk.camp ? `<div class="camp-actions" style="padding:0 12px 12px">
            <button class="btn ghost small" data-act="leg" data-i="${i}" type="button">Directions here</button>
            <a class="btn ghost small" href="${navUrl(pk.camp, "apple")}" target="_blank" rel="noopener">Apple Maps</a>
            <a class="btn ghost small" href="${navUrl(pk.camp, "google")}" target="_blank" rel="noopener">Google Maps</a>
          </div>` : ""}
        ${pk.alts.length ? `<details class="alts"><summary>${pk.alts.length} other option${pk.alts.length > 1 ? "s" : ""}</summary>
          ${pk.alts.map((c) => `${campRow(c)}<div style="padding:0 12px 10px"><button class="btn ghost small" data-act="swap" data-i="${i}" data-id="${esc(c.id)}" type="button">Use this one</button></div>`).join("")}
        </details>` : ""}
      </li>`).join("") + `
      <li class="night"><div class="night-head"><span class="night-num">✓</span><b>Arrive ${esc(p.to.name)}</b><span class="km">${km(p.line.total - (p.picks.at(-1)?.camp?.along ?? 0))} drive</span></div></li>`;
    const along = [...p.camps].sort((a, b) => a.along - b.along);
    $("#alongCount").textContent = along.length;
    $("#alongList").innerHTML = along.map((c) => `<li>${campRow(c)}</li>`).join("") || `<li class="empty">No camps found within your detour distance.</li>`;
    drawPlan();
    if (window.innerWidth < 900) { sheet.classList.remove("is-full", "is-peek"); }
  }

  function drawPlan() {
    tripLayer.clearLayers(); legLayer.clearLayers();
    const p = plan; if (!p) return;
    const line = L.polyline(p.line.pts, { color: "#24453A", weight: 5, opacity: .85 }).addTo(tripLayer);
    L.marker([p.from.lat, p.from.lon], { icon: pinIcon("unknown", "A") }).addTo(tripLayer);
    L.marker([p.to.lat, p.to.lon], { icon: pinIcon("unknown", "B") }).addTo(tripLayer);
    const pickIds = new Set(p.picks.map((x) => x.camp?.id));
    for (const c of p.camps) if (!pickIds.has(c.id)) L.circleMarker([c.lat, c.lon], { radius: 5, weight: 1, color: "#fff", fillColor: c.cost === "free" ? "#2F7D4F" : c.cost === "paid" ? "#A8472A" : "#6B7A72", fillOpacity: .9 })
      .on("click", () => openDetail(c)).addTo(tripLayer);
    p.picks.forEach((pk, i) => { if (pk.camp) campMarker(pk.camp, { night: true, label: String(i + 1) }).addTo(tripLayer); });
    map.fitBounds(line.getBounds(), { paddingTopLeft: window.innerWidth >= 900 ? [450, 30] : [30, 30], paddingBottomRight: window.innerWidth >= 900 ? [30, 30] : [30, Math.round(window.innerHeight * 0.62)] });
  }

  $("#nightList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b?.dataset.act === "swap") {
      const pk = plan.picks[+b.dataset.i];
      const alt = pk.alts.find((c) => c.id === b.dataset.id);
      pk.alts = [pk.camp, ...pk.alts.filter((c) => c.id !== alt.id)];
      pk.camp = alt; pk.warn = "";
      showPlan(); toast(`Night ${+b.dataset.i + 1} changed to ${alt.name}`);
      return;
    }
    if (b?.dataset.act === "leg") { showLeg(+b.dataset.i); return; }
    const row = e.target.closest(".camp");
    if (row) openDetail(findCamp(row.dataset.id));
  });
  $("#alongList").addEventListener("click", (e) => { const row = e.target.closest(".camp"); if (row) openDetail(findCamp(row.dataset.id)); });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList?.contains("camp")) e.target.click(); if (e.key === "Escape") closeDetail(); });
  function findCamp(id) {
    return (plan?.camps || []).find((c) => c.id === id) || exploreCamps.find((c) => c.id === id) || store.get("cf-camps", []).find((c) => c.id === id);
  }
  $("#editTrip").addEventListener("click", () => { $("#planForm").hidden = false; $("#results").hidden = true; });
  $("#saveTrip").addEventListener("click", () => {
    const trips = store.get("cf-trips", []);
    const slim = {
      id: Date.now(), from: plan.from, to: plan.to, nights: plan.nights, opts: plan.opts,
      picks: plan.picks.map((p) => p.camp && { id: p.camp.id, name: p.camp.name, lat: p.camp.lat, lon: p.camp.lon, cost: p.camp.cost }),
      km: plan.route.distance,
    };
    trips.unshift(slim); store.set("cf-trips", trips.slice(0, 30)); toast("Trip saved");
  });

  // ---------------------------------------------------------------- directions for a leg
  function navUrl(c, app) {
    return app === "apple"
      ? `https://maps.apple.com/?daddr=${c.lat},${c.lon}&dirflg=d&q=${encodeURIComponent(c.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}&travelmode=driving`;
  }
  async function showLeg(i) {
    const startPt = i === 0 ? plan.from : plan.picks[i - 1].camp || plan.from;
    const camp = plan.picks[i].camp;
    await directions(startPt, camp, i === 0 ? plan.from.name : startPt.name);
  }
  async function directions(from, camp, fromName) {
    openDetailShell(`<div class="d-title">Directions</div><div class="d-sub">${esc(fromName || "Start")} to ${esc(camp.name)}</div><p><span class="spinner"></span>Working out the route…</p>`);
    try {
      const r = await osrm([from, camp], true);
      legLayer.clearLayers();
      const pl = L.polyline(r.geometry.coordinates.map(([lo, la]) => [la, lo]), { color: "#D9922E", weight: 6, opacity: .95 }).addTo(legLayer);
      map.fitBounds(pl.getBounds(), { padding: [40, 40] });
      const steps = r.legs.flatMap((l) => l.steps).filter((s) => s.maneuver.type !== "arrive" || true);
      $("#detailBody").innerHTML = `
        <div class="d-title">Directions</div>
        <div class="d-sub">${esc(fromName || "Start")} to ${esc(camp.name)} · ${km(r.distance)} · ${hrs(r.duration)}</div>
        <div class="d-actions">
          <a class="btn dark small" href="${navUrl(camp, "apple")}" target="_blank" rel="noopener">Navigate in Apple Maps</a>
          <a class="btn ghost small" href="${navUrl(camp, "google")}" target="_blank" rel="noopener">Google Maps</a>
          <button class="btn ghost small" type="button" id="backToCamp">Camp details</button>
        </div>
        <ol class="steps">${steps.map((s) => `<li><span>${esc(stepText(s))}</span><span class="d">${s.distance > 0 ? km(s.distance) : ""}</span></li>`).join("")}</ol>
        <div class="disclaim">Driving times are estimates for a car and don't allow for towing, roadworks or unsealed roads. Check road conditions before heading off.</div>`;
      $("#backToCamp").addEventListener("click", () => openDetail(camp));
    } catch (err) {
      $("#detailBody").innerHTML = `<div class="d-title">Directions</div><p class="form-msg is-error">${esc(friendly(err))}</p>
        <div class="d-actions"><a class="btn dark small" href="${navUrl(camp, "apple")}" target="_blank" rel="noopener">Apple Maps</a><a class="btn ghost small" href="${navUrl(camp, "google")}" target="_blank" rel="noopener">Google Maps</a></div>`;
    }
  }

  // ---------------------------------------------------------------- detail
  function openDetailShell(html) { $("#detailBody").innerHTML = html; $("#detail").hidden = false; $("#detail").scrollTop = 0; }
  function closeDetail() { $("#detail").hidden = true; }
  $("#detailClose").addEventListener("click", closeDetail);

  function yn(v) { return v === true ? "Yes" : v === false ? "No" : "Not recorded"; }
  async function openDetail(c) {
    if (!c) return;
    const saved = store.get("cf-camps", []).some((x) => x.id === c.id);
    const cost = c.cost === "free" ? (c.donation ? "Free (donation welcome)" : "Free") : c.cost === "paid" ? (c.charge || "Paid") : "Not recorded";
    const site = c.website && /^https?:\/\//i.test(c.website) ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//, "").slice(0, 40))}</a>` : "";
    const ownPhoto = c.image && /^https:\/\/.+\.(jpe?g|png|webp)$/i.test(c.image) ? c.image : "";
    openDetailShell(`
      <div class="brand-kicker">${esc(c.kind)}</div>
      <div class="d-title">${esc(c.name)}</div>
      <div class="d-sub">${c.off != null ? `${km(c.off)} off your route · ` : ""}${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</div>
      <div class="photos" id="photos">${ownPhoto ? `<a href="${esc(ownPhoto)}" target="_blank" rel="noopener"><img src="${esc(ownPhoto)}" alt="${esc(c.name)}"></a>` : ""}<span class="hint"><span class="spinner"></span>Looking for photos…</span></div>
      <div class="photo-note" id="photoNote"></div>
      <div class="d-actions">
        <a class="btn dark small" href="${navUrl(c, "apple")}" target="_blank" rel="noopener">Navigate (Apple Maps)</a>
        <a class="btn ghost small" href="${navUrl(c, "google")}" target="_blank" rel="noopener">Google Maps</a>
        <button class="btn ghost small" id="dirBtn" type="button">Directions in app</button>
        <button class="btn ghost small" id="saveCamp" type="button">${saved ? "Saved" : "Save camp"}</button>
      </div>
      <dl class="facts">
        <dt>Cost</dt><dd>${esc(cost)}</dd>
        <dt>Toilets</dt><dd>${yn(c.a.toilets)}</dd>
        <dt>Drinking water</dt><dd>${yn(c.a.water)}</dd>
        <dt>Showers</dt><dd>${yn(c.a.showers)}</dd>
        <dt>Dogs</dt><dd>${yn(c.a.dogs)}</dd>
        <dt>Power</dt><dd>${yn(c.a.power)}</dd>
        <dt>Campfires</dt><dd>${yn(c.a.fires)}</dd>
        <dt>Boat ramp</dt><dd>${isFinite(c.rampM) ? km(c.rampM) + " away" : "None found nearby"}</dd>
        <dt>Dump point</dt><dd>${c.dumpM === 0 ? "On site" : isFinite(c.dumpM) ? km(c.dumpM) + " away" : "None found nearby"}</dd>
        <dt>Suits</dt><dd>${suits(c)}</dd>
        ${c.maxstay ? `<dt>Max stay</dt><dd>${esc(c.maxstay)}</dd>` : ""}
        ${c.hours ? `<dt>Open</dt><dd>${esc(c.hours)}</dd>` : ""}
        ${c.operator ? `<dt>Run by</dt><dd>${esc(c.operator)}</dd>` : ""}
        ${c.phone ? `<dt>Phone</dt><dd>${esc(c.phone)}</dd>` : ""}
        ${site ? `<dt>Website</dt><dd>${site}</dd>` : ""}
        ${c.desc ? `<dt>Notes</dt><dd>${esc(c.desc)}</dd>` : ""}
      </dl>
      <div class="disclaim">Details come from OpenStreetMap and may be out of date. Check signs, fees, closures and fire bans when you arrive.
        Spotted something wrong? <a href="https://www.openstreetmap.org/${esc(c.id)}" target="_blank" rel="noopener">Fix it on OpenStreetMap</a>.</div>`);
    map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12));
    $("#dirBtn").addEventListener("click", () => {
      if (plan && view === "plan") {
        const i = plan.picks.findIndex((p) => p.camp?.id === c.id);
        if (i >= 0) return showLeg(i);
      }
      if (me) return directions(me, c, "Your location");
      if (!navigator.geolocation) return toast("Turn on location to get directions from where you are.");
      navigator.geolocation.getCurrentPosition(
        (pos) => { me = { lat: pos.coords.latitude, lon: pos.coords.longitude }; directions(me, c, "Your location"); },
        () => toast("Couldn't get your location. Use Apple or Google Maps instead."), { timeout: 12000 });
    });
    $("#saveCamp").addEventListener("click", (e) => {
      const list = store.get("cf-camps", []);
      if (!list.some((x) => x.id === c.id)) { list.unshift(c); store.set("cf-camps", list.slice(0, 200)); }
      e.target.textContent = "Saved"; toast("Camp saved");
    });
    const ph = await photosNear(c);
    const box = $("#photos"); if (!box) return;
    box.querySelector(".hint")?.remove();
    box.insertAdjacentHTML("beforeend", ph.map((p) => `<a href="${esc(p.page)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(p.thumb)}" alt="Photo near ${esc(c.name)}"></a>`).join(""));
    $("#photoNote").textContent = ph.length
      ? "Photos taken within about 1.5 km, from Wikimedia Commons. Tap a photo for the photographer and licence."
      : (ownPhoto ? "" : "No photos found for this spot yet. Switch to satellite view to see the site from above.");
  }
  function suits(c) {
    const s = [];
    if (c.tents !== false) s.push("Tents");
    if (c.caravans !== false && !c.backcountry) s.push("Caravans");
    if (c.motorhome !== false && !c.backcountry) s.push("Motorhomes");
    return s.join(", ") || "Check on arrival";
  }

  // ---------------------------------------------------------------- EXPLORE
  let exploreCamps = [];
  const exCache = new Map(); // tile key -> parsed
  attachSuggest($("#exploreSearch"), (r) => map.setView([r.lat, r.lon], 11));
  ["#exCost", "#exRig"].forEach((s) => $(s).addEventListener("change", renderExplore));
  $("#exploreChips").addEventListener("change", () => { store.set("cf-prefs", { ...prefs, wants: wantsOf($("#planChips")), exWants: wantsOf($("#exploreChips")) }); renderExplore(); });
  let exTimer;
  map.on("moveend", () => { if (view === "explore") { clearTimeout(exTimer); exTimer = setTimeout(loadExplore, 500); } });

  function tileKeys(b) { // 0.5° tiles cover the view
    const keys = [];
    for (let la = Math.floor(b.getSouth() * 2) / 2; la < b.getNorth(); la += 0.5)
      for (let lo = Math.floor(b.getWest() * 2) / 2; lo < b.getEast(); lo += 0.5) keys.push(`${la.toFixed(1)},${lo.toFixed(1)}`);
    return keys;
  }
  async function loadExplore() {
    if (view !== "explore") return;
    const z = map.getZoom();
    if (z < CFG.exploreMinZoom) {
      $("#exploreCount").textContent = "Zoom in on an area to load its camps.";
      if (!exploreCamps.length) $("#exploreList").innerHTML = "";
      return;
    }
    const keys = tileKeys(map.getBounds()).filter((k) => !exCache.has(k));
    if (keys.length > 16) { $("#exploreCount").textContent = "Zoom in a little more to load camps."; return; }
    if (keys.length) {
      $("#exploreCount").innerHTML = `<span class="spinner"></span>Loading camps…`;
      const lats = keys.map((k) => +k.split(",")[0]), lons = keys.map((k) => +k.split(",")[1]);
      const s = Math.min(...lats), w = Math.min(...lons), n = Math.max(...lats) + 0.5, e = Math.max(...lons) + 0.5;
      const bb = `${s},${w},${n},${e}`, bbx = `${s - 0.1},${w - 0.1},${n + 0.1},${e + 0.1}`;
      const q = `[out:json][timeout:60];(${CAMP_SEL}(${bb});nwr["leisure"="slipway"](${bbx});nwr["amenity"="sanitary_dump_station"](${bbx}););out center tags;`;
      try {
        const res = parseElements(await overpass(q));
        enrich(res.camps, res.ramps, res.dumps);
        const byKey = new Map(keys.map((k) => [k, []]));
        for (const c of res.camps) {
          const k = `${(Math.floor(c.lat * 2) / 2).toFixed(1)},${(Math.floor(c.lon * 2) / 2).toFixed(1)}`;
          if (byKey.has(k)) byKey.get(k).push(c);
        }
        byKey.forEach((v, k) => exCache.set(k, v));
      } catch (err) { $("#exploreCount").textContent = friendly(err); return; }
    }
    const all = new Map();
    for (const k of exCache.keys()) for (const c of exCache.get(k)) all.set(c.id, c);
    exploreCamps = [...all.values()];
    renderExplore();
  }
  function renderExplore() {
    if (view !== "explore") return;
    const cost = $("#exCost").value, rig = $("#exRig").value, wants = wantsOf($("#exploreChips"));
    const b = map.getBounds(), ctr = map.getCenter();
    const inView = exploreCamps.filter((c) => b.contains([c.lat, c.lon]));
    const shown = inView.filter((c) => (cost === "any" || c.cost === "free") && rigOK(c, rig) && missing(c, wants).length === 0);
    shown.forEach((c) => (c._d = hav([ctr.lat, ctr.lng], [c.lat, c.lon])));
    shown.sort((a, b2) => score(b2, wants, cost) - score(a, wants, cost) || a._d - b2._d);
    cluster.clearLayers();
    cluster.addLayers(shown.map((c) => campMarker(c)));
    const free = shown.filter((c) => c.cost === "free").length;
    $("#exploreCount").textContent = map.getZoom() < CFG.exploreMinZoom ? "Zoom in on an area to load its camps."
      : `${shown.length} camp${shown.length === 1 ? "" : "s"} in view${cost === "any" ? ` (${free} free)` : ""}${inView.length > shown.length ? ` · ${inView.length - shown.length} hidden by your filters` : ""}`;
    $("#exploreList").innerHTML = shown.slice(0, 80).map((c) => `<li>${campRow(c, { fromCenter: c._d })}</li>`).join("") || `<li class="empty">No matching camps in this area. Try fewer must-haves or zoom out.</li>`;
  }
  $("#exploreList").addEventListener("click", (e) => { const row = e.target.closest(".camp"); if (row) openDetail(findCamp(row.dataset.id)); });

  // ---------------------------------------------------------------- SAVED
  function renderSaved() {
    const trips = store.get("cf-trips", []), camps = store.get("cf-camps", []);
    $("#savedTrips").innerHTML = trips.length ? trips.map((t) => `<li><div class="grow"><b>${esc(t.from.name)} to ${esc(t.to.name)}</b><div class="trip-meta">${km(t.km)} · ${t.nights} nights · ${t.picks.filter(Boolean).map((p) => esc(p.name)).join(" → ") || "no camps"}</div></div>
      <button class="btn ghost small" data-load="${t.id}" type="button">Open</button><button class="btn ghost small" data-del="${t.id}" type="button" aria-label="Delete trip">Delete</button></li>`).join("")
      : `<li class="empty">Trips you save appear here.</li>`;
    $("#savedCamps").innerHTML = camps.length ? camps.map((c) => `<li>${campRow(c)}</li>`).join("") : `<li class="empty">Tap "Save camp" on any camp to keep it here.</li>`;
  }
  $("#savedTrips").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]"), load = e.target.closest("[data-load]");
    const trips = store.get("cf-trips", []);
    if (del) { store.set("cf-trips", trips.filter((t) => String(t.id) !== del.dataset.del)); renderSaved(); }
    if (load) {
      const t = trips.find((x) => String(x.id) === load.dataset.load); if (!t) return;
      setView("plan");
      const f = $("#from"), to = $("#to");
      f.value = t.from.name; f.dataset.lat = t.from.lat; f.dataset.lon = t.from.lon;
      to.value = t.to.name; to.dataset.lat = t.to.lat; to.dataset.lon = t.to.lon;
      $("#nights").value = t.nights; $("#rig").value = t.opts.rig; $("#cost").value = t.opts.cost; $("#detour").value = t.opts.detour;
      $$("#planChips input").forEach((i) => (i.checked = t.opts.wants.includes(i.value)));
      $("#planForm").hidden = false; $("#results").hidden = true;
      $("#planForm").requestSubmit();
    }
  });
  $("#savedCamps").addEventListener("click", (e) => { const row = e.target.closest(".camp"); if (row) openDetail(findCamp(row.dataset.id)); });

  // ---------------------------------------------------------------- example trip on first open
  const ex = { from: { name: "Bundaberg", lat: -24.8661, lon: 152.3489 }, to: { name: "Cairns", lat: -16.9186, lon: 145.7781 } };
  if (!store.get("cf-seen", false)) {
    const f = $("#from"), t = $("#to");
    f.value = "Bundaberg, Queensland"; f.dataset.lat = ex.from.lat; f.dataset.lon = ex.from.lon;
    t.value = "Cairns, Queensland"; t.dataset.lat = ex.to.lat; t.dataset.lon = ex.to.lon;
    $("#planMsg").textContent = "Example filled in: Bundaberg to Cairns over 6 nights. Tap Find my camps, or type your own trip.";
    store.set("cf-seen", true);
  }

  // test hook (used by automated tests only)
  window.__cf = { normalise, rigOK, has, score, stepText, makePlan, buildLine, project, sample, parseElements, enrich };
})();
