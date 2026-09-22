# Loft private cloud update

This update adds a Cloud Storage section to the existing app's Settings. It keeps the current design, local privacy lock, and IndexedDB records. No real passwords, tokens, or R2 credentials are included in these files.

## What this version does

- Email/password login using your existing Supabase account. There is no public registration screen.
- Every private API request is checked with Supabase and must match APP_OWNER_USER_ID.
- Save a snapshot of local photos/videos (including thumbnails), notes, contacts, and saved conversations to R2.
- List saved snapshots and import one on another device.
- Verify media hashes before import. All imported records are committed in one IndexedDB transaction.
- Skip identical existing records. Preserve differing records with the same ID by adding a separate cloud copy. No import deletes or replaces existing local records.
- Cache only the public application shell for offline use. API calls and private data never enter the service worker cache.

This is MANUAL cloud transfer, not automatic background synchronization. After editing, use Save snapshot. On another device, sign in and import that snapshot. Local deletions are not applied to other devices. Old snapshots continue to contain old versions until you remove them from R2. Each save uploads a complete snapshot and therefore consumes additional storage. Interrupted uploads may leave unlisted parts in R2; a retry creates a new snapshot.

The local passcode, appearance preferences, and phone call history are device-specific and are not included. Saved conversations are personal records, not messages delivered to other people. Cloud login tokens stay in memory; after closing or reloading the page, sign in again. The app's local privacy lock remains separate from cloud login.

## Before deployment

1. In Cloudflare R2, verify that the `webapp` bucket has Public Development URL (r2.dev) disabled and no public custom domain or public Worker route exposing its objects. The S3 API endpoint is the account endpoint, not a public bucket URL. No bucket CORS rule is needed for this version: uploads go through Vercel.
2. Verify Supabase Email is enabled, new signups and anonymous sign-ins are disabled, and your existing owner account exists.
3. Keep these Vercel Production variables (spelling must match):

| Name | Value / type |
|---|---|
| R2_ACCESS_KEY_ID | Cloudflare Access Key ID; Secret |
| R2_SECRET_ACCESS_KEY | Cloudflare Secret Access Key; Secret |
| R2_ENDPOINT | Matching jurisdiction-specific account S3 endpoint, without bucket path |
| R2_BUCKET_NAME | Exact existing bucket name, expected `webapp` |
| R2_REGION | `auto` |
| SUPABASE_URL | Your Supabase project URL |
| SUPABASE_PUBLISHABLE_KEY | Your complete `sb_publishable_...` key |
| APP_OWNER_USER_ID | UUID of your one allowed Supabase Auth user |

Config is suitable for non-secret values. Saving those as Secret also works. No Supabase service-role key, Supabase database password, or Cloudflare account API token is needed.

## Upload to the existing GitHub repository

1. Download and extract the ZIP. Open its `loft-cloud-update` folder.
2. Back up the current repository using GitHub's Code > Download ZIP. Keep the existing production domain: browser data is tied to that origin. Do not clear site data or uninstall the app.
3. On GitHub, open `mmove3080-svg/Loft-App`, branch `main`, at the top level.
4. Choose Add file > Upload files. Drag the CONTENTS of `loft-cloud-update` into the upload area, including the `api`, `lib`, and `tests` folders. Do not upload the ZIP or nest the entire folder under another directory.
5. This replaces `index.html`, `sw.js`, and `vercel.json` and adds `cloud.js`, `package.json`, `package-lock.json`, `api/cloud.js`, `lib/security.js`, tests, and this guide. Keep the existing `icons`, `photos`, `manifest.webmanifest`, and other repository files.
6. Review the files and commit. Because Vercel tracks `main`, that commit normally starts a production deployment. No credentials belong in GitHub.
7. For the existing static project, keep Framework Preset Other, no custom build command, and output directory `.` if Vercel asks for one. Dependencies must install from package-lock.json. Use a supported Node runtime (22 or 24). Do not change a working setting unnecessarily.
8. Wait until Vercel reports Ready. Reload the same app URL twice to allow the service worker update. This does not clear local records. Go through the existing article/local lock and open Settings > Cloud Storage.

## First live test

1. Keep all original local records. Add a disposable test note and small test image.
2. Sign in under Cloud Storage with your Supabase app user's email/password (not the database password).
3. Click Save snapshot and wait for the saved-record confirmation. Keep the page open during transfers.
4. On another device, open the same app URL, go to Settings, sign in, click Show saved snapshots, then import the saved snapshot.
5. Confirm the test note and image are available. Also check existing records remain on the original device.
6. Test a differing record on the second device: importing an older version should preserve the local version and create a cloud copy.
7. An unauthenticated visit to `/api/cloud?action=list` should return a sign-in error without listing anything.

Code checks passed locally, including authentication/owner rejection and an interface/IndexedDB test using simulated cloud responses. Live Supabase/R2 credentials were not used here; production connectivity must be verified after deployment.

## Limits and recovery

Uploads use 1 MiB parts through Vercel so individual requests fit the function payload limit. This is slower than direct multipart upload for large videos. Snapshot metadata is limited to 3 MB. Imports assemble the snapshot before writing; a very large library may exceed device memory or browser storage quota. If quota, network, or integrity checks fail, existing local records remain. Start with a small snapshot and keep originals until you verify the other device.

If a save fails, the snapshot is not listed unless the final manifest was stored. If the final response was lost, check the snapshot list before retrying. If an import says already imported, it intentionally avoids importing the same snapshot twice on the same device.

This version does not include an in-app password-reset flow. Keep the cloud password in your password manager; an administrator can manage the owner account through Supabase. Never put a secret key into frontend code to implement recovery.

## Verification for developers

Run `npm ci` and `npm test` for server access-control checks. For the simulated interface and IndexedDB test, install `jsdom` and `fake-indexeddb` in a development environment and run `node tests/dom-check.cjs`. Its cloud responses are simulated; it is not a real-browser or live-provider test. A real-browser check could not run here because the Chromium download timed out.
