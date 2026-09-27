# Site Snag Report — presentation website

A read-only site for your builder(s) to browse the current snag list — grouped, filterable, with
photos and floor-plan locations. Separate from the snagging app itself; this is just for presenting
results.

## How it works

**Floor Plan Explorer (default view):** pick a floor, then a room, and the plan for that room shows
every snag pinned on it. Tap a pin, or drag a selection box across several, to build a working list
on the side — click any item in that list to see its full description and photos below. Every
room also has a full snag list (collapsed by default) and a "Print this room" button for a clean,
builder-friendly printout.

**Browse / Group List (second view):** the original grouped list — by Room, Trade, Severity, or
Floor — with a status filter and search, for scanning everything at once rather than room by room.

## Uploading photos to R2

Your existing bucket already has photos for every snag that was on the site before this update —
those don't need touching. This update adds 224 new snags, so you only need to add their photos.

The 5 "-B" tag pairs from the original 369-record build (the ones that once needed manual photo
renaming) now come pre-resolved from the app's own duplicate-tag checker, and line up exactly with
what's already on R2 — no renaming needed this time.

1. In the Cloudflare dashboard, open your `snag-photos` bucket (or whatever you named it), inside
   its `photos` folder.
2. Upload the photo files for the newly-added snags — see the accompanying `new_photos_manifest.txt`
   for the exact list of filenames expected (both `_thumb_` and `_full_` versions). Everything else
   keeps its original filename exactly as exported.
3. Easiest in practice: gather all your local photo files (from your batch exports) into one folder
   and re-run the same `rclone copy` command you used before, pointed at that folder and the same
   `r2:bucketname/photos` destination — rclone skips anything already uploaded and only pushes what's
   new, so you don't need to hunt down files individually.
4. The site is already pointed at `https://pub-52ef5d48cdfc41a29a32eb97a46c2221.r2.dev/` — no changes
   needed here as long as that's still your bucket's public URL.

## Deploying to GitHub Pages

Same process as the snagging app:

1. Create a new GitHub repository (or reuse a spare one — keep it separate from the snagging app's
   repo, since these are two different builds).
2. Upload every file here — `index.html`, `app.js`, `data.js`, `snags.js`, `robots.txt`, and the
   `plans/` folder — keeping the same structure.
3. Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)`. Save.
4. Wait a minute, refresh, and you'll get a URL like `https://yourname.github.io/reponame/`.

Send that link directly to your builder — there's a `robots.txt` included that asks search engines
not to index it, so it stays effectively private (reachable only by whoever has the link), the same
approach we discussed for the R2 bucket.

## Updating it later

This is a snapshot, not a live-syncing site. When you've logged more snags in the app:

1. On the Export tab, tap **"Export data JSON"** (small file, no photos — fast even with a large
   dataset).
2. Send that file to Claude — it'll rebuild `snags.js` (checking for any new tag collisions along
   the way) and hand you an updated site to re-upload, plus a list of exactly which photos are new.
3. Upload those new photos to the same R2 bucket, same folder.

## What's inside

- `index.html` / `app.js` — the site itself.
- `data.js` — room, trade, and floor-plan-pin reference data (shared convention with the snagging app).
- `snags.js` — your actual snag data (593 records), embedded directly — no live database, so it
  loads instantly and works entirely offline once cached.
- `plans/` — the same redacted floor plan images used in the app, for the pin-location view.
- `robots.txt` — asks search engines not to index the site.
