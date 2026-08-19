// Review inbox: one bookmarkable origin from which a reviewer reaches every agent's work.
import { resolveTheme, themeTogglePresentation, toggledTheme } from "./theme.js";
import { emptyMessage, rowPresentation } from "./inbox-presentation.js";

const $ = (s) => document.querySelector(s);
const listEl = $("#inbox"), emptyEl = $("#empty"), statusEl = $("#status"), showAllEl = $("#showAll");
const ALL = ["active", "completed", "superseded", "archived"];
let rows = [];
let showAll = localStorage.getItem("myd-inbox-all") === "1";
let ws;

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- theme ----------
const themeBtn = $("#themeBtn");
const currentTheme = () => resolveTheme(document.documentElement.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches);
function applyTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  const presentation = themeTogglePresentation(theme);
  themeBtn.querySelector("[data-theme-icon]").dataset.themeIcon = presentation.icon;
  themeBtn.querySelector("[data-theme-label]").textContent = presentation.label;
  themeBtn.setAttribute("aria-label", presentation.title);
  themeBtn.title = presentation.title;
  if (persist) localStorage.setItem("myd-theme", theme);
}
applyTheme(resolveTheme(localStorage.getItem("myd-theme"), matchMedia("(prefers-color-scheme: dark)").matches));
themeBtn.addEventListener("click", () => applyTheme(toggledTheme(currentTheme()), true));

// ---------- data ----------
async function load() {
  const query = showAll ? `?status=${ALL.join(",")}` : "";
  try {
    const r = await fetch(`/api/inbox${query}`);
    if (!r.ok) { statusEl.textContent = "could not load reviews"; return; }
    rows = (await r.json()).rows;
    statusEl.textContent = "";
    render();
  } catch {
    // A dropped connection is not evidence that the reviews are gone; keep what we have.
    statusEl.textContent = "offline";
  }
}

function render() {
  const now = Date.now();
  listEl.innerHTML = rows.map((row) => {
    const v = rowPresentation(row, now);
    const meta = [v.project, v.caller, v.revisionLabel, v.age].filter(Boolean);
    return `<li class="inbox-row" data-status="${escape(v.tone)}" data-id="${escape(row.id)}">
      <div class="inbox-main">
        <div class="inbox-line">
          <span class="inbox-title">${escape(v.title)}</span>
          <span class="inbox-badge" data-tone="${escape(v.tone)}">${escape(v.statusLabel)}</span>
          ${v.pending ? `<span class="inbox-pending">${escape(v.pending)}</span>` : ""}
        </div>
        <div class="inbox-meta">${meta.map(escape).join(" · ")}</div>
      </div>
      <div class="inbox-actions">
        ${v.openable ? `<a class="inbox-open" href="${escape(v.href)}">Open</a>` : ""}
        ${v.canArchive ? `<button class="link" data-archive="${escape(row.id)}">Archive</button>` : ""}
      </div>
    </li>`;
  }).join("");
  const hidden = !showAll && rows.length === 0;
  emptyEl.hidden = rows.length !== 0;
  emptyEl.textContent = rows.length === 0 ? emptyMessage(hidden) : "";
}

listEl.addEventListener("click", async (e) => {
  const id = e.target.closest("[data-archive]")?.dataset.archive;
  if (!id) return;
  e.preventDefault();
  const r = await fetch(`/api/reviews/${encodeURIComponent(id)}/archive`, { method: "POST" });
  if (!r.ok) { statusEl.textContent = "could not archive"; return; }
  await load(); // the socket also fires; reloading here keeps the click feeling immediate
});

showAllEl.checked = showAll;
showAllEl.addEventListener("change", () => {
  showAll = showAllEl.checked;
  localStorage.setItem("myd-inbox-all", showAll ? "1" : "0");
  load();
});

// ---------- live ----------
function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?inbox=1`);
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    if (JSON.parse(e.data).type === "reviews-changed") load();
  };
  ws.onclose = () => setTimeout(connect, 1000);
  const ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
  ws.addEventListener("close", () => clearInterval(ping), { once: true });
}

// Ages drift while the tab sits open; re-render without refetching so they stay honest.
const ageTimer = setInterval(() => { if (rows.length) render(); }, 60000);
window.addEventListener("pagehide", () => clearInterval(ageTimer));
window.addEventListener("focus", load);
connect();
load();
