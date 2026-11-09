// ───────────────────────────────────────────────────────────────
// SETUP: paste your Google Apps Script web app URL between the quotes.
// Leave it empty to preview the site in "demo mode" (reservations
// work on your screen only and vanish on refresh).
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwtSbBwDZm-8WDnJs8eUbD3L241BL_hLHETLeaZ-P4DfEgfVYmTuBAkxaLYXmt0YfEz/exec";
// ───────────────────────────────────────────────────────────────

const PLACEHOLDER = "images/placeholder.svg";
const REFRESH_MS = 60 * 1000;

let items = [];
let claimed = {};        // { itemId: number reserved } (names stay private in the Sheet)
let deadline = null;
let category = "all";    // all | a category key
let openItem = null;

// Reservations made on this device, so people can unclaim their own.
// Each has a private token from the Sheet; only that token can cancel it.
const MINE_KEY = "tosp-mine";
function loadMine() {
  try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; } catch (_) { return []; }
}
function saveMine(list) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch (_) {}
}
let mine = loadMine();

const $ = (id) => document.getElementById(id);

// Photos: "images": [...] or the older single "image"
function imagesOf(it) {
  if (Array.isArray(it.images) && it.images.length) return it.images;
  return it.image ? [it.image] : [PLACEHOLDER];
}

// ── Categories ─────────────────────────────────────────────────
// "category": "tech" in items.json. Matching ignores capitalization.
const catKey = (it) => String(it.category || "").trim().toLowerCase();
// Capitalize each word ("men's clothes" → "Men's Clothes", not "Men'S")
const catLabel = (key) => key.replace(/(^|\s)\w/g, (c) => c.toUpperCase());

function buildCategoryChips(onBoard) {
  const keys = [...new Set(onBoard.map(catKey).filter(Boolean))].sort();
  if (category !== "all" && !keys.includes(category)) category = "all";
  const row = $("category-filters");
  row.innerHTML = "";
  // Only worth showing once there's more than one category
  row.hidden = keys.length < 2;
  if (row.hidden) { category = "all"; return; }
  for (const key of ["all", ...keys]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip cat-chip" + (key === category ? " is-active" : "");
    b.textContent = key === "all" ? "All categories" : catLabel(key);
    b.addEventListener("click", () => {
      category = key;
      row.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === b));
      render();
    });
    row.append(b);
  }
}

// ── Quantity helpers ───────────────────────────────────────────
const totalOf = (it) => Math.max(1, parseInt(it.quantity, 10) || 1);
const claimedOf = (it) => claimed[it.id] || 0;
const leftOf = (it) => Math.max(0, totalOf(it) - claimedOf(it));

function badgeText(it) {
  const total = totalOf(it), left = leftOf(it), claimed = total - left;
  if (total === 1) {
    if (claimed) return "Reserved";
    return isClosed() ? "Being donated" : "Available";
  }
  if (left === 0) return `All ${total} claimed`;
  if (isClosed()) return `${left} being donated` + (claimed ? ` · ${claimed} reserved` : "");
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
// The script returns { counts: { itemId: n } }. An older script returned
// names ({ reservations }); convert that to counts so names never show.
function countsFrom(res) {
  if (res && res.counts) return res.counts;
  const out = {};
  for (const [id, list] of Object.entries((res && res.reservations) || {})) {
    out[id] = list.reduce((n, r) => n + (r.qty || 1), 0);
  }
  return out;
}
async function loadReservations() {
  if (!SCRIPT_URL) return;
  try {
    const res = await fetch(SCRIPT_URL, { cache: "no-store" }).then((r) => r.json());
    claimed = countsFrom(res);
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
    claimed[it.id] = (claimed[it.id] || 0) + qty;
    return { ok: true, counts: claimed, token: "demo-" + Math.random().toString(36).slice(2) };
  }
  // text/plain avoids a CORS preflight, which Apps Script can't answer.
  return fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ itemId: it.id, name, qty }),
  }).then((r) => r.json());
}

async function cancelReservation(entry) {
  if (!SCRIPT_URL) {
    claimed[entry.itemId] = Math.max(0, (claimed[entry.itemId] || 0) - entry.qty);
    return { ok: true, counts: claimed };
  }
  return fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "cancel", token: entry.token }),
  }).then((r) => r.json());
}

