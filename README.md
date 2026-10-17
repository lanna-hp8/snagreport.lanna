# Site Snag Report — website

Login-protected presentation site for the snag list. Three accounts:

| Account | Who | Can do |
|---|---|---|
| admin | you | everything — view, comment, set trade/status/contractor, edit or delete original snag records, manage accounts and the contractor list |
| ccbs | your builder | view; add / edit / delete **their own** comments; set the contractor, designated trade and status on any snag. Cannot delete snags or change the original data or original notes |
| trade | contractors (shared) | read only |

## How the data works
- The ORIGINAL snags (from the Snagging App export) live in a read-only table behind the login.
- Everything ccbs adds or changes (comments, trade/status changes, contractor names) lives in separate
  "overlay" tables. The site loads the originals, then lays the overlay on top. Refreshing the originals
  from a new app export never touches the overlay.
- Photos are still public links on R2 (unchanged).

## Files
- `index.html`, `app.js`, `data.js` — the site
- `config.js` — **set `API_BASE_URL` to your Worker address** (see the deploy guide)
- `xlsx.full.min.js` — spreadsheet library for "Export to Excel"
- `plans/` — floor plan images

There is deliberately no `snags.js` — snag data is only served after login.
**Delete any old `snags.js` from your GitHub repository** or the data stays public.
