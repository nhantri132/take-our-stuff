// Take Our Stuff Please — reservation backend.
// Paste this into Extensions → Apps Script on your Google Sheet, then Deploy → Web app.
//
// The sheet gets a tab called "Reservations" with columns:
//   Timestamp | Item ID | Name
// First reservation for an item wins. To release an item, delete its row.

const SHEET_NAME = "Reservations";
// Keep in sync with "deadline" in items.json. Reservations after this are refused.
const DEADLINE = new Date("2026-12-06T18:00:00-06:00");

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Timestamp", "Item ID", "Name"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readReservations_() {
  const rows = getSheet_().getDataRange().getValues().slice(1);
  const out = {};
  for (const [, itemId, name] of rows) {
    const id = String(itemId || "").trim();
    if (id && name && !out[id]) out[id] = String(name);
  }
  return out;
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
    if (!itemId || !name) return json_({ ok: false, error: "Please enter your name." });

    if (new Date() >= DEADLINE) {
      return json_({ ok: false, error: "Sorry, reservations are closed.", reservations: readReservations_() });
    }

    const current = readReservations_();
    if (current[itemId]) {
      return json_({ ok: false, error: `Already reserved by ${current[itemId]}.`, reservations: current });
    }

    // Leading ' stops a name like "=HYPERLINK(...)" from running as a formula.
    const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);
    getSheet_().appendRow([new Date(), safe(itemId), safe(name)]);
    current[itemId] = name;
    return json_({ ok: true, reservations: current });
  } finally {
    lock.releaseLock();
  }
}