// ── Rendering ──────────────────────────────────────────────────
function render() {
  const grid = $("grid");
  grid.innerHTML = "";

  renderMine();

  // Fully claimed items come off the board. Newest first: items added
  // later in items.json show at the top.
  const onBoard = items.slice().reverse().filter((it) => leftOf(it) > 0);
  buildCategoryChips(onBoard);
  const shown = onBoard.filter((it) => category === "all" || catKey(it) === category);

  $("status").textContent = items.length === 0
    ? "Nothing listed yet."
    : onBoard.length === 0 ? "Everything's been claimed!"
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
    const photos = imagesOf(it);
    img.src = photos[0];
    img.alt = it.name;
    img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
    media.append(img);
    if (photos.length > 1) {
      const pc = document.createElement("span");
      pc.className = "photo-tag";
      pc.textContent = `${photos.length} photos`;
      media.append(pc);
    }
    if (total > 1) {
      const q = document.createElement("span");
      q.className = "qty-tag";
      q.textContent = `×${total}`;
      media.append(q);
    }

    const body = document.createElement("div");
    body.className = "card-body";
    if (catKey(it)) {
      const cat = document.createElement("span");
      cat.className = "cat-label";
      cat.textContent = catLabel(catKey(it));
      body.append(cat);
    }
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

// "Your reservations": what this device claimed, with an Unclaim button
function renderMine() {
  // Drop entries for items no longer listed
  mine = mine.filter((m) => items.some((it) => it.id === m.itemId));
  const list = $("mine-list");
  list.innerHTML = "";
  $("mine").hidden = mine.length === 0;
  for (const m of mine) {
    const it = items.find((x) => x.id === m.itemId);
    const li = document.createElement("li");
    li.className = "mine-row";
    const img = document.createElement("img");
    img.src = imagesOf(it)[0];
    img.alt = "";
    img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
    const label = document.createElement("span");
    label.className = "mine-name";
    label.textContent = it.name + (totalOf(it) > 1 ? ` (${m.qty})` : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unclaim-btn";
    btn.textContent = "Unclaim";
    btn.addEventListener("click", () => onUnclaim(m, it, btn));
    li.append(img, label, btn);
    list.append(li);
  }
}

async function onUnclaim(entry, it, btn) {
  const what = totalOf(it) > 1 ? `${entry.qty} × ${it.name}` : it.name;
  if (!confirm(`Unclaim ${what}? It'll go back on the board for someone else.`)) return;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await cancelReservation(entry);
    if (res.counts) claimed = countsFrom(res);
    // notFound: already released (e.g. deleted from the Sheet), so forget it too
    if (res.ok || res.notFound) {
      mine = mine.filter((m) => m.token !== entry.token);
      saveMine(mine);
    } else {
      alert(res.error || "Couldn't unclaim that. Try again in a minute.");
    }
  } catch (err) {
    console.error(err);
    alert("Couldn't reach the server. Try again in a minute.");
  } finally {
    render();
  }
}

// ── Item dialog ────────────────────────────────────────────────
function openDialog(it) {
  openItem = it;
  $("form-msg").textContent = "";
  $("form-msg").className = "form-msg";
  $("reserve-qty").value = 1;
  buildGallery(it);
  fillDialog(it);
  $("item-dialog").showModal();
  $("gallery-track").scrollLeft = 0;
}

// Swipeable photo strip with dots and arrows. Built once per open so the
// once-a-minute refresh doesn't jump you back to the first photo.
function buildGallery(it) {
  const photos = imagesOf(it);
  const track = $("gallery-track");
  const dots = $("gallery-dots");
  track.innerHTML = "";
  dots.innerHTML = "";
  photos.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = photos.length > 1 ? `${it.name}, photo ${i + 1} of ${photos.length}` : it.name;
    if (i > 0) img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER; };
    track.append(img);
    if (photos.length > 1) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "dot" + (i === 0 ? " is-active" : "");
      d.setAttribute("aria-label", `Photo ${i + 1}`);
      d.addEventListener("click", () => goToPhoto(i));
      dots.append(d);
    }
  });
  $("gallery").classList.toggle("is-multi", photos.length > 1);
}

function currentPhoto() {
  const t = $("gallery-track");
  return Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
}
function goToPhoto(i) {
  const t = $("gallery-track");
  const n = t.children.length;
  i = (i + n) % n;
  t.scrollTo({ left: i * t.clientWidth, behavior: "smooth" });
}
$("gallery-track").addEventListener("scroll", () => {
  const i = currentPhoto();
  [...$("gallery-dots").children].forEach((d, j) => d.classList.toggle("is-active", j === i));
}, { passive: true });
$("gallery-prev").addEventListener("click", () => goToPhoto(currentPhoto() - 1));
$("gallery-next").addEventListener("click", () => goToPhoto(currentPhoto() + 1));
$("item-dialog").addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") goToPhoto(currentPhoto() - 1);
  if (e.key === "ArrowRight") goToPhoto(currentPhoto() + 1);
});

function fillDialog(it) {
  $("dlg-name").textContent = it.name;
  $("dlg-desc").textContent = it.description || "";

  const total = totalOf(it);
  const left = leftOf(it);
  $("dlg-count").hidden = total === 1;
  $("dlg-count").textContent = `${left} of ${total} still available`;

  // Single items say "Reserved"; multi-quantity items already show the count above
  $("dlg-reserved").hidden = !(total === 1 && left === 0);
  $("dlg-reserved").textContent = "Reserved";

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
    if (res.counts || res.reservations) claimed = countsFrom(res);
    if (res.ok) {
      try { localStorage.setItem("tosp-name", name); } catch (_) {}
      if (res.token) {
        mine.push({ token: res.token, itemId: it.id, qty });
        saveMine(mine);
      }
      msg.className = "form-msg success";
      msg.textContent = qty > 1
        ? `${qty} are yours! We'll be in touch about pickup. Changed your mind? Unclaim it under "Your reservations."`
        : `It's yours! We'll be in touch about pickup. Changed your mind? Unclaim it under "Your reservations."`;
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

// ── Light / dark switch ────────────────────────────────────────
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function paintThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  const btn = $("theme-toggle");
  // Button shows what you'll switch TO
  btn.innerHTML = (dark ? SUN : MOON) + `<span class="label">${dark ? "Light mode" : "Dark mode"}</span>`;
  btn.setAttribute("aria-pressed", String(dark));
  btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}
$("theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("tosp-theme", dark ? "dark" : "light"); } catch (_) {}
  paintThemeToggle();
});
paintThemeToggle();

init();
