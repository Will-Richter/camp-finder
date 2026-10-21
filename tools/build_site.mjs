// Builds the gonelappin.au website into _site/: the home page and styles from site/, privacy and terms
// pages from the app's own legal text (docs/legal.js, so they always match), plus the family live-trip page.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "_site");
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const copy = (from, to = path.basename(from)) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "site"))) copy(`site/${f}`, f);
copy("docs/cars.js"); copy("docs/icons", "icons"); copy("docs/share.html"); copy("docs/plan.html");
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
copy("docs/vendor/leaflet.min.js", "vendor/leaflet.min.js"); copy("docs/vendor/leaflet.min.css", "vendor/leaflet.min.css");
if (fs.existsSync(path.join(root, "docs/maps.js"))) copy("docs/maps.js");
fs.writeFileSync(path.join(out, "CNAME"), "gonelappin.au\n");

const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, "docs/legal.js"), "utf8"), ctx);
const L = ctx.window.CF_LEGAL;
const page = (title, desc, body) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Camp Finder</title><meta name="description" content="${desc}"><meta name="theme-color" content="#0E5A3E">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css"></head>
<body class="page"><a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap"><a class="brand" href="./" aria-label="Gone Lappin' Camp Finder home"><small>GONE LAPPIN'</small><b>CAMP FINDER</b></a>
<nav aria-label="Main"><a href="./#how">How it works</a><a href="./#beta">Get the app</a><a href="support.html">Help</a></nav></div></header>
<main id="main" class="doc"><div class="wrap">${body}</div></main>
<footer><div class="wrap"><div><a class="brand" href="./"><small>GONE LAPPIN'</small><b>CAMP FINDER</b></a><small>Camp information is a guide only. Always check local rules, fire bans and road conditions.</small></div>
<nav aria-label="Footer"><a href="support.html">Help and support</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="mailto:${L.contact}">${L.contact}</a></nav></div></footer>
</body></html>`;
const fill = (h) => h.replaceAll("{contact}", L.contact);
fs.writeFileSync(path.join(out, "privacy.html"), page("Privacy policy", "How Camp Finder handles your information.", `<h1>Privacy policy</h1><p class="meta">Last updated ${L.updated}</p>${fill(L.privacy)}`));
fs.writeFileSync(path.join(out, "terms.html"), page("Terms of use", "The terms for using Camp Finder.", `<h1>Terms of use</h1><p class="meta">Last updated ${L.updated}</p>${fill(L.terms)}`));
const support = fs.readFileSync(path.join(root, "site/support.body.html"), "utf8");
fs.writeFileSync(path.join(out, "support.html"), page("Help and support", "Get help with Camp Finder.", fill(support)));
fs.writeFileSync(path.join(out, "404.html"), page("Page not found", "", `<h1>Wrong turn</h1><p>That page doesn't exist. <a href="./">Head back to the home page</a>.</p>`));
fs.rmSync(path.join(out, "support.body.html"));
console.log("Built", fs.readdirSync(out).join(", "));
