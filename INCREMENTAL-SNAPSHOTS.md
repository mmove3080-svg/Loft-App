# Incremental snapshots: reuse saved media

This update includes the previous snapshot-index and iPhone sync-controls fixes. It changes Save Snapshot to reuse matching saved media while preserving a complete backup of the current local library.

## What you should see

A snapshot may still check all 5,000+ records. That is the complete backup's record count, not the number of photos being uploaded. Separate Uploaded and Reused byte counters show the difference. The phone reads and hashes originals to verify that their contents match; filenames alone are never used to decide reuse.

When existing media is present and passes verification, adding 90 new photos uploads only their new media bytes (plus snapshot metadata). Changed media or missing/unverifiable older cloud parts must be uploaded. A repeated snapshot with unchanged files reuses their media.

## Existing unfinished snapshot

Use the same iPhone Home Screen app, origin and website data. Do not uninstall, clear data, delete backups or start a replacement snapshot. The pending snapshot keeps its original ID and completed records. Older completed-record checkpoints are migrated atomically to individual metadata rows; a failed migration preserves the old checkpoint. Only unfinished parts switch to shared storage. Bytes already duplicated before the update are not retroactively removed.

After deployment, the pending snapshot can resume automatically after sign-in, or use Resume snapshot. If the app was closed before the newly imported photos were included in the pending job, finish that job first and then create another incremental snapshot for the current library.

## Storage and deletion behavior — important

New snapshot media uses owner-private, checksum-addressed shared objects. Legacy media is copied into that shared area within R2 the first time it is reused; the phone does not upload those bytes again. The original legacy copies are preserved. This can initially increase R2 storage; it avoids repeatedly sending the same media through the phone and Vercel, and subsequent snapshots reuse the shared copy.

Backup deletion and cleanup only remove the selected snapshot's metadata and private parts. They cannot delete shared objects used by other snapshots. This release deliberately retains shared objects even after all referencing backups are deleted. It does not provide shared-object garbage collection; deleting a backup may not reclaim all of its media storage or physically erase every shared byte. Do not manually delete shared-media objects from R2 while backups may reference them. The UI notes this retention behavior.

Live sync, live-sync Trash and snapshot backups remain separate. This is not the direct-to-R2 upload/download project: genuinely new media still uses the existing Vercel route. No unrelated gallery or album UI was redesigned.

## Deployment

1. Extract Loft-App-incremental-snapshots.zip on your PC.
2. Create a GitHub branch from main named incremental-snapshots.
3. Upload the contents of the extracted Loft-App-main folder to the repository root, preserving subfolders. Do not upload the ZIP or nest the outer folder.
4. Commit with: Add incremental snapshot saving.
5. Create a pull request into main and check the changed files and successful preview deployment before merging. This package builds on the previous delivered iphone-sync-fix release; preserve any unrelated changes made outside this conversation.
6. Wait for Vercel Production to be Ready. No new environment variables or R2 CORS configuration are required; the existing R2 object read/write credentials perform internal copies.
7. Open Loft online, then close and reopen the existing Home Screen app to activate public cache v15. Another reopen may be needed. Update/reopen the PC page too before reading new shared-media snapshots.

## iPhone acceptance check

- Confirm the old completed snapshot is still listed and readable.
- Resume the pending snapshot. Expect the complete library record count; distinguish Uploaded from Reused bytes.
- Keep the PWA active while it finishes. iOS may suspend it in the background; saved progress resumes when it becomes active again.
- Wait for Saved N records, then browse an old photo and one of the newly imported photos in that snapshot.
- Verify the iPhone sync controls still respond. Do not delete a backup solely as a test on your real library.

## Tests completed before packaging

40 automated unit/server tests passed, including authentication, owner isolation, malformed hashes, immutable media writes, checksum integrity, verified legacy copies, backup deletion safety, large snapshot/sync indexes, stale revisions and Trash retention.

Additional simulations passed:

- checks/incremental.cjs: 5,127 existing unique photo payloads plus 90 new ones; exactly 90 media uploads; all 5,217 originals readable after removal of legacy private copies; unchanged media does not upload; changed bytes and a lost response upload once; old-format partially completed job resumes; simulated quota failure during checkpoint migration preserves old progress.
- checks/incremental-ui.cjs: actual cloud UI code discovers legacy metadata, promotes an original inside cloud storage, uploads only new media, shows reuse metrics and reuses media on a subsequent save.
- checks/snapshot-reopen.cjs: fresh page context restores the job/session after a lost response; shared chunks are not resent.
- checks/large-index-resume.cjs: old 5,127/5,127 finalization checkpoint recovers without media reads/uploads.
- checks/snapshots.cjs and checks/resume-albums.cjs: browse/import/deletion and album persistence, preserving originals.
- checks/sync-controls.cjs, checks/sync.cjs and checks/library.cjs: working Pause/Sign out/browse during sync, upload checkpoints, two-device conflicts, albums, downloads and Trash.

The first full-size test exposed excessive memory consumption from rewriting a growing completed-record array. The checkpoint storage was changed to individual records, then the full-size test and older-checkpoint recovery tests passed. This was fixed before packaging.

Tests used synthetic media and simulated R2/IndexedDB. Actual iPhone hardware, your private R2 bucket and the live Vercel deployment were not accessed. Your post-deployment iPhone check remains necessary. This does not promise that all possible future bugs are eliminated.
