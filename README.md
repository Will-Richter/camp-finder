# Gone Lappin' Camp Finder

Find free and cheap campsites along any drive in Australia. Type where you're going, how many nights and what you're travelling with, and the app picks a camp for each night, with a map, photos, amenities and directions.

## What it does

- **Plan trip:** From, To, nights on the road, rig (tent, rooftop, camper trailer, caravan, motorhome), cost (free only / free first / any), max detour, and must-haves (toilets, drinking water, showers, dogs, boat ramp nearby, dump point nearby, power, campfires). Picks one camp per night at an even driving distance, with up to 3 alternatives each night, and lists every camp along the route.
- **Explore:** move the map anywhere in Australia and the camps in view load automatically, filtered the same way.
- **Camp details:** cost, amenities, max stay, nearest boat ramp and dump point, photos taken nearby, satellite view.
- **Directions:** the route drawn on the map with turn-by-turn steps for each day, plus one tap to navigate in Apple Maps or Google Maps.
- **Saved:** trips and camps are kept on the phone.

## Where the data comes from

| What | Source | Notes |
| --- | --- | --- |
| Campsites, boat ramps, dump points | OpenStreetMap via the Overpass API | Live, Australia-wide. Uses `tourism=camp_site` / `caravan_site`, `leisure=slipway`, `amenity=sanitary_dump_station` |
| Driving routes and turn-by-turn | OSRM | Public demo server for now |
| Place search | Photon (komoot) | |
| Photos | Wikimedia Commons | Photos geotagged within 1.5 km of the camp |
| Map | OpenStreetMap tiles; Esri imagery for satellite | |

WikiCamps data is not used: it has no public data feed and its content is copyrighted.

## Before charging money or going big

The free public servers above are fine for testing and light use but have no guarantee and limit heavy or commercial use. Before launch, switch to paid or self-hosted providers (all configurable at the top of `docs/app.js`):

- **Map tiles:** a commercial OSM provider (MapTiler, Stadia Maps, Thunderforest Outdoors, which also draws campsites).
- **Routing:** a hosted OSRM, OpenRouteService or GraphHopper plan.
- **Campsite data:** run our own nightly extract of OpenStreetMap Australia into a database, plus state national park camping datasets, so searches are fast and work offline.
- **Satellite imagery:** check Esri's terms or swap to the tile provider's imagery.

## Project layout

```
docs/                  the app (also served by GitHub Pages from /docs)
  index.html, app.js, styles.css, manifest.webmanifest, icons/
capacitor.config.json  wraps docs/ as a native iPhone / Android app
codemagic.yaml         cloud build to TestFlight (no Mac needed)
package.json
```

## Run it

- **Web / iPhone home screen:** GitHub repo Settings > Pages > Deploy from branch `main`, folder `/docs`. Open the link in Safari, Share > Add to Home Screen.
- **Native iPhone app (App Store):**
  1. Join the Apple Developer Program.
  2. In App Store Connect create the app with bundle ID `au.com.gonelappin.campfinder`, and create an App Store Connect API key.
  3. Either: on a Mac with Xcode, `npm install && npm run ios && npx cap open ios`, then Archive and upload. Or: connect this repo to Codemagic, add the API key as an integration named `GoneLappinASC`, and run the `iOS to TestFlight` workflow.
  4. Test on your phone through TestFlight, then submit for review.
- **Android:** `npm install && npm run android && npx cap open android`, then build a release bundle in Android Studio for Google Play.
