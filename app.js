// ───────────────────────────────────────────────────────────────
// SETUP: paste your Google Apps Script web app URL between the quotes.
// Leave it empty to preview the site in "demo mode" (reservations
// work on your screen only and vanish on refresh).
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxknIY4vPKZRD3MoM1yNbGcwZJAWJUHctNO80tCVYUVZaYcX6Bvlrx4dz9pso2TFcvHZw/exec";
// ───────────────────────────────────────────────────────────────

const PLACEHOLDER = "images/placeholder.svg";
const REFRESH_MS = 60 * 1000;

let items = [];
let reservations = {};   // { itemId: [{ name, qty }, ...] }
let deadline = null;
let filter = "all";
let openItem = null;

const $ = (id) => document.getElementById(id);

// ── Quantity helpers ───────────────────────────────────────────
const totalOf = (it) => Math.max(1, parseInt(it.quantity, 10) || 1);
const claimedOf = (it) => (reservations[it.id] || []).reduce((n, r) => n + (r.qty || 1), 0);
const leftOf = (it) => Math.max(0, totalOf(it) - claimedOf(it));

// Merge repeat reservations by the same person: [{name, qty}]
function claimantsOf(it) {
  const byName = new Map();
  for (const r of reservations[it.id] || []) {
    const key = r.name.trim().toLowerCase();
    const prev = byName.get(key);
    byName.set(key, { name: prev ? prev.name : r.name, qty: (prev ? prev.qty : 0) + (r.qty || 1) });
  }
  return [...byName.values()];
}

function claimantText(it) {
  const list = claimantsOf(it);
  if (!list.length) return "";
  const multi = totalOf(it) > 1;
  return "Reserved by " + list.map((c) => (multi && c.qty > 1 ? `${c.name} (${c.qty})` : c.name)).join(", ");
}

function badgeText(it) {
  const total = totalOf(it), left = leftOf(it), claimed = total - left;
  if (total === 1) {
    if (claimed) return claimantText(it);
    return isClosed() ? "Going to Goodwill" : "Available";
  }
  if (left === 0) return `All ${total} claimed`;
  if (isClosed()) return `${left} going to Goodwill` + (claimed ? ` · ${claimed} reserved` : "");
  return `${left} available` + (claimed ? ` · ${claimed} reserved` : "");
}

// ── Startup ────────────────────────────────────────────────────
async function init() {
  try {
    const data = await fetch("items.json", { cache: "no-store" }).then((r) => r.json());
    items = data.items || [];
    deadline = new Date(data.deadline);
    $("pickup").textContent = data.pickupNote || "";
  } catch (err) {
    $("status").textContent = "Couldn't load the item list. Check items.json for a typo.";
    console.error(err);
    return;
  }

  startCountdown();
  await loadReservations();
  render();
  setInterval(async () => { await loadReservations(); render(); if (openItem) fillDialog(openItem); }, REFRESH_MS);

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
      render();
    })
  );
  $("reserve-form").addEventListener("submit", onReserve);
  try { $("reserve-name").value = localStorage.getItem("tosp-name") || ""; } catch (_) {}
}

// ── Countdown ──────────────────────────────────────────────────
function isClosed() { return deadline && Date.now() >= deadline.getTime(); }

function startCountdown() {
  const tick = () => {
    const ms = Math.max(0, deadline.getTime() - Date.now());
    const s = Math.floor(ms / 1000);
    $("cd-days").textContent = Math.floor(s / 86400);
    $("cd-hours").textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
    $("cd-mins").textContent = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    $("cd-secs").textContent = String(s % 60).padStart(2, "0");
    if (ms === 0) {
      $("closed-banner").hidden = false;
      clearInterval(timer);
      render();
      if (openItem) fillDialog(openItem);
    }
  };
  const timer = setInterval(tick, 1000);
  tick();
}

// ── Reservations (Google Sheet via Apps Script) ────────────────
async function loadReservations() {
  if (!SCRIPT_URL) return;
  try {
    const res = await fetch(SCRIPT_URL, { cache: "no-store" }).then((r) => r.json());
    reservations = res.reservations || {};
  } catch (err) {
    console.error("Couldn't load reservations", err);
  }
}

