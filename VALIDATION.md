# Validation and remaining checks

Build: Loft reference redesign, September 23, 2026.

## Automated checks completed

| Area | Result | Scope |
| --- | --- | --- |
| Existing server/auth/security/cache/Trash/sync tests | 28 passed | Local tests and mocked external services; no production account changes |
| New checksum/export tests | 4 passed | SHA-256 compatibility, original ZIP bytes, cancellation/limits, streamed folder writes |
| Bulk imports | 2,100 files saved | Fake IndexedDB, tiny mixed image/video-labelled fixtures; timer continued running |
| Large selection | 5,200 selected | jsdom UI; fewer than 150 tiles retained before and after scrolling |
| Original preservation | Exact byte checks passed | Tiny fixtures plus one 64 MiB synthetic video-labelled payload |
| Interrupted import | Passed | Stop after committed files; saved records remain; reselect skips exact duplicates |
| Storage failure | Passed | Injected quota error; successful file retained; resumed without duplication |
| Duplicate collision | Passed | Same name/size/date with different bytes imported as distinct originals |
| Bulk deletion | Passed | Batches of 100 records with sync revision updates |
| Notes | Passed | Create/edit, flush on close, checklist preview, deletion without resurrection, failed-save editor protection |
| Phone | Passed | Dialpad builds correct number and hands off via a `tel:` link |
| Messages | Passed | Draft survives navigation, saving a message persists it |
| App navigation | Passed | Photos, Notes, Phone, Messages, Settings → Cloud Library, Calculator |
| Cloud integration | Passed | Mocked two-device round-trip, original media, no repeat unchanged uploads, offline edits, conflicts, concurrent-edit protection |
| Cloud Library | Passed | Search, media dialog, original/text downloads, export, Trash/restore, usage totals |
| Snapshots | Passed | Browse/delete/cancel operations preserve retained media and local records |
| ZIP interoperability | Passed | Python's independent ZIP reader verified filenames, CRCs and unchanged bytes |
| JavaScript syntax | Passed | New modules and extracted application script |

These are functional/simulated checks, **not an iPhone performance certification**. The 2,100-file run used tiny generated files, not thousands of camera originals. The 64 MiB test verifies storage preservation, not video playback or a supported codec. jsdom does not render page geometry or exercise real touch gestures.

## What could not be tested here

A real browser installation failed because the downloaded browser archive was unusable. Consequently, actual visual rendering, desktop browser behavior, thumbnail decoding, video playback, pinch/swipe behavior, native Share/folder pickers, browser memory pressure, iOS keyboard geometry, Safari and Home Screen/PWA operation remain unverified. Do the device checks in START-HERE.md before merging a preview into production.

The project retains the existing cloud metadata/part limits and browser storage constraints. A huge mixed library may hit those limits. Local import completion is not proof that every original has synced: check the Cloud status before relying on another device.

## Implementation boundaries

- IndexedDB remains `home-screen`, version 1, using the same stores. No content-clearing migration.
- File bytes are retained in `blob`; thumbnails are separate, derived previews. EXIF/container metadata in the original file remains intact.
- Imports commit one file at a time. Closing the browser may interrupt the current file; completed transactions remain.
- Cloud hashing for large blobs is incremental in a worker, with an incremental fallback. Existing hash/fingerprint format is preserved.
- Photo DOM is virtualized. Notes, contact lists, conversations and older messages load/display in batches.
- Sync uses the existing conflict/revision checks, owner authentication, R2 storage, snapshots and server-owned 30-day Trash retention.
- The existing daily cleanup cron and required environment variables are unchanged.
- ZIP export is store-only (no compression) with a 512 MiB batch limit. Folder export streams originals when the browser supports it.
- Notes formatting is portable plain text with a safe preview, not a full rich-text word processor.
- Phone uses the real device dialer. Messages is a private draft notebook and does not deliver SMS.

## Reproduce locally (optional, for development)

From this update's root folder after installing Node.js:

```sh
npm install
npm test
npm install --prefix checks
node checks/bulk.cjs
node checks/app.cjs
node checks/export.cjs
node checks/sync.cjs
node checks/snapshots.cjs
node checks/library.cjs
```

The `checks` scripts use isolated fake databases and mocked cloud services, never your production credentials. Their generated output files stay inside `checks`. The snapshot/library checks call mocked download/dialog interfaces; they do not claim native picker or real browser validation.
