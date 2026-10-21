/* Badges, states and local time helpers for Camp Finder.
 * CFGeo.stateAt(lat, lon)        -> "QLD" | "NSW" | ... (good enough for badges and sunset times)
 * CFGeo.localTime(date, lat, lon) -> "6:12 pm" in that place's own time zone
 * CFBadges.compute(journeys)     -> { stats, list: [{...badge, earned, progress}] }
 * Everything is worked out on the phone from your own recorded journeys. */
(() => {
  const R = 6371000, rad = Math.PI / 180;
  const hav = (a, b) => { const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  const interp = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts.at(-1)[1]; };
  const MURRAY = [[141, -34.0], [142.16, -34.16], [143.55, -35.34], [144.75, -36.13], [146.92, -36.08], [148.2, -36.8], [150.0, -37.5]];

  function stateAt(lat, lon) {
    if (lat < -39.2) return "TAS";
    if (lon < 129) return "WA";
    if (lon < 138) return lat > -26 ? "NT" : "SA";
    if (lon < 141) return lat > -26 ? "QLD" : "SA";
    if (lat > -35.93 && lat < -35.12 && lon > 148.76 && lon < 149.4) return "ACT";
    const qld = lon <= 148.9 ? -29.0 : -29.0 + (lon - 148.9) * 0.1787;
    if (lat > qld) return "QLD";
    return lat < interp(MURRAY, Math.min(150, lon)) ? "VIC" : "NSW";
  }
  const STATE_NAME = { QLD: "Queensland", NSW: "New South Wales", VIC: "Victoria", TAS: "Tasmania", SA: "South Australia", WA: "Western Australia", NT: "Northern Territory", ACT: "the ACT" };

  // time zones, with daylight saving in the southern states (first Sunday in October to first Sunday in April)
  const firstSunday = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); return 1 + ((7 - d.getUTCDay()) % 7); };
  function utcOffset(state, date) {
    const base = { WA: 8, NT: 9.5, SA: 9.5, QLD: 10, NSW: 10, ACT: 10, VIC: 10, TAS: 10 }[state] ?? 10;
    if (!["SA", "NSW", "ACT", "VIC", "TAS"].includes(state)) return base;
    const y = date.getUTCFullYear();
    const end = Date.UTC(y, 3, firstSunday(y, 3), 3) - (base + 1) * 36e5;   // 3am local, first Sunday in April
    const t = date.getTime();
    const startT = Date.UTC(y, 9, firstSunday(y, 9), 2) - base * 36e5;    // 2am local, first Sunday in October
    return t >= startT || t < end ? base + 1 : base;
  }
  function localTime(date, lat, lon) {
    const st = stateAt(lat, lon), off = utcOffset(st, date);
    const d = new Date(date.getTime() + off * 36e5);
    let h = d.getUTCHours(); const m = d.getUTCMinutes(), pm = h >= 12;
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${pm ? "pm" : "am"}`;
  }
  // minutes past local midnight, for comparing times
  function localMinutes(date, lat, lon) { const off = utcOffset(stateAt(lat, lon), date); const d = new Date(date.getTime() + off * 36e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

  // ---------------------------------------------------------------- badges
  const KM = [[10, "First 10 km", "Your first 10 km on the road"], [100, "Century", "100 km driven"], [500, "500 Club", "500 km driven"], [1000, "1,000 km", "A thousand km of Aussie road"],
    [2500, "Long Haul", "2,500 km driven"], [5000, "5,000 km", "5,000 km under your wheels"], [10000, "10,000 km", "Ten thousand km!"], [14500, "Big Lap Distance", "As far as the whole way round Australia"],
    [25000, "25,000 km", "Seriously well travelled"], [50000, "Road Legend", "50,000 km. Legend."]];
  const HOURS = [[1, "First Hour", "One hour behind the wheel"], [10, "10 Hours", "10 hours of driving"], [24, "A Full Day", "24 hours of driving in total"], [50, "50 Hours", "50 hours on the road"], [100, "100 Hours", "100 hours driving"], [250, "Road Warrior", "250 hours driving"]];
  const NIGHTS = [[1, "First Night Away", "Your first night on the road"], [7, "A Week Away", "7 nights on the road"], [30, "A Month Away", "30 nights on the road"], [100, "Grey Nomad", "100 nights on the road"]];
  const tier = (i, n) => (i < n * 0.3 ? "bronze" : i < n * 0.6 ? "silver" : i < n * 0.9 ? "gold" : "platinum");

  const BIG_THINGS = [[-30.27, 153.13], [-26.67, 152.99], [-28.87, 153.56], [-34.76, 149.69], [-31.12, 150.93], [-20.0, 148.23], [-36.83, 139.86], [-17.93, 145.92], [-36.46, 146.22], [-30.73, 121.47], [-23.38, 150.52]];
  // special places: earned when you pass close to `need` of the points (on any journey, ever)
  const SPECIAL = [
    { id: "gibb", name: "Gibb River Road", emoji: "🏜️", desc: "Drove the Gibb River Road through the Kimberley", r: 15000, need: 3, pts: [[-17.25, 124.3], [-16.98, 125.53], [-16.65, 125.95], [-15.98, 127.06], [-15.78, 128.17]] },
    { id: "nullarbor", name: "Crossed the Nullarbor", emoji: "🐪", desc: "Crossed the Nullarbor Plain on the Eyre Highway", r: 15000, need: 3, pts: [[-31.45, 130.9], [-31.64, 129.0], [-31.68, 128.88], [-32.04, 126.1], [-32.35, 123.62]] },
    { id: "ninety", name: "90 Mile Straight", emoji: "📏", desc: "Drove Australia's longest straight road", r: 10000, need: 2, pts: [[-32.27, 125.49], [-32.33, 124.6]] },
    { id: "uluru", name: "Uluru", emoji: "🪨", desc: "Made it to Uluru in the Red Centre", r: 14000, need: 1, pts: [[-25.345, 131.036]] },
    { id: "kings", name: "Kings Canyon", emoji: "🏞️", desc: "Visited Kings Canyon", r: 10000, need: 1, pts: [[-24.25, 131.57]] },
    { id: "tip", name: "Tip of Australia", emoji: "🧭", desc: "Stood at the northernmost tip, Cape York", r: 8000, need: 1, pts: [[-10.687, 142.531]] },
    { id: "steep", name: "Westernmost Point", emoji: "🌅", desc: "Steep Point, the westernmost point of the mainland", r: 8000, need: 1, pts: [[-26.153, 113.159]] },
    { id: "byron", name: "Easternmost Point", emoji: "🌄", desc: "Cape Byron, first sunrise on the mainland", r: 4000, need: 1, pts: [[-28.638, 153.637]] },
    { id: "prom", name: "Southernmost Point", emoji: "⚓", desc: "Wilsons Promontory, the bottom of the mainland", r: 15000, need: 1, pts: [[-39.0, 146.32]] },
    { id: "gor", name: "Great Ocean Road", emoji: "🌊", desc: "Drove the Great Ocean Road", r: 6000, need: 2, pts: [[-38.665, 143.104], [-38.54, 143.97], [-38.757, 143.67]] },
    { id: "kgari", name: "K'gari", emoji: "🏝️", desc: "Drove on the world's largest sand island", r: 6000, need: 1, pts: [[-25.45, 153.06], [-25.51, 153.13], [-25.33, 153.2], [-24.88, 153.34], [-25.1, 153.29]] },
    { id: "kakadu", name: "Kakadu", emoji: "🐊", desc: "Explored Kakadu National Park", r: 25000, need: 1, pts: [[-12.67, 132.83], [-12.41, 132.96]] },
    { id: "birdsville", name: "Birdsville", emoji: "🍺", desc: "Made it out to Birdsville", r: 6000, need: 1, pts: [[-25.9, 139.35]] },
    { id: "oodna", name: "Oodnadatta Track", emoji: "🛤️", desc: "Drove the Oodnadatta Track", r: 12000, need: 2, pts: [[-29.65, 138.06], [-28.91, 136.34], [-27.55, 135.45]] },
    { id: "savannah", name: "Savannah Way", emoji: "🌾", desc: "Drove the Savannah Way across the top", r: 15000, need: 3, pts: [[-17.67, 141.08], [-17.74, 139.55], [-16.07, 136.31], [-14.73, 134.52]] },
    { id: "explorers", name: "Explorer's Way", emoji: "🧗", desc: "Adelaide to Darwin, right through the middle", r: 15000, need: 5, pts: [[-32.49, 137.77], [-29.01, 134.75], [-23.7, 133.88], [-14.47, 132.26], [-12.46, 130.84]] },
    { id: "biglap", name: "The Big Lap", emoji: "🇦🇺", desc: "Visited every capital and Cairns, Darwin and Broome: the whole way round", r: 30000, need: 9, pts: [[-27.47, 153.03], [-16.92, 145.77], [-12.46, 130.84], [-17.96, 122.24], [-31.95, 115.86], [-34.93, 138.6], [-37.81, 144.96], [-33.87, 151.21], [-35.28, 149.13]] },
    { id: "capetrib", name: "Cape Tribulation", emoji: "🌴", desc: "Where the rainforest meets the reef", r: 8000, need: 1, pts: [[-16.09, 145.46]] },
    { id: "karijini", name: "Karijini", emoji: "🪜", desc: "Explored the gorges of Karijini", r: 25000, need: 1, pts: [[-22.47, 118.56], [-22.63, 118.29]] },
    { id: "ningaloo", name: "Ningaloo Reef", emoji: "🐋", desc: "Made it to the Ningaloo coast", r: 10000, need: 1, pts: [[-21.93, 114.13], [-23.14, 113.77]] },
    { id: "argyle", name: "Lake Argyle", emoji: "🛶", desc: "Visited Lake Argyle in the Kimberley", r: 10000, need: 1, pts: [[-16.11, 128.74]] },
    { id: "cable", name: "Cable Beach", emoji: "🐫", desc: "Sunset on Cable Beach, Broome", r: 6000, need: 1, pts: [[-17.93, 122.21]] },
    { id: "bungle", name: "Bungle Bungles", emoji: "🐝", desc: "Made it into Purnululu and the Bungle Bungles", r: 15000, need: 1, pts: [[-17.47, 128.39]] },
    { id: "cradle", name: "Cradle Mountain", emoji: "⛰️", desc: "Visited Cradle Mountain, Tasmania", r: 8000, need: 1, pts: [[-41.65, 145.94]] },
    { id: "snowy", name: "Snowy Mountains", emoji: "🏔️", desc: "Up in the high country near Kosciuszko", r: 7000, need: 1, pts: [[-36.43, 148.33], [-36.5, 148.3]] },
    { id: "bight", name: "Head of Bight", emoji: "🐳", desc: "Looked out over the Great Australian Bight", r: 7000, need: 1, pts: [[-31.47, 131.16]] },
    { id: "coober", name: "Coober Pedy", emoji: "💎", desc: "Visited the opal capital", r: 8000, need: 1, pts: [[-29.01, 134.75]] },
    { id: "bigthing", name: "Big Thing Spotter", emoji: "🍌", desc: "Saw one of Australia's Big Things", r: 1500, need: 1, pts: BIG_THINGS },
    { id: "bigthings", name: "Big Things Hunter", emoji: "🍍", desc: "Saw five of Australia's Big Things", r: 1500, need: 5, pts: BIG_THINGS },
    { id: "capricorn", name: "Tropic of Capricorn", emoji: "🌞", desc: "Crossed into the tropics", custom: "capricorn" },
  ];

  function statsOf(journeys) {
    const s = { km: 0, hours: 0, nights: 0, journeys: 0, states: new Set(), crossings: 0, hits: {}, capricorn: false };
    SPECIAL.forEach((p) => (s.hits[p.id] = new Set()));
    for (const j of journeys) {
      const pts = (j.points || []).filter((p) => p && p.length >= 3);
      if (!pts.length) continue;
      s.journeys++;
      let prevState = null, pending = null, pendingCount = 0;
      const days = new Set();
      for (let k = 0; k < pts.length; k++) {
        const [t, lat, lon] = pts[k];
        days.add(new Date(t * 1000).toDateString());
        if (k) {
          const [t0, la0, lo0] = pts[k - 1];
          const d = hav([la0, lo0], [lat, lon]), dt = t - t0;
          if (d < 50000) s.km += d / 1000; // ignore GPS jumps
          if (dt > 0 && dt <= 900 && d / dt > 2.8) s.hours += dt / 3600;
          if ((la0 > -23.44) !== (lat > -23.44)) s.capricorn = true;
        }
        const st = stateAt(lat, lon);
        s.states.add(st);
        if (prevState == null) prevState = st;
        else if (st !== prevState) { if (st === pending) { if (++pendingCount >= 2) { s.crossings++; prevState = st; pending = null; } } else { pending = st; pendingCount = 1; } }
        else pending = null;
        for (const sp of SPECIAL) {
          if (!sp.pts) continue;
          sp.pts.forEach((q, i) => { if (Math.abs(q[0] - lat) < 0.35 && Math.abs(q[1] - lon) < 0.4 && hav(q, [lat, lon]) <= sp.r) s.hits[sp.id].add(i); });
        }
      }
      s.nights += Math.max(0, days.size - 1);
    }
    return s;
  }

  function compute(journeys) {
    const s = statsOf(journeys);
    const list = [];
    const ladder = (group, rows, val, unit, icon) => rows.forEach(([n, name, desc], i) => list.push({ id: `${group}-${n}`, group, name, desc, icon, tier: tier(i, rows.length), earned: val >= n, progress: Math.min(1, val / n), target: `${n.toLocaleString("en-AU")} ${unit}` }));
    ladder("km", KM, s.km, "km", "🛣️");
    ladder("hours", HOURS, s.hours, "hours", "⏱️");
    ladder("nights", NIGHTS, s.nights, "nights", "🌙");
    list.push({ id: "journey-1", group: "journeys", name: "First Journey", desc: "Started and recorded your first journey", icon: "🚙", tier: "bronze", earned: s.journeys >= 1, progress: Math.min(1, s.journeys) });
    // states and territories
    for (const st of ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"]) list.push({ id: `state-${st}`, group: "states", name: st === "ACT" ? "The ACT" : STATE_NAME[st], short: st, desc: `Drove in ${STATE_NAME[st]}`, icon: st, tier: "state", earned: s.states.has(st), progress: s.states.has(st) ? 1 : 0 });
    list.push({ id: "border-1", group: "states", name: "Border Crosser", desc: "Drove across a state border", icon: "🚧", tier: "silver", earned: s.crossings >= 1, progress: Math.min(1, s.crossings) });
    list.push({ id: "border-10", group: "states", name: "Border Hopper", desc: "Crossed state borders 10 times", icon: "🔀", tier: "gold", earned: s.crossings >= 10, progress: Math.min(1, s.crossings / 10) });
    list.push({ id: "states-all", group: "states", name: "All of Australia", desc: "Drove in every state and territory", icon: "🏆", tier: "platinum", earned: s.states.size >= 8, progress: s.states.size / 8 });
    for (const sp of SPECIAL) {
      const got = sp.custom === "capricorn" ? (s.capricorn ? 1 : 0) : s.hits[sp.id].size;
      const need = sp.need || 1;
      list.push({ id: `place-${sp.id}`, group: "places", name: sp.name, desc: sp.desc, icon: sp.emoji, tier: "special", earned: got >= need, progress: Math.min(1, got / need), target: need > 1 ? `${got} of ${need} spots` : "" });
    }
    return { stats: { km: s.km, hours: s.hours, nights: s.nights, journeys: s.journeys, states: [...s.states], crossings: s.crossings }, list };
  }

  window.CFGeo = { stateAt, STATE_NAME, utcOffset, localTime, localMinutes, hav };
  window.CFBadges = { compute, SPECIAL };
})();
