/* Trip recap video: your car drives your actual route across the map, the kilometres tick up,
 * your journal photos play, then a summary card with your badges. Drawn on a canvas and recorded
 * to a video file you can share (portrait, made for Facebook and Instagram stories).
 * CFRecap.create(data) -> { canvas, duration, play(onEnd), stop(), record(onProgress) -> Promise<Blob>, still() -> Promise<Blob> } */
(() => {
  const W = 720, H = 1280, FPS = 30;
  const COAST = [[142.5,-10.7],[143.5,-12.8],[143.8,-14.3],[145.2,-15.5],[145.8,-16.9],[146.8,-19.3],[148.5,-20.3],[149.2,-21.1],[150.3,-22.4],[150.8,-23.2],[151.8,-24.2],[152.4,-24.9],[153.2,-25.3],[153.1,-26.5],[153.4,-27.5],[153.6,-28.6],[153.3,-29.5],[153.1,-30.3],[152.7,-31.6],[151.8,-32.9],[151.3,-33.9],[150.8,-35.1],[150.1,-36.3],[149.9,-37.5],[148.2,-37.8],[147.0,-38.2],[146.4,-39.1],[145.4,-38.5],[144.6,-38.3],[143.5,-38.8],[142.5,-38.4],[141.6,-38.35],[140.6,-38.0],[139.75,-37.2],[139.3,-35.9],[138.5,-35.6],[138.4,-35.0],[138.1,-34.2],[137.6,-35.2],[137.0,-34.8],[137.8,-32.5],[137.0,-33.6],[135.9,-34.7],[135.2,-33.8],[134.2,-32.8],[133.7,-32.1],[132.2,-32.0],[131.1,-31.5],[128.9,-31.7],[126.2,-32.3],[124.0,-33.0],[121.9,-33.9],[119.9,-33.9],[117.9,-35.0],[116.4,-35.0],[115.1,-34.4],[115.0,-33.6],[115.7,-32.6],[115.7,-31.9],[115.1,-30.5],[114.6,-28.8],[113.9,-27.5],[113.4,-26.0],[113.6,-24.9],[113.4,-23.5],[114.1,-21.9],[115.4,-21.4],[116.7,-20.6],[118.6,-20.3],[120.2,-19.7],[121.4,-18.5],[122.2,-18.0],[122.4,-17.0],[123.6,-17.3],[123.6,-16.3],[124.6,-15.4],[125.6,-14.4],[126.8,-13.9],[127.8,-14.4],[128.1,-15.2],[129.4,-14.9],[129.8,-13.6],[130.8,-12.4],[131.9,-11.9],[132.6,-11.4],[133.6,-11.9],[135.0,-12.1],[136.4,-11.9],[136.8,-12.4],[136.3,-13.4],[135.9,-14.5],[135.5,-15.0],[136.7,-15.9],[138.3,-16.8],[139.6,-17.5],[140.8,-17.5],[141.5,-15.5],[141.6,-13.6],[141.9,-12.6],[142.1,-11.2]];
  const TAS = [[144.7,-40.7],[146.6,-41.1],[148.3,-40.9],[148.3,-42.1],[147.9,-43.2],[147.0,-43.6],[146.0,-43.6],[145.2,-42.2],[144.7,-41.0]];

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const svgImg = (svg) => loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.includes("xmlns") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')));
  const fmtKm = (k) => `${Math.round(k).toLocaleString("en-AU")} km`;
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Arial, sans-serif';

  function simplify(track, max = 1200) { if (track.length <= max) return track; const step = track.length / max; const out = []; for (let i = 0; i < max; i++) out.push(track[Math.floor(i * step)]); out.push(track.at(-1)); return out; }

  async function create(data) {
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const track = simplify((data.track || []).filter((p) => isFinite(p[0]) && isFinite(p[1])));
    const photos = (await Promise.all((data.photos || []).slice(0, 6).map(loadImg))).filter(Boolean);
    const car = data.carSvg ? await svgImg(data.carSvg) : null;
    const st = data.stats || {};
    const badges = (data.badges || []).slice(0, 6);

    // timing (seconds)
    const T_TITLE = 1.8, T_MAP = 6.2, T_PHOTO = 1.3, T_END = 3.2;
    const tMapEnd = T_TITLE + T_MAP, tPhotoEnd = tMapEnd + photos.length * T_PHOTO;
    const duration = tPhotoEnd + T_END;

    // map projection: fit the route (or all of Australia for a long trip) into the map area
    const lats = track.map((p) => p[0]), lons = track.map((p) => p[1]);
    let s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
    if (!track.length) { s = -44; n = -10; w = 113; e = 154; }
    const span = Math.max(n - s, (e - w) * 0.9);
    if (span > 9) { s = Math.min(s, -44); n = Math.max(n, -10.5); w = Math.min(w, 113); e = Math.max(e, 153.8); }
    else { const cy = (s + n) / 2, cx = (w + e) / 2, half = Math.max(span * 0.68, 4.2); s = cy - half; n = cy + half; w = cx - half * 1.1; e = cx + half * 1.1; } // keep enough of Australia in view to recognise
    const k = Math.cos(((s + n) / 2) * Math.PI / 180);
    const box = { x: 40, y: 250, w: W - 80, h: 820 };
    const sc = Math.min(box.w / ((e - w) * k), box.h / (n - s));
    const ox = box.x + (box.w - (e - w) * k * sc) / 2, oy = box.y + (box.h - (n - s) * sc) / 2;
    const P = (lat, lon) => [ox + (lon - w) * k * sc, oy + (n - lat) * sc];
    const trackXY = track.map((p) => P(p[0], p[1]));
    const cum = [0]; for (let i = 1; i < trackXY.length; i++) cum.push(cum[i - 1] + Math.hypot(trackXY[i][0] - trackXY[i - 1][0], trackXY[i][1] - trackXY[i - 1][1]));
    const total = cum.at(-1) || 1;

    function smoothShape(pts) {
      const xy = pts.map(([lo, la]) => P(la, lo));
      ctx.beginPath();
      for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!i) ctx.moveTo(m[0], m[1]); else ctx.quadraticCurveTo(a[0], a[1], m[0], m[1]); }
      const a = xy[0], b = xy[1]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.closePath();
    }
    function background() {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0B4A33"); g.addColorStop(0.55, "#0E5A3E"); g.addColorStop(1, "#1C3A2C"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const r = ctx.createRadialGradient(W / 2, H * 0.95, 40, W / 2, H * 0.95, 700); r.addColorStop(0, "rgba(245,197,24,.18)"); r.addColorStop(1, "rgba(245,197,24,0)"); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
    function land(alpha = 1) {
      ctx.save(); ctx.globalAlpha = alpha;
      for (const shape of [COAST, TAS]) {
        smoothShape(shape);
        const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h); g.addColorStop(0, "#D9814A"); g.addColorStop(1, "#A9521C");
        ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8; ctx.fillStyle = g; ctx.fill();
        ctx.shadowColor = "transparent"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,236,200,.75)"; ctx.stroke();
      }
      ctx.restore();
    }
    function routeTo(frac) {
      if (trackXY.length < 2) return trackXY[0] ? { x: trackXY[0][0], y: trackXY[0][1], a: 0 } : null;
      const target = total * frac;
      // faint whole route
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); trackXY.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.setLineDash([6, 10]); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.stroke(); ctx.setLineDash([]);
      // driven so far
      ctx.beginPath(); let i = 0; ctx.moveTo(trackXY[0][0], trackXY[0][1]);
      while (i < trackXY.length - 1 && cum[i + 1] <= target) { i++; ctx.lineTo(trackXY[i][0], trackXY[i][1]); }
      let hx = trackXY[i][0], hy = trackXY[i][1], ang = 0;
      if (i < trackXY.length - 1) { const f = (target - cum[i]) / ((cum[i + 1] - cum[i]) || 1); hx += (trackXY[i + 1][0] - trackXY[i][0]) * f; hy += (trackXY[i + 1][1] - trackXY[i][1]) * f; ctx.lineTo(hx, hy); }
      // heading from a little way back so the car doesn't twitch
      const back = Math.max(0, target - 18); let j = cum.findIndex((c) => c >= back); if (j < 0) j = 0;
      ang = Math.atan2(hy - trackXY[j][1], hx - trackXY[j][0]);
      ctx.shadowColor = "rgba(245,197,24,.8)"; ctx.shadowBlur = 16; ctx.lineWidth = 8; ctx.strokeStyle = "#F5C518"; ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = "#FFF3B8"; ctx.stroke();
      ctx.restore();
      return { x: hx, y: hy, a: ang };
    }
    function pin(x, y, color, r = 11) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r - 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    function drawCar(h, scale = 1) {
      if (!h) return;
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.a + Math.PI / 2);
      ctx.beginPath(); ctx.arc(0, 0, 34 * scale, 0, Math.PI * 2); ctx.fillStyle = "rgba(245,197,24,.22)"; ctx.fill();
      if (car) { const sz = 58 * scale; ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4; ctx.drawImage(car, -sz / 2, -sz / 2, sz, sz); }
      else { ctx.fillStyle = "#F5C518"; ctx.fillRect(-10, -16, 20, 32); }
      ctx.restore();
    }
    function text(str, x, y, size, weight = 800, color = "#fff", align = "center", spacing = 0) {
      ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
      ctx.fillText(str, x, y);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    function fitText(str, max, size) { ctx.font = `900 ${size}px ${FONT}`; while (ctx.measureText(str).width > max && size > 28) { size -= 2; ctx.font = `900 ${size}px ${FONT}`; } return size; }
    function brand(y = 92, a = 1) { ctx.save(); ctx.globalAlpha = a; text("GONE LAPPIN'", W / 2, y, 22, 800, "#F5C518", "center", 8); text("CAMP FINDER", W / 2, y + 30, 18, 700, "rgba(255,255,255,.75)", "center", 5); ctx.restore(); }
    function roundRect(x, y, w2, h2, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w2, y, x + w2, y + h2, r); ctx.arcTo(x + w2, y + h2, x, y + h2, r); ctx.arcTo(x, y + h2, x, y, r); ctx.arcTo(x, y, x + w2, y, r); ctx.closePath(); }

    function frame(t) {
      background();
      if (t < T_TITLE + 0.4) {
        // title card over a faded map
        const a = clamp(t / 0.6), out = clamp((t - T_TITLE + 0.2) / 0.6);
        land(0.35 + 0.65 * out);
        ctx.save(); ctx.globalAlpha = a * (1 - out);
        brand(160);
        const size = fitText(data.title || "My trip", W - 90, 64);
        text(data.title || "My trip", W / 2, H / 2 - 40 + (1 - ease(a)) * 30, size, 900);
        text(data.sub || "", W / 2, H / 2 + 20, 30, 600, "rgba(255,255,255,.85)");
        ctx.restore();
        return;
      }
      if (t < tMapEnd) {
        const p = ease(clamp((t - T_TITLE - 0.3) / (T_MAP - 0.9)));
        land(1);
        if (trackXY.length) pin(trackXY[0][0], trackXY[0][1], "#0E5A3E");
        const head = routeTo(p);
        if (p > 0.98 && trackXY.length) pin(trackXY.at(-1)[0], trackXY.at(-1)[1], "#C8372D");
        drawCar(head);
        // header and counters
        brand(80);
        const size = fitText(data.title || "", W - 80, 40);
        text(data.title || "", W / 2, 190, size, 900);
        ctx.save(); roundRect(60, 1110, W - 120, 120, 26); ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fill(); ctx.restore();
        text(fmtKm((st.km || 0) * p), W / 2 - 150, 1182, 46, 900, "#F5C518");
        text("driven", W / 2 - 150, 1214, 20, 600, "rgba(255,255,255,.75)");
        const day = Math.max(1, Math.ceil((st.days || 1) * Math.max(0.01, p)));
        text(`Day ${day}`, W / 2 + 150, 1182, 46, 900, "#fff");
        text(`of ${st.days || 1}`, W / 2 + 150, 1214, 20, 600, "rgba(255,255,255,.75)");
        return;
      }
      if (t < tPhotoEnd) {
        const idx = Math.floor((t - tMapEnd) / T_PHOTO), lt = (t - tMapEnd - idx * T_PHOTO) / T_PHOTO;
        const img = photos[idx];
        const fx = 50, fy = 210, fw = W - 100, fh = 900;
        ctx.save(); roundRect(fx, fy, fw, fh, 30); ctx.clip();
        const z = 1.02 + lt * 0.08, r = Math.max(fw / img.width, fh / img.height) * z;
        const dw = img.width * r, dh = img.height * r;
        ctx.globalAlpha = clamp(lt / 0.18) * (idx === photos.length - 1 ? 1 : 1 - clamp((lt - 0.85) / 0.15));
        ctx.drawImage(img, fx + (fw - dw) / 2 - lt * 18, fy + (fh - dh) / 2, dw, dh);
        ctx.restore();
        ctx.save(); roundRect(fx, fy, fw, fh, 30); ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.stroke(); ctx.restore();
        brand(90);
        text(`${idx + 1} / ${photos.length}`, W / 2, 1190, 24, 700, "rgba(255,255,255,.7)");
        return;
      }
      // summary card
      const a = ease(clamp((t - tPhotoEnd) / 0.7));
      land(0.25);
      ctx.save(); ctx.globalAlpha = a;
      brand(140);
      const size = fitText(data.title || "", W - 90, 52);
      text(data.title || "", W / 2, 280, size, 900);
      text(data.sub || "", W / 2, 326, 26, 600, "rgba(255,255,255,.8)");
      const cells = [[fmtKm(st.km || 0), "driven"], [`${st.days || 1}`, (st.days || 1) === 1 ? "day" : "days"], [`${st.nights || 0}`, (st.nights || 0) === 1 ? "night camped" : "nights camped"], [`${(st.states || []).length || 1}`, (st.states || []).length === 1 ? "state" : "states"]];
      cells.forEach(([v, l], i) => {
        const cx = i % 2 ? W * 0.73 : W * 0.27, cy = 470 + Math.floor(i / 2) * 190, lift = (1 - a) * 40;
        ctx.save(); roundRect(cx - 150, cy - 80 + lift, 300, 160, 28); ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fill(); ctx.restore();
        text(v, cx, cy + 10 + lift, v.length > 7 ? 46 : 58, 900, i ? "#fff" : "#F5C518");
        text(l, cx, cy + 50 + lift, 22, 600, "rgba(255,255,255,.75)");
      });
      if (badges.length) {
        text("Badges earned", W / 2, 900, 26, 800, "#F5C518");
        const gap = 104, x0 = W / 2 - ((badges.length - 1) * gap) / 2;
        badges.forEach((b, i) => {
          const x = x0 + i * gap, y = 990, pop = ease(clamp((t - tPhotoEnd - 0.5 - i * 0.15) / 0.4));
          ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
          ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fillStyle = b.color || "#E3B23C"; ctx.fill();
          ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.fillStyle = "#14402E"; ctx.fill();
          text(b.icon || "★", 0, b.icon && b.icon.length <= 3 && /^[A-Z]+$/.test(b.icon) ? 9 : 13, b.icon && /^[A-Z]+$/.test(b.icon) ? 22 : 36, 900, "#fff");
          ctx.restore();
        });
      }
      text("Made with Camp Finder", W / 2, 1200, 24, 700, "rgba(255,255,255,.65)");
      ctx.restore();
    }

    let raf = 0, t0 = 0;
    function play(onEnd) {
      cancelAnimationFrame(raf); t0 = performance.now();
      const tick = (now) => { const t = (now - t0) / 1000; frame(Math.min(t, duration)); if (t < duration) raf = requestAnimationFrame(tick); else onEnd?.(); };
      raf = requestAnimationFrame(tick);
    }
    function stop() { cancelAnimationFrame(raf); }
    function supportsVideo() { return !!(window.MediaRecorder && canvas.captureStream); }
    function record(onProgress) {
      return new Promise((resolve, reject) => {
        if (!supportsVideo()) return reject(new Error("no-recorder"));
        const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
        const mimeType = types.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
        let rec;
        try { rec = new MediaRecorder(canvas.captureStream(FPS), mimeType ? { mimeType, videoBitsPerSecond: 6e6 } : undefined); } catch (e) { return reject(e); }
        const chunks = [];
        rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
        rec.onstop = () => { const type = rec.mimeType || mimeType || "video/mp4"; chunks.length ? resolve(new Blob(chunks, { type })) : reject(new Error("empty")); };
        rec.onerror = (e) => reject(e.error || new Error("recorder"));
        rec.start(250);
        cancelAnimationFrame(raf); t0 = performance.now();
        const tick = (now) => {
          const t = (now - t0) / 1000; frame(Math.min(t, duration)); onProgress?.(Math.min(1, t / duration));
          if (t < duration + 0.2) raf = requestAnimationFrame(tick); else rec.stop();
        };
        raf = requestAnimationFrame(tick);
      });
    }
    // a single picture of the summary card, for when video recording isn't available
    function still() { frame(duration); return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92)); }
    frame(0);
    return { canvas, duration, play, stop, record, still, supportsVideo, frame };
  }
  window.CFRecap = { create };
})();
