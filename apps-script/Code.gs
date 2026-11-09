// Take Our Stuff Please — reservation backend.
// Paste this into Extensions → Apps Script on your Google Sheet, then Deploy → Web app.
//
// The sheet gets a tab called "Reservations" with columns:
//   Timestamp | Item ID | Name | Qty
// To release a reservation, delete its row (or lower its Qty).
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
    sheet.appendRow(["Timestamp", "Item ID", "Name", "Qty"]);
    sheet.setFrozenRows(1);
  } else if (!sheet.getRange("D1").getValue()) {
    sheet.getRange("D1").setValue("Qty"); // upgrade an older sheet
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ reservations: readReservations_() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch (_) { return json_({ ok: false, error: "Bad request." }); }

    const itemId = String(body.itemId || "").trim().slice(0, 80);
    const name = String(body.name || "").trim().slice(0, 60);
    const qty = parseInt(body.qty, 10) || 1;
    if (!itemId || !name) return json_({ ok: false, error: "Please enter your name." });

    let config;
    try { config = getConfig_(); }
    catch (err) { return json_({ ok: false, error: "Couldn't check the item list. Try again in a minute." }); }

    const current = readReservations_();

    if (new Date() >= new Date(config.deadline)) {
      return json_({ ok: false, error: "Sorry, reservations are closed.", reservations: current });
    }

    const item = (config.items || []).find((it) => it.id === itemId);
    if (!item) return json_({ ok: false, error: "That item isn't listed anymore.", reservations: current });

    const total = Math.max(1, parseInt(item.quantity, 10) || 1);
    const claimed = (current[itemId] || []).reduce((n, r) => n + r.qty, 0);
    const left = total - claimed;

    if (left <= 0) {
      return json_({ ok: false, error: "Sorry, that's all been claimed.", reservations: current });
    }
    if (qty < 1 || qty > left) {
      return json_({ ok: false, error: `Only ${left} left.`, reservations: current });
    }

    // Leading ' stops a name like "=HYPERLINK(...)" from running as a formula.
    const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
    getSheet_().appendRow([new Date(), safe(itemId), safe(name), qty]);
    (current[itemId] = current[itemId] || []).push({ name, qty });
    return json_({ ok: true, reservations: current });
  } finally {
    lock.releaseLock();
  }
}
