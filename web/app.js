// myd viewer: render → hydrate rich blocks → paint highlights → capture annotations.
import { isEditorSubmitShortcut } from "./shortcuts.js";
const qs = new URLSearchParams(location.search);
const docPath = qs.get("path");
const $ = (s) => document.querySelector(s);
const docEl = $("#doc"), railEl = $("#threads"), statusEl = $("#status");
let state = { version: null, items: [], html: "" };
let ws;

if (!docPath) { docEl.innerHTML = "<p>Open with <code>?path=/abs/file.md</code></p>"; throw new Error("no path"); }
document.title = docPath.split("/").pop() + " · myd";
$("#title").textContent = docPath.split("/").pop();

// ---------- load / render ----------
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const r = await fetch(`/api/doc?path=${encodeURIComponent(docPath)}`);
  if (!r.ok) { statusEl.textContent = "load failed"; return; }
  const data = await r.json();
  if (seq !== loadSeq) return; // a newer load superseded this one
  const y = window.scrollY;
  state = data;
  docEl.innerHTML = data.html;
  fixRelativeImages();
  await hydrateRich(seq);
  if (seq !== loadSeq) return;
  paintHighlights();
  renderRail();
  window.scrollTo(0, y);
  statusEl.textContent = `v${data.version}`;
}

function fixRelativeImages() {
  for (const img of docEl.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (/^(https?:|data:|\/)/.test(src)) continue;
    img.src = `/api/raw?path=${encodeURIComponent(docPath)}&rel=${encodeURIComponent(src)}`;
  }
}

// ---------- theme ----------
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
(function initTheme() { const t = localStorage.getItem("myd-theme"); if (t) document.documentElement.dataset.theme = t; })();
$("#themeBtn").onclick = () => { const next = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("myd-theme", next); docEl.querySelectorAll("[data-hydrated]").forEach((el) => { delete el.dataset.hydrated; el.querySelectorAll(".rich-view, .src-toggle, .obj-comment").forEach((x) => x.remove()); }); hydrateRich(loadSeq).then(paintHighlights); };

