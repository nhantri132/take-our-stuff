// ───────────────────────────────────────────────────────────────
// SETUP: paste your Google Apps Script web app URL between the quotes.
// Leave it empty to preview the site in "demo mode" (reservations
// work on your screen only and vanish on refresh).
const SCRIPT_URL = "";
// ───────────────────────────────────────────────────────────────

const PLACEHOLDER = "images/placeholder.svg";
const REFRESH_MS = 60 * 1000;

let items = [];
let reservations = {};   // { itemId: "Name" }
let deadline = null;
let filter = "all";
let openItem = null;

const $ = (id) => document.getElementById(id);

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
  setInterval(async () => { await loadReservations(); render(); }, REFRESH_MS);

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

async function saveReservation(itemId, name) {
  if (!SCRIPT_URL) {
    // Demo mode
    if (reservations[itemId]) return { ok: false, error: `Already reserved by ${reservations[itemId]}.` };
    reservations[itemId] = name;
    return { ok: true, reservations };
  }
  // text/plain avoids a CORS preflight, which Apps Script can't answer.
  return fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ itemId, name }),
  }).then((r) => r.json());
}

// ── Rendering ──────────────────────────────────────────────────
function render() {
  const grid = $("grid");
  grid.innerHTML = "";

  const shown = items.filter((it) => {
    const taken = Boolean(reservations[it.id]);
    return filter === "all" || (filter === "reserved" ? taken : !taken);
  });

  $("status").textContent = items.length === 0
    ? "Nothing listed yet."
    : shown.length === 0 ? "Nothing here." : "";

  for (const it of shown) {
    const taken = reservations[it.id];
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.className = "card" + (taken ? " is-reserved" : "");
    card.addEventListener("click", () => openDialog(it));

    const img = document.createElement("img");
    img.src = it.image || PLACEHOLDER;
    img.alt = it.name;
    img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };

    const body = document.createElement("div");
    body.className = "card-body";
    const h3 = document.createElement("h3");
    h3.textContent = it.name;
    const p = document.createElement("p");
    p.textContent = it.description || "";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = taken ? `Reserved by ${taken}` : isClosed() ? "Going to Goodwill" : "Available";

    body.append(h3, p, badge);
    card.append(img, body);
    li.append(card);
    grid.append(li);
  }
}

// ── Item dialog ────────────────────────────────────────────────
function openDialog(it) {
  openItem = it;
  $("form-msg").textContent = "";
  $("form-msg").className = "form-msg";
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

  const taken = reservations[it.id];
  $("dlg-reserved").hidden = !taken;
  $("dlg-reserved").textContent = taken ? `Reserved by ${taken}` : "";
  $("reserve-form").hidden = Boolean(taken) || isClosed();
}

$("item-dialog")?.addEventListener("close", () => { openItem = null; });
// Close when tapping the dark backdrop
$("item-dialog")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

async function onReserve(e) {
  e.preventDefault();
  if (!openItem) return;
  const name = $("reserve-name").value.trim();
  if (!name) return;

  const btn = $("reserve-btn");
  const msg = $("form-msg");
  btn.disabled = true;
  msg.className = "form-msg";
  msg.textContent = "Saving…";

  try {
    const res = await saveReservation(openItem.id, name);
    if (res.reservations) reservations = res.reservations;
    if (res.ok) {
      try { localStorage.setItem("tosp-name", name); } catch (_) {}
      msg.textContent = "It's yours! We'll be in touch about pickup.";
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
    fillDialog(openItem);
  }
}

init();
