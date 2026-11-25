/* Camp Finder's legal pages: terms, privacy, cookies, refunds, and data and software credits. Shown in the app
 * (Settings → Legal) and built into gonelappin.au by tools/build_site.mjs, so both always say the same thing.
 * Plain-English drafts written to Australian law as of November 2026. Have a lawyer look over them. */
(() => {
  const B = {
    owner: "Will Richter",
    abn: "63\u00a0906\u00a0231\u00a0375",   // non-breaking spaces keep it on one line
    town: "Bundaberg, Queensland, Australia",
    phone: "0481 678 552",
    email: "hello@gonelappin.au",
    site: "gonelappin.au",
    appStore: "https://apps.apple.com/app/id6825620735",
  };
  const mail = `<a href="mailto:${B.email}">${B.email}</a>`;
  const tel = `<a href="tel:+61${B.phone.replace(/\D/g, "").slice(1)}">${B.phone}</a>`;
  const who = `<p>Camp Finder (the app and the ${B.site} website) is made and run by <b>${B.owner}</b>, ABN ${B.abn}, ${B.town}. "We", "us" and "our" mean ${B.owner}. Gone Lappin' is the name of the app's website and brand.</p>
<p>Email ${mail} · Phone ${tel}</p>`;

  const terms = `
<h3>Who we are</h3>
${who}

<h3>Agreeing to these terms</h3>
<p>These terms apply when you use Camp Finder. By using it you agree to them. If you don't agree, please don't use the app. You can stop using it at any time. Our <a href="privacy.html" data-legal="privacy">Privacy policy</a>, <a href="cookies.html" data-legal="cookies">Cookie policy</a> and <a href="refunds.html" data-legal="refunds">Refund policy</a> are part of these terms.</p>

<h3>The information is a guide, so check before you rely on it</h3>
<p>Camp, rest area, caravan park, fuel, water, dump point, sight, route, weather, fire and road information comes from public sources (such as OpenStreetMap contributors, Australian government data, Apple, Google and Wikipedia) and from other travellers. It can be incomplete, out of date or wrong. Camps close, rules change, prices rise, roads flood and servos run out.</p>
<p>Always check signs, local rules, permits, fire bans, tides, road conditions, opening hours and whether water is safe to drink before you travel, camp or drive on a beach. A warning not showing in the app does not mean there's no danger. You're responsible for where you camp, how you drive, your vehicle's limits (including its height, weight and range) and for following the law.</p>
<p>Fuel, distance, time, sunset and cost figures are estimates. Carry enough fuel, water and supplies for remote travel.</p>

<h3>Driving safely</h3>
<p>Set up your trip before you drive. Don't handle your phone while driving, and follow the road rules about phone use where you are. Turn-by-turn directions don't know about every closure, roadwork or restriction, and they don't account for towing, unsealed roads or flooding. In an emergency call 000.</p>

<h3>Your account</h3>
<p>You can use most of the app without an account. If you make one, keep access to your email secure and don't share your account. You can delete your account at any time in the app (My stuff, then Saved, then Delete account).</p>

<h3>What you share with other travellers</h3>
<p>When you add a camp, a photo, a rating, a review, a check-in or a report, other travellers can see it. You confirm that it's honest and based on your own experience, and that you took any photo you add, or have the right to share it.</p>
<p>Please don't post anything unlawful, misleading, abusive or offensive, advertising, or anything that shows other people's faces, number plates or private information without their permission.</p>
<p>You keep ownership of what you share. You give us a free, non-exclusive licence to store, show, resize and share it in Camp Finder (in the app and on our website) for as long as it stays in Camp Finder. If you delete it or your account, we stop showing it, except camps you've added, which stay for other travellers but are no longer linked to you.</p>
<p>Anyone can report a traveller's camp, photo or review. We look at every report and remove content that breaks these rules, and photos and camps with several reports are hidden automatically. You can also hide everything from a particular traveller on your phone. We may suspend an account that seriously or repeatedly breaks these rules.</p>

<h3>Using Camp Finder fairly</h3>
<p>Please don't misuse the app or website, try to break into or overload them, or copy large parts of them except as the data licences on our <a href="credits.html" data-legal="credits">Credits</a> page allow.</p>

<h3>Camp Finder Pro</h3>
<p>Most of the app is free. Camp Finder Pro is optional and is bought through Apple in the iPhone app, as a monthly or yearly subscription or a one-off "Pro forever" purchase. The price, in Australian dollars including GST, is shown before you buy.</p>
<ul>
<li><b>Free trial.</b> New subscribers may get a free trial. If you don't cancel at least 24 hours before it ends, the subscription starts and you're charged.</li>
<li><b>Renewal.</b> Subscriptions renew automatically at the same price unless you cancel at least 24 hours before the end of the current period. Your Apple ID is charged within 24 hours before the period ends.</li>
<li><b>Cancelling.</b> Cancel any time in the app (Settings, then tap Camp Finder Pro), or in your iPhone's Settings → your name → Subscriptions. Pro stays on until the end of the period you've paid for.</li>
<li><b>Pro forever</b> is paid once, doesn't renew, and stays with your Apple ID for as long as Camp Finder is offered. Restore it on a new phone with Restore purchases.</li>
<li><b>Tester and gift codes</b> are redeemed with Apple and give Pro for the time shown on the code.</li>
</ul>
<p>If we change a subscription price, Apple tells you before it applies to you. Refunds are covered in our <a href="refunds.html" data-legal="refunds">Refund policy</a>.</p>

<h3>Other businesses</h3>
<p>Links to ferries, permits, parks, caravan parks, motels and fuel stations take you to other businesses. We don't take bookings or payments for them and they're responsible for their own prices and services. Names like BIG4 belong to their owners and are used only to tell you which business a place is.</p>

<h3>Your rights under the Australian Consumer Law</h3>
<p>Our services come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms takes away those rights.</p>

<h3>Our responsibility</h3>
<p>We take reasonable care to make Camp Finder useful and accurate, and we're responsible for loss caused by our failure to take reasonable care or to meet our legal obligations. We're not responsible for:</p>
<ul>
<li>information supplied by others (like OpenStreetMap contributors, government agencies, businesses and other travellers) being wrong, where checking signs, local rules and conditions as these terms ask would have shown the problem,</li>
<li>loss that wasn't reasonably foreseeable, or</li>
<li>things outside our reasonable control, such as weather, fire, road closures, phone signal, or Apple, Google or other services being unavailable.</li>
</ul>
<p>This doesn't limit any right you have under the Australian Consumer Law or any other law that can't be limited.</p>

<h3>Changes</h3>
<p>We improve the app often, and we may update these terms. If we make an important change we'll tell you in the app before it applies. If you don't agree with a change, you can stop using the app, delete your account and cancel Pro (see our Refund policy for when a refund applies).</p>

<h3>Law and disputes</h3>
<p>These terms are governed by the law of Queensland, Australia. If something's wrong, please contact us first (${mail} or ${tel}) and we'll try to sort it out quickly. You can also contact the Queensland Office of Fair Trading or your local consumer protection agency.</p>`;

  const privacy = `
<h3>Who we are</h3>
${who}

<h3>The short version</h3>
<ul>
<li>Most of what you do in Camp Finder stays on your phone.</li>
<li>We don't show ads, we don't sell or rent your information, and the app and website don't use analytics or tracking tools.</li>
<li>Your location only leaves your phone to get routes, maps, weather, fuel prices, photos and warnings, or when you turn on live sharing or Family sharing.</li>
<li>An account is optional. If you make one, we keep your email and the things you choose to share.</li>
</ul>
<p>We follow the Australian Privacy Principles in the Privacy Act 1988 (Cth).</p>

<h3>What stays on your phone</h3>
<p>Your trips, saved camps, vehicle and cost settings, offline downloads, travel journal (notes and photos), badges, and camps you add without an account are kept on your phone. Your location is used on your phone to show where you are, follow you on the map, give directions and plan from where you are.</p>
<p><b>Journeys.</b> When you tap Start journey, the app records your route, including in the background while the journey is running, to give turn-by-turn directions, build your journal, badges and trip video, and warn you about the last fuel before a long stretch. This route stays on your phone unless you turn on live sharing or Family sharing. Recording stops when you end the journey.</p>
<p><b>Drive mode, CarPlay and widgets</b> work out what's coming up on your phone. Your location isn't sent to us for them.</p>
<p><b>Voice search.</b> When you tap the microphone, Apple's speech recognition turns what you say into text, which may send the audio to Apple. We don't receive or keep recordings.</p>
<p><b>Trip videos</b> are made on your phone and only leave it if you choose to share or save them.</p>

<h3>If you create an account</h3>
<ul>
<li><b>Your email address</b>, used to sign you in and, only if needed, to contact you about your account. We never send marketing emails.</li>
<li><b>Things you choose to share</b>: camps you add, photos, star ratings and reviews, check-ins (like "still free" or how busy a camp is), phone signal reports and AdBlue reports. These are public in the app. Ratings and reviews show your type of setup (for example "Caravan traveller"), never your name or email. Photos are re-saved by the app before upload, which removes hidden details such as where the photo was taken.</li>
<li><b>Trip notes and bookings</b> you add to a trip, so they're on any phone you sign in on. Only you can see them.</li>
</ul>

<h3>Sharing your trip</h3>
<ul>
<li><b>Send a trip plan.</b> When you send a plan, its places, camps and route are saved so the link works for anyone you send it to, for one year. No name, email or live location is included, and the start and end are only shown to about a kilometre, with no route line near them, so your home address isn't shared.</li>
<li><b>Live trip sharing</b> (only if you turn it on for a journey): your current location, speed, direction and tonight's stop are updated about every five minutes so anyone with the link can follow your trip. It stops when you end the journey, and the link stops working after 60 days.</li>
<li><b>Family sharing</b> (only if you turn it on): your phone sends your current location, speed and direction, with the name you choose, your vehicle, the trip you're on, the places you've stayed overnight, and your kilometres, states and badges. During a journey this is updated about every 20 seconds while driving; otherwise when you move a few hundred metres, if you've allowed location access "Always". Anyone with your invite code can see it until you pause sharing, make a new code (which stops the old one working) or turn sharing off. Turning it off, or deleting your account, deletes this information. Your journal notes and photos are never shared. When you follow someone, only their code is kept, on your phone.</li>
</ul>

<h3>Feedback</h3>
<p>If you send feedback in the app, we receive your message, the email address you give us (optional), and your app version, phone type and app settings such as your vehicle. It's linked to your account if you're signed in. We use it only to answer you and fix problems.</p>

<h3>Purchases</h3>
<p>Camp Finder Pro is bought through Apple. Apple handles your payment, and we never see your card or bank details. Apple only tells the app whether you have Pro.</p>

<h3>Services that receive information</h3>
<p>To work, the app sends some information to these services. They only get what they need for that job, and each handles it under its own privacy policy. We choose providers that commit to protecting information at least as well as this policy does.</p>
<ul>
<li><b>Supabase</b> stores accounts and everything shared through accounts, on servers in Sydney, Australia.</li>
<li><b>Resend</b> sends our sign-in emails (it receives your email address).</li>
<li><b>Apple</b>: Apple Maps for place search and directions (search text and route points), Apple Weather for forecasts (points along your route), speech recognition (when you use the microphone), and the App Store (purchases).</li>
<li><b>Google Maps</b> (Places) for photos, reviews, fuel prices and places to stay. The places you look at and points along your route are sent to Google.</li>
<li><b>Stadia Maps</b> for the map and for some routes (the map area you look at, and the start, end and stops of those routes). <b>Esri</b> for the satellite view (the map area you look at).</li>
<li><b>OpenStreetMap data services</b> (Overpass servers in Germany and Austria) for camps along your route that aren't yet in the app (the area around your route). <b>Photon by Komoot</b> (Germany) as a backup for place search (the search text or map point).</li>
<li><b>Wikimedia Commons and Wikipedia</b> for photos and descriptions of places (the place you open, or the area around a camp).</li>
<li><b>State fire, emergency and road agencies</b> for warnings and road conditions (your phone downloads their public feeds).</li>
<li><b>GitHub</b> hosts the weekly camp list update and the maps you download (no personal information is sent).</li>
</ul>
<p>Some of these services are based in, or store information in, other countries, including the United States and Germany. Every one of these services receives your phone's internet (IP) address when your phone contacts it.</p>

<h3>Cookies</h3>
<p>Camp Finder doesn't use cookies or similar tools to track you or for advertising. See our <a href="cookies.html" data-legal="cookies">Cookie policy</a>.</p>

<h3>How long we keep things</h3>
<ul>
<li>Your account and what you've shared: until you delete them or your account.</li>
<li>Family sharing: until you turn it off or delete your account. Live trip sharing: until the link expires after 60 days.</li>
<li>Trip plan links: one year.</li>
<li>Feedback: as long as we need it to answer you and fix the problem, unless you ask us to delete it sooner.</li>
<li>Copies in our database provider's backups are removed when those backups expire.</li>
</ul>
<p>When you delete your account (My stuff, then Saved, then Delete account), we delete your account, ratings, reviews, check-ins, signal reports, photos, trip notes and bookings, and sharing. Camps you've added stay for other travellers but are no longer linked to you, and AdBlue reports (which only say whether a servo has AdBlue) stay without your name. You can also email us to delete your account.</p>

<h3>Keeping it safe</h3>
<p>Information is sent over encrypted connections and our database only lets each person see and change their own private information. No system is perfectly secure, but if a data breach is likely to cause you serious harm we'll tell you and the Office of the Australian Information Commissioner as soon as we can.</p>

<h3>Your choices and rights</h3>
<ul>
<li>Use the app without an account, and turn off location access in your iPhone's settings at any time (some features need it).</li>
<li>Pause or turn off Family sharing and live sharing, and delete anything you've shared, at any time.</li>
<li>Ask us for a copy of the information we hold about you, or ask us to correct it, by emailing ${mail}. We'll reply within 30 days.</li>
</ul>

<h3>Children</h3>
<p>Camp Finder is for travellers of any age, but accounts, sharing and purchases are meant for adults. If you're under 18, please use them with a parent or guardian.</p>

<h3>Automated decisions</h3>
<p>Camp Finder automatically suggests camps, routes and fuel stops for your trip. It doesn't make decisions about you that have legal or similarly significant effects.</p>

<h3>Complaints</h3>
<p>If you have a privacy question or complaint, email ${mail} or call ${tel}. We'll respond within 30 days. If you're not happy with our response, you can contact the Office of the Australian Information Commissioner at oaic.gov.au.</p>

<h3>Changes</h3>
<p>If we change how we handle your information in an important way, we'll tell you in the app before the change applies.</p>`;

  const cookies = `
<h3>The short version</h3>
<p>Camp Finder doesn't use cookies, analytics or advertising tools to track you, in the app or on ${B.site}. Because nothing is used for tracking or advertising, there's no cookie banner to click through.</p>

<h3>What's stored on your phone</h3>
<p>The app stores things on your phone so it works the way you set it up. This is local storage, not cookies, and it stays on your phone:</p>
<ul>
<li>your settings, vehicle, trips, saved camps, journal, badges and offline downloads,</li>
<li>choices you've made, like which messages you've already seen,</li>
<li>if you sign in, a sign-in token so you stay signed in. It's removed when you sign out or delete the app.</li>
</ul>

<h3>Our website</h3>
<p>${B.site} doesn't set cookies, and its fonts and images come from our own site. Pages that show a shared trip or plan on a map download map tiles from Stadia Maps (or OpenStreetMap) and load the trip from our database. Those services receive your internet (IP) address because your browser asks them for the map or data.</p>

<h3>Photos, maps and other content in the app</h3>
<p>When the app shows a map, a Google or Wikimedia photo, or a weather forecast, your phone downloads it from that service, which receives your internet (IP) address. We don't let any of them track you for advertising. See the list in our <a href="privacy.html" data-legal="privacy">Privacy policy</a>.</p>

<h3>If this changes</h3>
<p>If we ever want to use cookies or similar tools for anything other than making Camp Finder work, we'll ask you first and update this policy.</p>

<h3>Clearing it</h3>
<p>Deleting the app removes everything it has stored on your phone. On the website, you can clear site data in your browser's settings.</p>

<h3>Questions</h3>
<p>Email ${mail} or call ${tel}.</p>`;

  const refunds = `
<h3>Who we are</h3>
${who}

<h3>Free features</h3>
<p>Most of Camp Finder is free, so there's nothing to refund.</p>

<h3>Camp Finder Pro is bought through Apple</h3>
<p>Pro subscriptions and Pro forever are sold through Apple's App Store. Apple takes the payment and handles refunds, so we can't refund App Store purchases ourselves, and we never see your payment details.</p>
<p><b>To ask Apple for a refund:</b> go to <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a>, sign in with your Apple ID, choose "Request a refund", and pick Camp Finder Pro. Apple decides refunds under its own policies and Australian law.</p>

<h3>Your rights under the Australian Consumer Law</h3>
<p>Our services come with guarantees that cannot be excluded under the Australian Consumer Law. For major failures with the service, you are entitled to cancel your service contract with us and to a refund for the unused portion, or to compensation for its reduced value. You are also entitled to choose a refund or replacement for major failures with goods. If a failure with the goods or a service does not amount to a major failure, you are entitled to have the failure rectified in a reasonable time. If this is not done you are entitled to a refund for the goods and to cancel the contract for the service and obtain a refund of any unused portion. You are also entitled to compensation for any other reasonably foreseeable loss or damage from a failure in the goods or service.</p>
<p>These rights apply no matter what this policy or Apple's policy says.</p>

<h3>If something isn't working</h3>
<p>Tell us first (${mail} or ${tel}) and we'll try to fix it quickly. If we can't fix it in a reasonable time, or it's a major failure, ask Apple for a refund as above. If you're entitled to a refund under the Australian Consumer Law and don't get one through Apple, contact us and we'll make it right.</p>

<h3>Changing your mind</h3>
<p>The Australian Consumer Law doesn't require refunds when you simply change your mind, but Apple sometimes gives them, so it's worth asking Apple.</p>

<h3>Cancelling a subscription</h3>
<ul>
<li>Cancel any time in the app (Settings, then tap Camp Finder Pro) or in your iPhone's Settings → your name → Subscriptions.</li>
<li>Cancel a free trial at least 24 hours before it ends and you won't be charged.</li>
<li>When you cancel, Pro stays on until the end of the period you've paid for, and you won't be charged again.</li>
</ul>

<h3>Tester and gift codes</h3>
<p>Codes are free, so there's nothing to refund.</p>

<h3>Questions</h3>
<p>Email ${mail} or call ${tel}.</p>`;

  const credits = `
<h3>Map and camp data</h3>
<ul>
<li><b>OpenStreetMap.</b> Camps, rest areas, caravan parks, fuel, water, dump points, boat ramps, 4WD tracks and map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) at <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a>. The camp list built into the app is a database made from OpenStreetMap data, and it's available under the ODbL in our <a href="https://github.com/Will-Richter/camp-finder/tree/main/docs/data" target="_blank" rel="noopener">public code repository</a>.</li>
<li><b>Queensland Parks and Wildlife Service</b> campgrounds, from parks.qld.gov.au, © State of Queensland.</li>
<li><b>National Formal Rest Areas</b>, Australian Government (data.gov.au), and <b>Recreation Sites</b>, Victorian Government (CC BY 3.0).</li>
<li><b>Fuel prices</b> from the state government fuel price schemes we have access to, such as FuelWatch (Government of Western Australia) and FuelCheck (NSW Government), and from Google Maps.</li>
<li><b>Fire and emergency warnings</b> from the state and territory fire and emergency services, and road conditions from state road agencies.</li>
<li><b>Map tiles</b> © Stadia Maps, © OpenMapTiles, © OpenStreetMap contributors. <b>Satellite imagery</b> © Esri, Maxar, Earthstar Geographics. <b>Offline maps</b> by Protomaps from OpenStreetMap data.</li>
<li><b>Directions</b> by Apple Maps and Stadia Maps. <b>Weather</b> by Apple Weather (data sources at <a href="https://weatherkit.apple.com/legal-attribution.html" target="_blank" rel="noopener">weatherkit.apple.com</a>). <b>Place search</b> backup by Photon (Komoot).</li>
</ul>

<h3>Photos and descriptions</h3>
<ul>
<li><b>Traveller photos</b> belong to the travellers who took them.</li>
<li><b>Google photos and reviews</b> come from Google Maps. Each shows the name of the person who posted it.</li>
<li><b>Wikimedia Commons photos</b> are shown with their photographer and licence (most are Creative Commons). Tap a photo to see its page, with the full licence.</li>
<li><b>Descriptions</b> marked "From Wikipedia" come from Wikipedia, under CC BY-SA 4.0.</li>
<li>Camp Finder's own text, drawings, icons and app design © ${B.owner}.</li>
</ul>

<h3>Open-source software and fonts</h3>
<p>Camp Finder is built with these open-source projects. Thank you to everyone who makes them.</p>
<ul class="lic">
<li><b>Leaflet</b> 1.9.4: BSD 2-Clause License. Copyright (c) 2010-2023, Volodymyr Agafonkin. Copyright (c) 2010-2011, CloudMade. All rights reserved.</li>
<li><b>Leaflet.markercluster</b>: MIT License. Copyright (c) 2012-2026 David Leaver and contributors.</li>
<li><b>MapLibre GL JS</b> 4.7.1: BSD 3-Clause License. Copyright (c) 2023, MapLibre contributors. Contains code from mapbox-gl-js v1.13 and earlier, Copyright (c) 2020, Mapbox.</li>
<li><b>MapLibre GL Leaflet</b>: ISC License. Copyright (c) 2021 MapLibre contributors. Copyright (c) 2014, Mapbox.</li>
<li><b>protomaps-leaflet</b> 5.1.0: BSD 3-Clause License. Copyright 2021-2024 Protomaps LLC.</li>
<li><b>supabase-js</b> 2.45.4: MIT License. Copyright (c) 2020 Supabase.</li>
<li><b>Overpass</b> font: SIL Open Font License 1.1. Copyright 2021 The Overpass Project Authors.</li>
<li><b>Atkinson Hyperlegible</b> font: SIL Open Font License 1.1. Copyright 2020 Braille Institute of America, Inc.</li>
<li><b>Barlow Condensed</b> font: SIL Open Font License 1.1. Copyright 2017 The Barlow Project Authors.</li>
</ul>
<details class="lic-text"><summary>Licence texts</summary>
<p><b>BSD 2-Clause License (Leaflet)</b></p>
<p>Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.</p>
<p>THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.</p>
<p><b>BSD 3-Clause License (MapLibre GL JS, protomaps-leaflet)</b></p>
<p>Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.</p>
<p>THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.</p>
<p><b>MIT License (Leaflet.markercluster, supabase-js)</b></p>
<p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
<p>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
<p><b>ISC License (MapLibre GL Leaflet)</b></p>
<p>Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.</p>
<p><b>SIL Open Font License 1.1 (Overpass, Atkinson Hyperlegible, Barlow Condensed)</b>: the fonts may be used, shared and bundled with software, and can't be sold on their own. Full text at <a href="https://openfontlicense.org" target="_blank" rel="noopener">openfontlicense.org</a>.</p>
</details>`;

  window.CF_LEGAL = {
    updated: "25 November 2026",
    contact: B.email,
    business: B,
    titles: { terms: "Terms of use", privacy: "Privacy policy", cookies: "Cookie policy", refunds: "Refund policy", credits: "Credits and licences" },
    terms, privacy, cookies, refunds, credits,
  };
})();
