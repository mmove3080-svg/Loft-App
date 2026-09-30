# Fix for a snapshot paused at 5127/5127

This update fixes "Snapshot metadata exceeds the 3 MB limit." It is based on the Loft media-improvements release merged in PR #2.

## Deploy

1. Extract this ZIP on your computer.
2. In mmove3080-svg/Loft-App, create a branch from main named snapshot-index-fix.
3. Upload the CONTENTS of Loft-App-main to the repository root, preserving api/, lib/, and the other directories. Do not nest the Loft-App-main folder itself inside the repository.
4. Commit, create a pull request into main, and merge after deployment checks pass.
5. Wait for the new Vercel Production deployment to become Ready. No environment variable, R2 CORS, Supabase, or database changes are required.

## Recover the pending snapshot on iPhone

1. Keep the same Home Screen PWA, domain, and website data. Do not uninstall, clear storage, reimport your library, or start a new snapshot.
2. Open Loft with internet access and let it fetch the application update. Close the PWA and reopen it after the update downloads; another reopen may be needed because an already-open page still runs the old code.
3. Sign in if asked. The unfinished job can resume automatically. If needed, tap Resume snapshot once.
4. At 5127/5127, the updated status says "Finalizing snapshot index". It transfers only index metadata and commits the existing snapshot. This can take some time; keep the PWA open.
5. Wait for "Saved 5127 records", then Show saved snapshots and Browse contents. Do not press Import snapshot on the originating device just to verify it: import is a separate operation.
6. If the old 3 MB message persists, close/reopen once more and confirm the new production deployment is ready. If any different error appears, capture its text without deleting anything.

## What changes

Large metadata is transferred in 1 MiB chunks (under 1.5 MB per JSON request), verified with SHA-256, then written to the existing private snapshot location. Readers fetch the index in revision-checked chunks too. Snapshots retain the v1 JSON format, so existing media references, album metadata, deletion and import features remain compatible. New index endpoints require the same owner authentication as the existing private API.

The IndexedDB version, snapshot-job-v2 checkpoint, snapshot ID and original media parts are unchanged. A job already at total skips media processing and only retries finalization. A failed commit keeps the checkpoint. If a final response is lost, an identical retry succeeds without replacing the original commit. Metadata chunks may be retransmitted on retry; original media is not retransmitted. Temporary metadata lives inside the snapshot parts folder and is removed by existing backup cleanup/deletion.

Indexes up to 64 MiB are supported. A larger index stops with an explicit error and preserves progress. This bounds server/browser memory use. This fix does not implement direct device-to-R2 media transfers; that cost-reduction update is separate.

## Validation

- 36 automated server/security/transfer tests, including a 5127-record index larger than Vercel's single-response limit, paged reads, checksums, revisions, retry safety and legacy snapshots.
- Recovery from an old 5127/5127 paused checkpoint without media reads, processing or uploads, including a lost finalization response.
- Existing browser-simulation snapshot save, browse, import, integrity checks and deletion flow.

Live access to your iPhone checkpoint and private R2 bucket was not available during testing. Recovery depends on their existing contents remaining intact.
