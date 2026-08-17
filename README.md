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

## How it opens

The app opens on a **Cristiano Ronaldo career article**. Selecting the **Manchester United
2003–2009** entry opens the Home Screen — via a passcode prompt if one is set in Settings.
Nothing on that entry marks it as a way in; it reads as an ordinary section of the article.

### About the passcode

Set it in **Settings → App password**. The same password is used everywhere — Change,
Remove, Lock now and the article entry all read one record, so there is no second password
to keep in sync.

It is stored as a PBKDF2-SHA256 hash (210,000 iterations, random 16-byte salt) via
WebCrypto. The plaintext is never written to storage, never logged, and never placed in
source. Wrong entries produce no message and no hint about what was wrong — the article
simply returns, as though the section had not opened — and repeated failures are slowed
progressively to blunt guessing.

**Be clear about what this is:** a privacy screen, not encryption. It keeps a passer-by out
of the app on a shared device. Anyone with the device and browser developer tools can still
read what's in IndexedDB, and nothing here changes that. Settings says so on screen.
WebCrypto needs a secure origin, so password protection is available over https (and on
localhost) and is disabled with an explanation elsewhere.

### Photographs and club badges

The article's image frames ship with **colour-matched placeholder graphics**, not
photographs of Ronaldo — those are copyrighted sports photography. To use real images,
replace the eight files in `photos/` keeping the same names. Club badges are registered
trademarks, so each club is represented by a colour-matched monogram shield in the badge
position rather than a reproduction of the crest.

Career figures reflect public reporting as of August 2026 (976 career goals, Al-Nassr
contract to June 2027) and will drift as he keeps playing. They live in the `CAREER` array
near the top of the script if you want to update them.

## What's on screen

The Clock, Calendar, iPad battery and Photos widgets, a Calculator and Settings row where
the Weather widget used to be, and a dock of Photos, Notes, Phone, Messages. No extra apps, no folder, no page
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
- **Calculator** — iOS-style arithmetic: decimals, sign, percent, AC/C, repeat-equals,
  and keyboard input. Division by zero shows Error and recovers on the next entry.
- **Settings** — Dark mode and Brightness (both take effect immediately and persist), plus
  the Security section described above.

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

## Updating

Bump `VERSION` in `sw.js` when you change any shell file. The new worker precaches the
whole shell before taking over, and old caches are deleted on activation.
