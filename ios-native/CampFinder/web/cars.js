/* Your own car, drawn to match the vehicle and rig picked in Settings.
 * CFCar.side(opts)  -> side-on SVG markup (loading screens), towing a caravan or camper trailer if you do
 * CFCar.top(opts)   -> top-down SVG markup (the car on the map and the splash screen)
 * opts: { make, model, color, rig }   rig: tent | rooftop | camper | caravan | motorhome
 * Generic shapes only (ute, 4WD wagon, SUV, van, car, motorhome): no brand logos or badges. */
(() => {
  const COLORS = {
    gold: "#F5C518", white: "#F4F5F2", silver: "#B9C0C4", grey: "#6B7378", black: "#25292B",
    red: "#C8372D", blue: "#2F6FD6", navy: "#1F3B5C", green: "#2E6B43", sand: "#D8C29A", orange: "#E67E22",
  };
  const NAMES = { gold: "Gold", white: "White", silver: "Silver", grey: "Grey", black: "Black", red: "Red", blue: "Blue", navy: "Navy", green: "Green", sand: "Sand", orange: "Orange" };

  // Which shape fits each model
  function bodyFor(make = "", model = "", rig = "") {
    if (rig === "motorhome") return "motorhome";
    const m = `${make} ${model}`.toLowerCase();
    if (/hiace|transit|transporter|crafter|sprinter|trafic|staria|carnival|vito|ducato|master|express|van\b/.test(m)) return "van";
    if (/hilux|ranger|d-?max|triton|navara|bt-?50|amarok|cannon|ute|70|gladiator|ram\b|silverado|f-?150|musso|tunland|t60|bt50|jac|ssangyong|ute/.test(m) && !/landcruiser 300|prado/.test(m)) return "ute";
    if (/rav4|kluger|x-?trail|cx-?\d|outlander|pathfinder|forester|outback|tucson|sportage|santa fe|sorento|cr-?v|asx|qashqai|tiguan|model y|haval|jolion|atto|seal|eclipse|captiva|xc\d/.test(m)) return "suv";
    if (/corolla|camry|mazda ?3|i30|civic|golf|yaris|model 3|cerato|swift|commodore|falcon|accord|sedan|hatch|mg ?3|mg ?4|polo/.test(m)) return "car";
    if (m.trim()) return "wagon";
    return "wagon";
  }

  const shade = (hex, f) => { // f < 0 darker, > 0 lighter
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };
  let uid = 0;
  const colorOf = (c) => COLORS[c] || (typeof c === "string" && c.startsWith("#") ? c : COLORS.gold);

  // ---------------------------------------------------------------- side view (132 x 64, facing right)
  const BODY = {
    wagon: "M10 44 L10 34 Q10 30 14 29.5 L30 27.5 L38 11 Q39.5 9 42 9 L88 9 Q91 9 92.5 11.5 L100 26 L116 28.5 Q122 29.5 122.5 35 L123 44 Q123 47 120 47 L13 47 Q10 47 10 44 Z",
    ute: "M10 44 L10 27 L58 27 L64 11 Q65.5 9 68 9 L90 9 Q93 9 94.5 11.5 L101 26 L116 28.5 Q122 29.5 122.5 35 L123 44 Q123 47 120 47 L13 47 Q10 47 10 44 Z",
    suv: "M11 44 L11 33 Q11 29 16 28 L31 26 L42 13.5 Q44 11.5 47 11.5 L86 11.5 Q90 11.5 92 14 L103 26 L117 28 Q122 29 122.5 34 L123 44 Q123 47 120 47 L14 47 Q11 47 11 44 Z",
    car: "M12 44 L12 34 Q12 31 16 30 L33 28.5 L47 17.5 Q49.5 15.5 53 15.5 L82 15.5 Q85.5 15.5 88 17.5 L101 27.5 L117 29.5 Q122 30.5 122.5 35 L123 44 Q123 47 120 47 L15 47 Q12 47 12 44 Z",
    van: "M10 44 L10 10 Q10 6 14 6 L94 6 Q99 6 101.5 10 L111 26 L118 28 Q123 29.5 123 35 L123 44 Q123 47 120 47 L13 47 Q10 47 10 44 Z",
    motorhome: "M4 44 L4 6 Q4 2 8 2 L102 2 Q107 2 107 7 L107 15 L111 17 L119 28 Q123 30 123 35 L123 44 Q123 47 120 47 L7 47 Q4 47 4 44 Z",
  };
  const WINDOWS = {
    wagon: `<path d="M41.5 13 L36 26 L62 26 L62 13 Z" fill="url(#cw{u})"/><path d="M65 13 L65 26 L89 26 L89 13 Z" fill="url(#cw{u})"/><path d="M92 13.5 L97.5 26 L91.5 26 L91.5 13.5 Z" fill="url(#cw{u})"/>
      <path d="M63.5 11 L63.5 41 M90 11 L91 41 M36 27.5 L36 41" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>`,
    ute: `<path d="M67.5 13 L62.5 26 L78 26 L78 13 Z" fill="url(#cw{u})"/><path d="M80.5 13 L80.5 26 L90 26 L90 13 Z" fill="url(#cw{u})"/><path d="M92.5 13.5 L98.5 26 L92 26 Z" fill="url(#cw{u})"/>
      <path d="M79.5 11 L79.5 41 M91 11 L92 41" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>
      <path d="M10 27 L58 27" stroke="#1A1608" stroke-width="1.6"/><path d="M12 25 L56 25" stroke="#2B2F2D" stroke-width="2.2" stroke-linecap="round"/><path d="M14 27 L14 25 M34 27 L34 25 M54 27 L54 25" stroke="#2B2F2D" stroke-width="1.4"/>`,
    suv: `<path d="M45 15 L35.5 26 L62 26 L62 15 Z" fill="url(#cw{u})"/><path d="M65 15 L65 26 L91 26 L88.5 15 Z" fill="url(#cw{u})"/>
      <path d="M63.5 13 L63.5 41 M92 14 L93 41" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>`,
    car: `<path d="M53 18.5 L39 28 L64 28 L64 18.5 Z" fill="url(#cw{u})"/><path d="M67 18.5 L67 28 L94 28 L84 18.5 Z" fill="url(#cw{u})"/>
      <path d="M65.5 17 L65.5 41 M96 28 L97 41" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>`,
    van: `<rect x="16" y="11" width="24" height="12" rx="2" fill="url(#cw{u})"/><rect x="44" y="11" width="26" height="12" rx="2" fill="url(#cw{u})"/><path d="M76 10 L76 26 L108 26 L100 10 Z" fill="url(#cw{u})"/>
      <path d="M73 8 L73 42 M42 8 L42 42" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>`,
    motorhome: `<path d="M106 17 L106 27 L118 27 L111 17 Z" fill="url(#cw{u})"/><rect x="12" y="12" width="22" height="11" rx="2" fill="url(#cw{u})"/><rect x="62" y="12" width="26" height="11" rx="2" fill="url(#cw{u})"/>
      <rect x="40" y="13" width="15" height="31" rx="2" fill="none" stroke="#1A1608" stroke-width="1" opacity=".55"/><circle cx="52" cy="29" r="1" fill="#1A1608"/>
      <path d="M4 34 L107 34" stroke="{stripe}" stroke-width="3.2"/><path d="M4 38 L107 38" stroke="{stripe2}" stroke-width="1.6"/>
      <path d="M100 17 L106 17 L106 44" stroke="#1A1608" stroke-width=".9" opacity=".5" fill="none"/>`,
  };
  const WHEELS = { wagon: [32, 101], ute: [32, 101], suv: [33, 101], car: [33, 101], van: [30, 103], motorhome: [26, 103] };

  function wheel(x, r = 10.5, y = 48) {
    return `<g class="wheel"><circle cx="${x}" cy="${y}" r="${r}" fill="#1B1E1D"/><circle cx="${x}" cy="${y}" r="${(r * .57).toFixed(1)}" fill="url(#cr{u})"/>` +
      `<path d="M${x} ${y - r * .52} V${y + r * .52} M${x - r * .52} ${y} H${x + r * .52} M${x - r * .37} ${y - r * .37} L${x + r * .37} ${y + r * .37} M${x + r * .37} ${y - r * .37} L${x - r * .37} ${y + r * .37}" stroke="#5E686E" stroke-width="1.2"/>` +
      `<circle cx="${x}" cy="${y}" r="1.8" fill="#2B2F2D"/></g>`;
  }

  function carSide(body, color, rig) {
    const c = color, dark = shade(c, -.28), light = shade(c, .35);
    const [w1, w2] = WHEELS[body];
    const offroad = body === "wagon" || body === "ute";
    let s = `<ellipse cx="66" cy="59" rx="57" ry="3.2" fill="#000" opacity=".22"/>`;
    // roof: rooftop tent, or rack with gear
    if (rig === "rooftop" && body !== "van" && body !== "motorhome") {
      const [a, b, top] = body === "ute" ? [62, 96, 9] : body === "car" ? [50, 88, 15.5] : body === "suv" ? [44, 92, 11.5] : [38, 92, 9];
      s += `<rect x="${a}" y="${top - 3}" width="${b - a}" height="2.4" rx="1" fill="#2B2F2D"/><rect x="${a - 2}" y="${top - 11}" width="${b - a + 4}" height="8.5" rx="3" fill="#3B4045"/><rect x="${a}" y="${top - 9.5}" width="${b - a}" height="2" rx="1" fill="#5B6267"/>`;
    } else if (offroad) {
      s += `<rect x="${body === "ute" ? 64 : 34}" y="6" width="${body === "ute" ? 30 : 56}" height="2.6" rx="1.2" fill="#2B2F2D"/>`;
      if (body === "wagon") s += `<rect x="38" y="1.5" width="20" height="5" rx="2" fill="#3E6B4E"/><rect x="61" y="2.5" width="9" height="4" rx="1" fill="#C0392B"/><rect x="72" y="2" width="14" height="4.6" rx="2.3" fill="#6B4E35"/>`;
    }
    if (body === "ute") s += `<rect x="16" y="19" width="14" height="7" rx="1.5" fill="#6B4E35"/><rect x="33" y="21" width="9" height="5" rx="1" fill="#3E6B4E"/>`;
    s += `<path d="${BODY[body]}" fill="url(#cb{u})" stroke="#1A1608" stroke-width="1.6"/>`;
    // lower cladding on 4WDs and utes, body-colour bumper on others
    s += offroad ? `<path d="M10 41 L123 41 L123 44 Q123 47 120 47 L13 47 Q10 47 10 44 Z" fill="#2B2F2D"/>` : `<path d="M${body === "motorhome" ? 4 : 11} 43 L123 43 L123 44 Q123 47 120 47 L14 47 Q11 47 11 44 Z" fill="${dark}"/>`;
    s += WINDOWS[body].replace(/\{stripe\}/g, dark).replace(/\{stripe2\}/g, light);
    // mirror, lights
    const front = body === "motorhome" || body === "van" ? 112 : 100;
    s += `<path d="M${front - 2} 24 L${front + 3} 22.5 L${front + 4} 26 L${front - 1} 27 Z" fill="#2B2F2D"/>`;
    s += `<rect x="117" y="31" width="5" height="4" rx="1.2" fill="#FFF7D1"/><rect x="${body === "motorhome" ? 4.5 : 10.5}" y="31.5" width="3" height="5" rx="1" fill="#E74C3C"/>`;
    if (offroad) s += `<path d="M102 41 L102 20 Q102 16 99 13.5" stroke="#1A1608" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M121 33 L128 33 Q130 33 130 35 L130 45 L122 45" stroke="#1A1608" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`;
    // arches + wheels
    s += `<path d="M${w1 - 13} 47 A13 13 0 0 1 ${w1 + 13} 47" fill="#1A1608"/><path d="M${w2 - 13} 47 A13 13 0 0 1 ${w2 + 13} 47" fill="#1A1608"/>`;
    s += wheel(w1) + wheel(w2);
    return s;
  }

  // things you tow, drawn in their own 0..120 space (hitch at the right edge, x = 120)
  function caravanSide(color) {
    const stripe = shade(color, -.15);
    return `<ellipse cx="58" cy="59" rx="54" ry="3" fill="#000" opacity=".2"/>
      <path d="M4 42 L4 12 Q4 4 14 4 L96 4 Q104 4 104 12 L104 42 Q104 46 100 46 L8 46 Q4 46 4 42 Z" fill="#F6F7F4" stroke="#1A1608" stroke-width="1.6"/>
      <path d="M4 30 L104 30" stroke="${stripe}" stroke-width="4"/><path d="M4 35 L104 35" stroke="${shade(color, .3)}" stroke-width="1.6"/>
      <rect x="12" y="11" width="24" height="12" rx="3" fill="url(#cw{u})"/><rect x="70" y="11" width="26" height="12" rx="3" fill="url(#cw{u})"/>
      <rect x="44" y="10" width="16" height="33" rx="2" fill="#E9ECE7" stroke="#1A1608" stroke-width="1"/><rect x="47" y="13" width="10" height="8" rx="1.5" fill="url(#cw{u})"/><circle cx="57" cy="29" r="1" fill="#1A1608"/>
      <rect x="20" y="2" width="16" height="3" rx="1" fill="#C9CEC8"/>
      <path d="M104 40 L120 43" stroke="#1A1608" stroke-width="2.6" stroke-linecap="round"/><rect x="104" y="33" width="7" height="9" rx="1" fill="#3B4045"/>
      <path d="M68 46 A12 12 0 0 1 92 46" fill="#1A1608"/>${wheel(80, 9.5, 48)}`;
  }
  function camperSide(color) {
    return `<ellipse cx="54" cy="59" rx="46" ry="3" fill="#000" opacity=".2"/>
      <path d="M14 20 Q14 14 22 14 L88 14 Q94 14 94 20 L94 24 L14 24 Z" fill="#5E6B4F" stroke="#1A1608" stroke-width="1.4"/>
      <path d="M22 14 L22 24 M50 14 L50 24 M80 14 L80 24" stroke="#3E4A34" stroke-width="1"/>
      <path d="M10 24 L98 24 L98 42 Q98 46 94 46 L14 46 Q10 46 10 42 Z" fill="${shade(color, -.05)}" stroke="#1A1608" stroke-width="1.6"/>
      <path d="M10 38 L98 38 L98 42 Q98 46 94 46 L14 46 Q10 46 10 42 Z" fill="#2B2F2D"/>
      <rect x="16" y="27" width="16" height="9" rx="1.5" fill="#2B2F2D" opacity=".85"/><rect x="74" y="27" width="10" height="9" rx="1.5" fill="#4E7A3A"/><rect x="86" y="27" width="8" height="9" rx="1.5" fill="#C0392B"/>
      <path d="M98 40 L120 43" stroke="#1A1608" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M44 46 A12 12 0 0 1 68 46" fill="#1A1608"/>${wheel(56, 9.5, 48)}`;
  }

  function defs(u, color) {
    const c = color;
    return `<defs><linearGradient id="cb${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, .38)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -.22)}"/></linearGradient>` +
      `<linearGradient id="cw${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5C7C8A"/><stop offset=".5" stop-color="#22343C"/><stop offset="1" stop-color="#121C21"/></linearGradient>` +
      `<radialGradient id="cr${u}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#E9EDEF"/><stop offset=".7" stop-color="#9AA5AB"/><stop offset="1" stop-color="#5E686E"/></radialGradient></defs>`;
  }

  /** Side-on picture. Returns { svg, viewBox, width, height, inner } */
  function side(opts = {}) {
    const u = ++uid, color = colorOf(opts.color), body = bodyFor(opts.make, opts.model, opts.rig);
    const tows = body !== "motorhome" && (opts.rig === "caravan" || opts.rig === "camper");
    let inner = defs(u, color);
    let w = 132;
    if (tows) {
      inner += `<g transform="translate(0 0)">${opts.rig === "caravan" ? caravanSide(color) : camperSide(color)}</g>`;
      inner += `<g transform="translate(118 0)">${carSide(body, color, opts.rig)}</g>`;
      w = 252;
    } else inner += carSide(body, color, opts.rig);
    inner = inner.replace(/\{u\}/g, u);
    const viewBox = `0 0 ${w} 64`;
    return { inner, viewBox, width: w, height: 64, body, tows, svg: `<svg viewBox="${viewBox}" aria-hidden="true">${inner}</svg>` };
  }

  // ---------------------------------------------------------------- top view (centred on 0,0, facing up)
  const TOP = { // half-width, half-length
    wagon: [9, 15], ute: [9, 16.5], suv: [8.6, 14], car: [8.2, 14], van: [9.2, 17], motorhome: [10, 19],
  };
  function top(opts = {}) {
    const color = colorOf(opts.color), body = bodyFor(opts.make, opts.model, opts.rig);
    const [hw, hl] = TOP[body], dark = shade(color, -.35);
    const glass = "#2B2F2D";
    let s = `<rect x="${-hw}" y="${-hl}" width="${hw * 2}" height="${hl * 2}" rx="${body === "car" || body === "suv" ? 6.5 : 5}" fill="${color}" stroke="#1A1608" stroke-width="2.4"/>`;
    // windscreen and rear glass / tray / roof
    if (body === "ute") {
      s += `<rect x="${-hw + 2.5}" y="${-hl + 6}" width="${hw * 2 - 5}" height="6" rx="2" fill="${glass}"/>`;
      s += `<rect x="${-hw + 2.2}" y="${-hl + 15.5}" width="${hw * 2 - 4.4}" height="1.8" rx=".8" fill="${glass}"/>`;
      s += `<rect x="${-hw + 2}" y="${-hl + 19}" width="${hw * 2 - 4}" height="${hl * 2 - 22}" rx="1.5" fill="${dark}" opacity=".55"/>`;
    } else if (body === "motorhome") {
      s += `<rect x="${-hw + 2.5}" y="${-hl + 3}" width="${hw * 2 - 5}" height="5" rx="2" fill="${glass}"/>`;
      s += `<rect x="${-hw + 2}" y="${-hl + 10}" width="${hw * 2 - 4}" height="${hl * 2 - 13}" rx="2" fill="#F6F7F4" stroke="${dark}" stroke-width=".8"/>`;
      s += `<rect x="-3" y="-2" width="6" height="5" rx="1" fill="#C9CEC8"/>`;
    } else {
      const ws = body === "van" ? 4 : 6;
      s += `<rect x="${-hw + 2.5}" y="${-hl + ws}" width="${hw * 2 - 5}" height="${body === "van" ? 5 : 7}" rx="2" fill="${glass}"/>`;
      s += `<rect x="${-hw + 2.5}" y="${hl - 6.5}" width="${hw * 2 - 5}" height="4.2" rx="1.5" fill="${glass}"/>`;
      if (opts.rig === "rooftop") s += `<rect x="${-hw + 2}" y="${-hl + 13}" width="${hw * 2 - 4}" height="${hl * 2 - 21}" rx="2" fill="#3B4045"/>`;
      else if (body === "wagon") s += `<path d="M${-hw + 3} ${-hl + 15} H${hw - 3} M${-hw + 3} ${hl - 10} H${hw - 3}" stroke="${dark}" stroke-width="1.4" opacity=".7"/>`;
    }
    // mirrors, headlights
    s += `<rect x="${-hw - 2.5}" y="${-hl + 8}" width="2.5" height="4" rx="1" fill="#1A1608"/><rect x="${hw}" y="${-hl + 8}" width="2.5" height="4" rx="1" fill="#1A1608"/>`;
    s += `<circle cx="${-hw + 3.5}" cy="${-hl + 1}" r="1.6" fill="#FFF7D1"/><circle cx="${hw - 3.5}" cy="${-hl + 1}" r="1.6" fill="#FFF7D1"/>`;
    const tows = body !== "motorhome" && (opts.rig === "caravan" || opts.rig === "camper");
    let extra = "";
    if (tows && opts.withTrailer) { // little trailer behind (used where there's room)
      const L = opts.rig === "caravan" ? 20 : 13;
      extra = `<path d="M0 ${hl} L0 ${hl + 4}" stroke="#1A1608" stroke-width="2"/><rect x="${-hw - 1}" y="${hl + 4}" width="${hw * 2 + 2}" height="${L}" rx="3" fill="${opts.rig === "caravan" ? "#F6F7F4" : "#5E6B4F"}" stroke="#1A1608" stroke-width="2"/>`;
    }
    const pad = tows && opts.withTrailer ? (opts.rig === "caravan" ? 26 : 19) : 0;
    const size = Math.max(hl + 3, hw + 4);
    const vb = `${-size} ${-size} ${size * 2} ${size * 2 + pad}`;
    return { inner: extra + s, viewBox: vb, svg: `<svg viewBox="${vb}" aria-hidden="true">${extra}${s}</svg>`, body };
  }

  const LABEL = { wagon: "4WD wagon", ute: "Ute", suv: "SUV", car: "Car", van: "Van", motorhome: "Motorhome" };
  window.CFCar = { side, top, bodyFor, COLORS, NAMES, LABEL };
})();
