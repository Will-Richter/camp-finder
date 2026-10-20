/* Camp Finder accounts and shared data (Supabase).
 * Fill in SUPABASE_URL and SUPABASE_ANON_KEY from the Supabase dashboard (Project settings > API).
 * Until then the app works fully on the phone, and the account screen says sharing isn't switched on.
 */
(() => {
  "use strict";
  const SUPABASE_URL = "";      // e.g. "https://abcd1234.supabase.co"
  const SUPABASE_ANON_KEY = ""; // the public "anon" key (safe to ship in the app; security comes from row level security)

  const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase?.createClient);
  const sb = enabled ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cf-auth" },
  }) : null;

  let session = null;
  const listeners = new Set();
  if (sb) {
    sb.auth.getSession().then(({ data }) => { session = data.session; listeners.forEach((f) => f(session)); });
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

  window.CFCloud = {
    enabled,
    signedIn: () => !!session,
    email: () => session?.user?.email || "",
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },

    async sendCode(email) {
      must();
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      fail(error);
    },
    async verifyCode(email, token) {
      must();
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
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
