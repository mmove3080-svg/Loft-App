# Automatic sync update

## Install

Upload the CONTENTS of this folder to the root of the existing Loft-App GitHub repository. Preserve the api, lib and tests folders. Keep all other existing files. No new credentials, environment variables or package dependencies are needed.

Commit message: Add automatic sync with conflict protection

Wait for Vercel to show Ready for that commit. Close all existing app tabs on each device, reopen the app, and reload if necessary so every open tab uses the new database write tracking. Do not clear browser site data.

## Enable on the first device

1. Sign in under Settings > Cloud Storage.
2. Keep a dated snapshot of important data using Save snapshot.
3. Click Enable automatic sync and read the confirmation.
4. Leave Settings open until the status says Up to date.

## Enable on the other device

Open the updated app, sign in, and enable automatic sync there too. Current records from both devices are merged. A missing local record on a device that has never synced is downloaded; it is not treated as a deletion. Existing records with different IDs remain separate, even if they look alike.

If the same item has different versions and there is no shared baseline, sync pauses for a choice. Notes have expandable full-text previews. Inspect other record types using Browse synced collection and the app's local screens before choosing Keep this device's version or Keep cloud version. Choosing a version replaces the other version for that item; dated snapshots are unchanged.

## Everyday behavior

- Automatic sync checks about every 15 seconds while the page is visible, signed in, and on Home or Settings.
- Return to Home or Settings after editing to let sync finish. Sync pauses while another app screen is open to avoid replacing data being edited.
- Changes made offline stay locally. Reconnect and return to Home or Settings to sync.
- Closing the app or signing out stops sync. Sign in again after reopening; tokens are not persistently stored.
- Sync now triggers a check. Pause automatic sync pauses this device. The enabled setting is saved locally.
- Web Locks support is required for safe coordination between tabs. Unsupported browsers retain manual snapshot features.

## Deletions and backups

There are now TWO cloud collections:

1. Current synced collection: Browse synced collection shows its active items. Deleting an item here, or deleting an already-synced local item, propagates to enabled devices on their next sync. A conflicting offline edit pauses for a choice instead of being silently lost.
2. Dated snapshots: Show saved snapshots opens existing backups. Import, browse, and delete work as before. Removing an item from a dated backup affects only that backup.

An item can still exist in older snapshots after it is deleted from sync. Delete those backup copies separately if you want them removed. Importing a backup can restore an item locally; sync may then ask whether to restore it to the shared collection.

Removed or replaced sync media is queued for cleanup. Sync processes a batch after successful cycles. Clean removed sync media finishes the queue while the page stays open. Interrupted cleanup can be retried. Deletion markers retain only the item ID and category to prevent offline devices silently bringing deleted items back. There is no Trash/Undo; dated backups are the recovery option.

## First live test

On device A, create a note called Auto sync test. Return to Home or Settings and wait for Up to date. On enabled device B, leave Home or Settings open until Up to date, then open Notes. The note should appear without Save snapshot or Import. Edit it on B and repeat in the other direction. Next test a small photo. Test deletion only with disposable items.

## Limits

This release is for a personal collection: 10,000 sync entries (including deletion markers) and 3 MB of metadata. Media uses separate 1 MB upload chunks; only changed records upload again. Large media still needs memory and time to transfer. Incomplete uploads that never reached the shared collection can leave orphan files; automated reclamation of those incomplete uploads is not included. Background sync with the app closed, cross-device local passcode/settings sync, and automatic snapshot retention are not included.

## Validation

23 automated tests pass. Simulated browser/IndexedDB tests also passed for two-device media transfer, avoiding repeat uploads of unchanged media, offline edits, conflict resolution, edit-screen pauses, propagated deletions, the pause toggle, and preservation of an edit made during an in-flight sync. Existing backup browse/import/delete simulation passed. Inline app scripts passed syntax checks.

These are local simulations. Live Vercel/R2 and real-device sync must be checked after deployment. No private account credentials or production data were used in testing.
