// Take Our Stuff Please — reservation backend.
// Paste this into Extensions → Apps Script on your Google Sheet, then Deploy → Web app.
//
// The sheet gets a tab called "Reservations" with columns:
//   Timestamp | Item ID | Name | Qty | Ref
// To release a reservation, delete its row (or lower its Qty).
// "Ref" is a private code saved on the reserver's device so they can
// unclaim from the site. Names and Refs are never sent to the site.
//
// Quantities and the deadline are read from your live items.json, so they
// only ever need to be set in one place.

const ITEMS_URL = "https://nhantri132.github.io/take-our-stuff/items.json";
const SHEET_NAME = "Reservations";

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Timestamp", "Item ID", "Name", "Qty", "Ref"]);
    sheet.setFrozenRows(1);
  } else {
    // upgrade an older sheet
    if (!sheet.getRange("D1").getValue()) sheet.getRange("D1").setValue("Qty");
    if (!sheet.getRange("E1").getValue()) sheet.getRange("E1").setValue("Ref");
  }
  return sheet;
}

// { itemId: [{ name, qty }, ...] }
function readReservations_() {
  const rows = getSheet_().getDataRange().getValues().slice(1);
  const out = {};
  for (const [, itemId, name, qty] of rows) {
    const id = String(itemId || "").trim();
    const who = String(name || "").trim();
    if (!id || !who) continue;
    const n = Math.max(1, parseInt(qty, 10) || 1);
    (out[id] = out[id] || []).push({ name: who, qty: n });
  }
  return out;
}

// items.json, cached for a minute so every request doesn't refetch it.
function getConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("config");
  if (hit) return JSON.parse(hit);
  const res = UrlFetchApp.fetch(ITEMS_URL + "?t=" + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("items.json returned " + res.getResponseCode());
  const text = res.getContentText();
  JSON.parse(text); // validate before caching
  cache.put("config", text, 60);
  return JSON.parse(text);
}

// What the public site gets: how many of each item are reserved, no names.
function counts_(reservations) {
  const out = {};
  for (const id in reservations) {
    out[id] = reservations[id].reduce((n, r) => n + r.qty, 0);
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ counts: counts_(readReservations_()) });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch (_) { return json_({ ok: false, error: "Bad request." }); }

    if (body.action === "cancel") return cancel_(String(body.token || ""));

    const itemId = String(body.itemId || "").trim().slice(0, 80);
    const name = String(body.name || "").trim().slice(0, 60);
    const qty = parseInt(body.qty, 10) || 1;
    if (!itemId || !name) return json_({ ok: false, error: "Please enter your name." });

    let config;
    try { config = getConfig_(); }
    catch (err) { return json_({ ok: false, error: "Couldn't check the item list. Try again in a minute." }); }

    const current = readReservations_();

    if (new Date() >= new Date(config.deadline)) {
      return json_({ ok: false, error: "Sorry, reservations are closed.", counts: counts_(current) });
    }

    const item = (config.items || []).find((it) => it.id === itemId);
    if (!item) return json_({ ok: false, error: "That item isn't listed anymore.", counts: counts_(current) });

    const total = Math.max(1, parseInt(item.quantity, 10) || 1);
    const claimed = (current[itemId] || []).reduce((n, r) => n + r.qty, 0);
    const left = total - claimed;

    if (left <= 0) {
      return json_({ ok: false, error: "Sorry, that's all been claimed.", counts: counts_(current) });
    }
    if (qty < 1 || qty > left) {
      return json_({ ok: false, error: `Only ${left} left.`, counts: counts_(current) });
    }

    // Leading ' stops a name like "=HYPERLINK(...)" from running as a formula.
    const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
    const token = Utilities.getUuid();
    getSheet_().appendRow([new Date(), safe(itemId), safe(name), qty, token]);
    (current[itemId] = current[itemId] || []).push({ name, qty });
    return json_({ ok: true, counts: counts_(current), token: token });
  } finally {
    lock.releaseLock();
  }
}

// Unclaim: delete the row whose Ref matches. Only the reserver's device has it.
// (Called from doPost, which already holds the lock.)
function cancel_(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json_({ ok: false, error: "Bad request." });
  const sheet = getSheet_();
  const refs = sheet.getRange(1, 5, sheet.getLastRow(), 1).getValues();
  for (let i = refs.length - 1; i >= 1; i--) {
    if (String(refs[i][0]) === token) {
      sheet.deleteRow(i + 1);
      return json_({ ok: true, counts: counts_(readReservations_()) });
    }
  }
  return json_({ ok: false, notFound: true, error: "That reservation was already released.",
                 counts: counts_(readReservations_()) });
}
