# Recently Deleted — v17

## Use

Open Photos, then choose Recently Deleted from the Album menu.

- Delete moves photos/videos here for 30 days, including items that have never synced.
- The original album ID, metadata and original bytes remain attached to the item.
- Each tile shows the days remaining. The deadline is measured from deletion, not the next sync.
- Select items and choose Restore or Delete permanently.
- Restore All and Delete All Permanently affect all media in Recently Deleted, even if a search/filter is active. The confirmation states the item count.
- Restore returns media to its original album. If the album is gone, it returns to Unfiled.
- Permanent deletion requires confirmation and cannot be undone through Recently Deleted.
- Normal albums, the home photo widget and the normal viewer exclude deleted items.

## Sync and retention

Enable sync on both devices and open the current version on both. Deletions, restores and permanent deletion propagate on successful sync. Offline changes remain local until connectivity and sync are available. Concurrent restore versus permanent deletion pauses for a conflict choice, preserving the local version until resolved.

Existing synced originals are reused when deletion/restoration changes only metadata; no duplicate original is uploaded. Media that has never synced still needs its first upload if it is to be recoverable on another device.

The server stores and validates the deletion time and 30-day deadline. The existing daily /api/cleanup cron expires cloud records and removes unreferenced sync parts in bounded batches. Recovery stops at the deadline; physical removal happens during the scheduled cleanup and may take further runs for a large backlog. Do not remove CRON_SECRET or the cron configuration.

An iPhone PWA cannot execute while iOS has suspended or terminated it. Local expired items are removed when Loft next opens, sync begins, or the Photos screen's periodic cleanup runs. Cloud cleanup can run while the device is off for records already synced.

Older dated snapshots are separate backups. Deleting from Recently Deleted does not erase copies inside those snapshots, shared snapshot media, or exports. Legacy items already in Cloud Library > Trash remain available there under their original recovery deadlines; this update does not automatically import those historical Trash items into the device gallery.

## Deploy

1. Create a branch from main named recently-deleted-album.
2. Extract Loft-App-recently-deleted.zip. Upload the files and folders INSIDE Loft-App-main to the branch's root, not the outer folder or ZIP.
3. Commit message: Add Recently Deleted album with 30-day recovery
4. Create a pull request into main and wait for checks. Merge once they pass.
5. Wait for Vercel's Production deployment to be Ready.
6. Reopen the existing Loft PWA online on your iPhone and refresh the PC app. The Album menu should offer Recently Deleted. If the old app code is still loaded, close and reopen after the update finishes installing. Do not clear website data or uninstall Loft.
7. Test with one disposable photo: delete, check the countdown, restore to its original album. Then delete it again and test permanent deletion. Test the second device after sync.

This release includes the prior snapshot controls v16 fixes. The public cache advances to v17; local databases are preserved. No new credentials or environment variables are required.

## Validation

- 44 Node unit tests passed, including server retention deadline, clock validation, conditional restore, source protection, permanent deletion, and existing auth/backup/sync tests.
- checks/recently-deleted.cjs: real local storage and cloud sync code exercised across two simulated devices. Covered offline/never-synced media, original album restoration, missing album fallback, repeated delete without clock reset, byte preservation, no duplicate original uploads, expiry, permanent deletion before and after sync, reopen persistence, and restore-versus-delete conflict.
- checks/recently-deleted-ui.cjs: actual Photos UI code tested in a DOM environment. Covered delete/cancel, album selection, countdown, selected restore, Restore All, permanent deletion/cancel, Delete All and remount persistence.
- checks/bulk.cjs: 2,100 mixed imports, duplicate checks, quota recovery, 5,200-item virtual grid and selection, bulk deletion, and a 64 MiB synthetic original.
- Existing app, library, sync, sync-controls, snapshot-controls, snapshot-reopen, incremental-ui and resume-albums checks passed.
- Browser hardware testing was not performed. The available Playwright installation has no browser binary, so the mobile browser test could not start. UI checks used a simulated DOM; real iPhone layout/touch and the private production cron still need deployment verification.
