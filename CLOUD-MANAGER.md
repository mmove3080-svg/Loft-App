# Cloud browsing and backup deletion

This update adds browsing and deletion to the existing manual cloud backup app. Automatic sync is not included.

## Install

Extract loft-cloud-manager.zip. Upload its CONTENTS to the existing Loft-App repository root, keeping the api, lib and tests folders. Replace cloud.js, sw.js and api/cloud.js; add lib/snapshots.js and the included documentation/tests. Keep all existing files, including lib/security.js, package.json, reset.html, icons and photos. No environment-variable or dependency changes are required.

Commit with: Add cloud browsing and backup deletion
Wait for Vercel's deployment to become Ready. Reload the app; if the old controls remain, close and reopen it, then reload. Do not clear site data: it contains local records.

## Use

Settings > Cloud Storage > sign in > Show saved snapshots.
Each backup offers Browse contents, Import snapshot and Delete entire backup.
Browse contents displays 25 items at a time, with category filters and Show more items. Notes, contacts and conversation text are readable directly. View photo / play video downloads that one media file for a temporary preview without writing it to the app's local database. Large videos can take time and memory to load.

Delete item from this backup removes only the selected record and its unused media from this backup. Other backups and local device copies remain. Saving a local copy again can upload it again. To remove all cloud copies, remove it from every backup containing it (or delete those backups). This release does not offer a delete-across-all-backups button or deletion across devices.

Delete entire backup permanently deletes the selected backup and its media. A confirmation appears first. Local copies and other backups remain. Deletion happens in batches; keep the page open. If interrupted, open the backup again and resume deletion. A backup marked for deletion cannot be imported. Clean unused media retries cleanup if item deletion succeeded but removing its media was interrupted. Cloud deletion is permanent; there is no trash or undo.

The backup list date is the last saved/changed date. Opening a backup also shows its original creation date. Existing import markers are preserved; a backup already imported on a device cannot be reimported there just because cloud items were removed.

## First live check

Use a disposable test backup. Browse a note/photo without importing. Delete a test item, reopen that backup, and confirm it is absent while its local copy remains. Delete the disposable backup and confirm it leaves the list. Keep important backups during testing.

## Validation and scope

13 Node tests pass, including authentication, private caching exclusions, selection/version validation, item deletion, retained media, cleanup errors and resumable whole-backup deletion. Simulated DOM/IndexedDB tests cover login/save/import, previews, cancellation, deletion and preservation of local records. Live Vercel/R2 deletion and visual browser checks still need validation after deployment.

Conditional updates use R2's documented PutObject If-Match support: https://developers.cloudflare.com/r2/api/s3/api/

No credentials are included in this update. Existing owner authentication applies to all browsing/deletion routes. Private data stays excluded from service-worker caching. The update does not clean incomplete uploads that never became committed backups.