// ---------- rich blocks ----------
let mermaidMod, vegaLoaded;
async function hydrateRich(seq) {
  const dark = isDark();
  const fresh = (sel) => [...docEl.querySelectorAll(sel)].filter((el) => !el.dataset.hydrated && (el.dataset.hydrated = "1"));
  const stale = () => seq !== loadSeq;
  const merm = fresh(".rich.mermaid");
  if (merm.length) {
    mermaidMod ??= (await import("/vendor/mermaid/dist/mermaid.esm.min.mjs")).default;
    mermaidMod.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
    let i = 0;
    for (const el of merm) {
      if (stale()) return;
      const src = el.querySelector(".rich-src").textContent;
      try {
        const { svg } = await mermaidMod.render(`mm${Date.now()}${i++}`, src);
        const host = document.createElement("div"); host.className = "rich-view"; host.innerHTML = svg;
        el.appendChild(host); addSourceToggle(el);
        // clickable nodes → object comments
        host.querySelectorAll("g.node, g.edgeLabel, .cluster").forEach((g) => { g.classList.add("obj"); g.addEventListener("click", (e) => { e.stopPropagation(); objectComment(el, g.id || g.getAttribute("data-id") || g.textContent.trim().slice(0, 40), e); }); });
      } catch (err) { el.insertAdjacentHTML("beforeend", `<div class="rich-error">Mermaid: ${String(err.message || err)}</div>`); }
    }
  }
  if (stale()) return;
  const vega = fresh(".rich.vega");
  if (vega.length) {
    if (!vegaLoaded) { for (const f of ["/vendor/vega/build/vega.min.js", "/vendor/vega-lite/build/vega-lite.min.js", "/vendor/vega-embed/build/vega-embed.min.js"]) await loadScript(f); vegaLoaded = true; }
    for (const el of vega) {
      if (stale()) return;
      const src = el.querySelector(".rich-src").textContent;
      const host = document.createElement("div"); host.className = "rich-view"; el.appendChild(host);
      try {
        const spec = JSON.parse(src);
        const res = await window.vegaEmbed(host, spec, { actions: false, theme: dark ? "dark" : undefined });
        addSourceToggle(el);
        res.view.addEventListener("click", (ev, item) => { if (item && item.datum) objectComment(el, "datum:" + JSON.stringify(item.datum).slice(0, 80), ev); });
      } catch (err) { host.innerHTML = `<div class="rich-error">Chart: ${String(err.message || err)}</div>`; }
    }
  }
  for (const el of fresh(".rich.island")) {
    const src = el.querySelector(".rich-src").textContent;
    const f = document.createElement("iframe");
    f.className = "rich-view island-frame"; f.setAttribute("sandbox", "allow-scripts"); f.srcdoc = src; f.loading = "lazy";
    el.appendChild(f); addSourceToggle(el);
    f.addEventListener("load", () => { try { f.style.height = (f.contentDocument.documentElement.scrollHeight + 8) + "px"; } catch {} });
  }
}
function addSourceToggle(el) {
  const b = document.createElement("button"); b.className = "src-toggle"; b.textContent = "source";
  b.onclick = () => el.classList.toggle("show-src"); el.prepend(b);
  const c = document.createElement("button"); c.className = "obj-comment"; c.title = "Comment on this block"; c.textContent = "💬";
  c.onclick = (e) => objectComment(el, null, e); el.prepend(c);
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

// ---------- highlights (CSS Custom Highlight API) ----------
const canHighlight = "highlights" in CSS;
function paintHighlights() {
  if (!canHighlight) return;
  const showResolved = $("#showResolved").checked;
  const hc = new Highlight(), hs = new Highlight(), hres = new Highlight();
  const blocks = [...docEl.querySelectorAll("[data-pos]")].map((el) => { const [s, e] = el.dataset.pos.split("-").map(Number); return { el, s, e }; });
  for (const it of state.items) {
    if (it.kind === "reply") continue;
    const anchor = it.anchorText ?? it.originalText;
    if (!anchor) continue;
    const resolved = it.status === "resolved";
    if (resolved && !showResolved) continue;
    // innermost block containing the item's clean offset
    const cands = blocks.filter((b) => it.cleanOffset >= b.s && it.cleanOffset <= b.e).sort((a, b) => (a.e - a.s) - (b.e - b.s));
    const host = cands[0]?.el ?? docEl;
    const range = findTextRange(host, anchor);
    if (!range) continue;
    range.__item = it;
    (resolved ? hres : it.kind === "suggestion" ? hs : hc).add(range);
  }
  CSS.highlights.set("myd-comment", hc); CSS.highlights.set("myd-suggest", hs); CSS.highlights.set("myd-resolved", hres);
  state.__ranges = [...hc, ...hs, ...hres];
}
function textNodes(root) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest(".rich-src, .katex-mathml, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); const out = []; while (w.nextNode()) out.push(w.currentNode); return out; }
function findTextRange(root, needle) {
  const nodes = textNodes(root); let full = "", idx = [];
  for (const n of nodes) { idx.push({ n, start: full.length }); full += n.data; }
  const norm = (s) => s.replace(/\s+/g, " ");
  let at = full.indexOf(needle);
  if (at < 0) { const nf = norm(full), nn = norm(needle); const a2 = nf.indexOf(nn); if (a2 < 0) return null; // map back approx
    at = a2; needle = nn; full = nf; }
  const end = at + needle.length, r = document.createRange();
  const loc = (off, isEnd) => { for (let i = idx.length - 1; i >= 0; i--) { if (off >= idx[i].start && (isEnd ? off <= idx[i].start + idx[i].n.data.length : off < idx[i].start + idx[i].n.data.length)) return [idx[i].n, off - idx[i].start]; } return null; };
  const a = loc(at, false), b = loc(end, true); if (!a || !b) return null;
  try { r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); } catch { return null; }
  return r;
}
docEl.addEventListener("click", (e) => {
  if (!state.__ranges || !popover.hidden || !editor.hidden) return;
  const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
  const rng = pos ? (() => { const r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true); return r; })() : document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!rng) return;
  for (const hr of state.__ranges) { if (hr.comparePoint(rng.startContainer, rng.startOffset) === 0) { focusThread(hr.__item.id); return; } }
});
$("#showResolved").onchange = () => { paintHighlights(); renderRail(); };

