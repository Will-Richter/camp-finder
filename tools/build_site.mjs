// Builds the gonelappin.au website into _site/: the home page and styles from site/, the legal pages (terms, privacy,
// cookies, refunds, credits) from the app's own legal text (docs/legal.js, so they always match), plus the shared
// trip, plan and family pages.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "_site");
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const copy = (from, to = path.basename(from)) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "site"))) copy(`site/${f}`, f);
copy("docs/cars.js"); copy("docs/icons", "icons"); copy("docs/share.html"); copy("docs/plan.html"); copy("docs/family.html");
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
copy("docs/vendor/leaflet.min.js", "vendor/leaflet.min.js"); copy("docs/vendor/leaflet.min.css", "vendor/leaflet.min.css");
if (fs.existsSync(path.join(root, "docs/maps.js"))) copy("docs/maps.js");
fs.writeFileSync(path.join(out, "CNAME"), "gonelappin.au\n");

const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, "docs/legal.js"), "utf8"), ctx);
const L = ctx.window.CF_LEGAL, B = L.business;
const page = (title, desc, body) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Camp Finder</title><meta name="description" content="${desc}"><meta name="theme-color" content="#0E5A3E">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="preload" href="fonts/AtkinsonHyperlegible-Regular.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="site.css"></head>
<body class="page"><a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap"><a class="brand" href="./" aria-label="Gone Lappin' Camp Finder home"><small>GONE LAPPIN'</small><b>CAMP FINDER</b></a>
<nav aria-label="Main"><a href="./#how">How it works</a><a href="./#get">Get the app</a><a href="support.html">Help</a></nav></div></header>
<main id="main" class="doc"><div class="wrap">${body}</div></main>
<footer><div class="wrap"><div><a class="brand" href="./" aria-label="Gone Lappin' Camp Finder home"><small>GONE LAPPIN'</small><b>CAMP FINDER</b></a><small>Camp information is a guide only. Always check local rules, fire bans and road conditions.</small>
<small class="biz">Camp Finder is made by ${B.owner}, ABN ${B.abn}, Bundaberg QLD · <a href="tel:+61${B.phone.replace(/\D/g, "").slice(1)}">${B.phone}</a> · <a href="mailto:${B.email}">${B.email}</a></small></div>
<nav aria-label="Footer"><a href="support.html">Help and support</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="cookies.html">Cookies</a><a href="refunds.html">Refunds</a><a href="credits.html">Credits</a></nav></div></footer>
</body></html>`;
const fill = (h) => h.replaceAll("{contact}", L.contact);
const DOCS = { terms: "The terms for using Camp Finder.", privacy: "How Camp Finder handles your information.", cookies: "How Camp Finder uses (and doesn't use) cookies.", refunds: "Refunds for Camp Finder Pro.", credits: "Where Camp Finder's maps, data, photos and software come from." };
const legalNav = `<nav class="legal-nav" aria-label="Legal">${Object.keys(DOCS).map((k) => `<a href="${k}.html">${L.titles[k]}</a>`).join("")}</nav>`;
for (const [k, desc] of Object.entries(DOCS)) fs.writeFileSync(path.join(out, `${k}.html`), page(L.titles[k], desc, `<h1>${L.titles[k]}</h1><p class="meta">Last updated ${L.updated}</p>${legalNav}${fill(L[k])}`));
const support = fs.readFileSync(path.join(root, "site/support.body.html"), "utf8");
fs.writeFileSync(path.join(out, "support.html"), page("Help and support", "Get help with Camp Finder.", fill(support)));
fs.writeFileSync(path.join(out, "404.html"), page("Page not found", "", `<h1>Wrong turn</h1><p>That page doesn't exist. <a href="./">Head back to the home page</a>.</p>`));
fs.rmSync(path.join(out, "support.body.html"));
console.log("Built", fs.readdirSync(out).join(", "));
