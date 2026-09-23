# Loft redesign — start here

This is an update for your existing Loft-App GitHub repository. It is ready for a **preview deployment and your phone check**. It has not been uploaded or deployed for you.

## Upload the update

1. Download and extract `loft-redesign.zip` using Windows **Extract All**.
2. Open the extracted `loft-redesign` folder. You should see `index.html`, `refined.css`, `cloud.js`, the new media/notes scripts, and the `api`, `lib`, and `tests` folders.
3. On GitHub, open **mmove3080-svg / Loft-App**, then **Add file → Upload files**.
4. Drag the **contents inside** `loft-redesign` into GitHub. Do not upload the outer folder or the ZIP.
5. Check that `index.html`, `photos-ui.js`, `media-store.js`, `media-export.js`, `notes-ui.js`, `refined.css`, `sha256.js`, `integrity.js`, `hash-worker.js`, and `sw.js` are at the repository root. Keep `api` and `lib` as folders.
6. Prefer **Create a new branch** for this upload so Vercel can build a preview. Check it before merging into `main` for production. If your normal workflow commits straight to `main`, that updates the live app immediately.
7. Leave your existing icons, photos, manifest, and other repository files in place. This ZIP does not replace those assets.

No new Vercel environment variable is required. Keep your working Supabase, R2, owner ID, and CRON_SECRET values. The daily `/api/cleanup` schedule remains in `vercel.json`.

## First look

Open the preview. Close and reopen its tab once if it initially shows the previous interface. **Do not clear browser/site data** to refresh it: that can delete originals which exist only on this device.

The Home screen follows your reference layout: Calculator/Settings above the clock/calendar, a wide photo widget, and the four-icon dock. The extra status time and simulated battery widget are hidden. The compact Cloud button remains your sync shortcut.

Settings now has a **Cloud Library** entry for account, sync, backups, Trash, and storage. Sign in there using your working cloud email/password. A preview URL has separate browser storage from the production URL; it will not automatically show your production device's local files.

## Photos

- **Select** is at the top-left; **+** is at the top-right, each with a comfortable touch target.
- Search filenames or filter Photos/Videos.
- Select all works on the current filtered results. The count is shown above the grid.
- Long-press/right-click a tile enters selection. **Done** exits it.
- Open an image; swipe horizontally, use Previous/Next, or use arrow keys. Pinch, double-tap, or tap Zoom. Drag to pan when zoomed.
- Videos use the browser's playback controls and Previous/Next buttons, keeping playback gestures separate from photo swipes.
- Download and Share use the original file. If the browser cannot preview a format such as some HEIC/MOV variants, download it to a compatible viewer.

### Large imports

The queue stores each unchanged original separately, reports saved/duplicate/failed counts, and creates thumbnails lazily for visible tiles. One failed file does not discard files already saved.

Use **Stop import** to stop after the current file. Use **Retry failed files** while the page is open, or reselect the batch after reopening. Files with the same name, size and modification time are compared byte-for-byte before skipping. A previous interrupted job is reported when you reopen Photos. Browsers cannot retain your permission to arbitrary selected files across reloads, so unfinished files must be reselected.

If device storage fills, importing stops with a message. Space and format support depend on the browser/device. Keep the page open during a large import; iOS can suspend or terminate background pages. Auto sync waits while importing or editing, then resumes on Home or Cloud Library.

### Export selected originals

Supported desktop browsers let you choose a folder and stream originals there. Each file goes into a numbered subfolder, keeping duplicate filenames distinct.

Other browsers download one uncompressed ZIP, limited to **512 MiB per batch**. This avoids attempting an unbounded in-memory archive on mobile. Select smaller batches for larger libraries, or use folder export on a supporting desktop browser. No export resizes or recompresses original media.

## Notes, Phone and Messages

Notes has search, pinning, archive, checklists, simple portable text formatting and a Preview button. It saves after typing pauses and before leaving the app; save failures are shown instead of pretending success. Never close the browser while it reports an unsaved note.

Phone has larger dial keys, contact search and a clear link to the device's actual dialer. It does not simulate a connected call.

Messages remains a private conversation notebook, not a messaging network. It preserves drafts, supports original-file attachments and timestamps, and loads older messages in batches. It does not send SMS or deliver messages to another person.

## Device checks before production

See `VALIDATION.md` for checks completed in this environment. A real browser could not be installed here; **visual rendering, iPhone Safari/PWA interactions and video codec playback still need device testing**.

1. On a phone, open Photos: tap Select and +, then import a small photo/video mix.
2. Scroll, select, open an image, pinch, swipe, and play a video. Rotate the phone.
3. Download one original and check its bytes/file size against the source.
4. Create a note, edit a checklist, switch Home, and reopen it. Test with the keyboard visible.
5. Create a conversation draft, leave and return, then attach/download a small file.
6. Open Cloud Library and confirm your usual sync, backups, Trash and restore.
7. Repeat the key steps in Safari and an iOS Home Screen/PWA installation. Check the top controls and Home button near safe areas.
8. Start with 100 representative files, then try a larger batch within your device's storage quota. The automated 2,100-file test used tiny fixtures; it does not establish performance for thousands of large videos on an iPhone.

If something looks wrong, send the screen and describe the action. Keep the previous deployment available in Vercel for rollback. The existing IndexedDB database name, version and stores are unchanged; this update does not erase or migrate your content.