// ---------- selection → comment / suggest ----------
const popover = $("#popover");
let pending = null;
document.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
document.addEventListener("keyup", (e) => { if (e.key === "Escape") { popover.hidden = true; } });
function captureSelection() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !docEl.contains(sel.anchorNode)) { if (editor.hidden) popover.hidden = true; return; }
  const range = sel.getRangeAt(0);
  const text = sel.toString();
  if (!text.trim()) return;
  const blockEl = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement).closest("[data-pos]");
  if (!blockEl || blockEl.closest(".rich")) return;
  // prefix: text before the selection within the block (for disambiguation)
  const pre = document.createRange(); pre.selectNodeContents(blockEl); pre.setEnd(range.startContainer, range.startOffset);
  pending = { blockPos: blockEl.dataset.pos, anchorText: text, prefix: pre.toString().slice(-40) };
  const rect = range.getBoundingClientRect();
  popover.style.left = `${Math.max(8, rect.left + rect.width / 2 - 80 + window.scrollX)}px`;
  popover.style.top = `${rect.top + window.scrollY - 44}px`;
  popover.hidden = false;
}
popover.addEventListener("mousedown", (e) => e.preventDefault());
popover.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act; if (!act || !pending) return;
  popover.hidden = true; openDialog(act, popover.getBoundingClientRect());
});
const editor = $("#editor");
let edMode = "comment", edTarget = null; // edTarget: {kind:"text"} | {kind:"object", blockEl, target}
function placeEditor(rect) {
  editor.style.left = `${Math.min(window.innerWidth - 440, Math.max(8, rect.left + window.scrollX))}px`;
  editor.style.top = `${rect.bottom + window.scrollY + 8}px`;
  editor.hidden = false;
}
function openDialog(kind, rect) {
  edMode = kind; edTarget = { kind: "text" };
  $("#edAnchor").textContent = pending.anchorText; $("#edAnchor").hidden = false;
  const isSug = kind === "suggest";
  $("#edRepl").hidden = !isSug; $("#edRepl").value = isSug ? pending.anchorText : "";
  $("#edBody").value = ""; $("#edBody").placeholder = isSug ? "Note (optional)" : "Comment…";
  placeEditor(rect ?? getSelection().getRangeAt(0).getBoundingClientRect());
  (isSug ? $("#edRepl") : $("#edBody")).focus();
}
function closeEditor() { editor.hidden = true; pending = null; edTarget = null; getSelection()?.removeAllRanges(); }
$("#edCancel").onclick = closeEditor;
editor.addEventListener("keydown", (e) => {
  const submit = isEditorSubmitShortcut(e);
  if (submit) { e.preventDefault(); saveEditor(); }
  if (e.key === "Escape") closeEditor();
});
$("#edSave").onclick = saveEditor;
async function saveEditor() {
  const body = $("#edBody").value, repl = $("#edRepl").value;
  if (edTarget?.kind === "object") {
    if (!body.trim()) return;
    const r = await fetch("/api/annotate-object", { method: "POST", body: JSON.stringify({ path: docPath, version: state.version, bid: edTarget.blockEl.dataset.bid, target: edTarget.target, body, by: "user" }) });
    if (!r.ok) alert("Failed to save comment");
    closeEditor(); return;
  }
  if (!pending) return;
  const isSug = edMode === "suggest";
  if (!isSug && !body.trim()) return;
  const payload = { path: docPath, version: state.version, ...pending, kind: isSug ? "suggestion" : "comment", body, replacement: repl, note: body, by: "user" };
  const r = await fetch("/api/annotate", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Failed to save annotation"); if (r.status === 409) load(); }
  closeEditor();
}
document.addEventListener("mousedown", (e) => { if (!editor.hidden && !editor.contains(e.target) && !popover.contains(e.target)) { /* keep open while user reselects? close for simplicity */ if (!$("#edBody").value && !$("#edRepl").value) closeEditor(); } });

function objectComment(blockEl, target, evt) {
  edMode = "comment"; edTarget = { kind: "object", blockEl, target }; pending = null;
  $("#edAnchor").textContent = target ? `${blockEl.dataset.bid} › ${target}` : `${blockEl.dataset.bid} (whole block)`; $("#edAnchor").hidden = false;
  $("#edRepl").hidden = true; $("#edBody").value = ""; $("#edBody").placeholder = "Comment…";
  const rect = (evt?.target?.getBoundingClientRect?.()) ?? blockEl.getBoundingClientRect();
  placeEditor(rect); $("#edBody").focus();
}

// ---------- rail ----------
function renderRail() {
  const showResolved = $("#showResolved").checked;
  const roots = state.items.filter((i) => i.kind !== "reply" && (showResolved || i.status !== "resolved"));
  const replies = (id) => state.items.filter((i) => i.kind === "reply" && i.parentId === id);
  $("#count").textContent = roots.length ? `(${roots.length})` : "";
  railEl.innerHTML = roots.map((it) => {
    const anchor = it.anchorText ?? it.originalText ?? "";
    const objAnchor = it.anchor ? `<span class="obj-tag">${escape(it.anchor.target ? `${it.anchor.block} › ${it.anchor.target}` : it.anchor.block)}</span>` : "";
    const sug = it.kind === "suggestion" ? `<div class="sug"><del>${escape(it.originalText ?? "")}</del> → <ins>${escape(it.replacementText ?? "")}</ins></div>` : "";
    return `<div class="thread ${it.status === "resolved" ? "resolved" : ""}" data-id="${it.id}">
      <div class="meta"><b>${escape(it.author ?? "?")}</b> <span class="id">${it.id}</span> ${objAnchor}<span class="spacer"></span>${it.status !== "resolved" ? `<button class="link" data-resolve="${it.id}">resolve</button>` : "<span class='id'>resolved</span>"}</div>
      ${anchor && !it.anchor ? `<div class="anchor">“${escape(anchor.slice(0, 120))}”</div>` : ""}
      ${sug}${it.kind === "suggestion" && it.text === it.replacementText ? "" : `<div class="body">${escape(it.text)}</div>`}
      ${replies(it.id).map((r) => `<div class="reply"><b>${escape(r.author ?? "?")}</b> ${escape(r.text)}</div>`).join("")}
      <form class="replyForm" data-id="${it.id}"><input placeholder="Reply…"><button class="link">send</button></form>
    </div>`;
  }).join("") || "<p class='muted'>Select text to comment or suggest. Click 💬 on a diagram or a diagram node to comment on it.</p>";
  railEl.querySelectorAll(".thread").forEach((t) => t.addEventListener("click", (e) => { if (e.target.closest("form,button")) return; scrollToItem(t.dataset.id); }));
  railEl.querySelectorAll("[data-resolve]").forEach((b) => b.onclick = async () => { await fetch("/api/resolve", { method: "POST", body: JSON.stringify({ path: docPath, id: b.dataset.resolve, by: "user" }) }); });
  railEl.querySelectorAll(".replyForm").forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const m = f.querySelector("input").value.trim(); if (!m) return; await fetch("/api/reply", { method: "POST", body: JSON.stringify({ path: docPath, id: f.dataset.id, message: m, by: "user" }) }); });
}
function focusThread(id) { const t = railEl.querySelector(`.thread[data-id="${id}"]`); if (!t) return; railEl.querySelectorAll(".thread").forEach((x) => x.classList.remove("focus")); t.classList.add("focus"); t.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
function scrollToItem(id) {
  const r = state.__ranges?.find((x) => x.__item.id === id);
  focusThread(id);
  if (r) { const el = r.startContainer.parentElement; el.scrollIntoView({ block: "center", behavior: "smooth" }); const s = getSelection(); s.removeAllRanges(); s.addRange(r); setTimeout(() => s.removeAllRanges(), 800); return; }
  const it = state.items.find((x) => x.id === id);
  if (it?.anchor?.block) docEl.querySelector(`[data-bid="${it.anchor.block}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}
function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- done ----------
$("#doneBtn").onclick = () => $("#doneDlg").showModal();
$("#doneDlg").addEventListener("close", async () => {
  if ($("#doneDlg").returnValue !== "ok") return;
  await fetch("/api/done", { method: "POST", body: JSON.stringify({ path: docPath, note: $("#doneNote").value, by: "user" }) });
  $("#doneNote").value = ""; statusEl.textContent = "sent ✓";
});

// ---------- live ----------
function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?path=${encodeURIComponent(docPath)}`);
  ws.onmessage = (e) => { if (e.data === "pong") return; const m = JSON.parse(e.data); if (m.type === "changed") load(); };
  ws.onclose = () => setTimeout(connect, 1000);
  setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
}
connect(); load();
