# Site Snag Report — presentation website

A read-only site for your builder(s) to browse the current snag list — grouped, filterable, with
photos and floor-plan locations. Separate from the snagging app itself; this is just for presenting
results.

## ⚠️ Before you upload photos to R2 — 5 files need renaming

Your export had 5 pairs of snags that ended up sharing the same tag (two different, real snags
each — not duplicates). The site has been built expecting the **second** snag in each pair to use a
"-B" suffix, so when you upload to R2, rename that one's photo files to match:

| Tag on the site | Photos to rename before uploading |
|---|---|
| `1F-FLD-04-B` | the "Cracks in paint on ceiling" photos → `1F-FLD-04-B_full_1.jpg`, `_2.jpg` |
| `1F-FLD-05-B` | the "Cracks in paint" photos → `1F-FLD-05-B_full_1.jpg` through `_5.jpg` |
| `2F-BA2-14-B` | the "Top not painter" photo → `2F-BA2-14-B_full_1.jpg` |
| `1F-FHL-03-B` | the "Marks on bottom astragal beading..." photos → `1F-FHL-03-B_full_1.jpg` through `_9.jpg` |
| `2F-BD6-29-B` | the "Paint drips" photos → `2F-BD6-29-B_full_1.jpg`, `_2.jpg` |

Do the same for each one's `_thumb_` files if you're uploading those too. Everything else keeps its
original filename exactly as exported.

## Uploading photos to R2

1. In the Cloudflare dashboard, open your `snag-photos` bucket (or whatever you named it).
2. Create a folder called `photos` inside it (matching the site's expected path).
3. Drag in your photo files — after applying the 5 renames above, upload everything as-is, keeping
   the original filenames the app exported (`{tag}_full_1.jpg`, `{tag}_thumb_1.jpg`, etc.).
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

1. Export a fresh `data.json` from the app (Restore/Export tab).
2. Send it to Claude — it'll rebuild `snags.js` (checking for any new tag collisions along the way)
   and hand you an updated site to re-upload.
3. Upload any new photos to the same R2 bucket, same folder.

## What's inside

- `index.html` / `app.js` — the site itself.
- `data.js` — room, trade, and floor-plan-pin reference data (shared convention with the snagging app).
- `snags.js` — your actual snag data (369 records), embedded directly — no live database, so it
  loads instantly and works entirely offline once cached.
- `plans/` — the same redacted floor plan images used in the app, for the pin-location view.
- `robots.txt` — asks search engines not to index the site.
