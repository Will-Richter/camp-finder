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


  // ---------------------------------------------------------------- trip logic
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
  function campCard(c, ctx) {
    return `<button type="button" class="camp-card" data-id="${esc(c.id)}">
      <div class="cc-top"><div><div class="cc-name">${esc(c.name)}</div><div class="cc-meta">${esc(metaLine(c, ctx))}</div></div>${priceTag(c)}</div>
      ${amenIcons(c)}
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

  const tripLayer = L.layerGroup().addTo(map);
  const legLayer = L.layerGroup().addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, chunkedLoading: true });
  map.addLayer(cluster);

  const divIcon = (html, size) => L.divIcon({ className: "", html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
  function campMarker(c, opts = {}) {
    const ic = opts.night
      ? divIcon(`<div class="mk-night">${esc(opts.label)}</div>`, [34, 32])
      : divIcon(`<div class="mk ${c.cost}"></div>`, [16, 16]);
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
  let meDot = null;
  function locate(then) {
    if (!navigator.geolocation) { toast("Location isn't available on this device"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (meDot) map.removeLayer(meDot);
        meDot = L.circleMarker([me.lat, me.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#2F6FD6", fillOpacity: 1 }).addTo(map);
        then(me);
      },
      () => toast("Turn on location for Camp Finder in your phone's settings"),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }
  $("#locateBtn").addEventListener("click", () => locate((p) => map.setView([p.lat, p.lon], 11)));

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
    const say = (t) => (btn.innerHTML = `<span class="spinner"></span>${esc(t)}`);
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
      plan = makePlan({ from, to, route, nights, opts, data });
      msg.textContent = "";
      showPlan();
    } catch (err) {
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
      const leg = `<p class="stop-leg">Day ${i + 1}: ${km(nightKm(i))}</p>`;
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
    stops.push(`<li class="stop"><div class="plate end" aria-hidden="true"></div><div class="stop-body"><p class="stop-leg">Day ${p.nights + 1}: ${km(p.line.total - lastAlong)}</p><div class="stop-place" style="padding-top:0">${esc(short(p.to.name))}</div></div></li>`);
    $("#nightList").innerHTML = stops.join("");
    const along = [...p.camps].sort((a, b) => a.along - b.along);
    $("#alongCount").textContent = along.length;
    $("#alongList").innerHTML = along.map((c) => `<li>${campCard(c)}</li>`).join("") || `<li class="empty">No camps within your detour distance. Try a longer detour.</li>`;
    $("#saveTrip").classList.remove("is-on");
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
    return (plan?.camps || []).find((c) => c.id === id) || exploreCamps.find((c) => c.id === id) || store.get("cf-camps", []).find((c) => c.id === id);
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
    directions(start, plan.picks[i].camp, short(start.name));
  }
  function manIcon(s) {
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
  async function directions(from, camp, fromName) {
    showDetail(`<div class="d-pad" style="padding-top:22px"><h2 class="d-title">To ${esc(camp.name)}</h2><p class="d-kind">From ${esc(fromName || "start")}</p><p class="msg"><span class="spinner"></span>Planning the route</p></div>`);
    try {
      const r = await osrm([from, camp], true);
      legLayer.clearLayers();
      const pts = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
      L.polyline(pts, { color: "#ffffff", weight: 10, opacity: .9 }).addTo(legLayer);
      const pl = L.polyline(pts, { color: "#D9A400", weight: 6, opacity: 1 }).addTo(legLayer);
      map.fitBounds(pl.getBounds(), fitPad());
      const steps = r.legs.flatMap((l) => l.steps);
      $("#detailBody").innerHTML = `<div class="d-pad" style="padding-top:22px">
        <h2 class="d-title">To ${esc(camp.name)}</h2>
        <p class="d-kind">From ${esc(fromName || "start")}</p>
        <div class="dir-sum"><div><b>${km(r.distance)}</b><span>distance</span></div><div><b>${hrs(r.duration)}</b><span>driving</span></div></div>
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
        <div class="amen-grid">
          ${amenTile("toilets", c.a.toilets)}${amenTile("water", c.a.water)}${amenTile("showers", c.a.showers)}${amenTile("dogs", c.a.dogs)}
          ${amenTile("power", c.a.power)}${amenTile("fires", c.a.fires)}
          ${amenTile("boatramp", ramp ? true : null, ramp ? km(c.rampM) + " away" : "None nearby")}
          ${amenTile("dump", dump ? true : null, c.dumpM === 0 ? "On site" : dump ? km(c.dumpM) + " away" : "None nearby")}
        </div>
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
        <p class="caveat">Details come from OpenStreetMap and can be out of date. Check signs, prices, closures and fire bans when you arrive.
          Something wrong? <a href="https://www.openstreetmap.org/${esc(c.id)}" target="_blank" rel="noopener">Update it on OpenStreetMap</a>.</p>
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
    const ph = await photosNear(c);
    const g = $("#gallery"); if (!g) return;
    $("#galleryWait")?.remove();
    g.insertAdjacentHTML("beforeend", ph.map((p) => `<a href="${esc(p.page)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(p.thumb)}" alt="Photo near ${esc(c.name)}"></a>`).join(""));
    if (!ph.length && !ownPhoto) g.innerHTML = `<div class="none">${icon("photo")}No photos of this spot yet. Use satellite view on the map to see the site from above.</div>`;
    $("#photoNote").textContent = ph.length ? "Photos taken nearby, from Wikimedia Commons. Tap one for the photographer's credit." : "";
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
    if (keys.length > 16) { $("#exploreCount").textContent = "Zoom in a little further to load camps."; return; }
    if (keys.length) {
      $("#exploreCount").innerHTML = `<span class="spinner"></span>Loading camps in this area`;
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

  // ---------------------------------------------------------------- first open: example trip
  if (!store.get("cf-seen", false)) {
    const f = $("#from"), t = $("#to");
    f.value = "Bundaberg, Queensland"; f.dataset.lat = -24.8661; f.dataset.lon = 152.3489; $("#useHere").hidden = true;
    t.value = "Cairns, Queensland"; t.dataset.lat = -16.9186; t.dataset.lon = 145.7781;
    $("#planMsg").textContent = "We've filled in an example trip. Change it to yours, or tap Find camps to see how it works.";
    store.set("cf-seen", true);
  }

  window.__cf = { normalise, rigOK, has, score, stepText, makePlan, buildLine, project, sample, parseElements, enrich };
})();
