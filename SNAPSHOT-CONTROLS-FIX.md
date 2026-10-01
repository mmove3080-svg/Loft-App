# Snapshot controls fix — v16

This package includes the incremental snapshot update and the earlier sync/index fixes.

## What failed

Automatic snapshot resume set the same global busy flag used by cloud buttons. Their handlers returned without doing anything. Manually starting a snapshot also used the UI-wide operation wrapper, disabling all buttons until the snapshot ended. Previous tests exercised live sync cancellation, but not this snapshot path.

## Changes

- Snapshot jobs run independently of the cloud action busy flag.
- Pause snapshot cancels the active request and saves a persistent pause preference. Opening the app, signing in, and online/visibility events do not override an explicit pause.
- Sign out stops the snapshot and live sync, preserves pending media and checkpoints, and removes the stored snapshot login.
- On the first v16 launch, an existing pending snapshot pauses once for manual review. Resume snapshot keeps its original ID, completed records and pending-part recovery. Newly started unpaused jobs retain automatic recovery on reopening.
- Snapshot fetch and response-body consumption have a 60-second limit and cancellation. A stalled request cannot keep the snapshot controls locked. A request whose bytes reached storage can be verified on resume without sending those bytes again.
- A failed attempt does not loop every 15 seconds in the same session. Resume explicitly or reconnect after a network interruption. Explicit Pause is still respected.
- A known legacy backup part that cannot be verified for reuse stops with an error instead of silently uploading it again.
- Sync cannot race snapshot startup. Sync now explains that the snapshot must be paused first.
- A late login refresh cannot restore a session after sign-out.
- Progress labels distinguish records checked, newly uploaded bytes, and reused bytes. Checking all 5,000+ records is still expected; it does not mean all media is uploaded.
- Cloud Storage/Library shows `Snapshot controls v16`. Public service-worker cache version is v16. Local IndexedDB is not cleared.

## Tests completed

- npm test: 40/40 passed.
- checks/snapshot-controls.cjs: legacy job at 26/28 survives upgrade; only manual resume starts it; existing media reused; controls work during stalled upload and automatic resume; browse works; persistent pause survives fresh context, sign-in and online events; sign-out cancels an unresponsive request; completed lost-response bytes are not sent again; failed known-backup reuse stops without an upload.
- checks/incremental.cjs: 5,127 existing synthetic photos plus 90 new = exactly 90 uploads, 5,217 byte-for-byte readable originals; changed/unchanged media and retry recovery.
- checks/incremental-ui.cjs: real UI metadata discovery and reuse on repeat save.
- checks/snapshot-reopen.cjs: new-format unpaused job automatically resumes in a fresh context without repeated media writes.
- checks/large-index-resume.cjs: old 5,127/5,127 job finalizes without media reads/uploads.
- checks/resume-albums.cjs: lost upload/commit responses, checkpoints, album move persistence.
- checks/sync-controls.cjs and checks/sync.cjs: stalled live-sync controls, two-device merge, conflicts, offline changes and deletion propagation.
- checks/snapshots.cjs and checks/library.cjs: browsing, previews, exports, Trash, deletion and local data preservation.

These are automated tests with simulated storage/network and browser environments. They are not a hardware iPhone test or an inspection of your private production bucket. No claim of zero future bugs is made.

## Deploy

1. Create `snapshot-controls-fix` from current `main`.
2. Extract the ZIP and upload the contents inside `Loft-App-main` to the branch root. Do not upload the outer folder or ZIP.
3. Commit message: `Fix snapshot resume and cloud controls`.
4. Create a pull request into main. Wait for deployment checks, then merge and confirm.
5. Wait for the new Vercel Production deployment to be Ready.
6. Reopen the existing iPhone Home Screen app while online. Confirm `Snapshot controls v16` in Cloud Storage/Library. If absent, close and reopen again after the updated service worker finishes installing. Do not clear website data or uninstall the PWA.
7. Existing pending job should be paused with its completed record count retained. Check Collection and Sign out. Sign back in, then choose Resume snapshot.
8. Inspect Uploaded this snapshot and Reused. The total records checked still includes the entire snapshot. Test Pause snapshot and reopening: it should remain paused until Resume.

No new environment variables or database migration are required.

## Existing incremental-storage limits

New media still goes through Vercel; this is not the direct-device-to-R2 change. Initial legacy reuse creates shared copies within R2, without retransmitting those originals from your phone. Shared objects remain retained after snapshot deletion to protect other snapshots; garbage collection is not included. Reading/hashing local records and checking cloud metadata still takes time and some requests. All completed work remains checkpointed.
