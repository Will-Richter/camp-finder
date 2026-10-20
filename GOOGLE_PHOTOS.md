# Switching on Google photos

Camp Finder shows real Google Maps photos of each camp through Google's official Places API.
Photos are fetched live when someone opens a camp (Google doesn't allow storing them).

Cost (Google Places API "New", checked Oct 2026): place lookups used here are free;
each photo shown counts as one "Place Photo" event — 1,000 free a month, then about US$7 per 1,000.
The app shows up to 4 photos per camp (`googlePhotos` in docs/app.js).

## Steps
1. console.cloud.google.com → create a project called "Camp Finder".
2. Billing → link a billing account (card needed; set a budget alert, e.g. A$20/month).
3. APIs & Services → Library → enable **Places API (New)**.
4. APIs & Services → Credentials → Create credentials → API key.
   - Application restrictions: **iOS apps** → bundle ID `au.com.gonelappin.campfinder`
   - API restrictions: **Places API (New)** only
5. Paste the key into `googleKey: ""` in docs/app.js, copy docs to ios-native/CampFinder/web, rebuild.
