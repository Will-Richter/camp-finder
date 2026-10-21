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
    ute: {
      body: "M5.5 45.5 L5.5 30 Q5.5 27.6 8 27.6 L43.6 27.6 L45 25.8 L48.4 14.6 Q49.2 12.6 51.5 12.6 L90.6 12.6 Q93.2 12.6 94.7 14.4 L104.8 26.6 L118.5 28.6 Q123.8 29.4 125 32.8 L126.2 40.5 Q126.4 46 122.4 46 L8.5 46 Q5.5 46 5.5 45.5 Z",
      band: "M49.8 15.2 L93.6 15.2 L102.6 26.2 L48.4 26.2 Z",
      glass: ["M51 16.2 L69.4 16.2 L69.4 25.4 L49.2 25.4 Z", "M72.6 16.2 L92.7 16.2 L100.6 25.4 L72.6 25.4 Z"],
      lines: "M71 14 L71 42.5 M48.6 27 L48.6 42.5 M103.4 27.6 L101.4 42.5 M8 31.4 L43 31.4",
      handles: [[52.4, 29.6], [74, 29.6]], mirror: [100.8, 23.6], wheels: [27.5, 104], r: 10.2,
      extra: () => `<path d="M26.4 27.6 L29 19.4 Q29.6 18 31.2 18 L44.4 18" fill="none" stroke="#1E2224" stroke-width="2.3" stroke-linecap="round"/><path d="M36 18 L36 27.6" stroke="#1E2224" stroke-width="1.6"/>` +
        `<rect x="49" y="43.6" width="54" height="2" rx="1" fill="#1E2224"/>`,
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

  function wheel(x, r = 10, y = 48.2, alloy = true) {
    const rim = r * 0.6, spokes = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; spokes.push(`M${(x + Math.cos(a) * rim * 0.28).toFixed(1)} ${(y + Math.sin(a) * rim * 0.28).toFixed(1)} L${(x + Math.cos(a) * rim * 0.92).toFixed(1)} ${(y + Math.sin(a) * rim * 0.92).toFixed(1)}`); }
    return `<g class="wheel"><circle cx="${x}" cy="${y}" r="${r}" fill="#1B1E1D"/>` +
      `<circle cx="${x}" cy="${y}" r="${(r - 1.1).toFixed(1)}" fill="none" stroke="#33383A" stroke-width="1.6" stroke-dasharray="1.6 1.4"/>` +
      `<circle cx="${x}" cy="${y}" r="${rim.toFixed(1)}" fill="url(#cr{u})"/>` +
      `<path d="${spokes.join(" ")}" stroke="${alloy ? "#5E686E" : "#3E4448"}" stroke-width="${(rim * 0.26).toFixed(1)}" stroke-linecap="round"/>` +
      `<circle cx="${x}" cy="${y}" r="${(rim * 0.3).toFixed(1)}" fill="#3A4044"/></g>`;
  }

  function carSide(body, color, rig) {
    const d = S[body], c = color, dark = shade(c, -.32);
    const offroad = ["ute", "classic", "wagon", "boxy"].includes(body);
    const [w1, w2] = d.wheels, r = d.r;
    let s = `<ellipse cx="66" cy="59" rx="58" ry="3" fill="#000" opacity=".22"/>`;
    // roof: rooftop tent, or a rack with gear on 4WDs
    const roofY = { ute: 12.6, classic: 9, wagon: 12, boxy: 9.6, suv: 14.5, car: 16.6, van: 6, motorhome: 2 }[body];
    const roofX = { ute: [50, 92], classic: [60, 94], wagon: [14, 90], boxy: [10, 93], suv: [22, 86], car: [50, 84], van: [10, 94], motorhome: [10, 100] }[body];
    if (rig === "rooftop" && body !== "van" && body !== "motorhome") {
      const [a, b] = roofX;
      s += `<rect x="${a}" y="${roofY - 2.4}" width="${b - a}" height="2" rx="1" fill="#1E2224"/><rect x="${a - 1}" y="${roofY - 10.4}" width="${b - a + 2}" height="8.2" rx="3" fill="#3B4045"/><rect x="${a + 1}" y="${roofY - 8.8}" width="${b - a - 2}" height="1.6" rx=".8" fill="#59616A"/>`;
    } else if (body === "wagon" || body === "boxy") {
      s += `<rect x="${roofX[0] + 6}" y="${roofY - 4.8}" width="${roofX[1] - roofX[0] - 12}" height="2" rx="1" fill="#1E2224"/>` +
        `<rect x="${roofX[0] + 10}" y="${roofY - 9.4}" width="18" height="4.8" rx="2" fill="#3E6B4E"/><rect x="${roofX[0] + 31}" y="${roofY - 8.6}" width="9" height="4" rx="1" fill="#B8322A"/><rect x="${roofX[0] + 43}" y="${roofY - 9}" width="15" height="4.4" rx="2.2" fill="#6B4E35"/>`;
    }
    if (body === "ute") s += `<rect x="9" y="21" width="12" height="6.6" rx="1.6" fill="#6B4E35"/><rect x="38" y="22.4" width="5" height="5.2" rx="1" fill="#3E6B4E"/>`;
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
    const fx = body === "classic" || body === "boxy" ? 124.4 : 125.4;
    s += `<path d="M${fx - 6.4} ${body === "classic" || body === "boxy" ? 28.6 : 30.2} L${fx} ${body === "classic" || body === "boxy" ? 28.8 : 31.8} L${fx} ${body === "classic" || body === "boxy" ? 33 : 34.8} L${fx - 5.6} ${body === "classic" || body === "boxy" ? 32.8 : 34.2} Z" fill="#FFF7D1" stroke="#15191A" stroke-width=".5"/>`;
    s += `<rect x="${fx - 2.6}" y="35.4" width="3.2" height="5" rx=".8" fill="#15191A"/>`;
    s += `<rect x="${body === "motorhome" ? 4.4 : body === "van" ? 6.4 : 5.9}" y="30.4" width="2.8" height="${body === "van" || body === "motorhome" ? 8 : 5.6}" rx=".8" fill="#D63A2E"/>`;
    s += `<rect x="113" y="41.6" width="13.4" height="4.4" rx="1.4" fill="#2A2F31"/><rect x="${body === "motorhome" ? 3.6 : 5}" y="41.8" width="11" height="4.2" rx="1.4" fill="#2A2F31"/>`;
    if (offroad) s += `<rect x="1.6" y="42.8" width="4.4" height="2.2" rx=".8" fill="#2A2F31"/><circle cx="1.8" cy="42.4" r="1.4" fill="#2A2F31"/>`;
    if (body === "wagon" || body === "classic" || body === "boxy") s += `<path d="M105.6 40.6 L105.6 19 Q105.4 15.6 102.6 13.6" stroke="#15191A" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    // wheel arches with flares
    const arch = r + 2.6;
    s += `<path d="M${w1 - arch} 46 A${arch} ${arch} 0 0 1 ${w1 + arch} 46 Z M${w2 - arch} 46 A${arch} ${arch} 0 0 1 ${w2 + arch} 46 Z" fill="#101314"/>`;
    if (offroad) s += `<path d="M${w1 - arch - .8} 46 A${arch + .8} ${arch + .8} 0 0 1 ${w1 + arch + .8} 46 M${w2 - arch - .8} 46 A${arch + .8} ${arch + .8} 0 0 1 ${w2 + arch + .8} 46" fill="none" stroke="#2A2F31" stroke-width="2.2"/>`;
    s += wheel(w1, r) + wheel(w2, r);
    return s;
  }

  // things you tow, drawn in their own 0..120 space (hitch at x = 120)
  function caravanSide(color) {
    const stripe = color === COLORS.white || color === COLORS.silver ? "#2E6B43" : shade(color, -.1);
    return `<ellipse cx="58" cy="59" rx="54" ry="3" fill="#000" opacity=".2"/>
      <path d="M4 42 L4 13 Q4 4.5 13 4.5 L95 4.5 Q104 4.5 104 13 L104 42 Q104 46 100 46 L8 46 Q4 46 4 42 Z" fill="#F6F7F4" stroke="#15191A" stroke-width="1.3"/>
      <path d="M4 7.5 Q4 4.5 13 4.5 L95 4.5 Q104 4.5 104 7.5 Z" fill="#E4E7E2"/>
      <path d="M4 31 L104 31" stroke="${stripe}" stroke-width="4"/><path d="M4 36 L104 36" stroke="#F5C518" stroke-width="1.4"/>
      <rect x="11" y="11" width="25" height="13" rx="3" fill="url(#cw{u})"/><rect x="69" y="11" width="27" height="13" rx="3" fill="url(#cw{u})"/>
      <rect x="44" y="9.5" width="16" height="34" rx="2" fill="#ECEFEA" stroke="#15191A" stroke-width=".9"/><rect x="47" y="12.5" width="10" height="8.5" rx="1.5" fill="url(#cw{u})"/><circle cx="57" cy="29" r="1" fill="#15191A"/>
      <rect x="20" y="2" width="16" height="3" rx="1" fill="#C9CEC8"/><rect x="74" y="2.4" width="12" height="2.4" rx="1" fill="#C9CEC8"/>
      <path d="M104 41 L120 43.4" stroke="#15191A" stroke-width="2.6" stroke-linecap="round"/><rect x="104" y="33" width="7" height="9" rx="1" fill="#3B4045"/>
      <path d="M66 46 A13.5 13.5 0 0 1 93 46 Z" fill="#101314"/>${wheel(72.5, 9, 48.6)}${wheel(86.5, 9, 48.6)}`;
  }
  function camperSide(color) {
    return `<ellipse cx="54" cy="59" rx="46" ry="3" fill="#000" opacity=".2"/>
      <path d="M14 21 Q14 14.5 22 14.5 L88 14.5 Q94 14.5 94 21 L94 24.5 L14 24.5 Z" fill="#5E6B4F" stroke="#15191A" stroke-width="1.2"/>
      <path d="M22 14.5 L22 24.5 M50 14.5 L50 24.5 M80 14.5 L80 24.5" stroke="#3E4A34" stroke-width="1"/>
      <path d="M10 24.5 L98 24.5 L98 42 Q98 46 94 46 L14 46 Q10 46 10 42 Z" fill="${shade(color, -.06)}" stroke="#15191A" stroke-width="1.3"/>
      <path d="M10 38.5 L98 38.5 L98 42 Q98 46 94 46 L14 46 Q10 46 10 42 Z" fill="#2A2F31"/>
      <rect x="16" y="27.5" width="16" height="9" rx="1.5" fill="#2A2F31" opacity=".85"/><rect x="74" y="27.5" width="10" height="9" rx="1.5" fill="#4E7A3A"/><rect x="86" y="27.5" width="8" height="9" rx="1.5" fill="#B8322A"/>
      <path d="M98 40.6 L120 43.4" stroke="#15191A" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M42 46 A14 14 0 0 1 70 46 Z" fill="#101314"/>${wheel(56, 10, 48.4)}`;
  }

  function defs(u, color) {
    const c = color;
    return `<defs><linearGradient id="cb${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, .32)}"/><stop offset=".38" stop-color="${c}"/><stop offset=".72" stop-color="${shade(c, -.08)}"/><stop offset="1" stop-color="${shade(c, -.3)}"/></linearGradient>` +
      `<linearGradient id="cw${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6E8C99"/><stop offset=".45" stop-color="#26363E"/><stop offset="1" stop-color="#0F171B"/></linearGradient>` +
      `<radialGradient id="cr${u}" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#EEF1F3"/><stop offset=".7" stop-color="#A3ADB3"/><stop offset="1" stop-color="#5E686E"/></radialGradient></defs>`;
  }

  /** Side-on picture. Returns { svg, viewBox, width, height, inner, body, tows } */
  function side(opts = {}) {
    const u = ++uid, color = colorOf(opts.color), body = bodyFor(opts.make, opts.model, opts.rig);
    const tows = body !== "motorhome" && (opts.rig === "caravan" || opts.rig === "camper");
    let inner = defs(u, color), w = 132;
    if (tows) {
      inner += `<g>${opts.rig === "caravan" ? caravanSide(color) : camperSide(color)}</g><g transform="translate(118 0)">${carSide(body, color, opts.rig)}</g>`;
      w = 252;
    } else inner += carSide(body, color, opts.rig);
    inner = inner.replace(/\{u\}/g, u);
    const viewBox = `0 0 ${w} 64`;
    return { inner, viewBox, width: w, height: 64, body, tows, svg: `<svg viewBox="${viewBox}" aria-hidden="true">${inner}</svg>` };
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
