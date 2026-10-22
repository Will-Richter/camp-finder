/* Camp Finder accounts and shared data (Supabase).
 * Fill in SUPABASE_URL and SUPABASE_ANON_KEY from the Supabase dashboard (Project settings > API).
 * Until then the app works fully on the phone, and the account screen says sharing isn't switched on.
 */
(() => {
  "use strict";
  const SUPABASE_URL = "https://cesprkqwzmcioeydxsms.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_VIMVz7yyvc5-GR_v1aQmwg_oBtMIju0"; // the public "anon" key (safe to ship in the app; security comes from row level security)

  const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase?.createClient);
  const sb = enabled ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cf-auth" },
  }) : null;

  let session = null, ready = Promise.resolve();
  const listeners = new Set();
  if (sb) {
    ready = sb.auth.getSession().then(({ data }) => { session = data.session; listeners.forEach((f) => f(session)); }).catch(() => {});
    sb.auth.onAuthStateChange((_e, s) => { session = s; listeners.forEach((f) => f(session)); });
  }
  const must = () => { if (!sb) throw new Error("Sharing isn't switched on in this version yet."); };
  const mustUser = () => { must(); if (!session) throw new Error("Sign in first."); };
  const fail = (error) => { if (error) throw new Error(error.message || "Something went wrong"); };

  function toCamp(r) {
    const a = r.amenities || {}, s = r.suits || {};
    return {
      id: `community/${r.id}`, cloudId: r.id, lat: r.lat, lon: r.lon, tags: {}, source: r.created_by === session?.user?.id ? "user" : "community",
      name: r.name, named: true, kind: "Traveller-added camp",
      cost: r.cost, donation: r.donation, charge: r.charge || "",
      a: { toilets: a.toilets || null, water: a.water || null, showers: a.showers || null, dogs: a.dogs || null, power: a.power || null, fires: a.fires || null, dumpOnSite: a.dump || null },
      ramp: !!a.boatramp, rampM: a.boatramp ? 0 : Infinity, dumpM: a.dump ? 0 : Infinity,
      tents: s.tents !== false, caravans: s.caravans || null, motorhome: s.motorhome || null, bigRig: !!s.big, backcountry: false,
      maxstay: r.max_stay || "", access: "", website: "", phone: "", operator: "", hours: "",
      desc: r.notes || "", image: "", commons: "", photo: r.photo_url || "", added: r.created_at, updated: r.updated_at, mine: r.created_by === session?.user?.id,
    };
  }
  async function dataUrlToBlob(u) { const r = await fetch(u); return r.blob(); }

  // Sign-in link from the email: campfinder://auth#access_token=...&refresh_token=...
  async function handleAuthLink(href) {
    if (!sb) return false;
    const u = new URL(href.replace(/^campfinder:\/\//, "https://app.invalid/"));
    const p = new URLSearchParams((u.hash || "").replace(/^#/, ""));
    u.searchParams.forEach((v, k) => { if (!p.has(k)) p.set(k, v); });
    const say = (ok, text) => window.dispatchEvent(new CustomEvent("cf-auth-link", { detail: { ok, text } }));
    if (p.get("error_description") || p.get("error")) { say(false, (p.get("error_description") || p.get("error")).replace(/\+/g, " ")); return false; }
    try {
      if (p.get("access_token") && p.get("refresh_token")) {
        const { error } = await sb.auth.setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") }); fail(error);
      } else if (p.get("code")) {
        const { error } = await sb.auth.exchangeCodeForSession(p.get("code")); fail(error);
      } else if (p.get("token_hash")) {
        const { error } = await sb.auth.verifyOtp({ token_hash: p.get("token_hash"), type: p.get("type") || "email" }); fail(error);
      } else return false;
      say(true, "Signed in"); return true;
    } catch (e) { say(false, e.message); return false; }
  }
  window.__cfAuthLink = handleAuthLink;
  // Web version: the link lands back on this page with the tokens in the address
  if (sb && /access_token=|[?&]code=|error_description=/.test(location.href)) {
    handleAuthLink(location.href).finally(() => history.replaceState(null, "", location.pathname));
  }

  window.CFCloud = {
    enabled,
    signedIn: () => !!session,
    email: () => session?.user?.email || "",
    whenReady: () => ready,   // the saved sign-in has been read from the phone
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },

    async sendCode(email) {
      must();
      // In the iPhone app the email link opens Camp Finder directly (campfinder://auth); on the web it comes back to this page
      const native = !!window.webkit?.messageHandlers?.nativeFetch;
      const emailRedirectTo = native ? "campfinder://auth" : location.href.split("#")[0];
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo } });
      fail(error);
    },
    async verifyCode(email, token) {
      must();
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      fail(error);
    },
    // password sign-in (only for accounts set up with a password, e.g. Apple's App Review demo account)
    async signInPassword(email, password) {
      must();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signOut() { must(); const { error } = await sb.auth.signOut(); fail(error); },
    async deleteAccount() {
      mustUser();
      const { error } = await sb.rpc("delete_my_account"); fail(error);
      await sb.auth.signOut().catch(() => {});
    },

    async campsIn([s, w, n, e]) {
      if (!sb) return [];
      const { data, error } = await sb.from("camps").select("*").gte("lat", s).lte("lat", n).gte("lon", w).lte("lon", e).limit(1000);
      fail(error);
      return (data || []).map(toCamp);
    },
    async saveCamp(c) {
      mustUser();
      let photo_url = c.photo && !c.photo.startsWith("data:") ? c.photo : null;
      if (c.photo && c.photo.startsWith("data:")) {
        const path = `${session.user.id}/${Date.now()}.jpg`;
        const { error } = await sb.storage.from("camp-photos").upload(path, await dataUrlToBlob(c.photo), { contentType: "image/jpeg" });
        fail(error);
        photo_url = sb.storage.from("camp-photos").getPublicUrl(path).data.publicUrl;
      }
      const row = {
        name: c.name, lat: c.lat, lon: c.lon, cost: c.cost, donation: !!c.donation, charge: c.charge || null,
        amenities: { toilets: !!c.a.toilets, water: !!c.a.water, showers: !!c.a.showers, dogs: !!c.a.dogs, power: !!c.a.power, fires: !!c.a.fires, dump: !!c.a.dumpOnSite, boatramp: !!c.ramp },
        suits: { tents: !!c.tents, caravans: !!c.caravans, motorhome: !!c.motorhome, big: !!c.bigRig },
        max_stay: c.maxstay || null, notes: c.desc || null, photo_url, updated_at: new Date().toISOString(),
      };
      const q = c.cloudId ? sb.from("camps").update(row).eq("id", c.cloudId).select().single() : sb.from("camps").insert(row).select().single();
      const { data, error } = await q; fail(error);
      return toCamp(data);
    },
    async deleteCamp(cloudId) { mustUser(); const { error } = await sb.from("camps").delete().eq("id", cloudId); fail(error); },
    async reportCamp(cloudId) { mustUser(); const { error } = await sb.rpc("report_camp", { target: cloudId }); fail(error); },

    async checkin(key, status, note = "") {
      mustUser();
      const { error } = await sb.from("checkins").insert({ camp_key: key, status, note: note || null }); fail(error);
    },
    // recent "how busy is it" reports for many camps at once (last 36 hours)
    async crowdFor(keys) {
      if (!sb || !keys.length) return [];
      const since = new Date(Date.now() - 36 * 3600e3).toISOString();
      const { data, error } = await sb.from("checkins").select("camp_key,status,note,created_at").in("camp_key", keys.slice(0, 80)).like("note", "crowd:%").gte("created_at", since).order("created_at", { ascending: false });
      fail(error);
      return data || [];
    },
    async latestCheckins(key) {
      if (!sb) return [];
      const { data, error } = await sb.from("checkins").select("status,note,created_at").eq("camp_key", key).order("created_at", { ascending: false }).limit(5);
      fail(error);
      return data || [];
    },

    // ---- ratings
    userId: () => session?.user?.id || "",
    async rate(key, stars, review = "", rig = "", name = "") {
      mustUser();
      const { error } = await sb.from("ratings").upsert({ camp_key: key, stars, review: review || null, rig: rig || null, name: name || null, updated_at: new Date().toISOString() });
      fail(error);
    },
    async deleteRating(key) { mustUser(); const { error } = await sb.from("ratings").delete().eq("camp_key", key).eq("user_id", session.user.id); fail(error); },
    async ratingsFor(key) {
      if (!sb) return { avg: 0, n: 0, list: [], mine: null };
      const { data, error } = await sb.from("ratings").select("stars,review,rig,name,updated_at,user_id").eq("camp_key", key).order("updated_at", { ascending: false }).limit(50);
      fail(error);
      const list = data || [];
      const n = list.length, avg = n ? list.reduce((a, r) => a + r.stars, 0) / n : 0;
      const me = session?.user?.id;
      return { avg, n, list: list.map((r) => ({ ...r, mine: r.user_id === me })), mine: list.find((r) => r.user_id === me) || null };
    },
    async ratingSummaries(keys) {
      if (!sb || !keys.length) return {};
      const out = {};
      for (let i = 0; i < keys.length; i += 150) {
        const { data, error } = await sb.from("rating_summary").select("camp_key,avg,n").in("camp_key", keys.slice(i, i + 150));
        if (error) break;
        for (const r of data || []) out[r.camp_key] = { avg: +r.avg, n: r.n };
      }
      return out;
    },

    // ---- traveller photos of any camp
    async addPhoto(key, dataUrl) {
      mustUser();
      const path = `${session.user.id}/${key.replace(/[^\w-]/g, "_")}-${Date.now()}.jpg`;
      const up = await sb.storage.from("camp-photos").upload(path, await dataUrlToBlob(dataUrl), { contentType: "image/jpeg" });
      fail(up.error);
      const url = sb.storage.from("camp-photos").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from("camp_photos").insert({ camp_key: key, url, path }); fail(error);
      return url;
    },
    async photosFor(key) {
      if (!sb) return [];
      const { data, error } = await sb.from("camp_photos").select("id,url,path,user_id,created_at").eq("camp_key", key).order("created_at", { ascending: false }).limit(30);
      if (error) return [];
      const me = session?.user?.id;
      return (data || []).map((p) => ({ ...p, mine: p.user_id === me }));
    },
    async deletePhoto(p) {
      mustUser();
      await sb.storage.from("camp-photos").remove([p.path]).catch(() => {});
      const { error } = await sb.from("camp_photos").delete().eq("id", p.id); fail(error);
    },
    async reportPhoto(id) { mustUser(); const { error } = await sb.rpc("report_photo", { target: id }); fail(error); },

    // ---- live trip sharing
    url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY,
    async createShare(name, route, tonight) {
      mustUser();
      const { data, error } = await sb.rpc("create_share", { p_name: name, p_route: route, p_tonight: tonight || "" }); fail(error);
      const row = Array.isArray(data) ? data[0] : data;
      return { id: row.id, secret: row.secret };
    },
    async updateShare(sh, pos, tonight, ended = false) {
      if (!sb || !sh) return;
      await sb.rpc("update_share", { p_id: sh.id, p_secret: sh.secret, p_lat: pos?.lat ?? null, p_lon: pos?.lon ?? null, p_speed: pos?.speed ?? null, p_heading: pos?.heading ?? null, p_tonight: tonight || null, p_ended: ended });
    },

    // ---- family sharing (like Life360): you get an invite code, family use it to watch you live
    async createFamily(name, car) {
      mustUser();
      const { data, error } = await sb.rpc("create_family", { p_name: name, p_car: car }); fail(error);
      const row = Array.isArray(data) ? data[0] : data;
      return { id: row.id, secret: row.secret, code: row.code };
    },
    async updateFamily(me, f = {}) {
      if (!sb || !me) return;
      const args = { p_id: me.id, p_secret: me.secret };
      for (const [k, v] of Object.entries(f)) if (v !== undefined) args[`p_${k}`] = v;
      const { error } = await sb.rpc("update_family", args); fail(error);
    },
    async newFamilyCode(me) { must(); const { data, error } = await sb.rpc("new_family_code", { p_id: me.id, p_secret: me.secret }); fail(error); return data; },
    async stopFamily(me) { must(); const { error } = await sb.rpc("stop_family", { p_id: me.id, p_secret: me.secret }); fail(error); },
    async getFamily(code) { must(); const { data, error } = await sb.rpc("get_family", { p_code: code }); fail(error); return data || null; },

    // ---- shared trip plans (anyone with the link can view; no sign-in needed)
    async createPlan(data) {
      if (!sb) throw new Error("offline");
      const { data: id, error } = await sb.rpc("create_plan", { p_data: data }); fail(error);
      return Array.isArray(id) ? id[0] : id;
    },
    // ---- feedback from inside the app
    async sendFeedback(message, contact, kind, device) {
      if (!sb) throw new Error("offline");
      const { error } = await sb.rpc("send_feedback", { p_message: message, p_contact: contact || null, p_kind: kind || null, p_device: device || {} }); fail(error);
    },

    // ---- phone signal at camps
    async signalFor(key) {
      if (!sb) return [];
      const { data, error } = await sb.from("signal_reports").select("carrier,bars,created_at").eq("camp_key", key).order("created_at", { ascending: false }).limit(40);
      if (error) return [];
      return data || [];
    },
    async reportSignal(key, carrier, bars) {
      mustUser();
      const { error } = await sb.from("signal_reports").insert({ camp_key: key, carrier, bars }); fail(error);
    },

    async saveTripNotes(key, data) {
      if (!sb || !session) return;
      const { error } = await sb.from("trip_notes").upsert({ key, data, updated_at: new Date().toISOString() }); fail(error);
    },
    async loadTripNotes() {
      if (!sb || !session) return {};
      const { data, error } = await sb.from("trip_notes").select("key,data"); fail(error);
      return Object.fromEntries((data || []).map((r) => [r.key, r.data]));
    },
  };
})();
