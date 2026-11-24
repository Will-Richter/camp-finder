/* Route options: the main ways to drive between two places (the "Route options" and "Routes home" panels).
 *
 * Long trips use a sketch of Australia's highway network: the towns where the main roads meet and the roads between
 * them, with the big dirt roads marked. Its different corridors (Bundaberg to Exmouth: across the top through
 * Katherine and Broome, through the centre past Alice Springs and Uluru, or along the bottom over the Nullarbor)
 * are each routed for real through the few towns that keep the route on that corridor. Shorter trips also try towns
 * either side of the fastest route. Options that mostly share the same roads are dropped, and each one is named
 * after the places only it goes through.
 *
 *   CFRoutes.choices(a, b, base, opts) -> Promise<[option]>
 *     a, b              {lat, lon}: start and end
 *     base              the fastest route: { distance, duration, geometry: { coordinates: [[lon, lat]] } }
 *     opts.route(pts)   routes through [{lat, lon}, ...] (start, stops, end) -> Promise<route>
 *     opts.townNear     (lat, lon) -> {name, lat, lon} | null, for the shorter-trip options
 *     opts.mine         your own stops, kept in every option
 *     opts.current      { key, pts }: the option you're on now, so it's always in the list
 *     opts.max          most options to find (5)
 *     opts.onUpdate     (list) => {}: called as options are found
 *     opts.stop         () => true to give up early (the panel was closed)
 *     opts.log          (text) => {}: what happened to each way it tried (for checking)
 *   option: { key, title, phrase, pts: [{name, lat, lon}], route, line, dirt: ["the Tanami"], fastest, cur, base }
 *
 *   CFRoutes.corridors(a, b)              the distinct ways through the highway sketch
 *   CFRoutes.forcing(a, b, corridor, line) the towns to route through to stay on a corridor (null: the line already does)
 *   CFRoutes.describe(line, a, b, others)  "the Nullarbor and Perth": the places that say which way a route goes
 *   CFRoutes.dirtOn(line)                  ["the Tanami"]: big dirt roads the route uses
 */
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  function hav(a, b) { // [lat, lon] pairs, metres
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const ll = (p) => [p.lat, p.lon];

  // ---- The highway sketch. [id, name, lat, lon, fame, flag]
  // fame: how well known the name is (3 = everyone knows it), used to name the options.
  // flag "j": a roadhouse junction, only there to join roads up (never routed through on purpose, never named).
  const HUBS = [
    // Queensland
    ["BNE", "Brisbane", -27.469, 153.024, 3], ["TWB", "Toowoomba", -27.561, 151.953, 2], ["WRW", "Warwick", -28.216, 152.033, 1],
    ["GYM", "Gympie", -26.19, 152.66, 1], ["MBH", "Maryborough", -25.538, 152.702, 1], ["BDB", "Bundaberg", -24.865, 152.352, 2],
    ["GLT", "Gladstone", -23.843, 151.256, 1], ["ROK", "Rockhampton", -23.378, 150.513, 2], ["BIL", "Biloela", -24.4, 150.514, 1],
    ["MLS", "Miles", -26.66, 150.186, 1], ["RMA", "Roma", -26.571, 148.787, 1], ["RLS", "Rolleston", -24.463, 148.623, 1],
    ["EMD", "Emerald", -23.526, 148.162, 1], ["CLM", "Clermont", -22.825, 147.64, 1], ["MKY", "Mackay", -21.142, 149.187, 2],
    ["TSV", "Townsville", -19.257, 146.824, 3], ["CNS", "Cairns", -16.921, 145.772, 3], ["MRB", "Mareeba", -16.993, 145.422, 1],
    ["GTN", "Georgetown", -18.29, 143.548, 1], ["NTN", "Normanton", -17.671, 141.078, 1], ["BKT", "Burketown", -17.74, 139.547, 1],
    ["CHT", "Charters Towers", -20.071, 146.271, 1], ["HGD", "Hughenden", -20.842, 144.2, 1], ["CCY", "Cloncurry", -20.705, 140.506, 1],
    ["ISA", "Mount Isa", -20.729, 139.493, 2], ["WIN", "Winton", -22.385, 143.036, 2], ["LRE", "Longreach", -23.438, 144.259, 2],
    ["BCA", "Barcaldine", -23.555, 145.287, 1], ["CTL", "Charleville", -26.406, 146.242, 1], ["QLP", "Quilpie", -26.615, 144.27, 1],
    ["WDR", "Windorah", -25.42, 142.655, 1], ["BVI", "Birdsville", -25.898, 139.352, 2], ["BQL", "Boulia", -22.91, 139.911, 1],
    ["CNM", "Cunnamulla", -28.071, 145.684, 1], ["STG", "St George", -28.037, 148.581, 1], ["GDW", "Goondiwindi", -28.547, 150.307, 1],
    // New South Wales and the ACT
    ["GFN", "Grafton", -29.691, 152.933, 1], ["CFS", "Coffs Harbour", -30.296, 153.114, 2], ["PQQ", "Port Macquarie", -31.43, 152.91, 2],
    ["NCL", "Newcastle", -32.927, 151.781, 2], ["SYD", "Sydney", -33.87, 151.208, 3], ["KTB", "the Blue Mountains", -33.714, 150.312, 2],
    ["TNT", "Tenterfield", -29.048, 152.018, 1], ["ARM", "Armidale", -30.514, 151.666, 1], ["TMW", "Tamworth", -31.09, 150.929, 2],
    ["MOR", "Moree", -29.462, 149.841, 1], ["NBI", "Narrabri", -30.33, 149.781, 1], ["CBN", "Coonabarabran", -31.273, 149.273, 1],
    ["WLG", "Walgett", -30.022, 148.118, 1], ["DBO", "Dubbo", -32.248, 148.603, 2], ["BTH", "Bathurst", -33.417, 149.58, 1],
    ["ORG", "Orange", -33.282, 149.097, 1], ["PKS", "Parkes", -33.137, 148.175, 1], ["WWY", "West Wyalong", -33.924, 147.205, 1],
    ["NAR", "Narrandera", -34.748, 146.551, 1], ["WGA", "Wagga Wagga", -35.114, 147.37, 2], ["GDG", "Gundagai", -35.063, 148.101, 1],
    ["GLB", "Goulburn", -34.752, 149.72, 1], ["CBR", "Canberra", -35.298, 149.101, 3], ["CMA", "Cooma", -36.236, 149.126, 1],
    ["BTB", "Batemans Bay", -35.707, 150.178, 1], ["BGA", "Bega", -36.674, 149.842, 1], ["ALB", "Albury", -36.08, 146.916, 2],
    ["HAY", "Hay", -34.509, 144.844, 1], ["NYN", "Nyngan", -31.563, 147.197, 1], ["BRK", "Bourke", -30.091, 145.943, 1],
    ["CBA", "Cobar", -31.498, 145.834, 1], ["WLC", "Wilcannia", -31.559, 143.375, 1], ["BKH", "Broken Hill", -31.965, 141.451, 2],
    ["TOC", "Tocumwal", -35.811, 145.565, 1],
    // Victoria
    ["MEL", "Melbourne", -37.814, 144.963, 3], ["GEE", "Geelong", -38.149, 144.36, 1], ["APB", "the Great Ocean Road", -38.755, 143.669, 3],
    ["WBL", "Warrnambool", -38.383, 142.481, 1], ["BRT", "Ballarat", -37.562, 143.861, 2], ["BDG", "Bendigo", -36.759, 144.283, 2],
    ["SHP", "Shepparton", -36.383, 145.399, 1], ["HSM", "Horsham", -36.715, 142.202, 1], ["OUY", "Ouyen", -35.069, 142.316, 1],
    ["MIL", "Mildura", -34.195, 142.15, 2], ["BRN", "Bairnsdale", -37.825, 147.63, 1],
    // South Australia
    ["ADL", "Adelaide", -34.928, 138.6, 3], ["TLB", "Tailem Bend", -35.253, 139.453, 1], ["BDT", "Bordertown", -36.311, 140.773, 1],
    ["MTG", "Mount Gambier", -37.83, 140.784, 2], ["RMK", "Renmark", -34.174, 140.747, 1], ["YNT", "Yunta", -32.58, 139.564, 1],
    ["PAG", "Port Augusta", -32.491, 137.764, 2], ["PLN", "Port Lincoln", -34.721, 135.859, 2], ["CDA", "Ceduna", -32.126, 133.674, 1],
    ["CBP", "Coober Pedy", -29.013, 134.754, 2], ["MLA", "Marla", -27.303, 133.622, 1], ["ODN", "Oodnadatta", -27.547, 135.447, 1],
    ["HWK", "Hawker", -31.888, 138.423, 1], ["LYN", "Lyndhurst", -30.288, 138.349, 1], ["MRE", "Marree", -29.647, 138.064, 1],
    // Northern Territory
    ["DRW", "Darwin", -12.46, 130.841, 3], ["JAB", "Kakadu", -12.674, 132.837, 3], ["KTR", "Katherine", -14.465, 132.264, 2],
    ["DLW", "Daly Waters", -16.31, 133.42, 0, "j"], ["BRL", "Borroloola", -16.059, 136.305, 1], ["BKY", "Barkly Homestead", -19.71, 135.83, 0, "j"],
    ["TWY", "Three Ways", -19.43, 134.21, 0, "j"], ["TCK", "Tennant Creek", -19.648, 134.19, 1], ["ASP", "Alice Springs", -23.698, 133.881, 3],
    ["ERL", "Erldunda", -25.205, 133.2, 0, "j"], ["YLR", "Uluru", -25.241, 130.987, 3],
    // Along the long empty roads, so each has a way of its own through the sketch. Flag "m": a spot on the road itself
    // (a rest area or roadhouse, from OpenStreetMap) that a route can be sent through to keep it on that road;
    // flag "j": only roughly placed, never routed through.
    ["RFT", "the Tanami", -21.2777, 130.8493, 0, "m"], ["JRV", "the Plenty Highway", -22.9535, 136.1518, 0, "m"],
    ["MTB", "the Gibb River Road", -16.71668, 125.92752, 0, "m"], ["HGT", "Hells Gate", -17.45, 138.36, 0, "j"],
    ["MUN", "Mungerannie", -28.01, 138.66, 0, "j"], ["WCK", "William Creek", -28.91, 136.34, 0, "j"], ["EUC", "Eucla", -31.68, 128.88, 0, "j"],
    // Western Australia
    ["WBT", "Warburton", -26.136, 126.579, 1], ["LAV", "Laverton", -28.626, 122.403, 1], ["LEO", "Leonora", -28.884, 121.331, 1],
    ["KAL", "Kalgoorlie", -30.746, 121.473, 2], ["CGD", "Coolgardie", -30.951, 121.162, 1], ["NRS", "Norseman", -32.198, 121.779, 1],
    ["ESP", "Esperance", -33.858, 121.893, 2], ["ALY", "Albany", -35.025, 117.884, 2], ["BUN", "Bunbury", -33.327, 115.637, 1],
    ["PER", "Perth", -31.956, 115.861, 3], ["GER", "Geraldton", -28.783, 114.626, 2], ["MTM", "Mount Magnet", -28.065, 117.848, 1],
    ["MKA", "Meekatharra", -26.593, 118.496, 1], ["NMN", "Newman", -23.357, 119.733, 1], ["TPR", "Tom Price", -22.689, 117.797, 1],
    ["CRV", "Carnarvon", -24.884, 113.657, 2], ["EXM", "Exmouth", -21.932, 114.126, 2], ["NNT", "Nanutarra", -22.545, 115.497, 0, "j"], ["KTA", "Karratha", -20.737, 116.848, 2],
    ["PHE", "Port Hedland", -20.311, 118.58, 2], ["FTZ", "Fitzroy Crossing", -18.193, 125.567, 1], ["DBY", "Derby", -17.303, 123.629, 1],
    ["HCK", "Halls Creek", -18.225, 127.668, 1], ["KNX", "Kununurra", -15.773, 128.739, 2],
  ];
  // [from, to, road km, flag]   flag "d": mostly dirt
  const ROADS = [
    // Queensland coast and inland
    ["BNE", "GYM", 165], ["GYM", "MBH", 90], ["MBH", "BDB", 105], ["MBH", "GLT", 270], ["BDB", "GLT", 185], ["BDB", "BIL", 250],
    ["GLT", "ROK", 110], ["GLT", "BIL", 120], ["ROK", "BIL", 140], ["ROK", "MKY", 335], ["MKY", "TSV", 390], ["TSV", "CNS", 345],
    ["CNS", "MRB", 65], ["MRB", "GTN", 340], ["GTN", "NTN", 300], ["NTN", "CCY", 375], ["NTN", "BKT", 230, "d"], ["BKT", "HGT", 170, "d"], ["HGT", "BRL", 310, "d"],
    ["TSV", "CHT", 135], ["CHT", "HGD", 245], ["HGD", "CCY", 335], ["HGD", "WIN", 215], ["CHT", "CLM", 380], ["CLM", "EMD", 105],
    ["CLM", "MKY", 275], ["ROK", "EMD", 270], ["EMD", "BCA", 300], ["EMD", "RLS", 140], ["RLS", "BIL", 275], ["RLS", "RMA", 260],
    ["BCA", "LRE", 105], ["LRE", "WIN", 175], ["WIN", "CCY", 345], ["CCY", "ISA", 120], ["WIN", "BQL", 360], ["BQL", "ISA", 300],
    ["BQL", "BVI", 390, "d"], ["BVI", "WDR", 380, "d"], ["WDR", "QLP", 240], ["QLP", "CTL", 210], ["BCA", "CTL", 405], ["CTL", "RMA", 270],
    ["CTL", "CNM", 200], ["RMA", "MLS", 140], ["MLS", "TWB", 210], ["MLS", "BIL", 280], ["MLS", "GDW", 215], ["TWB", "BNE", 125],
    ["TWB", "WRW", 85], ["TWB", "GDW", 220], ["BNE", "WRW", 155], ["WRW", "GDW", 220], ["WRW", "TNT", 115], ["RMA", "STG", 235],
    ["STG", "GDW", 200], ["STG", "CNM", 290], ["STG", "WLG", 300], ["CNM", "BRK", 260], ["GDW", "MOR", 135],
    // New South Wales and the ACT
    ["BNE", "GFN", 325], ["GFN", "CFS", 85], ["CFS", "PQQ", 160], ["PQQ", "NCL", 250], ["NCL", "SYD", 160], ["TNT", "ARM", 190],
    ["ARM", "TMW", 110], ["TMW", "NCL", 280], ["PQQ", "TMW", 270], ["TMW", "CBN", 180], ["MOR", "NBI", 100], ["NBI", "CBN", 120],
    ["MOR", "WLG", 215], ["WLG", "DBO", 285], ["WLG", "BRK", 235], ["CBN", "DBO", 155], ["DBO", "NYN", 165], ["NYN", "BRK", 205],
    ["NYN", "CBA", 130], ["BRK", "CBA", 160], ["CBA", "WLC", 260], ["WLC", "BKH", 195], ["DBO", "ORG", 150], ["ORG", "BTH", 55],
    ["BTH", "KTB", 100], ["KTB", "SYD", 100], ["DBO", "PKS", 120], ["PKS", "ORG", 105], ["PKS", "WWY", 135], ["WWY", "NAR", 120],
    ["NAR", "TOC", 160], ["TOC", "SHP", 75], ["SHP", "MEL", 190], ["NAR", "WGA", 100], ["NAR", "HAY", 170], ["WGA", "GDG", 85],
    ["WGA", "ALB", 140], ["GDG", "ALB", 175], ["GDG", "CBR", 160], ["GDG", "GLB", 185], ["CBR", "GLB", 90], ["GLB", "SYD", 195],
    ["CBR", "CMA", 115], ["CMA", "BGA", 115], ["CBR", "BTB", 150], ["SYD", "BTB", 280], ["BTB", "BGA", 145], ["BGA", "BRN", 350],
    ["HAY", "MIL", 295], ["HAY", "BDG", 300], ["HAY", "WWY", 255], ["BKH", "MIL", 300], ["BKH", "YNT", 200],
    // Victoria
    ["ALB", "MEL", 325], ["MEL", "BRT", 115], ["BRT", "HSM", 190], ["HSM", "BDT", 150], ["MEL", "BDG", 150], ["BDG", "SHP", 115],
    ["BDG", "OUY", 300], ["BDG", "BRT", 120], ["MIL", "OUY", 105], ["OUY", "TLB", 285], ["MEL", "GEE", 75], ["GEE", "APB", 115],
    ["APB", "WBL", 160], ["GEE", "WBL", 190], ["WBL", "MTG", 190], ["MEL", "BRN", 285],
    // South Australia
    ["BDT", "TLB", 185], ["TLB", "ADL", 100], ["MTG", "TLB", 340], ["MTG", "BDT", 180], ["MIL", "RMK", 140], ["RMK", "ADL", 255],
    ["ADL", "PAG", 310], ["ADL", "YNT", 315], ["YNT", "PAG", 215], ["PAG", "HWK", 110], ["HWK", "LYN", 190], ["LYN", "MRE", 80],
    ["PAG", "CDA", 470], ["PAG", "PLN", 340], ["PLN", "CDA", 400], ["PAG", "CBP", 540], ["CBP", "MLA", 235], ["CBP", "ODN", 195, "d"],
    ["MLA", "ERL", 255], ["MRE", "WCK", 205, "d"], ["WCK", "ODN", 200, "d"], ["ODN", "MLA", 210, "d"], ["MRE", "MUN", 205, "d"], ["MUN", "BVI", 315, "d"],
    ["CDA", "EUC", 495], ["EUC", "NRS", 715],
    // Northern Territory
    ["ERL", "ASP", 200], ["ERL", "YLR", 245], ["ASP", "TCK", 505], ["TCK", "TWY", 25], ["TWY", "DLW", 375], ["DLW", "KTR", 270],
    ["KTR", "DRW", 315], ["DRW", "JAB", 255], ["JAB", "KTR", 305], ["TWY", "BKY", 210], ["BKY", "ISA", 430], ["BKY", "BRL", 485],
    ["DLW", "BRL", 380], ["KTR", "KNX", 510], ["YLR", "WBT", 560, "d"], ["WBT", "LAV", 565, "d"], ["ASP", "RFT", 440, "d"], ["RFT", "HCK", 600, "d"],
    ["ASP", "JRV", 410, "d"], ["JRV", "BQL", 405, "d"],
    // Western Australia
    ["KNX", "HCK", 360], ["HCK", "FTZ", 290], ["FTZ", "DBY", 255], ["FTZ", "PHE", 935], ["DBY", "PHE", 770], ["DBY", "MTB", 300, "d"], ["MTB", "KNX", 400, "d"],
    ["PHE", "KTA", 240], ["KTA", "NNT", 290], ["NNT", "CRV", 380], ["CRV", "GER", 480], ["GER", "PER", 420], ["PHE", "NMN", 450],
    ["NMN", "MKA", 425], ["MKA", "MTM", 195], ["MTM", "PER", 560], ["MTM", "GER", 340], ["MTM", "LEO", 400, "d"], ["MKA", "LEO", 480, "d"],
    ["LEO", "KAL", 235], ["LEO", "LAV", 125], ["KAL", "CGD", 40], ["CGD", "NRS", 170], ["KAL", "NRS", 190], ["CGD", "PER", 560],
    ["NRS", "ESP", 205], ["ESP", "ALY", 480], ["ALY", "PER", 420], ["PER", "BUN", 175], ["BUN", "ALY", 360], ["NMN", "TPR", 290],
    ["TPR", "NNT", 375], ["TPR", "PHE", 450], ["EXM", "NNT", 270], ["EXM", "CRV", 360],
  ];
  // Places that name a route without being a junction, and the big dirt roads (a route within `tol` km of the
  // point goes along that road). [name, lat, lon, fame, tol km, flag "d" = dirt road]
  const MARKS = [
    ["Broome", -17.957, 122.224, 3, 45],
    ["the Nullarbor", -31.45, 130.9, 3, 30],
    // the big dirt roads, by rest areas and roadhouses on them (OpenStreetMap)
    ["the Tanami", -22.4667, 132.1025, 3, 20, "d"], ["the Tanami", -21.2777, 130.8493, 3, 20, "d"], ["the Tanami", -19.895, 129.0242, 3, 20, "d"],
    ["the Great Central Road", -25.04287, 128.30328, 2, 20, "d"], ["the Great Central Road", -27.15525, 124.57481, 2, 20, "d"],
    ["the Plenty Highway", -22.98386, 134.93554, 2, 20, "d"], ["the Plenty Highway", -22.95105, 136.14307, 2, 20, "d"], ["the Plenty Highway", -22.2743, 137.97387, 2, 25, "d"],
    ["the Gibb River Road", -16.71668, 125.92752, 3, 20, "d"], ["the Gibb River Road", -17.14916, 125.45938, 3, 20, "d"], ["the Gibb River Road", -15.7223, 127.8313, 3, 20, "d"],
    ["the Savannah Way", -17.45, 138.36, 2, 35, "d"], ["the Savannah Way", -16.77, 136.97, 2, 40, "d"],
    ["the Birdsville Track", -28.01, 138.66, 3, 35, "d"],
    ["the Oodnadatta Track", -28.91, 136.34, 3, 30, "d"], ["the Oodnadatta Track", -27.547, 135.447, 3, 15, "d"],
  ];

  let G = null;
  function graph() {
    if (G) return G;
    const hubs = new Map(), adj = new Map();
    for (const [id, name, lat, lon, fame, fl] of HUBS) { hubs.set(id, { id, name, lat, lon, fame, j: fl === "j", m: fl === "m" }); adj.set(id, []); }
    for (const [x, y, km, fl] of ROADS) {
      if (!hubs.has(x) || !hubs.has(y)) throw new Error(`routes.js: unknown town in road ${x}-${y}`);
      const key = x < y ? `${x}-${y}` : `${y}-${x}`, dirt = fl === "d";
      adj.get(x).push({ to: y, km, dirt, key }); adj.get(y).push({ to: x, km, dirt, key });
    }
    const marks = [
      ...[...hubs.values()].filter((h) => !h.j && !h.m && h.fame > 0).map((h) => ({ name: h.name, lat: h.lat, lon: h.lon, fame: h.fame, tol: 20000, dirt: false })),
      ...MARKS.map(([name, lat, lon, fame, tol, fl]) => ({ name, lat, lon, fame, tol: tol * 1000, dirt: fl === "d" })),
    ];
    return (G = { hubs, adj, marks });
  }

  // Joins the start (A) and end (B) to the sketch: to the nearest town, and to other nearby towns that aren't
  // simply further along the same way (by a straight line and a quarter, roads being a bit longer)
  function endEdges(a, b) {
    const { hubs } = graph();
    const near = (p) => {
      const all = [...hubs.values()].map((h) => ({ h, d: hav(ll(p), ll(h)) })).sort((x, y) => x.d - y.d), out = [];
      for (const x of all) {
        if (out.length >= 4 || (out.length && x.d > 350000)) break;
        if (out.some((g) => g.d + hav(ll(g.h), ll(x.h)) < 1.25 * x.d)) continue;   // behind a town we already join
        out.push(x);
      }
      return out;
    };
    const ex = new Map();
    const link = (u, v, d) => { const l = ex.get(u) || []; l.push({ to: v, km: d / 1000 * 1.25, dirt: false, key: `${u < v ? u : v}-${u < v ? v : u}`, access: true }); ex.set(u, l); };
    for (const { h, d } of near(a)) { link("A", h.id, d); link(h.id, "A", d); }
    for (const { h, d } of near(b)) { link("B", h.id, d); link(h.id, "B", d); }
    return ex;
  }
  // Cheapest paths on the sketch from one place (Dijkstra; it's small enough for a plain list). The start and end
  // only join the sketch, they're never a way through. With `to`, stops there.
  function tree(from, cost, ex, to) {
    const dist = new Map([[from, 0]]), prev = new Map(), done = new Set(), open = [[0, from]];
    while (open.length) {
      let mi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
      const [d, u] = open[mi]; open[mi] = open[open.length - 1]; open.pop();
      if (done.has(u)) continue; done.add(u);
      if (u === to) break;
      if ((u === "A" || u === "B") && u !== from) continue;
      for (const e of [...(G.adj.get(u) || []), ...(ex.get(u) || [])]) {
        const nd = d + cost(e);
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { u, e }); open.push([nd, e.to]); }
      }
    }
    return { dist, prev, from };
  }
  function pathTo(t, to) {
    if (to !== t.from && !t.prev.has(to)) return null;
    const nodes = [to], edges = [];
    for (let v = to; v !== t.from;) { const p = t.prev.get(v); edges.unshift(p.e); nodes.unshift(p.u); v = p.u; }
    return { nodes, edges };
  }
  const search = (from, to, cost, ex) => pathTo(tree(from, cost, ex, to), to);
  function via(seq, cost, ex) {
    const nodes = [seq[0]], edges = [];
    for (let i = 1; i < seq.length; i++) {
      const p = search(seq[i - 1], seq[i], cost, ex); if (!p) return null;
      nodes.push(...p.nodes.slice(1)); edges.push(...p.edges);
    }
    return { nodes, edges };
  }
  const kmOf = (edges) => edges.reduce((s, e) => s + e.km, 0);

  // The distinct ways through the sketch: for every town, the best way that goes through it (best way there plus
  // best way on), cheapest first, keeping each one that's at least 30% on different roads to those already kept and
  // doesn't go into a town and straight back out. A km of dirt counts as two of bitumen. They come back most
  // different first: the best way, then whichever shares least with those before it (across the top, then along the
  // bottom, then through the centre), so a router asked for the first few gets the big choices before variations.
  const DIRT = 2;
  function corridors(a, b, { max = 6, limit = 1.5 } = {}) {
    graph();
    if (hav(ll(a), ll(b)) < 250000) return [];
    const ex = endEdges(a, b), w = (e) => e.km * (e.dirt ? DIRT : 1);
    const ta = tree("A", w, ex), tb = tree("B", w, ex);
    const best = ta.dist.get("B");
    if (!(best < Infinity)) return [];
    const cand = [...G.hubs.keys()].filter((id) => ta.dist.has(id) && tb.dist.has(id))
      .map((id) => ({ id, cost: ta.dist.get(id) + tb.dist.get(id) })).filter((c) => c.cost <= best * limit).sort((x, y) => x.cost - y.cost);
    const all = [];
    const shared = (p, q) => kmOf(p.inner.filter((e) => q.keys.has(e.key))) / p.km;   // how much of p is on q's roads
    for (const { id, cost } of cand) {
      if (all.length >= 14) break;
      const there = pathTo(ta, id), on = pathTo(tb, id);
      if (!there || !on) continue;
      const back = { nodes: [...on.nodes].reverse(), edges: [...on.edges].reverse() };
      const used = new Set(there.edges.map((e) => e.key));
      if (back.edges.some((e) => used.has(e.key))) continue;   // in and back out the same road
      const nodes = [...there.nodes, ...back.nodes.slice(1)];
      if (new Set(nodes).size !== nodes.length) continue;      // loops back on itself
      const edges = [...there.edges, ...back.edges], inner = edges.filter((e) => !e.access);
      if (!inner.length) continue;
      const c = { nodes: nodes.filter((n) => n !== "A" && n !== "B"), inner, keys: new Set(inner.map((e) => e.key)), km: kmOf(inner), cost, dirt: inner.some((e) => e.dirt), via: id };
      if (all.some((q) => shared(c, q) >= 0.7 || shared(q, c) >= 0.7)) continue;
      all.push(c);
    }
    const out = all.splice(0, 1);
    while (out.length < max && all.length) {
      let bi = 0, bv = Infinity;
      all.forEach((c, i) => { const v = Math.max(...out.map((q) => shared(c, q))); if (v < bv - 0.05 || (Math.abs(v - bv) <= 0.05 && c.cost < all[bi].cost)) { bv = v; bi = i; } });
      out.push(all.splice(bi, 1)[0]);
    }
    return out;
  }

  // Which of a corridor's towns to route through so a road router stays on it. Starts with the town furthest from
  // the route you'd get anyway (`line`), then keeps adding the corridor town furthest from where a router would
  // still go (worked out on the sketch, both for a router that happily takes dirt roads and one that avoids them)
  // until both would follow the corridor.
  const SIMS = [1, 3];
  function forcing(a, b, cor, line) {
    graph();
    const ex = endEdges(a, b), target = cor.nodes, keys = cor.keys || new Set(cor.inner.map((e) => e.key));
    const pinnable = target.filter((id) => { const h = G.hubs.get(id); return !h.j && hav(ll(h), ll(a)) > 60000 && hav(ll(h), ll(b)) > 60000; });
    if (!pinnable.length) return null;
    let first = pinnable[0];
    if (line) {
      let far = -1;
      for (const id of pinnable) { const d = offLine(line, G.hubs.get(id)); if (d > far) { far = d; first = id; } }
      if (far < 50000) return null;   // the route you'd get anyway already goes this way
    }
    const S = [first];
    for (let k = 0; k < 7; k++) {
      let next = null, nd = 40000;
      for (const dw of SIMS) {
        const sim = via(["A", ...S, "B"], (e) => e.km * (e.dirt ? dw : 1), ex);
        if (!sim) return null;
        const inner = sim.edges.filter((e) => !e.access), total = kmOf(inner) || 1;
        if (kmOf(inner.filter((e) => keys.has(e.key))) / total >= 0.9) continue;
        const chain = [a, ...sim.nodes.filter((n) => n !== "A" && n !== "B").map((id) => G.hubs.get(id)), b];
        for (const id of pinnable) { if (S.includes(id)) continue; const d = chainDist(G.hubs.get(id), chain); if (d > nd) { nd = d; next = id; } }
        if (next) break;
      }
      if (!next) break;
      S.push(next); S.sort((x, y) => target.indexOf(x) - target.indexOf(y));
    }
    return S.map((id) => { const h = G.hubs.get(id); return { name: h.name, lat: h.lat, lon: h.lon }; });
  }
  // distance from a point to a chain of places joined by straight lines (flat-earth, fine at this scale)
  function chainDist(p, chain) {
    let best = Infinity;
    for (let i = 1; i < chain.length; i++) {
      const A = chain[i - 1], B = chain[i], kx = 111320 * Math.cos(p.lat * RAD), ky = 110540;
      const bx = (B.lon - A.lon) * kx, by = (B.lat - A.lat) * ky, px = (p.lon - A.lon) * kx, py = (p.lat - A.lat) * ky;
      const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
      best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
    }
    return best;
  }

  // ---- Route lines: [lat, lon] points with distance along
  function buildLine(route) {
    const pts = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] || 0 };
  }
  function sample(line, step) {
    const out = [line.pts[0]]; let next = step;
    for (let i = 1; i < line.pts.length; i++) if (line.cum[i] >= next) { out.push(line.pts[i]); next = line.cum[i] + step; }
    out.push(line.pts[line.pts.length - 1]);
    return out;
  }
  // every ~4 km with distance along, for the "how close does it go" checks
  function steps(line) {
    if (line._st) return line._st;
    const out = [[...line.pts[0], 0]]; let next = 4000;
    for (let i = 1; i < line.pts.length; i++) if (line.cum[i] >= next) { out.push([...line.pts[i], line.cum[i]]); next = line.cum[i] + 4000; }
    out.push([...line.pts[line.pts.length - 1], line.total]);
    let s = 90, n = -90, w = 180, e = -180;
    for (const q of out) { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }
    out.box = [s, w, n, e];
    return (line._st = out);
  }
  function offLine(line, p) {
    let best = Infinity;
    for (const q of steps(line)) { const d = hav(q, [p.lat, p.lon]); if (d < best) best = d; }
    return best;
  }
  function pointAt(line, along) {
    let i = line.cum.findIndex((c) => c >= along); if (i < 0) i = line.pts.length - 1;
    return { lat: line.pts[i][0], lon: line.pts[i][1] };
  }
  // route points bucketed into ~25 km cells, so "is this point on that route" is quick
  function cells(line) {
    if (line._g) return line._g;
    const g = new Map();
    line.pts.forEach((p, i) => { const k = `${Math.floor(p[0] * 4)}:${Math.floor(p[1] * 4)}`; let c = g.get(k); if (!c) g.set(k, (c = [])); c.push(i); });
    return (line._g = g);
  }
  function near(line, q, m) {
    const g = cells(line), cy = Math.floor(q[0] * 4), cx = Math.floor(q[1] * 4);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = g.get(`${cy + dy}:${cx + dx}`); if (!c) continue;
      for (const i of c) if (hav(line.pts[i], q) < m) return true;
    }
    return false;
  }
  // how much of `line` runs along `ref` (0 to 1), ignoring the first and last few km
  function share(line, ref) {
    const pts = sample(line, 5000).slice(3, -3); if (!pts.length) return 1;
    let on = 0; for (const q of pts) if (near(ref, q, 3000)) on++;
    return on / pts.length;
  }

  // ---- Naming routes after the places they go through
  function landmarks(line) {
    if (line._lm) return line._lm;
    const st = steps(line), [s, w, n, e] = st.box, out = [];
    for (const m of graph().marks) {
      if (m.lat < s - 0.6 || m.lat > n + 0.6 || m.lon < w - 0.6 || m.lon > e + 0.6) continue;
      let best = Infinity, at = 0;
      for (const q of st) { const d = hav(q, [m.lat, m.lon]); if (d < best) { best = d; at = q[2]; } }
      if (best <= m.tol) out.push({ ...m, along: at });
    }
    out.sort((x, y) => x.along - y.along);
    const seen = new Set();
    return (line._lm = out.filter((x) => !seen.has(x.name) && seen.add(x.name)));
  }
  function dirtOn(line) { return landmarks(line).filter((m) => m.dirt).map((m) => m.name); }
  const join = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  // Ranked places that say which way this line goes: well-known ones, towards the middle of the trip, that the
  // other lines don't go through. The start and end don't count.
  function ranked(line, a, b, others = []) {
    const total = line.total || 1, oth = others.map(landmarks);
    return landmarks(line).filter((m) => hav(ll(m), ll(a)) > 120000 && hav(ll(m), ll(b)) > 120000).map((m) => {
      const shared = oth.filter((l) => l.some((x) => x.name === m.name)).length;
      if (oth.length && shared === oth.length) return null;   // every way goes past it
      const mid = 1 - Math.abs(m.along / total - 0.5) * 2;
      return { m, score: m.fame + 0.6 * mid - 0.6 * shared };
    }).filter(Boolean).sort((x, y) => y.score - x.score).map((x) => x.m);
  }
  const bare = (s) => s.replace(/^the /, "").toLowerCase();
  const overlaps = (x, y) => bare(x).includes(bare(y)) || bare(y).includes(bare(x));   // Birdsville and the Birdsville Track
  function named(line, a, b, others = [], n = 2) {
    const pick = [];
    for (const m of ranked(line, a, b, others)) {
      if (pick.length >= n) break;
      if (!pick.some((p) => overlaps(p.name, m.name))) pick.push(m);
    }
    return pick.sort((x, y) => x.along - y.along);
  }
  function describe(line, a, b, others = [], n = 2) { return join(named(line, a, b, others, n).map((m) => m.name)); }

  // ---- The options
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
  // your own stops and an option's towns, in trip order (the option's towns keep their own order)
  function order(a, b, mine, pts) {
    const dx = b.lon - a.lon, dy = b.lat - a.lat, L = dx * dx + dy * dy || 1;
    const along = (v) => ((v.lon - a.lon) * dx + (v.lat - a.lat) * dy) / L;
    const m = [...mine].sort((p, q) => along(p) - along(q)), out = [];
    let i = 0, j = 0;
    while (i < m.length || j < pts.length) {
      if (j >= pts.length || (i < m.length && along(m[i]) <= along(pts[j]))) out.push(m[i++]); else out.push(pts[j++]);
    }
    return [a, ...out, b];
  }
  // Towns either side of the fastest route, a bit out and a long way out. On long trips only proper towns: a route
  // made to go through a tiny place out there often takes back roads.
  function sideTowns(a, b, baseLine, townNear) {
    if (!townNear) return [];
    const straight = hav(ll(a), ll(b)), out = [], seen = new Set();
    for (const off of [0.1, 0.18, 0.28, 0.4]) for (const f of [0.5, 0.33, 0.67]) {
      const d = Math.min(400000, Math.max(20000, straight * off));
      const p0 = pointAt(baseLine, baseLine.total * (f - 0.05)), p1 = pointAt(baseLine, baseLine.total * (f + 0.05)), p = pointAt(baseLine, baseLine.total * f);
      const kx = 111000 * Math.cos(p.lat * RAD), ky = 111000;
      let dx = (p1.lon - p0.lon) * kx, dy = (p1.lat - p0.lat) * ky; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      for (const sgn of [1, -1]) {
        const t = townNear(p.lat + sgn * dx * d / ky, p.lon - sgn * dy * d / kx);
        if (!t || seen.has(t.name) || (straight > 600000 && (t.rank || 2) < 2) || offLine(baseLine, t) < d * 0.3) continue;
        seen.add(t.name); out.push(t);
      }
    }
    return out.slice(0, 12);
  }
  function finish(found, a, b, cur) {
    const fastest = found.reduce((x, y) => (y.route.duration < x.route.duration ? y : x), found[0]);
    const list = found.map((o, i) => {
      const others = found.filter((_, j) => j !== i).map((x) => x.line);
      // the places that set it apart, topped up with the towns it was routed through ("Via Horsham and Kingston SE")
      const names = named(o.line, a, b, others).map((m) => ({ name: m.name, along: m.along }));
      for (const p of o.pts) {
        if (names.length >= 2) break;
        if (hav(ll(p), ll(a)) < 60000 || hav(ll(p), ll(b)) < 60000 || names.some((x) => overlaps(x.name, p.name))) continue;
        let at = 0, best = Infinity; for (const q of steps(o.line)) { const d = hav(q, ll(p)); if (d < best) { best = d; at = q[2]; } }
        names.push({ name: p.name, along: at });
      }
      const phrase = join(names.sort((x, y) => x.along - y.along).map((x) => x.name));
      return { ...o, others, phrase, dirt: dirtOn(o.line), fastest: o === fastest, cur: o.key === cur || o.alias === cur };
    });
    // two options with the same name: say more about the later one
    for (let i = 1; i < list.length; i++) {
      if (!list.slice(0, i).some((x) => x.phrase === list[i].phrase)) continue;
      const more = describe(list[i].line, a, b, list[i].others, 3);
      list[i].phrase = more !== list[i].phrase ? more : join(list[i].pts.map((p) => p.name));
    }
    if (!list.some((x) => x.cur)) list[0].cur = true;
    return list.map(({ others, alias, ...o }) => ({ ...o, title: o.phrase ? `Via ${o.phrase}` : o.base ? "Fastest route" : `Via ${join(o.pts.map((p) => p.name))}` }))
      .sort((x, y) => (y.base ? 1 : 0) - (x.base ? 1 : 0) || x.route.duration - y.route.duration);
  }
  async function choices(a, b, base, o = {}) {
    const max = o.max || 5, mine = o.mine || [], cur = o.current?.key || "";
    const baseLine = buildLine(base), straight = hav(ll(a), ll(b));
    const found = [{ key: "", pts: [], route: base, line: baseLine, base: true }];
    const report = () => { try { o.onUpdate?.(finish(found, a, b, cur)); } catch (e) { /* only drawing */ } };
    if (straight < 40000 || !o.route) return finish(found, a, b, cur);
    const cands = [], keys = new Set([""]);
    const add = (key, pts, side = false) => { if (!keys.has(key) && pts.length) { keys.add(key); cands.push({ key, pts, side }); } };
    if (o.current?.pts?.length) add(cur, o.current.pts);
    if (straight >= 250000) {
      for (const c of corridors(a, b)) { const f = forcing(a, b, c, baseLine); if (f) add(f.map((h) => h.name).join(" · "), f); }
    }
    // How much longer an option may be than the fastest. Long trips get the main ways across rather than every
    // detour: only a few towns either side are tried, and only while there are fewer than three ways.
    const long = straight >= 1000000;
    for (const t of sideTowns(a, b, baseLine, o.townNear).slice(0, long ? 3 : 6)) add(t.name, [{ name: t.name, lat: t.lat, lon: t.lon }], true);
    report();
    const [dMax, tMax] = straight < 150000 ? [1.35, 1.5] : long ? [1.4, 1.45] : [1.6, 1.7];
    const sideOk = () => !long || found.length < 3;
    const log = o.log || (() => {});
    for (let i = 0; i < cands.length && found.length < max; i += 3) {
      if (o.stop?.()) break;   // nobody's looking any more
      const batch = await Promise.all(cands.slice(i, i + 3).filter((c) => !c.side || sideOk()).map(async (c) => ({ c, r: await within(o.route(order(a, b, mine, c.pts)), o.timeout || 45000) })));
      for (const { c, r } of batch) {
        const what = `${c.side ? "town" : "way"} ${c.key}`;
        if (!r || !(r.distance > 0) || !r.geometry?.coordinates?.length) { log(`${what}: no route`); continue; }
        const dr = r.distance / base.distance, tr = r.duration / (base.duration || 1);
        if ((dr > dMax || tr > tMax) && c.key !== cur) { log(`${what}: too long (${Math.round(r.distance / 1000)} km, x${dr.toFixed(2)} distance, x${tr.toFixed(2)} time)`); continue; }
        const line = buildLine(r);
        const twin = found.find((f) => share(line, f.line) >= 0.65);   // mostly the same roads as one we have
        if (twin) { log(`${what}: same roads as ${twin.key || "the fastest"}`); if (c.key === cur) twin.alias = cur; continue; }
        if (c.side && !sideOk() && c.key !== cur) { log(`${what}: enough ways already`); continue; }
        if (found.length < max || c.key === cur) { found.push({ ...c, route: r, line }); log(`${what}: added (${Math.round(r.distance / 1000)} km)`); }
      }
      report();
    }
    return finish(found, a, b, cur);
  }

  const api = { choices, corridors, forcing, describe, dirtOn, buildLine, share, order, hubs: () => [...graph().hubs.values()], _graph: graph };
  root.CFRoutes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