async function saveReservation(it, name, qty) {
  if (!SCRIPT_URL) {
    // Demo mode
    const left = leftOf(it);
    if (left === 0) return { ok: false, error: "Sorry, that's all been claimed." };
    if (qty > left) return { ok: false, error: `Only ${left} left.` };
    (reservations[it.id] ||= []).push({ name, qty });
    return { ok: true, reservations };
  }
  // text/plain avoids a CORS preflight, which Apps Script can't answer.
  return fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ itemId: it.id, name, qty }),
  }).then((r) => r.json());
}

// ── Rendering ──────────────────────────────────────────────────
function render() {
  const grid = $("grid");
  grid.innerHTML = "";

  const shown = items.filter((it) =>
    filter === "all" || (filter === "reserved" ? claimedOf(it) > 0 : leftOf(it) > 0)
  );

  $("status").textContent = items.length === 0
    ? "Nothing listed yet."
    : shown.length === 0 ? "Nothing here." : "";

  for (const it of shown) {
    const total = totalOf(it);
    const left = leftOf(it);
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.className = "card" + (left === 0 ? " is-reserved" : claimedOf(it) ? " is-partial" : "");
    card.addEventListener("click", () => openDialog(it));

    const media = document.createElement("div");
    media.className = "card-media";
    const img = document.createElement("img");
    img.src = it.image || PLACEHOLDER;
    img.alt = it.name;
    img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
    media.append(img);
    if (total > 1) {
      const q = document.createElement("span");
      q.className = "qty-tag";
      q.textContent = `×${total}`;
      media.append(q);
    }

    const body = document.createElement("div");
    body.className = "card-body";
    const h3 = document.createElement("h3");
    h3.textContent = it.name;
    const p = document.createElement("p");
    p.textContent = it.description || "";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = badgeText(it);

    body.append(h3, p, badge);
    card.append(media, body);
    li.append(card);
    grid.append(li);
  }
}

// ── Item dialog ────────────────────────────────────────────────
function openDialog(it) {
  openItem = it;
  $("form-msg").textContent = "";
  $("form-msg").className = "form-msg";
  $("reserve-qty").value = 1;
  fillDialog(it);
  $("item-dialog").showModal();
}

function fillDialog(it) {
  const img = $("dlg-img");
  img.src = it.image || PLACEHOLDER;
  img.alt = it.name;
  img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
  $("dlg-name").textContent = it.name;
  $("dlg-desc").textContent = it.description || "";

  const total = totalOf(it);
  const left = leftOf(it);
  $("dlg-count").hidden = total === 1;
  $("dlg-count").textContent = `${left} of ${total} still available`;

  const who = claimantText(it);
  $("dlg-reserved").hidden = !who;
  $("dlg-reserved").textContent = who;

  $("reserve-form").hidden = left === 0 || isClosed();
  $("qty-field").hidden = total === 1;
  $("reserve-label").textContent = total === 1
    ? "Want it? Put your name down:"
    : "Want some? Your name and how many:";
  const qtyInput = $("reserve-qty");
  qtyInput.max = Math.max(1, left);
  if (Number(qtyInput.value) > left) qtyInput.value = Math.max(1, left);
}

$("item-dialog")?.addEventListener("close", () => { openItem = null; });
// Close when tapping the dark backdrop
$("item-dialog")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

async function onReserve(e) {
  e.preventDefault();
  if (!openItem) return;
  const it = openItem;
  const name = $("reserve-name").value.trim();
  if (!name) return;
  const qty = totalOf(it) > 1 ? Math.max(1, parseInt($("reserve-qty").value, 10) || 1) : 1;

  const btn = $("reserve-btn");
  const msg = $("form-msg");
  btn.disabled = true;
  msg.className = "form-msg";
  msg.textContent = "Saving…";

  try {
    const res = await saveReservation(it, name, qty);
    if (res.reservations) reservations = res.reservations;
    if (res.ok) {
      try { localStorage.setItem("tosp-name", name); } catch (_) {}
      msg.className = "form-msg success";
      msg.textContent = qty > 1
        ? `${qty} are yours! We'll be in touch about pickup.`
        : "It's yours! We'll be in touch about pickup.";
    } else {
      msg.className = "form-msg error";
      msg.textContent = res.error || "Something went wrong. Try again.";
    }
  } catch (err) {
    console.error(err);
    msg.className = "form-msg error";
    msg.textContent = "Couldn't reach the server. Try again in a minute.";
  } finally {
    btn.disabled = false;
    render();
    if (openItem) fillDialog(openItem);
  }
}

init();
