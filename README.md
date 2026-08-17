# Home — an iOS-style Home Screen for the web

A high-fidelity recreation of the attached reference Home Screen, built as a responsive
web app and installable PWA. No frameworks, no build step, no external assets, and no
network requests at runtime — the whole interface is one HTML file.

## Files

```
index.html              the entire app (markup, CSS, JS)
manifest.webmanifest    PWA manifest
sw.js                   service worker: versioned shell precache
icons/                  icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
```

Keep the folder structure — `manifest.webmanifest` and `sw.js` reference `icons/` relatively.

## Running it

Serve the folder over HTTP(S); opening `index.html` from the file system works, but the
service worker and install prompt need an origin.

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Deploy by uploading the folder as-is to any static host (Netlify, Vercel, GitHub Pages,
Cloudflare Pages, S3). Nothing needs to be compiled.

**Installing:** iOS/iPadOS — Safari → Share → Add to Home Screen. Android/desktop Chrome
and Edge — the install button in the address bar. It launches standalone, without browser
chrome.

## What's on screen

Only what the reference shows: the Weather, Clock, Calendar, iPad battery, and Photos
widgets, and a dock of Photos, Notes, Phone, Messages. No extra apps, no folder, no page
indicator, and deliberately **no signal bars, Wi-Fi, carrier, or battery indicator** — the
status bar shows the real time and nothing else.

The Clock and Calendar are live. The Photos widget shows your own imported thumbnails and
a real count once you've imported anything.

## The apps

- **Photos** — imports images and video from the device, generates thumbnails locally,
  groups by date, full-screen viewer (swipe, arrow keys), select mode, delete.
- **Notes** — create, edit, search, delete; autosaves as you type.
- **Phone** — favorites, recents, contacts, keypad, and a call screen. A browser can't
  place calls, so the call screen says so and offers a `tel:` handoff to the real dialer.
- **Messages** — local conversations you can open, write in, and delete. Nothing is sent
  over a network; the app says so on screen.

## Data

Photos, videos, notes, conversations, and contacts live in **IndexedDB on the device**.
Media is never uploaded anywhere, and there is no backend. Clearing site data (or
uninstalling the PWA) removes it. If IndexedDB is unavailable — private windows on some
browsers — the app falls back to in-memory storage for the session rather than failing.

Formats depend on the browser: JPG, PNG, WEBP, GIF and MP4/WebM decode nearly everywhere;
HEIC and some MOV files don't. Those still import and are stored intact, and the app says
plainly that the browser can't preview them instead of showing a broken tile.

## Layout

Four tiers, chosen from the viewport rather than from device sniffing:

| Viewport | Layout |
|---|---|
| Phone portrait | 4 columns, the reference composition exactly |
| Tablet portrait | 6 columns, widgets spread across the width |
| Landscape / desktop | 8 columns — two medium widgets over three small |
| Short landscape (phone sideways) | 14 columns, all five widgets in one band |

Grid metrics — 8% side margin, 3.4% gutter, 2.15:1 medium widgets, square small ones —
were measured from the reference image rather than estimated.

## Interaction

Tap or click an icon to open an app; it scales up from the icon it came from. Return home
via the home indicator at the bottom of any app, `Esc`, a swipe up from the bottom edge,
or the browser/Android back button. Everything is reachable by keyboard, focus rings are
visible, and `prefers-reduced-motion` disables the transitions.

## Performance

Measured on a cold load: 0 network requests after the document, DOMContentLoaded ~85 ms,
first contentful paint ~215 ms, ~9.5 MB JS heap. Thumbnails decode lazily through an
IntersectionObserver and object URLs are revoked when a view closes, so the gallery stays
flat in memory as it grows. The clock stops ticking when the tab is hidden.

## Deploying to Vercel

This is a static site — there is no build step and no dependencies.

```
git init
git add .
git commit -m "Home Screen PWA"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then in Vercel: **Add New → Project → import the repo**, and deploy with the defaults:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command | leave empty (or `echo "static"`) |
| Output Directory | leave empty |
| Install Command | leave empty |

`vercel.json` is included and sets the headers that matter: `sw.js` and `index.html` are
revalidated on every request so updates reach installed apps, `manifest.webmanifest` is
served with the right content type, and `icons/` is cached for a year.

To update after a change, bump `VERSION` in `sw.js`, then commit and push — Vercel
redeploys on push, the new worker precaches the shell before taking over, and old caches
are dropped.

Installed apps keep their data across deploys: photos, notes, and conversations live in
IndexedDB on the device, which a deploy never touches.

## Updating

Bump `VERSION` in `sw.js` when you change any shell file. The new worker precaches the
whole shell before taking over, and old caches are deleted on activation.
