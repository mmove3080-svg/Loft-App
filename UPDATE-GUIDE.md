# Loft update — resumable snapshots, albums and media gestures

This package updates the existing Loft project. It has not been deployed to your Vercel account.

## Deploy

1. Create a GitHub branch named `loft-media-improvements` from your latest `main`.
2. Extract this ZIP. Copy the contents of `Loft-App-main` into the repository root, replacing matching files and including the new JavaScript files. Do not put the folder itself inside your repository.
3. Commit the changes and let Vercel create a preview deployment. Test it with a small collection before merging the pull request.
4. Merge after checking the preview. Vercel should deploy your production branch as configured.
5. Close other open Loft tabs and reopen the installed app after deployment so the new app files and database upgrade can load together. Do not clear site data or uninstall the PWA as an update step.

No new environment variables, Supabase migrations or R2 bucket changes are required. Keep the existing credentials and CRON_SECRET in Vercel. The database upgrades from version 1 to 2 by adding an albums store; it does not delete existing records. The service worker caches only public application assets, not authentication or private API responses.

## What changed

- **Save Snapshot:** A durable queue freezes the records at the start of the snapshot. Every acknowledged upload chunk and completed record is checkpointed in IndexedDB. A lost upload response is reconciled with server metadata, without downloading the original again. The final commit is retry-safe. The progress panel shows completed records, uploaded bytes and the last completed item.
- **Automatic resume:** Uploads continue while the browser permits execution, even when hidden. Returning to the app, reconnecting or reopening checks for unfinished work. A cloud session is saved on this device only while a snapshot is unfinished; signing out removes it. If credentials expire or are revoked, sign in again to resume the same job. Closing the app stops execution, not the durable queue.
- **Photo grid:** Visible items are prioritized, with a small look-ahead window in the scrolling direction. Thumbnails are stored in IndexedDB, reused through a bounded in-memory cache and rendered through the existing virtual grid. The cloud grid uses a bounded concurrent, viewport-aware thumbnail queue and a persistent thumbnail cache.
- **Viewer:** Photos and videos have adjacent pages, horizontal swipes, downward dismissal and snap-back. Native video controls, Done, Previous/Next, download, sharing and photo zoom remain available. Reduced-motion settings are respected.
- **Albums:** Use New album, or Select → choose items → Move to Album. You can choose an existing album, create a destination or return items to Unfiled. Imports enter the selected album. Moves update metadata rather than creating another original. All media continues to show the complete library. Album order is newest media first, with a stable ID tie-break.
- **Consistency:** Album records and membership use the same database, sync revision and snapshot format as the rest of the app. Moves update all selected records in one transaction. Cloud sync reuses unchanged media payloads for membership-only edits. Cloud collections and backups can be filtered by album.

## Important behavior

A dated snapshot captures the arrangement when that snapshot starts. Later album moves appear in live sync and in the next snapshot; they do not rewrite an older backup. Importing a backup preserves existing records and remaps album references if an imported album needs a new ID.

The browser cannot execute after iOS suspends or terminates it. No continuous background execution is claimed. Completed work is recorded before advancing, and an in-flight chunk is verified on resume. Browser storage eviction, clearing site data or uninstalling the PWA can remove local checkpoints. A persistent-storage request is made where supported, but the operating system controls whether it is granted. Staging a consistent snapshot needs device storage; a quota error pauses the operation rather than claiming success.

A preview cannot be displayed before its bytes arrive, and some formats (such as certain HEIC or video codecs) may not be supported by the browser. Unsupported previews keep the unchanged original available for download. Automatic sync retains the existing rule of applying changes on Home, Cloud Library or Settings, protecting active editors.

## Checks completed

- Existing server/security, cache, integrity, export, snapshot and sync unit tests.
- Whole-app DOM regression checks for Notes, Phone, Messages, Settings, Photos and Calculator.
- Snapshot crash tests: lost part response, lost final commit response, fresh execution context, persisted authentication, automatic resume and no repeated completed uploads.
- Album transaction, rollback, persistence and two-device synchronization checks, including unchanged cloud originals during moves.
- 2,100-file import, 5,200-item virtual grid, duplicate detection, quota failure and unchanged-original checks.
- Chromium at a 390 × 844 mobile viewport with actual dispatched touch events: album creation/moves, reopening, photo/video paging, boundaries, downward snap-back/dismissal, thumbnail cache reuse, and preserved video controls.

These checks do not substitute for testing on your physical iPhone or against your live Supabase/R2 deployment.

## iPhone acceptance check

1. Start a small snapshot. Minimize Loft, return, then terminate and reopen it. Confirm progress resumes and the last completed item is retained.
2. Turn connectivity off during an upload, then restore it. Confirm the job resumes and produces one completed backup.
3. Scroll rapidly through photos and videos, reverse direction, then revisit earlier rows. Confirm loaded previews are reused.
4. Open a photo and a video. Swipe both directions, test both album boundaries, try a short downward drag and then a full downward dismissal. Test video play/seek and photo zoom.
5. Create two albums. Move several items between them, refresh and reopen. Verify both counts, the viewer order and the cloud album arrangement after sync.
6. Save a snapshot after the move and inspect its album filter. Confirm existing import/export, password reset and Trash behavior remain available.

## Developer checks

Run from the project root:

```sh
npm ci
npm test
npm ci --prefix checks
node checks/app.cjs
node checks/bulk.cjs
node checks/snapshots.cjs
node checks/sync.cjs
node checks/library.cjs
node checks/resume-albums.cjs
node checks/snapshot-reopen.cjs
```

`checks/mobile.cjs` additionally requires Playwright and an installed Chromium. It uses an installed `playwright` package (or `CODEX_PRIMARY_RUNTIME_NODE_MODULES` when supplied); `LOFT_BROWSER_BINARY` optionally selects a compatible Chromium executable. Screenshots are written to the test output directory. The included one-second blue video is a generated test fixture.
