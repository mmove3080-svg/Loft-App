# Loft: complete Cloud Library update

This package upgrades your existing Loft-App repository. It preserves the current
local database and existing R2 snapshots. Upload the CONTENTS of this folder into
the repository root. Keep your existing icons, photos and manifest.webmanifest.
Do not replace the repository with an empty folder, clear site data, or delete
existing app files.

## What is included

- A Home cloud-status button that opens a dedicated Cloud Library.
- Collection, Trash, Backups and Storage navigation.
- Search across cloud filenames, note text, contact details and conversation text;
  category filters, name/date sorting and paginated cards.
- Thumbnail cards where stored thumbnails are available, large image/video
  previews, keyboard-accessible controls and light/dark theme support.
- Original photo/video downloads; text and JSON record exports. The bulk matching
  export contains text records and media metadata, NOT the original media bytes.
  Download original media from individual cards.
- Storage totals for your app's R2 prefix, separated into sync/Trash, backups and
  other files; browser storage estimates where supported. These are not billing
  totals or a Cloudflare account-wide quota.
- Server-controlled 30-day Trash for deleted synced records, restoration, explicit
  permanent deletion, and daily scheduled expiry with resumable media cleanup.
- Existing snapshot save/import/browse/delete, local privacy lock, password reset,
  automatic sync and conflict resolution remain available.

## 1. Keep a backup

On the device containing your latest data, sign in and choose Save snapshot.
Wait for the success message. The update does not clear IndexedDB.

## 2. Add the new Vercel secret BEFORE committing the update

Open Vercel > loft-app > Settings > Environments > Production.
Under Environment Variables, choose Add Environment Variable.

- Type: Secret
- Key: CRON_SECRET
- Value: a newly generated random secret of at least 32 characters
- Environment: Production
- Note: optional; you can enter "Daily Trash cleanup"

Use your password manager's generator for a 48-character random value, or generate
one on your own Windows computer with PowerShell:

```powershell
$cleanupBytes = New-Object byte[] 32
$cleanupRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$cleanupRng.GetBytes($cleanupBytes)
$cleanupRng.Dispose()
[Convert]::ToBase64String($cleanupBytes) | Set-Clipboard
```

That copies the secret to your clipboard. Paste it directly into Vercel's Value
field and click Save. Do not paste it into GitHub, JavaScript, chat or screenshots.
Keep all existing R2 and Supabase environment variables. Your existing
APP_OWNER_USER_ID determines the only account the cleanup can access.

## 3. Upload and deploy

1. Extract this ZIP on Windows.
2. Open your GitHub Loft-App repository, on main, at the root.
3. Choose Add file > Upload files.
4. Upload everything INSIDE the extracted loft-improvements folder, including
   api, lib and tests. Do not upload the enclosing folder or the ZIP itself.
5. Commit with a message such as "Add Cloud Library and 30-day Trash".
6. Wait for the new Vercel production deployment to show Ready.
7. Reload the app. Close and reopen old app tabs on ALL devices to load the new
   cached public files. Do not clear browser storage. Sign in again if asked.

The schedule is already included in vercel.json. You do not need to create a
second cron job manually. It calls /api/cleanup daily, scheduled for 03:00 UTC.
Vercel Hobby may invoke it during the following hour. The app need not be open.

## 4. Check the deployment and scheduled cleanup

In Vercel Project Settings, open Cron Jobs. Confirm /api/cleanup appears with
schedule `0 3 * * *`. You can use its Run control to test it, then inspect Logs.
A successful request returns 200 and logs an expired count, batches and done.
Running cleanup early does not shorten anyone's 30-day recovery period.

- 401: CRON_SECRET is missing, too short or did not reach the deployment. Check
  the Production variable and redeploy. Do not reveal its value.
- 409: concurrent cloud activity won a conditional write; the next run can retry.
- 503: cleanup did not finish; inspect the function logs/R2 configuration.
- done=false: more media remains. Further sync cleanup or the next daily run
  continues. A large backlog or outage can delay physical file removal.

Opening /api/cleanup in your browser without the secret should return 401.
That is expected and is not a reason to expose the secret in a URL.
Vercel does not automatically retry a failed cron invocation immediately; this
implementation retries remaining work during future scheduled runs.

## 5. Test with one disposable note

1. Open Cloud Library using the new Home status button and sign in.
2. Enable sync if needed. Create a note named "Trash test", return to Home or
   Cloud Library and wait for Up to date.
3. In Collection, search for "Trash test", then select Move to Trash.
4. Open Trash. Confirm the recovery deadline appears.
5. Choose Restore item. Confirm the note returns to Collection and, after sync,
   to the Notes app on your devices.
6. Try a photo preview and Download original. Check Storage and an existing backup.
7. Only if you want to test permanent deletion, use the disposable note. Choose
   Delete permanently from Trash and confirm. This cannot be undone from Trash.

## Retention and data boundaries

The 30 days start when the server accepts the deletion of a synced item, using
server time. An offline deletion reaches Trash when that device next syncs.
A local item that has NEVER been uploaded cannot be recovered from cloud Trash.
Old deletions made before this update cannot be reconstructed automatically.

Restoring a Trash item returns it to the current synced collection. Enabled
online devices receive it on a later sync; concurrent offline edits may still
need your conflict choice. Expired entries cannot be restored, even if their
physical files are waiting for the next cleanup run.

The server retains minimal deletion markers (store and ID, without content) so
stale devices cannot silently resurrect old records. File removal is conditional
on media no longer being referenced by active or recoverable records. Cleanup
can run repeatedly or stop partway and resume.

Backups remain separate. Deleting from Trash does NOT scrub copies from older
snapshots or exported files. Backup item/whole-backup deletion is still explicitly
PERMANENT. Items can also exist on devices that have paused sync or are offline.
No claim is made that all independent copies are erased.

Automatic device sync still runs while the page is open, signed in and on Home,
Cloud Library or Settings. The SERVER cleanup alone runs with the app closed.
Sign-in sessions stay in memory; reopening the app may require signing in again.

## Validation and limits

28 automated server/security/cache/sync tests passed, plus simulated browser and
IndexedDB checks of two-device sync, offline/conflicting edits, concurrent local
changes, snapshot integrity/import, media browsing, search, downloads, exports,
Trash/restore and storage totals. Tests used mock cloud storage, not your private
production data. A real-browser visual review and your live deployment test are
still needed.

Existing limits remain: 10,000 sync entries including deletion markers; 3 MB sync
metadata including Trash; media uses 1 MiB parts. Large videos/downloads require
browser memory. Thumbnail cards use existing thumbnails, and show a placeholder
when none is stored. This release does not introduce background mobile sync,
end-to-end encryption or a generic JSON-export importer.

For developers: run npm ci, then npm test. The test dependencies are unchanged.
