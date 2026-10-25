/* Camp Finder tutorial: a short walkthrough of everything the app does.
 * Shown once after the first-time setup (with Skip), and again any time from the ? help button.
 * window.CFTour.open({ onDone }) */
(() => {
  const SLIDES = [
    { art: "🏕️", tag: "Welcome", title: "Every camp in Australia, in your pocket",
      body: "Camp Finder plans road trips around where you'll sleep: free camps, caravan parks, rest areas and national park campgrounds, plus fuel, water, dump points and sights on the way.",
      points: ["Over 10,000 camps and 2,000+ caravan parks built in", "Works with no phone signal once it's on your phone", "Made for caravans, campers, motorhomes, swags and tents"] },
    { art: "🗺️", tag: "Plan a trip", title: "Tell it where you're going",
      body: "On the Trip tab, type where you're starting and where you're headed, then tap the town in the list.",
      points: ["📍 \"Use my location\" fills in where you are", "➕ Add places you want to stop at on the way, like Uluru on the way to Exmouth", "🌙 Pick how many nights, and what you're travelling with", "↩️ Return trip: nights there, nights at your destination, nights home, and a different road back"] },
    { art: "⛺", tag: "Where to stay", title: "Free camps, caravan parks, or both",
      body: "Choose where you like to stay and tick your must-haves (toilets, showers, dogs, fires, power and more).",
      points: ["Free camps, Free first, Caravan parks or Anything", "The best-rated places with your must-haves are picked first", "BIG4 and the big park chains come up near the top", "Every park shows a price guide, and Book and Call buttons"] },
    { art: "📋", tag: "Your trip plan", title: "A camp for every night",
      body: "Tap Find camps and you get one place for each night, with photos, amenities, price, weather and how far you'll drive each day.",
      points: ["🔁 Not keen on a camp? See other camps near it and swap", "🏕️ Stay an extra night anywhere", "🛣️ Route options: up to five ways to go, there and home", "💾 Save it, download it for no signal, or send it to someone"] },
    { art: "⛽", tag: "Fuel and costs", title: "Know what it'll cost",
      body: "Set your vehicle once and every trip shows fuel and camp fees, with fuel stops placed so you never run dry.",
      points: ["Official fuel prices where the states publish them", "Fuel stops picked for price and range, towing included", "Warnings for long stretches with no fuel", "A full cost breakdown for the trip"] },
    { art: "🧭", tag: "Explore and Discover", title: "Find a spot near you",
      body: "Explore shows every camp on the map around you. Discover has ready-made trips to start from.",
      points: ["Filter by free camps, caravan parks, amenities and big-rig friendly", "Tap any camp for photos, reviews, rules and directions", "Download an area before you lose signal", "Add a camp you know about to help other travellers"] },
    { art: "🚙", tag: "On the road", title: "Tap Start journey when you leave",
      body: "Your drive is recorded as you go, and the part of the route you've driven changes colour.",
      points: ["💧 Need water, 🚐 dump point or ⛽ fuel? One tap finds the nearest", "Directions open in Apple Maps for each day's drive", "Rate camps and check in so others know what it's like now", "Keep a trip journal with notes and photos"] },
    { art: "🏅", tag: "Badges", title: "Collect badges as you travel",
      body: "Badges are earned automatically while a journey is running. Open them from My stuff.",
      points: ["📏 Kilometres: First 10 km up to Road Legend (50,000 km)", "🌙 Nights away, hours driving and states visited", "🪨 Special places: Uluru, K'gari, Cape York, the Gibb, the Nullarbor and more", "🇦🇺 The Big Lap: every capital plus Cairns, Darwin and Broome", "🎬 Finish a trip for a recap video to share"] },
    { art: "👨‍👩‍👧", tag: "Family sharing", title: "Let family follow along",
      body: "Turn on family sharing in My stuff and send the invite code. Family can watch where you are, how fast you're going, where you've camped and the badges you've earned.",
      points: ["Pause or stop sharing any time", "Get a new code if you want to cut someone off", "They can follow you in the app or on the web"] },
    { art: "⛴️", tag: "Islands and safety", title: "Heading somewhere tricky?",
      body: "Trips to K'gari, Moreton, Straddie, Kangaroo Island, Bruny and Tasmania show the barge or ferry with booking links, plus the permits you need.",
      points: ["4WD-only islands are flagged, so caravans aren't sent there", "Fire bans, closures and local camping rules show on your trip", "Always check signs and conditions when you arrive"] },
    { art: "❓", tag: "That's it", title: "Help is always one tap away",
      body: "Tap the ? next to \"Where are you headed?\" on the Trip tab for quick help, and to watch this tutorial again. Settings lets you switch to Simple mode for bigger text and buttons.",
      points: ["Something wrong or an idea? Settings → Send feedback", "Have a great trip! 🤙"] },
  ];
  let el = null;
  function build() {
    el = document.createElement("div");
    el.id = "tour"; el.className = "tour"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Camp Finder tutorial");
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    el.innerHTML = `<div class="tour-card">
      <div class="tour-top"><span class="tour-step" id="tourStep"></span><button type="button" class="tour-skip" id="tourSkip">Skip</button></div>
      <div class="tour-track" id="tourTrack">${SLIDES.map((s, i) => `<section class="tour-slide" data-i="${i}">
        <div class="tour-art" aria-hidden="true"><span>${s.art}</span></div>
        <p class="tour-tag">${esc(s.tag)}</p>
        <h2>${esc(s.title)}</h2>
        <p class="tour-body">${esc(s.body)}</p>
        <ul class="tour-points">${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      </section>`).join("")}</div>
      <div class="tour-dots" id="tourDots">${SLIDES.map(() => "<i></i>").join("")}</div>
      <div class="tour-nav"><button type="button" class="btn" id="tourBack">Back</button><button type="button" class="cta" id="tourNext">Next</button></div>
    </div>`;
    document.body.appendChild(el);
  }
  function open({ onDone } = {}) {
    if (!el) build();
    const track = el.querySelector("#tourTrack"), dots = [...el.querySelectorAll("#tourDots i")], n = SLIDES.length;
    el.hidden = false; el.classList.remove("out"); track.scrollLeft = 0;
    const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const mark = () => {
      const i = at();
      dots.forEach((d, k) => d.classList.toggle("on", k === i));
      el.querySelector("#tourStep").textContent = `${i + 1} of ${n}`;
      el.querySelector("#tourNext").textContent = i === n - 1 ? "Let's go" : "Next";
      el.querySelector("#tourBack").style.visibility = i === 0 ? "hidden" : "visible";
      el.querySelector("#tourSkip").style.visibility = i === n - 1 ? "hidden" : "visible";
    };
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    const done = () => {
      try { localStorage.setItem("cf-tour-seen", "1"); } catch { /* private mode */ }
      el.classList.add("out");
      setTimeout(() => { el.hidden = true; onDone && onDone(); }, smooth ? 380 : 0);
    };
    track.onscroll = () => { clearTimeout(track._t); track._t = setTimeout(mark, 50); };
    el.querySelector("#tourNext").onclick = () => { const i = at(); if (i >= n - 1) return done(); go(i + 1); };
    el.querySelector("#tourBack").onclick = () => go(Math.max(0, at() - 1));
    el.querySelector("#tourSkip").onclick = done;
    el.onkeydown = (e) => { if (e.key === "Escape") done(); if (e.key === "ArrowRight") go(Math.min(n - 1, at() + 1)); if (e.key === "ArrowLeft") go(Math.max(0, at() - 1)); };
    setTimeout(() => { mark(); el.querySelector("#tourNext").focus({ preventScroll: true }); }, 30);
  }
  const seen = () => { try { return localStorage.getItem("cf-tour-seen") === "1"; } catch { return false; } };
  window.CFTour = { open, seen, count: SLIDES.length };
})();
