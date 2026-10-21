/* Your own car, drawn to match the vehicle and rig picked in Settings.
 * CFCar.side(opts)  -> side-on SVG (loading screens), towing a caravan or camper trailer if you do
 * CFCar.top(opts)   -> top-down SVG (the car on the map and the splash screen)
 * opts: { make, model, color, rig }   rig: tent | rooftop | camper | caravan | motorhome
 * Realistic proportions for each kind of vehicle (dual-cab ute, 70 Series, 4WD wagon, boxy 4WD,
 * SUV, van, car, motorhome). No brand logos or badges. */
(() => {
  const COLORS = {
    white: "#F2F3F0", silver: "#B9C0C4", grey: "#6B7378", black: "#25292B", gold: "#F5C518",
    red: "#B8322A", blue: "#2F6FD6", navy: "#1F3B5C", green: "#2E6B43", sand: "#CDB68E", orange: "#E07A1F",
  };
  const NAMES = { gold: "Gold", white: "White", silver: "Silver", grey: "Grey", black: "Black", red: "Red", blue: "Blue", navy: "Navy", green: "Green", sand: "Sand", orange: "Orange" };
  const LABEL = { ute: "Dual-cab ute", classic: "70 Series", wagon: "4WD wagon", boxy: "4WD", suv: "SUV", van: "Van", car: "Car", motorhome: "Motorhome" };

  // Which shape fits each model
  function bodyFor(make = "", model = "", rig = "") {
    if (rig === "motorhome") return "motorhome";
    const m = `${make} ${model}`.toLowerCase();
    if (/hiace|transit|transporter|crafter|sprinter|trafic|staria|carnival|vito|ducato|master|express|\bvan\b/.test(m)) return "van";
    if (/landcruiser 7\d|troop/.test(m)) return "classic";
    if (/defender|jimny|wrangler|g-?class|g wagon|tank 300|ineos|grenadier|bronco|4runner/.test(m)) return "boxy";
    if (/hilux|ranger|d-?max|triton|navara|bt-?50|amarok|cannon|\bute\b|gladiator|\bram\b|silverado|f-?150|musso|tunland|t60|jac |shark|bt50/.test(m)) return "ute";
    if (/rav4|kluger|x-?trail|cx-?\d|outlander|pathfinder|forester|outback|tucson|sportage|santa fe|sorento|cr-?v|asx|qashqai|tiguan|model y|haval|jolion|atto|eclipse|captiva|xc\d/.test(m)) return "suv";
    if (/corolla|camry|mazda ?3|i30|civic|golf|yaris|model 3|cerato|swift|commodore|falcon|accord|sedan|hatch|mg ?3|mg ?4|polo|seal\b/.test(m)) return "car";
    return "wagon";
  }

  const shade = (hex, f) => { // f < 0 darker, > 0 lighter
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };
  let uid = 0;
  const colorOf = (c) => COLORS[c] || (typeof c === "string" && c.startsWith("#") ? c : COLORS.white);

  // ---------------------------------------------------------------- side view: 132 x 64, facing right, ground at y = 58
  // body outline, glass band (blacked-out pillars), windows, panel lines, wheel positions and tyre size
  const S = {
    // modern dual-cab ute, drawn to Ford Ranger measurements (5.37 m long, 1.88 m high, 3.27 m wheelbase):
    // tall flat bonnet, blunt upright nose, shallow side windows, squared-off wheel arches and a sports bar
    ute: {
      body: "M5 46 L5 30.4 Q5 28.4 7 28.4 L45 28.4 L46.2 26.6 L50.8 13.6 Q51.6 11.6 54 11.6 L91.6 11.6 Q94 11.6 95.4 13.2 L106.2 26.2 L122.6 27.6 Q125.6 27.9 126 30.4 L127.4 40.8 Q127.8 46.4 124 46.4 L8 46.4 Q5 46.4 5 46 Z",
      band: "M52.2 14.2 L94.6 14.2 L104.2 25.6 L50.2 25.6 Z",
      glass: ["M53.2 15.1 L72.4 15.1 L72.4 24.9 L51 24.9 Z", "M75.2 15.1 L93.6 15.1 L102.2 24.9 L75.2 24.9 Z"],
      lines: "M73.8 13 L73.8 43 M50.6 27 L50.6 43 M105 27.4 L104 43 M7 31.6 L44.6 31.6 M48 27.2 L122 28.6",
      handles: [[55.2, 29.4], [77, 29.4]], mirror: [101.8, 22.8], wheels: [34.5, 113.5], r: 10.2, square: true,
      extra: () => `<path d="M24.6 28.4 L28.2 18.4 Q28.8 17.2 30.4 17.2 L46.6 17.2" fill="none" stroke="#1E2224" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M37 17.2 L37 28.4" stroke="#1E2224" stroke-width="1.6"/>` +
        // C-clamp headlight, big upright grille with a bar, skid plate, tall tail light, side step
        `<path d="M119.4 28.4 L126.2 29 L126.6 32.4 L120.2 32 Z" fill="#FFF7D1" stroke="#15191A" stroke-width=".5"/><path d="M120 28.8 L120.4 37.6" stroke="#FFF7D1" stroke-width="1.1"/>` +
        `<path d="M121.6 33.4 L127 33.6 L127.5 39.6 L122 39.4 Z" fill="#15191A"/><path d="M122 36.4 L127.3 36.5" stroke="#3B4246" stroke-width="1"/>` +
        `<path d="M118 42 L127.8 42 L127.6 45.2 Q127.4 46.6 125 46.6 L118 46.6 Z" fill="#2A2F31"/><path d="M120 46.4 L127 46.4" stroke="#8A949A" stroke-width="1"/>` +
        `<rect x="5" y="29.2" width="2.6" height="9.4" rx=".8" fill="#D63A2E"/><rect x="51" y="44" width="52" height="2" rx="1" fill="#1E2224"/>`,
      noLights: true,
    },
    classic: {
      body: "M5.5 45.5 L5.5 30 Q5.5 27.6 8 27.6 L56.5 27.6 L57.5 26 L58.2 11 Q58.4 9 60.5 9 L94.4 9 Q96.3 9 96.8 10.9 L99.4 25.9 L120.8 26.9 Q124.4 27.3 124.8 30.4 L125.6 41 Q125.6 46 122 46 L8.5 46 Q5.5 46 5.5 45.5 Z",
      band: "M60 11.6 L95.5 11.6 L98 25.6 L60 25.6 Z",
      glass: ["M61.2 12.6 L77.2 12.6 L77.2 24.8 L61.2 24.8 Z", "M80.2 12.6 L95 12.6 L97.2 24.8 L80.2 24.8 Z"],
      lines: "M78.7 10 L78.7 42.5 M98.8 26.6 L98.8 42.5 M8 31.4 L55 31.4 M100 30 L123 30",
      handles: [[81.5, 28.8]], mirror: [98.6, 21.6], wheels: [30, 104], r: 10.2,
      extra: () => `<path d="M40 27.6 L42.5 19 L56 19" fill="none" stroke="#1E2224" stroke-width="2.3" stroke-linecap="round"/>` +
        `<path d="M117 27 L117 45 M121 27.2 L121 45" stroke="#1E2224" stroke-width="1.4"/><rect x="113" y="37.5" width="14" height="3" rx="1" fill="#1E2224"/>`,
    },
    wagon: {
      body: "M7.5 45.5 L7.5 18.5 Q7.6 13.6 12.4 13.2 L90.6 12 Q93.4 12 95 13.7 L105 26.4 L118.8 28.4 Q124.2 29.2 125.4 32.8 L126.3 40.5 Q126.4 46 122.4 46 L10.5 46 Q7.5 46 7.5 45.5 Z",
      band: "M11 15 L93.9 14.6 L103 26.2 L9.8 26.2 Z",
      glass: ["M12.2 16 L35 15.8 L35 25.4 L11 25.4 Z", "M38.2 15.8 L60.6 15.6 L60.6 25.4 L38.2 25.4 Z", "M63.8 15.6 L92.6 15.4 L100.8 25.4 L63.8 25.4 Z"],
      lines: "M36.6 13.8 L36.6 42.5 M62.2 13.6 L62.2 42.5 M103.6 27.6 L101.4 42.5",
      handles: [[39.8, 29.2], [65.4, 29.2]], mirror: [101, 23.6], wheels: [30.5, 103.5], r: 10,
      extra: () => `<path d="M17 11.2 L88 10.4" stroke="#1E2224" stroke-width="2" stroke-linecap="round"/><path d="M20 11.2 L20 13 M50 10.9 L50 12.6 M84 10.5 L84 12.2" stroke="#1E2224" stroke-width="1.4"/>` +
        `<rect x="40" y="43.6" width="62" height="2" rx="1" fill="#1E2224"/>`,
    },
    boxy: {
      body: "M7 45.5 L7 12.6 Q7 9.6 10 9.6 L93.8 9.6 Q95.8 9.6 96.3 11.6 L98.8 26 L120.6 27 Q124.4 27.4 124.8 30.4 L125.6 41 Q125.6 46 122 46 L10 46 Q7 46 7 45.5 Z",
      band: "M9.6 12.2 L95 12.2 L97.5 25.6 L9.6 25.6 Z",
      glass: ["M10.6 13.2 L33 13.2 L33 24.8 L10.6 24.8 Z", "M36.2 13.2 L60 13.2 L60 24.8 L36.2 24.8 Z", "M63.2 13.2 L94.4 13.2 L96.6 24.8 L63.2 24.8 Z"],
      lines: "M34.6 10.6 L34.6 42.5 M61.6 10.6 L61.6 42.5 M98.3 26.6 L98.3 42.5 M100 30 L123 30",
      handles: [[37.5, 28.6], [64.6, 28.6]], mirror: [98.2, 21.4], wheels: [29, 104], r: 10.2,
      extra: (c) => `<circle cx="5" cy="29" r="8.6" fill="#1B1E1D"/><circle cx="5" cy="29" r="4.6" fill="${shade(c, -.1)}" stroke="#1B1E1D" stroke-width="1"/>` +
        `<path d="M117 27 L117 45 M121 27.2 L121 45" stroke="#1E2224" stroke-width="1.4"/><rect x="113" y="37.5" width="14" height="3" rx="1" fill="#1E2224"/>`,
    },
    suv: {
      body: "M9.5 44.5 L9.5 29.5 Q9.6 25.4 12 21.4 L16.6 16.6 Q18.2 15 20.8 15 L88.2 14.5 Q91.3 14.5 93.3 16.6 L104.2 27.4 L118.8 29.4 Q123.7 30.3 124.7 34 L125.3 41 Q125.3 45.6 121.6 45.6 L12.5 45.6 Q9.5 45.6 9.5 44.5 Z",
      band: "M17.6 17.2 L91.6 16.9 L101.4 26.6 L13.4 26.6 Z",
      glass: ["M18.2 18.2 L34.4 18 L34.4 25.8 L14.4 25.8 Z", "M37.6 18 L61.6 17.9 L61.6 25.8 L37.6 25.8 Z", "M64.8 17.9 L90.6 17.8 L99.2 25.8 L64.8 25.8 Z"],
      lines: "M36 16 L36 42 M63.2 15.8 L63.2 42 M102.8 28.2 L100.8 42",
      handles: [[39.4, 29.6], [66.4, 29.6]], mirror: [99.4, 24.4], wheels: [31, 102.5], r: 9.2,
      extra: () => `<path d="M24 13.6 L84 13.2" stroke="#1E2224" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`,
    },
    van: {
      body: "M6 45.5 L6 9 Q6 6 9 6 L95.8 6 Q98.8 6 100.4 8.2 L110.6 24.8 L119.6 27.8 Q124.4 29.4 125 33 L125.6 41 Q125.6 46 122 46 L9 46 Q6 46 6 45.5 Z",
      band: "M8.6 9 L98.8 9 L107.6 23.6 L8.6 23.6 Z",
      glass: ["M10 10 L34.6 10 L34.6 22.6 L10 22.6 Z", "M38.4 10 L66.6 10 L66.6 22.6 L38.4 22.6 Z", "M79.8 10 L97.6 10 L105.6 22.6 L79.8 22.6 Z"],
      lines: "M36.6 8 L36.6 42.5 M68.6 8 L68.6 42.5 M78.4 8 L78.4 42.5 M108.8 25 L107 42.5 M37 27 L68 27",
      handles: [[64, 28.4], [81, 28.4]], mirror: [106.6, 22.6], wheels: [26, 104], r: 9.4,
      extra: () => "",
    },
    car: {
      body: "M8 44.5 L8 33 Q8 30 11 29.6 L30 28 L44 18.6 Q47 16.6 51 16.6 L82 16.6 Q86 16.6 89 18.6 L103 28 L119 30 Q124 31 124.5 35 L125 41 Q125 45.6 121.5 45.6 L11 45.6 Q8 45.6 8 44.5 Z",
      band: "M48.6 18.6 L87.6 18.6 L100.8 28.2 L33.6 28.2 Z",
      glass: ["M49.4 19.4 L64.2 19.4 L64.2 27.6 L37 27.6 Z", "M67.4 19.4 L86.4 19.4 L98 27.6 L67.4 27.6 Z"],
      lines: "M65.8 18 L65.8 42 M101.6 29 L100 42 M33 29 L35 42",
      handles: [[55, 31], [70, 31]], mirror: [98.6, 26.6], wheels: [30, 103], r: 8.6,
      extra: () => "",
    },
    motorhome: {
      body: "M4 45.5 L4 6 Q4 2 8 2 L102 2 Q107 2 107 7 L107 15 L111 17 L119 28 Q123 30 123.6 35 L124.2 41 Q124.2 46 120.6 46 L7 46 Q4 46 4 45.5 Z",
      band: "M104.6 17 L110.4 17 L117.6 27 L104.6 27 Z",
      glass: ["M105.6 17.8 L110 17.8 L116 26.2 L105.6 26.2 Z", "M12 11 L34 11 L34 22 L12 22 Z", "M62 11 L88 11 L88 22 L62 22 Z"],
      lines: "M100 17 L106 17 L106 44 M40 12 L55 12 L55 44 L40 44 Z",
      handles: [[52, 29]], mirror: [116, 23], wheels: [26, 103], r: 9.4,
      extra: (c) => `<path d="M4 33 L106 33" stroke="${shade(c === COLORS.white ? "#2E6B43" : c, -.2)}" stroke-width="3.4"/><path d="M4 37.4 L106 37.4" stroke="${c === COLORS.white ? "#F5C518" : shade(c, .3)}" stroke-width="1.6"/>` +
        `<rect x="18" y="0" width="16" height="2.4" rx="1" fill="#C9CEC8"/>`,
    },
  };

  function wheel(x, r = 10, y = 48.2, alloy = true, tread = false) {
    const rim = r * (alloy ? 0.6 : 0.7), spokes = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; spokes.push(`M${(x + Math.cos(a) * rim * 0.28).toFixed(1)} ${(y + Math.sin(a) * rim * 0.28).toFixed(1)} L${(x + Math.cos(a) * rim * 0.92).toFixed(1)} ${(y + Math.sin(a) * rim * 0.92).toFixed(1)}`); }
    const lugs = tread ? `<circle cx="${x}" cy="${y}" r="${(r - 0.55).toFixed(1)}" fill="none" stroke="#303536" stroke-width="1.5" stroke-dasharray="1.5 1.1"/><circle cx="${x}" cy="${y}" r="${(r * 0.8).toFixed(1)}" fill="none" stroke="#0E1011" stroke-width=".6"/>` : "";
    return `<g class="wheel"><circle cx="${x}" cy="${y}" r="${r}" fill="#1B1E1D"/>${lugs}` +
      (alloy && !tread ? `<circle cx="${x}" cy="${y}" r="${(r - 1.1).toFixed(1)}" fill="none" stroke="#33383A" stroke-width="1.6" stroke-dasharray="1.6 1.4"/>` : "") +
      `<circle cx="${x}" cy="${y}" r="${rim.toFixed(1)}" fill="url(#cr{u})"/>` +
      `<path d="${spokes.join(" ")}" stroke="#5E686E" stroke-width="${(rim * 0.26).toFixed(1)}" stroke-linecap="round"/>` +
      `<circle cx="${x}" cy="${y}" r="${(rim * 0.3).toFixed(1)}" fill="#3A4044"/></g>`;
  }

  function carSide(body, color, rig) {
    const d = S[body], c = color, dark = shade(c, -.32);
    const offroad = ["ute", "classic", "wagon", "boxy"].includes(body);
    const [w1, w2] = d.wheels, r = d.r;
    let s = `<ellipse cx="66" cy="59" rx="58" ry="3" fill="#000" opacity=".22"/>`;
    // roof: rooftop tent, or a rack with gear on 4WDs
    const roofY = { ute: 11.6, classic: 9, wagon: 12, boxy: 9.6, suv: 14.5, car: 16.6, van: 6, motorhome: 2 }[body];
    const roofX = { ute: [53, 93], classic: [60, 94], wagon: [14, 90], boxy: [10, 93], suv: [22, 86], car: [50, 84], van: [10, 94], motorhome: [10, 100] }[body];
    if (rig === "rooftop" && body !== "van" && body !== "motorhome") {
      const [a, b] = roofX;
      s += `<rect x="${a}" y="${roofY - 2.4}" width="${b - a}" height="2" rx="1" fill="#1E2224"/><rect x="${a - 1}" y="${roofY - 10.4}" width="${b - a + 2}" height="8.2" rx="3" fill="#3B4045"/><rect x="${a + 1}" y="${roofY - 8.8}" width="${b - a - 2}" height="1.6" rx=".8" fill="#59616A"/>`;
    } else if (body === "wagon" || body === "boxy") {
      s += `<rect x="${roofX[0] + 6}" y="${roofY - 4.8}" width="${roofX[1] - roofX[0] - 12}" height="2" rx="1" fill="#1E2224"/>` +
        `<rect x="${roofX[0] + 10}" y="${roofY - 9.4}" width="18" height="4.8" rx="2" fill="#3E6B4E"/><rect x="${roofX[0] + 31}" y="${roofY - 8.6}" width="9" height="4" rx="1" fill="#B8322A"/><rect x="${roofX[0] + 43}" y="${roofY - 9}" width="15" height="4.4" rx="2.2" fill="#6B4E35"/>`;
    }
    if (body === "ute") s += `<rect x="9" y="22" width="12" height="6.4" rx="1.6" fill="#6B4E35"/>`;
    if (body === "classic") s += `<rect x="12" y="20.6" width="14" height="7" rx="1.6" fill="#6B4E35"/><rect x="28" y="22.4" width="8" height="5.2" rx="1" fill="#3E6B4E"/>`;
    // body with a subtle lower darker sill
    s += `<path d="${d.body}" fill="url(#cb{u})" stroke="#15191A" stroke-width="1.3" stroke-linejoin="round"/>`;
    s += offroad ? `<path d="M6 40.6 L126 40.6 L126.2 41.5 Q126.4 46 122.4 46 L8.5 46 Q6 46 6 45.5 Z" fill="${shade(c, -.55)}" opacity=".85"/>` : `<path d="M8 42.6 L125 42.6 L125.2 43 Q125.2 45.6 121.6 45.6 L11 45.6 Q8 45.6 8 44.5 Z" fill="${dark}" opacity=".8"/>`;
    // shoulder highlight
    s += `<path d="M10 ${body === "van" || body === "motorhome" ? 25 : 29.4} L120 ${body === "van" || body === "motorhome" ? 25 : 30.2}" stroke="#fff" stroke-width="1" opacity=".35"/>`;
    // glass
    s += `<path d="${d.band}" fill="#151C20"/>` + d.glass.map((g) => `<path d="${g}" fill="url(#cw{u})"/>`).join("");
    s += d.glass.slice(-1).map(() => "").join("");
    s += `<path d="${d.lines}" stroke="#15191A" stroke-width=".8" opacity=".55" fill="none"/>`;
    s += d.handles.map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="1.4" rx=".7" fill="#15191A" opacity=".7"/>`).join("");
    const [mx, my] = d.mirror;
    s += `<path d="M${mx} ${my} L${mx + 4.6} ${my - 1.6} L${mx + 5.4} ${my + 1.8} L${mx + .8} ${my + 2.6} Z" fill="#1E2224"/>`;
    s += d.extra(c);
    // lights, grille and bumpers
    if (!d.noLights) {
    const fx = body === "classic" || body === "boxy" ? 124.4 : 125.4;
    s += `<path d="M${fx - 6.4} ${body === "classic" || body === "boxy" ? 28.6 : 30.2} L${fx} ${body === "classic" || body === "boxy" ? 28.8 : 31.8} L${fx} ${body === "classic" || body === "boxy" ? 33 : 34.8} L${fx - 5.6} ${body === "classic" || body === "boxy" ? 32.8 : 34.2} Z" fill="#FFF7D1" stroke="#15191A" stroke-width=".5"/>`;
    s += `<rect x="${fx - 2.6}" y="35.4" width="3.2" height="5" rx=".8" fill="#15191A"/>`;
    s += `<rect x="${body === "motorhome" ? 4.4 : body === "van" ? 6.4 : 5.9}" y="30.4" width="2.8" height="${body === "van" || body === "motorhome" ? 8 : 5.6}" rx=".8" fill="#D63A2E"/>`;
    s += `<rect x="113" y="41.6" width="13.4" height="4.4" rx="1.4" fill="#2A2F31"/><rect x="${body === "motorhome" ? 3.6 : 5}" y="41.8" width="11" height="4.2" rx="1.4" fill="#2A2F31"/>`;
    }
    if (offroad) s += `<rect x="1.6" y="42.8" width="4.4" height="2.2" rx=".8" fill="#2A2F31"/><circle cx="1.8" cy="42.4" r="1.4" fill="#2A2F31"/>`;
    if (body === "wagon" || body === "classic" || body === "boxy") s += `<path d="M105.6 40.6 L105.6 19 Q105.4 15.6 102.6 13.6" stroke="#15191A" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    // wheel arches with flares (squared-off on a modern ute, round on everything else)
    const arch = r + 2.6;
    if (d.square) {
      const sq = (w, k) => `M${w - arch - k} 46.4 L${w - arch + 1 - k} 40 Q${w - arch + 3.2 - k} ${36 - k} ${w - 6} ${35.6 - k} L${w + 6} ${35.6 - k} Q${w + arch - 3.2 + k} ${36 - k} ${w + arch - 1 + k} 40 L${w + arch + k} 46.4`;
      s += `<path d="${sq(w1, 0)} Z ${sq(w2, 0)} Z" fill="#101314"/>`;
      s += `<path d="${sq(w1, 1.2)} ${sq(w2, 1.2)}" fill="none" stroke="#25292B" stroke-width="2.4" stroke-linejoin="round"/>`;
    } else {
      s += `<path d="M${w1 - arch} 46 A${arch} ${arch} 0 0 1 ${w1 + arch} 46 Z M${w2 - arch} 46 A${arch} ${arch} 0 0 1 ${w2 + arch} 46 Z" fill="#101314"/>`;
      if (offroad) s += `<path d="M${w1 - arch - .8} 46 A${arch + .8} ${arch + .8} 0 0 1 ${w1 + arch + .8} 46 M${w2 - arch - .8} 46 A${arch + .8} ${arch + .8} 0 0 1 ${w2 + arch + .8} 46" fill="none" stroke="#2A2F31" stroke-width="2.2"/>`;
    }
    s += wheel(w1, r) + wheel(w2, r);
    return s;
  }

  // ---------------------------------------------------------------- vehicles drawn from real measurements
  // Each model's side profile is built from its published size (metres): length L, height H, wheelbase WB,
  // front overhang FO, wheel radius R, window line BL, bonnet height at the nose NH and at the windscreen BH,
  // windscreen run WR (how far back it leans), tray length, rear slope, and styling cues.
  const BASE = {
    ute:   { kind: "ute", L: 5.33, H: 1.82, WB: 3.10, FO: 0.93, R: 0.385, BL: 1.26, NH: 1.04, BH: 1.22, WR: 0.66, tray: 1.56, cab: "dual", kick: 0.06, arch: "round", clad: true, light: "wedge", step: true, bar: false },
    wagon: { kind: "wagon", L: 4.85, H: 1.84, WB: 2.80, FO: 0.90, R: 0.385, BL: 1.24, NH: 1.04, BH: 1.20, WR: 0.66, rake: 0.22, arch: "round", clad: true, light: "wedge", step: true, rails: true },
    boxy:  { kind: "boxy", L: 4.76, H: 1.97, WB: 3.02, FO: 0.80, R: 0.40, BL: 1.30, NH: 1.12, BH: 1.24, WR: 0.32, rake: 0.03, arch: "square", clad: true, light: "round", step: true, rails: true, spare: true },
    suv:   { kind: "suv", L: 4.62, H: 1.69, WB: 2.69, FO: 0.92, R: 0.36, BL: 1.10, NH: 0.92, BH: 1.06, WR: 0.86, rake: 0.42, arch: "round", clad: true, light: "slim" },
    van:   { kind: "van", L: 5.27, H: 1.99, WB: 3.21, FO: 0.93, R: 0.34, BL: 1.18, NH: 1.00, BH: 1.16, WR: 0.86, rake: 0.04, arch: "round", clad: false, light: "slim", wsFwd: 0.42 },
    sedan: { kind: "sedan", L: 4.63, H: 1.44, WB: 2.70, FO: 0.92, R: 0.33, BL: 0.98, NH: 0.74, BH: 0.92, WR: 1.02, arch: "round", clad: false, light: "slim" },
    hatch: { kind: "suv", L: 4.37, H: 1.46, WB: 2.64, FO: 0.86, R: 0.32, BL: 0.98, NH: 0.74, BH: 0.92, WR: 1.0, rake: 0.55, arch: "round", clad: false, light: "slim" },
  };
  // [pattern, base, overrides]: the shapes people drive most around Australia
  const MODELS = [
    [/ranger raptor/, "ute", { L: 5.38, H: 1.92, WB: 3.27, FO: 0.90, R: 0.42, NH: 1.16, BH: 1.30, WR: 0.56, BL: 1.33, arch: "square", light: "cclamp", tray: 1.56, kick: 0.02 }],
    [/ranger|amarok/, "ute", { L: 5.37, H: 1.88, WB: 3.27, FO: 0.92, R: 0.40, NH: 1.13, BH: 1.28, WR: 0.56, BL: 1.31, arch: "square", light: "cclamp", tray: 1.56, kick: 0.02, bar: true }],
    [/hilux/, "ute", { L: 5.33, H: 1.82, WB: 3.085, FO: 0.93, NH: 1.02, BH: 1.22, WR: 0.70, BL: 1.25, kick: 0.07, light: "wedge" }],
    [/d-?max/, "ute", { L: 5.33, H: 1.79, WB: 3.125, FO: 0.95, NH: 1.02, BH: 1.20, WR: 0.72, BL: 1.24, kick: 0.09, light: "wedge" }],
    [/triton/, "ute", { L: 5.32, H: 1.80, WB: 3.13, FO: 0.93, NH: 1.10, BH: 1.25, WR: 0.62, BL: 1.28, arch: "square", light: "split", kick: 0.03 }],
    [/navara/, "ute", { L: 5.26, H: 1.84, WB: 3.15, FO: 0.89, NH: 1.06, BH: 1.23, WR: 0.66, BL: 1.26, kick: 0.10, light: "wedge" }],
    [/bt-?50/, "ute", { L: 5.28, H: 1.79, WB: 3.125, FO: 0.95, NH: 1.00, BH: 1.20, WR: 0.74, BL: 1.24, kick: 0.09, light: "slim" }],
    [/cannon|tunland|musso|t60|shark/, "ute", { L: 5.41, H: 1.92, WB: 3.23, NH: 1.10, BH: 1.26, WR: 0.62, BL: 1.30, arch: "square", light: "wedge", kick: 0.04 }],
    [/gladiator/, "ute", { L: 5.59, H: 1.90, WB: 3.49, FO: 0.80, R: 0.42, NH: 1.10, BH: 1.24, WR: 0.32, BL: 1.30, arch: "square", light: "round", kick: 0 }],
    [/silverado|ram\b|f-?150/, "ute", { L: 5.90, H: 1.98, WB: 3.70, FO: 0.95, R: 0.42, NH: 1.25, BH: 1.36, WR: 0.66, BL: 1.40, arch: "square", light: "square", tray: 1.75, kick: 0 }],
    [/landcruiser 7\d|troop/, "ute", { L: 5.23, H: 1.95, WB: 3.18, FO: 0.86, R: 0.40, NH: 1.20, BH: 1.28, WR: 0.24, BL: 1.36, arch: "flat", light: "round", cab: "single", tray: 2.45, kick: 0, snorkel: true, step: false, boxy: true }],
    [/landcruiser 300|lc ?300/, "wagon", { L: 4.98, H: 1.945, WB: 2.85, FO: 0.88, R: 0.40, NH: 1.12, BH: 1.25, WR: 0.58, BL: 1.31, rake: 0.10, light: "wedge" }],
    [/prado/, "wagon", { L: 4.92, H: 1.87, WB: 2.85, FO: 0.86, R: 0.39, NH: 1.12, BH: 1.24, WR: 0.44, BL: 1.30, rake: 0.05, arch: "square", light: "square", boxy: true }],
    [/patrol/, "wagon", { L: 5.17, H: 1.94, WB: 3.075, FO: 0.90, R: 0.40, NH: 1.10, BH: 1.25, WR: 0.66, BL: 1.30, rake: 0.18, light: "wedge" }],
    [/everest/, "wagon", { L: 4.91, H: 1.84, WB: 2.90, FO: 0.92, R: 0.39, NH: 1.12, BH: 1.26, WR: 0.56, BL: 1.29, rake: 0.16, arch: "square", light: "cclamp" }],
    [/fortuner/, "wagon", { L: 4.80, H: 1.84, WB: 2.745, NH: 1.02, BH: 1.20, WR: 0.70, BL: 1.24, rake: 0.30, light: "wedge" }],
    [/mu-?x/, "wagon", { L: 4.85, H: 1.82, WB: 2.855, NH: 1.02, BH: 1.20, WR: 0.72, BL: 1.24, rake: 0.30, light: "wedge" }],
    [/pajero sport/, "wagon", { L: 4.83, H: 1.83, WB: 2.80, NH: 1.05, BH: 1.21, WR: 0.66, BL: 1.25, rake: 0.36, light: "split" }],
    [/pajero/, "wagon", { L: 4.90, H: 1.87, WB: 2.78, NH: 1.04, BH: 1.20, WR: 0.56, BL: 1.26, rake: 0.08, spare: true, light: "square" }],
    [/discovery/, "wagon", { L: 4.96, H: 1.89, WB: 2.92, NH: 1.08, BH: 1.22, WR: 0.70, BL: 1.26, rake: 0.12, light: "slim", clad: false }],
    [/tank 300/, "boxy", { L: 4.76, H: 1.90, WB: 2.75, FO: 0.85, NH: 1.08, BH: 1.20, WR: 0.40 }],
    [/defender/, "boxy", { L: 4.76, H: 1.97, WB: 3.02, FO: 0.80, NH: 1.10, BH: 1.22, WR: 0.36, light: "round" }],
    [/jimny/, "boxy", { L: 3.48, H: 1.72, WB: 2.25, FO: 0.60, R: 0.35, NH: 1.00, BH: 1.10, WR: 0.32, BL: 1.18, light: "round" }],
    [/wrangler|bronco|4runner|grenadier|g-?class/, "boxy", { L: 4.88, H: 1.84, WB: 3.01, FO: 0.75, NH: 1.08, BH: 1.18, WR: 0.30, light: "round" }],
    [/rav4/, "suv", { L: 4.60, H: 1.69, WB: 2.69, NH: 0.95, BH: 1.07, WR: 0.84, BL: 1.12, rake: 0.40, arch: "square" }],
    [/kluger|cx-?9|pathfinder|santa fe|sorento/, "suv", { L: 4.97, H: 1.73, WB: 2.85, NH: 0.96, BH: 1.10, WR: 0.86, BL: 1.12, rake: 0.32 }],
    [/x-?trail|cx-?5|outlander|tucson|sportage|cr-?v|forester|outback|tiguan|haval|captiva/, "suv", { L: 4.68, H: 1.72, WB: 2.71, NH: 0.94, BH: 1.07, WR: 0.86, BL: 1.12, rake: 0.38 }],
    [/hiace/, "van", { L: 5.27, H: 1.99, WB: 3.21, FO: 0.93, NH: 1.02, BH: 1.18, WR: 0.86 }],
    [/transit|crafter|sprinter|master|ducato/, "van", { L: 5.53, H: 2.50, WB: 3.75, FO: 0.95, NH: 1.06, BH: 1.24, WR: 0.82, BL: 1.24, wsFwd: 0.55 }],
    [/transporter|trafic|vito|staria|carnival|express/, "van", { L: 4.90, H: 1.97, WB: 3.00, FO: 0.95, NH: 0.98, BH: 1.14, WR: 0.90, wsFwd: 0.30 }],
    [/corolla hatch|i30|golf|yaris|swift|mazda ?3 hatch|polo|hatch/, "hatch", {}],
    [/corolla|camry|mazda ?3|civic|model 3|cerato|commodore|falcon|accord|sedan|seal\b/, "sedan", {}],
  ];
  function specFor(make = "", model = "", body = "wagon") {
    const m = `${make} ${model}`.toLowerCase();
    for (const [re, base, o] of MODELS) if (re.test(m)) return { ...BASE[base], ...o };
    return { ...BASE[{ ute: "ute", classic: "ute", wagon: "wagon", boxy: "boxy", suv: "suv", van: "van", car: "sedan" }[body] || "wagon"] };
  }

  const U = 22.2;                       // drawing units per metre (a 5.4 m ute fills the frame)
  function specSide(sp, c, rig, x0, opts = {}) {
    const X = (m) => +(x0 + m * U).toFixed(2), Y = (m) => +(58 - m * U).toFixed(2), P = (x, y) => `${X(x)} ${Y(y)}`;
    const { L, H, WB, FO, R, BL, NH, BH, WR } = sp;
    const fw = L - FO, rw = fw - WB;
    // windscreen base: behind the front axle on utes and 4WDs (long bonnet), over it on vans
    const xws = sp.kind === "van" ? fw + (sp.wsFwd || 0) : fw - (sp.wsBack ?? ({ ute: 0.42, wagon: 0.34, boxy: 0.3, suv: 0.22, sedan: 0.1 }[sp.kind] || 0));
    const xrf = xws - WR;                                                       // roof front
    const dark = shade(c, -.32), deep = "#15191A";
    const isUte = sp.kind === "ute", single = sp.cab === "single";
    const xcb = isUte ? (single ? xws - 1.30 : sp.tray + 0.26) : 0;             // back of the cab (tub + tailgate in front of it)
    const xcr = isUte ? xcb + (sp.boxy ? 0.04 : 0.12) : 0;
    const rail = BL + 0.02;
    const rake = sp.rake || 0;
    // ---- outline (rear bottom, round the top, down the nose, along the bottom)
    let d = `M${P(0, 0.56)} `;
    if (isUte) d += `L${P(0, rail - 0.04)} Q${P(0, rail)} ${P(0.05, rail)} L${P(xcb - 0.03, rail)} L${P(xcb, rail + 0.06)} L${P(xcr, H - 0.06)} Q${P(xcr + 0.02, H)} ${P(xcr + 0.1, H)} `;
    else if (sp.kind === "sedan") d += `L${P(0, 0.94)} Q${P(0, 1.0)} ${P(0.08, 1.0)} L${P(0.62, 1.02)} L${P(1.26, H - 0.03)} Q${P(1.3, H)} ${P(1.4, H)} `;
    else d += `L${P(0, BL)} L${P(rake, H - 0.07)} Q${P(rake + 0.02, H)} ${P(rake + 0.12, H)} `;
    d += `L${P(xrf - 0.08, H)} Q${P(xrf, H)} ${P(xrf + 0.05, H - 0.04)} L${P(xws, BH)} `;
    d += sp.kind === "van" ? `Q${P(L - 0.25, BH - 0.04)} ${P(L - 0.06, NH)} ` : `L${P(L - 0.14, NH)} Q${P(L - 0.03, NH - 0.01)} ${P(L - 0.01, NH - 0.12)} `;
    d += `L${P(L + (sp.boxy || sp.kind === "boxy" ? 0 : 0.01), 0.62)} Q${P(L, 0.47)} ${P(L - 0.12, 0.47)} L${P(0.12, 0.47)} Q${P(0, 0.47)} ${P(0, 0.56)} Z`;
    // ---- windows (dark band with the glass panes set in it)
    const top = H - 0.075, bot = BL;
    const fEdge = (y) => xws - 0.07 - (y - bot) / (top - bot) * (WR - 0.05);  // follows the windscreen pillar
    let rEdgeTop, rEdgeBot;
    if (isUte) { rEdgeTop = xcr + 0.08; rEdgeBot = xcb + 0.1; }
    else if (sp.kind === "sedan") { rEdgeTop = 1.42; rEdgeBot = 1.06; }
    else { rEdgeTop = rake + 0.16 + (sp.kind === "van" ? 0 : 0.08); rEdgeBot = (rake * (bot - BL)) + 0.18 + (sp.kind === "van" ? 0 : 0.1); }
    const xb = isUte && single ? xcb + 0.1 : xws - (isUte ? 1.06 : sp.kind === "van" ? 0.90 : 1.10);   // B-pillar
    const xc = sp.kind === "wagon" || sp.kind === "boxy" || sp.kind === "suv" ? xb - 0.98 : sp.kind === "van" ? xb - 1.45 : null; // C-pillar
    const pane = (x1t, x2t, x1b, x2b, kickRear = 0) => `<path d="M${P(x1t, top)} L${P(x2t, top)} L${P(x2b, bot)} L${P(x1b, bot + kickRear)} Z" fill="url(#cw{u})"/>`;
    let glass = `<path d="M${P(rEdgeTop - 0.04, top + 0.035)} L${P(fEdge(top) + 0.045, top + 0.035)} L${P(fEdge(bot) + 0.05, bot - 0.03)} L${P(rEdgeBot - 0.04, bot - 0.03)} Z" fill="#11181C"/>`;
    const fwin = pane(xb + 0.04, fEdge(top), xb + 0.04, fEdge(bot));
    if (isUte && single) glass += fwin;
    else if (isUte) glass += fwin + pane(rEdgeTop, xb - 0.04, rEdgeBot, xb - 0.04, sp.kick || 0);
    else if (xc != null) glass += fwin + pane(xc + 0.04, xb - 0.04, xc + 0.04, xb - 0.04) + pane(rEdgeTop, xc - 0.04, rEdgeBot, xc - 0.04, sp.kick || 0);
    else glass += fwin + pane(rEdgeTop, xb - 0.04, rEdgeBot, xb - 0.04);
    if (sp.kind === "sedan") glass += `<path d="M${P(0.7, 1.04)} L${P(1.25, H - 0.06)} L${P(1.36, H - 0.075)} L${P(0.98, 1.02)} Z" fill="url(#cw{u})"/>`;
    // ---- panel lines, handles, mirror
    let lines = `M${P(xb, top + 0.02)} L${P(xb, 0.5)} M${P(xws + 0.03, BH - 0.03)} L${P(xws - 0.04, 0.5)}`;
    if (isUte && !single) lines += ` M${P(xcb + 0.08, rail)} L${P(xcb + 0.08, 0.5)}`;
    if (xc != null && sp.kind !== "van") lines += ` M${P(xc - 0.02, top + 0.02)} L${P(xc - 0.02, 0.5)}`;
    if (sp.kind === "van") lines += ` M${P(xb - 1.5, top + 0.02)} L${P(xb - 1.5, 0.5)} M${P(xb - 1.5, 0.9)} L${P(xb - 0.04, 0.9)}`;
    if (isUte) lines += ` M${P(0.06, rail - 0.13)} L${P(xcb - 0.05, rail - 0.13)}`;
    lines += ` M${P(0.05, BL - 0.1)} L${P(L - 0.2, NH - 0.06)}`;                 // shoulder crease
    const handles = [xb + 0.1, (xc != null ? xc : (isUte && !single ? xcb + 0.14 : null))].filter((x) => x != null).map((x) => `<rect x="${X(x)}" y="${Y(BL - 0.1)}" width="${(0.22 * U).toFixed(1)}" height="1.3" rx=".6" fill="${deep}" opacity=".7"/>`).join("");
    const mirror = `<path d="M${P(xws - 0.16, BL + 0.12)} L${P(xws + 0.03, BL + 0.16)} L${P(xws + 0.05, BL + 0.02)} L${P(xws - 0.13, BL - 0.01)} Z" fill="#1E2224"/>`;
    // ---- lights, grille, bumpers
    let front = "";
    const hl = sp.light;
    const lx = L - (hl === "round" ? 0.08 : 0.3);
    if (hl === "round") front += `<ellipse cx="${X(L - 0.04)}" cy="${Y(NH - 0.12)}" rx="1.2" ry="2.6" fill="#FFF7D1" stroke="${deep}" stroke-width=".4"/>`;
    else front += `<path d="M${P(lx, NH - 0.02)} L${P(L - 0.02, NH - 0.06)} L${P(L, NH - (hl === "slim" ? 0.13 : 0.18))} L${P(lx + 0.04, NH - (hl === "slim" ? 0.1 : 0.15))} Z" fill="#FFF7D1" stroke="${deep}" stroke-width=".4"/>`;
    if (hl === "cclamp") front += `<path d="M${P(lx + 0.02, NH - 0.03)} L${P(lx + 0.04, NH - 0.36)}" stroke="#FFF7D1" stroke-width="1.1"/>`;
    if (hl === "split") front += `<path d="M${P(L - 0.2, NH - 0.34)} L${P(L, NH - 0.36)}" stroke="#FFF7D1" stroke-width="1.2"/>`;
    front += `<path d="M${P(L - 0.07, NH - 0.2)} L${P(L + 0.01, NH - 0.21)} L${P(L + 0.012, 0.74)} L${P(L - 0.08, 0.74)} Z" fill="${deep}"/>`;   // grille
    front += sp.clad ? `<path d="M${P(L - 0.42, 0.66)} L${P(L + 0.012, 0.66)} L${P(L, 0.5)} Q${P(L - 0.02, 0.46)} ${P(L - 0.12, 0.46)} L${P(L - 0.42, 0.46)} Z" fill="#2A2F31"/><path d="M${P(L - 0.3, 0.48)} L${P(L - 0.02, 0.48)}" stroke="#8A949A" stroke-width="1"/>` : `<path d="M${P(L - 0.38, 0.62)} L${P(L + 0.01, 0.62)}" stroke="${dark}" stroke-width="1.2"/>`;
    const tl = isUte ? `<rect x="${X(0)}" y="${Y(rail - 0.04)}" width="${(0.07 * U).toFixed(1)}" height="${(0.4 * U).toFixed(1)}" rx=".7" fill="#D63A2E"/>`
      : sp.kind === "sedan" ? `<rect x="${X(0)}" y="${Y(0.98)}" width="${(0.08 * U).toFixed(1)}" height="${(0.18 * U).toFixed(1)}" rx=".7" fill="#D63A2E"/>`
      : `<rect x="${X(rake * 0.4)}" y="${Y(BL + 0.05)}" width="${(0.07 * U).toFixed(1)}" height="${(0.34 * U).toFixed(1)}" rx=".7" fill="#D63A2E"/>`;
    const rearBumper = sp.clad && !isUte ? `<rect x="${X(-0.02)}" y="${Y(0.66)}" width="${(0.42 * U).toFixed(1)}" height="${(0.2 * U).toFixed(1)}" rx="1.2" fill="#2A2F31"/><rect x="${X(-0.16)}" y="${Y(0.55)}" width="${(0.18 * U).toFixed(1)}" height="1.8" rx=".6" fill="#2A2F31"/>` : "";
    // ---- arches and wheels
    const ar = R + 0.07, ax = [rw, fw];
    const archPath = (w, k) => {
      if (sp.arch === "round") return `M${P(w - ar - k, 0.47)} A${((ar + k) * U).toFixed(1)} ${((ar + k) * U).toFixed(1)} 0 0 1 ${P(w + ar + k, 0.47)}`;
      const t = sp.arch === "flat" ? ar + 0.02 : ar * 0.9, inset = sp.arch === "flat" ? 0.02 : 0.16;
      return `M${P(w - ar - k, 0.47)} L${P(w - ar - k + inset * 0.4, R + t * 0.55)} Q${P(w - ar - k + inset, R + t + k)} ${P(w - ar * 0.55, R + t + k)} L${P(w + ar * 0.55, R + t + k)} Q${P(w + ar + k - inset, R + t + k)} ${P(w + ar + k - inset * 0.4, R + t * 0.55)} L${P(w + ar + k, 0.47)}`;
    };
    let arches = `<path d="${ax.map((w) => archPath(w, 0) + " Z").join(" ")}" fill="#101314"/>`;
    if (sp.clad) arches += `<path d="${ax.map((w) => archPath(w, 0.035)).join(" ")}" fill="none" stroke="#25292B" stroke-width="${(0.07 * U).toFixed(1)}" stroke-linejoin="round"/>`;
    const sill = sp.clad ? `<path d="M${P(rw + ar, 0.62)} L${P(fw - ar, 0.62)} L${P(fw - ar, 0.47)} L${P(rw + ar, 0.47)} Z" fill="#2A2F31" opacity=".9"/>` : `<path d="M${P(rw + ar, 0.56)} L${P(fw - ar, 0.56)}" stroke="${dark}" stroke-width="1.6"/>`;
    const step = sp.step ? `<rect x="${X(xcb + (isUte ? 0.12 : rw + ar + 0.05))}" y="${Y(0.47)}" width="${((fw - ar - 0.06 - (isUte ? xcb + 0.12 : rw + ar + 0.05)) * U).toFixed(1)}" height="1.8" rx=".9" fill="#1E2224"/>` : "";
    // ---- extras: sports bar, roof rails, spare wheel, snorkel, rooftop tent
    let extras = "";
    if (sp.bar) extras += `<path d="M${P(xcb - 0.95, rail)} L${P(xcb - 0.8, H - 0.3)} Q${P(xcb - 0.78, H - 0.24)} ${P(xcb - 0.7, H - 0.24)} L${P(xcb + 0.02, H - 0.24)}" fill="none" stroke="#1E2224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (sp.rails && rig !== "rooftop") extras += `<path d="M${P(rake + 0.25, H + 0.05)} L${P(xrf - 0.15, H + 0.05)}" stroke="#1E2224" stroke-width="1.6" stroke-linecap="round"/><path d="M${P(rake + 0.3, H)} L${P(rake + 0.3, H + 0.05)} M${P(xrf - 0.2, H)} L${P(xrf - 0.2, H + 0.05)}" stroke="#1E2224" stroke-width="1.2"/>`;
    if (sp.spare) extras += `<circle cx="${X(-0.13)}" cy="${Y(1.0)}" r="${(0.36 * U).toFixed(1)}" fill="#1B1E1D"/><circle cx="${X(-0.13)}" cy="${Y(1.0)}" r="${(0.2 * U).toFixed(1)}" fill="${shade(c, -.08)}"/>`;
    if (sp.snorkel) extras += `<path d="M${P(fw - 0.2, 0.92)} L${P(xws - 0.02, BH + 0.06)} L${P(xrf + 0.06, H - 0.06)}" fill="none" stroke="${deep}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (rig === "rooftop" && sp.kind !== "van") {
      const a = isUte ? xcr + 0.15 : rake + 0.25, b = xrf - 0.1;
      extras += `<rect x="${X(a)}" y="${Y(H + 0.1)}" width="${((b - a) * U).toFixed(1)}" height="1.6" rx=".8" fill="#1E2224"/><rect x="${X(a - 0.04)}" y="${Y(H + 0.46)}" width="${((b - a + 0.08) * U).toFixed(1)}" height="${(0.36 * U).toFixed(1)}" rx="2.6" fill="#3B4045"/><rect x="${X(a)}" y="${Y(H + 0.4)}" width="${((b - a) * U).toFixed(1)}" height="1.4" rx=".7" fill="#59616A"/>`;
    }
    if (isUte) {
      // the tub: capped top rail, gap behind the cab, tailgate seam, tall tail lights and a step bumper
      extras += `<path d="M${P(0.02, rail - 0.035)} L${P(xcb - 0.04, rail - 0.035)}" stroke="${shade(c, -.45)}" stroke-width="1.1" opacity=".7"/>` +
        `<path d="M${P(xcb + 0.02, rail + 0.02)} L${P(xcb + 0.02, 0.62)}" stroke="${deep}" stroke-width="1.3" opacity=".8"/>` +
        `<path d="M${P(0.1, rail - 0.06)} L${P(0.1, 0.62)}" stroke="${deep}" stroke-width=".6" opacity=".5"/>` +
        `<path d="M${P(0.02, 0.86)} L${P(xcb - 0.12, 0.86)}" stroke="#fff" stroke-width=".8" opacity=".25"/>` +
        `<path d="M${P(0.42, 0.68)} L${P(-0.06, 0.68)} L${P(-0.06, 0.52)} Q${P(-0.06, 0.48)} ${P(0, 0.48)} L${P(0.42, 0.48)} Z" fill="#2A2F31"/><path d="M${P(-0.05, 0.665)} L${P(0.38, 0.665)}" stroke="#9AA3A8" stroke-width=".9"/>`;
    }
    if (opts.towbar) extras += `<path d="M${P(-0.36, 0.5)} L${P(0.15, 0.5)}" stroke="#1E2224" stroke-width="2.6" stroke-linecap="round"/><circle cx="${X(-0.36)}" cy="${Y(0.56)}" r="1.5" fill="#9AA3A8"/>`;
    const tyres = ax.map((w) => wheel(X(w), +(R * U).toFixed(1), Y(R), sp.clad, !!sp.clad && sp.kind !== "suv")).join("");
    return `<ellipse cx="${X(L / 2)}" cy="59" rx="${((L / 2 + 0.1) * U).toFixed(1)}" ry="3" fill="#000" opacity=".2"/>` +
      `<path d="${d}" fill="url(#cb{u})" stroke="${deep}" stroke-width=".7" stroke-linejoin="round"/>` +
      `<path d="M${P(0.04, BL - 0.03)} L${P(L - 0.25, NH - 0.02)}" stroke="#fff" stroke-width="1.1" opacity=".35"/>` +
      sill + glass + `<path d="${lines}" stroke="${deep}" stroke-width=".7" opacity=".45" fill="none"/>` + handles + mirror + front + tl + rearBumper + step + extras + arches + tyres;
  }

  // ---------------------------------------------------------------- things you tow, built from real sizes too
  // Drawn facing right with the rear at x0; the coupling (where it meets the tow ball) is returned.
  // An Australian off-road tourer: 20 ft body, about 2.95 m tall, tandem axles, checker plate, front boot, gas and jerry cans.
  function caravanSide(c, x0) {
    const X = (m) => +(x0 + m * U).toFixed(2), Y = (m) => +(58 - m * U).toFixed(2), P = (x, y) => `${X(x)} ${Y(y)}`;
    const deep = "#15191A", Lb = 6.3, top = 2.92, bot = 0.56, hx = 7.75, hy = 0.5, R = 0.37, a1 = 2.85, a2 = 3.68;
    const accent = c === COLORS.white || c === COLORS.silver ? "#2E3438" : c, accent2 = shade(accent, .25);
    let s = `<ellipse cx="${X(Lb / 2 + 0.3)}" cy="59" rx="${((Lb / 2 + 0.3) * U).toFixed(1)}" ry="3" fill="#000" opacity=".2"/>`;
    // chassis rail, A-frame drawbar, jockey wheel
    s += `<path d="M${P(0.1, 0.5)} L${P(Lb, 0.5)} L${P(hx, hy + 0.02)}" fill="none" stroke="#202426" stroke-width="2.6" stroke-linejoin="round"/>`;
    s += `<path d="M${P(hx - 0.55, 0.62)} L${P(hx - 0.55, 0.34)}" stroke="#2A2F31" stroke-width="1.6"/><circle cx="${X(hx - 0.55)}" cy="${Y(0.3)}" r="1.9" fill="#1B1E1D"/>`;   // jockey wheel, wound up for the drive
    s += `<path d="M${P(hx - 0.12, hy + 0.02)} L${P(hx + 0.04, hy + 0.02)}" stroke="#3A4044" stroke-width="3.4" stroke-linecap="round"/>`;
    // body: square at the back, curved front roof edge, slightly raked lower front
    s += `<path d="M${P(0, bot + 0.06)} L${P(0, top - 0.12)} Q${P(0, top)} ${P(0.14, top)} L${P(Lb - 0.42, top)} Q${P(Lb - 0.04, top)} ${P(Lb, top - 0.36)} L${P(Lb, 1.3)} L${P(Lb - 0.06, bot)} L${P(0.06, bot)} Q${P(0, bot)} ${P(0, bot + 0.06)} Z" fill="#F7F8F5" stroke="${deep}" stroke-width=".8" stroke-linejoin="round"/>`;
    s += `<path d="M${P(0.12, top - 0.05)} L${P(Lb - 0.42, top - 0.05)}" stroke="#D9DDD8" stroke-width="1.4"/>`;
    // checker-plate stone guard along the bottom and up the front
    s += `<path d="M${P(0.02, bot + 0.38)} L${P(Lb - 0.03, bot + 0.38)} L${P(Lb, 1.3)} L${P(Lb, bot + 0.68)} L${P(Lb - 0.06, bot)} L${P(0.06, bot)} Q${P(0.02, bot)} ${P(0.02, bot + 0.06)} Z" fill="url(#cp{u})" stroke="#5E676C" stroke-width=".5"/>`;
    s += `<path d="M${P(Lb - 0.02, bot + 0.38)} L${P(Lb - 0.02, 1.3)}" stroke="#5E676C" stroke-width=".5"/>`;
    // decals in your car's colour: a sweep from the front corner back along the side
    s += `<path d="M${P(Lb, 2.05)} Q${P(Lb - 1.4, 1.98)} ${P(Lb - 2.6, 1.35)} L${P(0.02, 1.35)} L${P(0.02, 1.19)} L${P(Lb - 2.72, 1.19)} Q${P(Lb - 1.5, 1.8)} ${P(Lb, 1.85)} Z" fill="${accent}"/>`;
    s += `<path d="M${P(Lb, 2.18)} Q${P(Lb - 1.3, 2.12)} ${P(Lb - 2.45, 1.48)} L${P(0.02, 1.48)}" fill="none" stroke="${accent2}" stroke-width="1"/>`;
    // windows (dark, framed), entry door with its own window, hatch, awning bag
    const win = (x1, x2, y1, y2) => `<rect x="${X(x1)}" y="${Y(y2)}" width="${((x2 - x1) * U).toFixed(1)}" height="${((y2 - y1) * U).toFixed(1)}" rx="2.2" fill="url(#cw{u})" stroke="#202426" stroke-width="1.1"/>`;
    s += win(0.45, 1.75, 1.62, 2.38) + win(4.6, 5.85, 1.62, 2.38) + win(2.3, 2.8, 1.95, 2.38);
    s += `<rect x="${X(3.2)}" y="${Y(2.5)}" width="${(0.66 * U).toFixed(1)}" height="${(1.88 * U).toFixed(1)}" rx="1.4" fill="#EEF0EC" stroke="#202426" stroke-width=".9"/>` + win(3.3, 3.76, 1.95, 2.38) + `<rect x="${X(3.74)}" y="${Y(1.5)}" width="1.1" height="3.2" rx=".5" fill="${deep}"/>`;
    s += `<rect x="${X(3.24)}" y="${Y(bot - 0.02)}" width="${(0.58 * U).toFixed(1)}" height="2.6" rx=".6" fill="#3A4044"/>`;   // fold-down step
    s += `<rect x="${X(0.5)}" y="${Y(2.8)}" width="${(4.6 * U).toFixed(1)}" height="${(0.12 * U).toFixed(1)}" rx="1.3" fill="#7E878C"/><path d="M${P(0.5, 2.74)} L${P(5.1, 2.74)}" stroke="#5E676C" stroke-width=".6"/>`;
    // roof: air-conditioner, solar panels, hatch
    s += `<path d="M${P(2.85, top)} L${P(2.95, top + 0.24)} L${P(3.75, top + 0.24)} L${P(3.85, top)} Z" fill="#E4E7E2" stroke="${deep}" stroke-width=".6"/>`;
    s += `<rect x="${X(4.3)}" y="${Y(top + 0.06)}" width="${(1.3 * U).toFixed(1)}" height="1.3" fill="#24303A"/><rect x="${X(0.6)}" y="${Y(top + 0.06)}" width="${(1.3 * U).toFixed(1)}" height="1.3" fill="#24303A"/>`;
    // rear: spare wheel edge-on, tail lights
    s += `<rect x="${X(-0.16)}" y="${Y(1.75)}" width="${(0.16 * U).toFixed(1)}" height="${(0.76 * U).toFixed(1)}" rx="1.2" fill="#1B1E1D"/><rect x="${X(0)}" y="${Y(1.05)}" width="1.6" height="${(0.3 * U).toFixed(1)}" rx=".5" fill="#D63A2E"/>`;
    // front boot on the A-frame, gas bottles and a jerry can
    s += `<path d="M${P(Lb + 0.04, 0.55)} L${P(Lb + 0.04, 1.22)} L${P(Lb + 0.66, 1.22)} L${P(Lb + 0.82, 0.55)} Z" fill="url(#cp{u})" stroke="#5E676C" stroke-width=".6"/>`;
    s += `<rect x="${X(Lb + 0.86)}" y="${Y(1.12)}" width="${(0.3 * U).toFixed(1)}" height="${(0.58 * U).toFixed(1)}" rx="2.4" fill="#E8EBE8" stroke="${deep}" stroke-width=".5"/><rect x="${X(Lb + 0.9)}" y="${Y(1.2)}" width="${(0.22 * U).toFixed(1)}" height="1.4" rx=".5" fill="#9AA3A8"/>`;
    s += `<rect x="${X(Lb + 1.2)}" y="${Y(0.98)}" width="${(0.18 * U).toFixed(1)}" height="${(0.44 * U).toFixed(1)}" rx=".8" fill="#2E6B43" stroke="${deep}" stroke-width=".5"/>`;
    // wheel well, mudflap, tandem off-road wheels
    s += `<path d="M${P(a1 - R - 0.13, bot)} L${P(a1 - R - 0.13, 0.82)} Q${P(a1 - R - 0.13, 0.98)} ${P(a1 - 0.2, 0.98)} L${P(a2 + 0.2, 0.98)} Q${P(a2 + R + 0.13, 0.98)} ${P(a2 + R + 0.13, 0.82)} L${P(a2 + R + 0.13, bot)} Z" fill="#101314"/>`;
    s += `<path d="M${P(a1 - R - 0.16, bot)} L${P(a1 - R - 0.16, 0.82)} Q${P(a1 - R - 0.16, 1.01)} ${P(a1 - 0.2, 1.01)} L${P(a2 + 0.2, 1.01)} Q${P(a2 + R + 0.16, 1.01)} ${P(a2 + R + 0.16, 0.82)} L${P(a2 + R + 0.16, bot)}" fill="none" stroke="#2A2F31" stroke-width="1.6"/>`;
    s += wheel(X(a1), +(R * U).toFixed(1), Y(R), true, true) + wheel(X(a2), +(R * U).toFixed(1), Y(R), true, true);
    return { svg: s, hitch: hx, top: top + 0.24 };
  }
  // An off-road camper trailer: steel box, folded tent under a black cover, toolbox, jerry cans, spare on the drawbar.
  function camperSide(c, x0) {
    const X = (m) => +(x0 + m * U).toFixed(2), Y = (m) => +(58 - m * U).toFixed(2), P = (x, y) => `${X(x)} ${Y(y)}`;
    const deep = "#15191A", Lb = 2.55, bot = 0.55, boxTop = 1.22, hx = 4.25, hy = 0.5, R = 0.38, ax = 1.3;
    const body = c === COLORS.white ? "#ECEEEA" : shade(c, -.05);
    let s = `<ellipse cx="${X(2.1)}" cy="59" rx="${(2.15 * U).toFixed(1)}" ry="3" fill="#000" opacity=".2"/>`;
    s += `<path d="M${P(0.1, 0.5)} L${P(Lb, 0.5)} L${P(hx, hy + 0.02)}" fill="none" stroke="#202426" stroke-width="2.6" stroke-linejoin="round"/>`;
    s += `<path d="M${P(hx - 0.45, 0.62)} L${P(hx - 0.45, 0.34)}" stroke="#2A2F31" stroke-width="1.6"/><circle cx="${X(hx - 0.45)}" cy="${Y(0.3)}" r="1.9" fill="#1B1E1D"/>`;   // jockey wheel, wound up for the drive
    s += `<path d="M${P(hx - 0.12, hy + 0.02)} L${P(hx + 0.04, hy + 0.02)}" stroke="#3A4044" stroke-width="3.4" stroke-linecap="round"/>`;
    // folded tent under its cover, with a roof rack and a kayak-free top
    s += `<path d="M${P(0.04, boxTop)} L${P(0.04, 1.5)} Q${P(0.04, 1.62)} ${P(0.18, 1.62)} L${P(Lb - 0.14, 1.62)} Q${P(Lb, 1.62)} ${P(Lb, 1.5)} L${P(Lb, boxTop)} Z" fill="#2B2F31" stroke="${deep}" stroke-width=".7"/>`;
    s += `<path d="M${P(0.2, 1.56)} L${P(Lb - 0.2, 1.56)}" stroke="#4A5155" stroke-width=".8"/><path d="M${P(0.7, 1.24)} L${P(0.7, 1.6)} M${P(1.85, 1.24)} L${P(1.85, 1.6)}" stroke="#1A1D1E" stroke-width=".8"/>`;
    // the box
    s += `<path d="M${P(0, bot + 0.05)} L${P(0, boxTop)} L${P(Lb, boxTop)} L${P(Lb, bot + 0.05)} Q${P(Lb, bot)} ${P(Lb - 0.05, bot)} L${P(0.05, bot)} Q${P(0, bot)} ${P(0, bot + 0.05)} Z" fill="${body}" stroke="${deep}" stroke-width=".8"/>`;
    s += `<path d="M${P(0, bot + 0.26)} L${P(Lb, bot + 0.26)} L${P(Lb, bot)} L${P(0, bot)} Z" fill="url(#cp{u})" stroke="#5E676C" stroke-width=".4"/>`;
    s += `<rect x="${X(0.18)}" y="${Y(1.1)}" width="${(0.7 * U).toFixed(1)}" height="${(0.26 * U).toFixed(1)}" rx="1" fill="${shade(body, -.25)}"/><rect x="${X(1.95)}" y="${Y(1.1)}" width="${(0.4 * U).toFixed(1)}" height="${(0.26 * U).toFixed(1)}" rx="1" fill="${shade(body, -.25)}"/>`;
    s += `<rect x="${X(0)}" y="${Y(1.02)}" width="1.6" height="${(0.22 * U).toFixed(1)}" rx=".5" fill="#D63A2E"/>`;
    // toolbox, jerry cans and the spare wheel on the drawbar
    s += `<rect x="${X(Lb + 0.06)}" y="${Y(1.1)}" width="${(0.62 * U).toFixed(1)}" height="${(0.52 * U).toFixed(1)}" rx="1" fill="url(#cp{u})" stroke="#5E676C" stroke-width=".6"/>`;
    s += `<rect x="${X(Lb + 0.72)}" y="${Y(1.04)}" width="${(0.18 * U).toFixed(1)}" height="${(0.44 * U).toFixed(1)}" rx=".8" fill="#2E6B43" stroke="${deep}" stroke-width=".5"/><rect x="${X(Lb + 0.92)}" y="${Y(1.04)}" width="${(0.18 * U).toFixed(1)}" height="${(0.44 * U).toFixed(1)}" rx=".8" fill="#B8322A" stroke="${deep}" stroke-width=".5"/>`;
    s += `<rect x="${X(-0.17)}" y="${Y(1.2)}" width="${(0.17 * U).toFixed(1)}" height="${(0.74 * U).toFixed(1)}" rx="1.4" fill="#1B1E1D"/>`;   // spare on the back
    // arch flare and the off-road wheel
    s += `<path d="M${P(ax - R - 0.1, bot)} A${((R + 0.1) * U).toFixed(1)} ${((R + 0.1) * U).toFixed(1)} 0 0 1 ${P(ax + R + 0.1, bot)} Z" fill="#101314"/>`;
    s += `<path d="M${P(ax - R - 0.16, bot)} L${P(ax - R - 0.1, 0.86)} Q${P(ax, 1.05)} ${P(ax + R + 0.1, 0.86)} L${P(ax + R + 0.16, bot)}" fill="#25292B"/><path d="M${P(ax - R - 0.06, bot)} A${((R + 0.06) * U).toFixed(1)} ${((R + 0.06) * U).toFixed(1)} 0 0 1 ${P(ax + R + 0.06, bot)} Z" fill="#101314"/>`;
    s += wheel(X(ax), +(R * U).toFixed(1), Y(R), true, true);
    return { svg: s, hitch: hx, top: 1.65 };
  }

  function defs(u, color) {
    const c = color;
    return `<defs><linearGradient id="cb${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, .32)}"/><stop offset=".38" stop-color="${c}"/><stop offset=".72" stop-color="${shade(c, -.08)}"/><stop offset="1" stop-color="${shade(c, -.3)}"/></linearGradient>` +
      `<linearGradient id="cw${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6E8C99"/><stop offset=".45" stop-color="#26363E"/><stop offset="1" stop-color="#0F171B"/></linearGradient>` +
      `<pattern id="cp${u}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" fill="#B9C1C5"/><rect x=".6" y="1.1" width="1.8" height=".8" rx=".4" fill="#E3E7E9"/></pattern>` +
      `<radialGradient id="cr${u}" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#EEF1F3"/><stop offset=".7" stop-color="#A3ADB3"/><stop offset="1" stop-color="#5E686E"/></radialGradient></defs>`;
  }

  /** Side-on picture. Returns { svg, viewBox, width, height, inner, body, tows } */
  function side(opts = {}) {
    const u = ++uid, color = colorOf(opts.color), body = bodyFor(opts.make, opts.model, opts.rig);
    const tows = body !== "motorhome" && (opts.rig === "caravan" || opts.rig === "camper");
    let inner = defs(u, color), w = 132, y0 = 0, h = 64;
    if (body === "motorhome") inner += carSide(body, color, opts.rig);
    else {
      const sp = specFor(opts.make, opts.model, body);
      if (tows) {
        const t = opts.rig === "caravan" ? caravanSide(color, 6) : camperSide(color, 6);
        const carX = 6 + (t.hitch + 0.36) * U;           // tow ball sits on the coupling
        inner += `<g>${t.svg}</g>` + specSide(sp, color, opts.rig, carX, { towbar: true });
        w = Math.ceil(carX + sp.L * U + 6);
        const need = Math.max(sp.H + (opts.rig === "rooftop" ? 0.5 : 0.1), t.top) * U + 8;   // headroom over the tallest part
        if (need > 58) { y0 = -Math.ceil(need - 58); h = 64 - y0; }
      } else inner += specSide(sp, color, opts.rig, 66 - (sp.L * U) / 2);
    }
    inner = inner.replace(/\{u\}/g, u);
    const viewBox = `0 ${y0} ${w} ${h}`;
    return { inner, viewBox, width: w, height: h, body, tows, svg: `<svg viewBox="${viewBox}" aria-hidden="true">${inner}</svg>` };
  }

  // ---------------------------------------------------------------- top view (centred on 0,0, facing up)
  const TOP = { ute: [8.8, 17], classic: [8.6, 16.6], wagon: [9, 15.8], boxy: [8.8, 15], suv: [8.6, 14.4], car: [8.2, 14.4], van: [9.2, 17.4], motorhome: [10, 19] };
  function top(opts = {}) {
    const color = colorOf(opts.color), body = bodyFor(opts.make, opts.model, opts.rig);
    const [hw, hl] = TOP[body], dark = shade(color, -.35), glass = "#1E262A";
    const round = body === "car" || body === "suv" ? 6 : body === "boxy" || body === "classic" ? 3 : 4.6;
    let s = `<rect x="${-hw}" y="${-hl}" width="${hw * 2}" height="${hl * 2}" rx="${round}" fill="${color}" stroke="#15191A" stroke-width="2.2"/>`;
    // bonnet crease lines
    s += `<path d="M${-hw + 3} ${-hl + 1.5} L${-hw + 3.4} ${-hl + 7} M${hw - 3} ${-hl + 1.5} L${hw - 3.4} ${-hl + 7}" stroke="${dark}" stroke-width=".8" opacity=".6"/>`;
    if (body === "ute" || body === "classic") {
      s += `<rect x="${-hw + 2.2}" y="${-hl + 7}" width="${hw * 2 - 4.4}" height="5.6" rx="1.6" fill="${glass}"/>`;           // windscreen
      s += `<rect x="${-hw + 2}" y="${-hl + 12.6}" width="${hw * 2 - 4}" height="${body === "ute" ? 11 : 6}" rx="1.4" fill="${shade(color, .1)}"/>`; // cab roof
      const ty = -hl + (body === "ute" ? 25.2 : 20.4);
      s += `<rect x="${-hw + 2}" y="${ty - 1.6}" width="${hw * 2 - 4}" height="1.4" rx=".6" fill="${glass}"/>`;             // rear window
      s += `<rect x="${-hw + 1.6}" y="${ty + 1.2}" width="${hw * 2 - 3.2}" height="${hl - ty - 2}" rx="1" fill="${shade(color, -.5)}"/>`; // tray
      s += `<path d="M${-hw + 1.6} ${ty + 3.4} H${hw - 1.6}" stroke="#15191A" stroke-width="1.6"/>`;                        // sports bar
    } else if (body === "motorhome") {
      s += `<rect x="${-hw + 2.5}" y="${-hl + 3}" width="${hw * 2 - 5}" height="5" rx="2" fill="${glass}"/>`;
      s += `<rect x="${-hw + 1.6}" y="${-hl + 9.6}" width="${hw * 2 - 3.2}" height="${hl * 2 - 12}" rx="2" fill="#F6F7F4" stroke="${dark}" stroke-width=".8"/>`;
      s += `<rect x="-3" y="-2" width="6" height="5" rx="1" fill="#C9CEC8"/>`;
    } else {
      const ws = body === "van" ? 4 : 6.4;
      s += `<rect x="${-hw + 2.2}" y="${-hl + ws}" width="${hw * 2 - 4.4}" height="${body === "van" ? 5 : 6}" rx="1.6" fill="${glass}"/>`;
      s += `<rect x="${-hw + 2.4}" y="${hl - 5.8}" width="${hw * 2 - 4.8}" height="3.6" rx="1.3" fill="${glass}"/>`;
      if (opts.rig === "rooftop") s += `<rect x="${-hw + 1.8}" y="${-hl + 13.4}" width="${hw * 2 - 3.6}" height="${hl * 2 - 21}" rx="2" fill="#3B4045"/>`;
      else if (body === "wagon" || body === "boxy") s += `<path d="M${-hw + 2} ${-hl + 14} V${hl - 8} M${hw - 2} ${-hl + 14} V${hl - 8}" stroke="#15191A" stroke-width="1.4"/><rect x="${-hw + 3.6}" y="-1" width="${hw * 2 - 7.2}" height="5" rx="1" fill="#6B4E35"/>`;
      if (body === "boxy") s += `<circle cx="0" cy="${hl + 1.4}" r="3.6" fill="#1B1E1D"/>`;
    }
    // mirrors and headlights
    s += `<rect x="${-hw - 2.4}" y="${-hl + 8}" width="2.4" height="3.6" rx="1" fill="#15191A"/><rect x="${hw}" y="${-hl + 8}" width="2.4" height="3.6" rx="1" fill="#15191A"/>`;
    s += `<rect x="${-hw + 1.6}" y="${-hl + .6}" width="4" height="1.8" rx=".8" fill="#FFF7D1"/><rect x="${hw - 5.6}" y="${-hl + .6}" width="4" height="1.8" rx=".8" fill="#FFF7D1"/>`;
    s += `<rect x="${-hw + 1}" y="${hl - 1.6}" width="3" height="1.4" rx=".6" fill="#D63A2E"/><rect x="${hw - 4}" y="${hl - 1.6}" width="3" height="1.4" rx=".6" fill="#D63A2E"/>`;
    const tows = body !== "motorhome" && (opts.rig === "caravan" || opts.rig === "camper");
    let extra = "";
    if (tows && opts.withTrailer) {
      const L = opts.rig === "caravan" ? 20 : 13;
      extra = `<path d="M0 ${hl} L0 ${hl + 4}" stroke="#15191A" stroke-width="2"/><rect x="${-hw - 1}" y="${hl + 4}" width="${hw * 2 + 2}" height="${L}" rx="3" fill="${opts.rig === "caravan" ? "#F6F7F4" : "#5E6B4F"}" stroke="#15191A" stroke-width="2"/>`;
    }
    const pad = tows && opts.withTrailer ? (opts.rig === "caravan" ? 26 : 19) : 0;
    const size = Math.max(hl + 4, hw + 4);
    const vb = `${-size} ${-size} ${size * 2} ${size * 2 + pad}`;
    return { inner: extra + s, viewBox: vb, svg: `<svg viewBox="${vb}" aria-hidden="true">${extra}${s}</svg>`, body };
  }

  window.CFCar = { side, top, bodyFor, COLORS, NAMES, LABEL };
})();
