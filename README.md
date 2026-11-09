# Take Our Stuff Please

A tiny site where friends and family can claim stuff before it goes to Goodwill.
Static files on GitHub Pages; reservations live in a Google Sheet.

```
index.html, style.css, app.js   the site (no build step)
items.json                      the item list, deadline, pickup note  ← you edit this
images/                         item photos
apps-script/Code.gs             the Google Sheet backend
```

## One-time setup (~15 minutes)

### 1. Google Sheet backend
1. Create a new Google Sheet (name it anything, e.g. "Donate reservations").
2. **Extensions → Apps Script**. Delete the starter code, paste in `apps-script/Code.gs`, save.
3. **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (this lets the site talk to it; it does *not* share your Sheet)
4. Click Deploy, approve the permissions prompt (Google warns because it's your own unverified script — "Advanced → Go to project").
5. Copy the **Web app URL** (ends in `/exec`).
6. Paste it into `SCRIPT_URL` at the top of `app.js`.

> If you later edit `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, or the URL keeps running the old code.

### 2. GitHub Pages
1. Repo: https://github.com/nhantri132/take-our-stuff
2. Repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. After a minute the site is at https://nhantri132.github.io/take-our-stuff/ — Text that link to people.

## Day-to-day

**Add an item:** drop a photo in `images/`, add an entry to `items.json`:
```json
{ "id": "blue-armchair", "name": "Blue armchair", "description": "Comfy, a little faded.", "image": "images/blue-armchair.jpg" }
```
`id` must be unique and should never change once people can reserve it (reservations are keyed to it).
Watch the commas — a missing or extra comma breaks the whole list. Paste into jsonlint.com if the page says it couldn't load.

**Remove an item:** delete its entry. (You can leave the photo.)

**See who reserved what:** open the Google Sheet.

**Release a reservation** (someone changed their mind): delete that row in the Sheet.

**Change the deadline:** update `deadline` in `items.json` **and** `DEADLINE` in `Code.gs` (then redeploy a new version). Format: `2026-12-06T18:00:00-06:00` (the `-06:00` is Central Standard Time).

## Shrinking photos
Phone photos are 3–5 MB; aim for ~200 KB each so the page loads fast on cellular.
- Easiest: squoosh.app — drop the photo in, resize to 1200px wide, export JPEG ~75% quality.
- Bulk on Mac: select photos in Finder → right-click → Quick Actions → Convert Image → Medium.
- Bulk on Windows: PowerToys Image Resizer.

Landscape photos crop best (cards are 4:3); the tap-to-open view shows the whole photo.

## Preview locally
Leave `SCRIPT_URL` empty for demo mode, then from this folder run `python3 -m http.server` and open http://localhost:8000.
(Opening `index.html` directly by double-clicking won't load `items.json`.)

## Known limits (fine for family use)
- **Unlisted, not private.** The repo is public and anyone with the link can view and reserve. Search engines are told not to index it.
- **Honor system.** Anyone can type any name. Releases are manual (delete the Sheet row).
- **Updates every minute.** If two people tap Reserve at the same moment, the Sheet takes the first one and tells the second it's taken.
