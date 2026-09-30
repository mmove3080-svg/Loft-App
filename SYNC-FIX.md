# iPhone cloud controls and large sync fix

## Deploy

1. Extract Loft-App-sync-fix.zip on your PC.
2. Create a GitHub branch from main named iphone-sync-fix.
3. Upload the contents of the extracted Loft-App-main folder into the repository root. Do not upload the ZIP or nest the outer folder.
4. Commit with the message: Fix iPhone cloud sync controls.
5. Create a pull request into main. Wait for successful deployment checks, then merge.
6. Wait for the new Vercel Production deployment to show Ready.

No new environment variables, credentials, database migrations, or R2 CORS changes are required. This package includes the previous snapshot-index fix. It is based on that delivered release; compare the PR if main has other changes made outside this conversation.

## Check on your iPhone

Keep the same Home Screen icon and domain. Do not uninstall Loft or clear website data.

1. Open Loft online, then close and reopen it to load the update. A second reopen may be needed for the service worker update.
2. Open Cloud Library and sign in if asked. Automatic sync may start if it was already enabled.
3. Confirm the status advances through Checking, Reading shared collection, Sending or Receiving, and Saving.
4. While syncing, try Browse synced collection and Pause automatic sync. Pause cancels the active sync request and saves the disabled setting. Enable automatic sync resumes it.
5. Sign out should stop sync and preserve local records. Signing out now turns automatic sync off on that device; re-enable it after signing in when desired.
6. Wait for Up to date, then verify a known item from each device on the other. Existing conflict and deletion rules still apply.
7. Confirm the completed iPhone snapshot remains in Backups. Browsing it does not require importing it.

If sync reports an error, capture its exact text. Errors no longer trigger a repeating 15-second retry loop; Sync now explicitly retries. Reconnecting can also trigger a retry.

## Changes

- Automatic sync no longer occupies the lock used by cloud buttons.
- Pause and Sign out abort active sync network requests and check cancellation before local writes.
- Checking, sending and receiving counts show progress. Sending also shows the current item and blob byte position; these are stage counts, not a claim that the whole sync is committed.
- Confirmed upload-part checkpoints persist in IndexedDB. On retry/reopen, matching parts are verified against cloud hash and size, and only missing/unconfirmed parts upload again. Existing files may be read/hashed to verify identity; this is not a media re-upload.
- Large live-sync metadata uses bounded requests and revision-checked reads, as snapshots do. The same shared collection, owner authentication, merge rules, Trash retention and conditional writes remain in use.
- Starting a snapshot save/import while sync is running pauses automatic sync first.
- Public cache version changes to v14; private API data and IndexedDB are not cleared.

## Validation

37 automated tests passed, covering owner authentication, upload integrity, snapshots, sync merges/conflicts, Trash/deletion retention, large metadata transport and stale-revision rejection. The new live-sync transport test uses 5,127 records with metadata larger than 3 MB.

Additional simulation checks passed:
- sync-controls: browsing during a stalled upload, Pause, Sign out, network failure, reopening with a durable upload checkpoint and no repeat of completed upload chunks.
- sync: two devices, original media round trip, album moves without duplicate media uploads, offline/concurrent edits, local edit during an in-flight request and deletion propagation.
- library: search, thumbnails, media dialog, downloads, export, Trash/restore and storage totals.
- snapshot-reopen, large-index-resume, snapshots: previous snapshot recovery and management remain working.
- resume-albums, bulk and export: durable snapshot upload recovery, album persistence, 2,100 mixed imports, 5,200-item virtual grid, quota/interruption handling and byte-preserving exports.

## Limits

Actual iPhone Safari/PWA hardware, your private R2 bucket and your live account were not available during these tests. The post-deployment iPhone check is still required; no promise is made that every possible future bug is eliminated.

This is not the direct-to-R2 transfer update. Media still passes through Vercel and uses bandwidth. Upload checkpoints apply to work completed by this update; it cannot reconstruct checkpoints never saved by an older sync. A request completed remotely but interrupted before acknowledgement can be retried with the same part identity. Snapshot and live-sync storage remain separate.

iOS can suspend the PWA. Work resumes when it is active and signed in; it does not run continuously while suspended. Download staging is not yet a persistent per-chunk download queue: downloads not locally committed may be fetched again after interruption. Large incoming libraries still require adequate device storage and memory.

The live collection retains its existing 10,000-record limit including deletion markers. Metadata is bounded at 64 MiB. Failed/conflicting metadata staging can remain in R2 for later cleanup; successful staging is removed best-effort. No original media or existing snapshots are deleted by this update.
