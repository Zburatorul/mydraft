// myd viewer: render → hydrate rich blocks → paint highlights → capture annotations.
import { isEditorSubmitShortcut, isModifiedEnterShortcut } from "./shortcuts.js";
import { reviewPresentation } from "./review-state.js";
import { revisionLabel, revisionTitle } from "./revision-label.js";
import { islandDocument, islandThemeMessage, parseIslandMessage } from "./island-bridge.js";
import { resolveTheme, themeTogglePresentation, toggledTheme } from "./theme.js";
import { clickAwayDismissal } from "./annotation-overlay.js";
import { annotationSaveDisposition } from "./annotation-save.js";
import { ReviewComposer } from "./review-composer.js";
const qs = new URLSearchParams(location.search);
const routeReview = /^\/review\/([^/]+)\/?$/.exec(location.pathname);
const reviewId = routeReview ? decodeURIComponent(routeReview[1]) : qs.get("review");
let docPath = qs.get("path");
// A `doc` handle names the document without spelling out its path — how `myd shot`
// opens a file whose name would otherwise fill the URL with escapes.
const docHandle = qs.get("doc");
const $ = (s) => document.querySelector(s);
const docEl = $("#doc"), railEl = $("#threads"), railPanel = $("#rail"), mainEl = $("main"), railToggle = $("#railToggle"), statusEl = $("#status");
let state = { version: null, items: [], html: "" };
let reviewStatus = null;
let ws;
let composerFocusAfterReload = null;
let reviewChanges = null;
let selectedChangeIndex = 0;
let selectedChangeId = null;
let changeModePreference = null;
let railView = "comments";

if (!docPath && !reviewId && !docHandle) { docEl.innerHTML = "<p>Open with <code>myd view /abs/file.md</code></p>"; throw new Error("no review, handle or path"); }
let fileName = docPath?.split("/").pop() ?? "review";
function setDocumentTitle(title) {
  fileName = title || docPath?.split("/").pop() || "review";
  document.title = fileName + " · myd";
  $("#title").textContent = fileName;
}
setDocumentTitle(fileName);

async function resolveReviewRoute() {
  if (docPath || !reviewId) return true;
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}`);
  if (!response.ok) {
    statusEl.textContent = response.status === 404 ? "review not found" : "review load failed";
    return false;
  }
  // Deliberately no path: a review reached by id identifies its document by title, and the
  // server resolves the file itself. This tab may be running on someone else's machine.
  setDocumentTitle((await response.json()).review.title);
  return true;
}

function documentQuery() {
  if (reviewId) return `review=${encodeURIComponent(reviewId)}`;
  if (docHandle) return `doc=${encodeURIComponent(docHandle)}`;
  return `path=${encodeURIComponent(docPath)}`;
}
/** How a mutation names its document: the review id when we have one, else the path a
 *  legacy `?path=` tab was opened with. Sending both would leak the path back needlessly. */
function documentRef() {
  return reviewId ? { reviewId } : { path: docPath };
}

const railMediaQuery = matchMedia("(max-width: 1360px)");
let railPreference = null;
let railHadThreads = null;
let railAutoOpen = false;
function setRailOpen(open) {
  railPanel.hidden = !open;
  mainEl.classList.toggle("rail-closed", !open);
  const noun = reviewChanges ? "review panel" : "comments";
  railToggle.setAttribute("aria-expanded", String(open));
  railToggle.setAttribute("aria-label", open ? `Hide ${noun}` : `Show ${noun}`);
  railToggle.querySelector("[data-rail-label]").textContent = open ? `Hide ${noun}` : `Show ${noun}`;
}
function syncRailDefault() {
  const hasThreads = state.items.some((item) => item.kind !== "reply");
  const hasChanges = Boolean(reviewChanges?.changeSet.changes.length);
  const hasRailContent = hasThreads || hasChanges;
  if (railPreference !== null) { railHadThreads = hasThreads; return; }
  // Keep an initially empty/narrow review spacious, but reveal the thread a reviewer
  // just created. Once revealed, live reloads must not hide the reply controls again.
  if (railHadThreads === false && hasThreads) railAutoOpen = true;
  if (!hasRailContent) railAutoOpen = false;
  setRailOpen(hasRailContent && (hasChanges || railAutoOpen || !railMediaQuery.matches));
  railHadThreads = hasThreads;
}
setRailOpen(false);
railToggle.onclick = () => { railPreference = railPanel.hidden; setRailOpen(railPreference); };
railMediaQuery.addEventListener("change", syncRailDefault);

function applyReviewStatus(status) {
  reviewStatus = status;
  const view = reviewPresentation(status, fileName, state.revision?.number);
  document.documentElement.dataset.reviewState = view.deprecated ? "deprecated" : "active";
  document.title = view.title;
  const badge = $("#reviewState");
  badge.hidden = !view.deprecated;
  badge.textContent = view.label;
  badge.title = view.deprecated ? "This tab is no longer the review tracked by the backend. Run myd view to start a fresh review." : "";
  if (view.deprecated) { $("#popover").hidden = true; if (!$("#editor").hidden) closeEditor(); }
  updateWriteControls();
}

function updateWriteControls() {
  const disabled = reviewStatus ? !reviewStatus.tracked : true;
  $("#doneBtn").disabled = disabled;
  for (const el of document.querySelectorAll("#rail button, #rail input, .obj-comment")) el.disabled = disabled;
}

async function checkTracking() {
  if (!state.version) return;
  try {
    const r = await fetch(`/api/tracking?${documentQuery()}&version=${encodeURIComponent(state.version)}`);
    if (r.ok) applyReviewStatus(await r.json());
  } catch {
    // A network interruption is not evidence that this review was deprecated.
  }
}

// ---------- load / render ----------
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const r = await fetch(`/api/doc?${documentQuery()}`);
  if (!r.ok) { statusEl.textContent = "load failed"; return false; }
  const data = await r.json();
  if (seq !== loadSeq) return true; // a newer load superseded this one
  const y = window.scrollY;
  const previousVersion = state.version;
  state = data;
  if (previousVersion && previousVersion !== data.version) reviewComposer.documentChanged({ version: data.version });
  // A handle tab holds no path and no review, so the document names itself here.
  if (docHandle && data.name) setDocumentTitle(data.name);
  docEl.innerHTML = data.html;
  fixRelativeImages();
  await hydrateRich(seq);
  if (seq !== loadSeq) return true;
  restoreComposerFocusAfterReload();
  paintHighlights();
  const focusedInitialChange = await loadReviewChanges(data, seq);
  if (seq !== loadSeq) return true;
  renderRail();
  syncRailDefault();
  if (!focusedInitialChange) window.scrollTo(0, y);
  statusEl.textContent = revisionLabel(data.revision, data.version);
  statusEl.title = revisionTitle(data.revision, data.version);
  $("#changesBtn").hidden = !data.changesAvailable;
  $("#changesBtn").textContent = data.comparison ? "± Source diff" : "± Changes";
  await checkTracking();
  return true;
}

function fixRelativeImages() {
  for (const img of docEl.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (/^(https?:|data:|\/)/.test(src)) continue;
    img.src = `/api/raw?${documentQuery()}&rel=${encodeURIComponent(src)}`;
  }
}

// ---------- theme ----------
const themeBtn = $("#themeBtn");
const currentTheme = () => resolveTheme(document.documentElement.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches);
const isDark = () => currentTheme() === "dark";
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
themeBtn.onclick = () => {
  applyTheme(toggledTheme(currentTheme()), true);
  docEl.querySelectorAll("[data-hydrated]:not(.explainer)").forEach((el) => { delete el.dataset.hydrated; el.querySelectorAll(".rich-view, .src-toggle, .obj-comment, .diagram-open").forEach((x) => x.remove()); });
  hydrateRich(loadSeq).then(paintHighlights);
};

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
        el.appendChild(host); addSourceToggle(el); addDiagramOpen(el, host);
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
    f.className = "rich-view island-frame"; f.setAttribute("sandbox", "allow-scripts"); f.srcdoc = islandDocument(src); f.loading = "lazy";
    el.appendChild(f); addSourceToggle(el);
    f.addEventListener("load", () => f.contentWindow?.postMessage(islandThemeMessage(dark ? "dark" : "light"), "*"));
  }
  for (const el of fresh(".rich.explainer")) {
    addSourceToggle(el);
    el.querySelectorAll("[data-myd-target]").forEach((target) => {
      const comment = (event) => { event.stopPropagation(); objectComment(el, target.dataset.mydTarget, event); };
      target.addEventListener("click", comment);
      target.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); comment(event);
      });
    });
  }
}
function addSourceToggle(el) {
  const b = document.createElement("button"); b.className = "src-toggle"; b.textContent = "source";
  b.onclick = () => el.classList.toggle("show-src"); el.prepend(b);
  const c = document.createElement("button"); c.className = "obj-comment"; c.title = "Comment on this block"; c.textContent = "💬";
  c.onclick = (e) => objectComment(el, null, e); el.prepend(c);
}
function addDiagramOpen(el, host) {
  const button = document.createElement("button");
  button.className = "diagram-open";
  button.type = "button";
  button.setAttribute("aria-label", "Open diagram");
  button.title = "Open diagram";
  button.textContent = "⛶";
  button.onclick = () => openDiagram(host.querySelector("svg"));
  el.prepend(button);
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

// ---------- full-size Mermaid stage ----------
const diagramDlg = $("#diagramDlg"), diagramViewport = $("#diagramViewport"), diagramStage = $("#diagramStage");
let diagramScale = 1, diagramX = 0, diagramY = 0, diagramDrag = null;
function paintDiagramTransform() {
  diagramStage.dataset.scale = String(diagramScale);
  diagramStage.style.transform = `translate(${diagramX}px, ${diagramY}px) scale(${diagramScale})`;
  $("#diagramReset").textContent = `${Math.round(diagramScale * 100)}%`;
}
function setDiagramScale(next, originX = diagramViewport.clientWidth / 2, originY = diagramViewport.clientHeight / 2) {
  const scale = Math.min(4, Math.max(.4, next));
  const ratio = scale / diagramScale;
  diagramX = originX - (originX - diagramX) * ratio;
  diagramY = originY - (originY - diagramY) * ratio;
  diagramScale = scale;
  paintDiagramTransform();
}
function resetDiagram() {
  diagramScale = 1; diagramX = 0; diagramY = 0; paintDiagramTransform();
  const svg = diagramStage.querySelector("svg");
  if (!svg) return;
  const svgRect = svg.getBoundingClientRect();
  diagramX = Math.max(0, (diagramViewport.clientWidth - svgRect.width) / 2);
  diagramY = Math.max(0, (diagramViewport.clientHeight - svgRect.height) / 2);
  paintDiagramTransform();
}
function openDiagram(svg) {
  if (!svg) return;
  diagramStage.replaceChildren(svg.cloneNode(true));
  diagramDlg.showModal();
  resetDiagram();
  diagramViewport.focus();
}
$("#diagramZoomIn").onclick = () => setDiagramScale(diagramScale * 1.25);
$("#diagramZoomOut").onclick = () => setDiagramScale(diagramScale / 1.25);
$("#diagramReset").onclick = resetDiagram;
$("#diagramClose").onclick = () => diagramDlg.close();
diagramViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = diagramViewport.getBoundingClientRect();
  setDiagramScale(diagramScale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
diagramViewport.addEventListener("pointerdown", (event) => {
  diagramDrag = { x: event.clientX, y: event.clientY, originX: diagramX, originY: diagramY };
  diagramViewport.setPointerCapture(event.pointerId);
});
diagramViewport.addEventListener("pointermove", (event) => {
  if (!diagramDrag) return;
  diagramX = diagramDrag.originX + event.clientX - diagramDrag.x;
  diagramY = diagramDrag.originY + event.clientY - diagramDrag.y;
  paintDiagramTransform();
});
diagramViewport.addEventListener("pointerup", () => { diagramDrag = null; });

window.addEventListener("message", (event) => {
  const frame = [...docEl.querySelectorAll(".rich.island iframe")].find((candidate) => candidate.contentWindow === event.source);
  if (!frame) return;
  const message = parseIslandMessage(event.data);
  if (!message) return;
  if (message.type === "resize") { frame.style.height = `${message.height + 8}px`; return; }
  if (message.type === "pointerdown") { dismissAnnotationOverlays(frame); return; }
  const block = frame.closest(".rich.island");
  if (!block) return;
  const frameRect = frame.getBoundingClientRect();
  const point = { left: frameRect.left + message.x, right: frameRect.left + message.x, top: frameRect.top + message.y, bottom: frameRect.top + message.y };
  objectComment(block, message.target, { target: { getBoundingClientRect: () => point } }, message.text);
});

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
function isEditableControl(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
document.addEventListener("mouseup", (event) => {
  if (isEditableControl(event.target)) return;
  setTimeout(captureSelection, 0);
});
document.addEventListener("keyup", (e) => { if (e.key === "Escape") closePopover(); });
function clearAnnotationSelection() { pending = null; getSelection()?.removeAllRanges(); }
function closePopover() {
  if (popover.hidden) return;
  popover.hidden = true;
  clearAnnotationSelection();
}
function captureSelection() {
  if (!reviewStatus?.tracked) return;
  const reselecting = reviewComposer.state.targetStatus === "reselecting";
  if ((!editor.hidden && !reselecting) || !popover.hidden) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !docEl.contains(sel.anchorNode)) { if (editor.hidden) closePopover(); return; }
  const range = sel.getRangeAt(0);
  const text = sel.toString();
  if (!text.trim()) return;
  const blockEl = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement).closest("[data-pos]");
  if (!blockEl || blockEl.closest(".rich")) return;
  // prefix: text before the selection within the block (for disambiguation)
  const pre = document.createRange(); pre.selectNodeContents(blockEl); pre.setEnd(range.startContainer, range.startOffset);
  const captured = {
    target: { kind: "text", blockPos: blockEl.dataset.pos, anchorText: text, prefix: pre.toString().slice(-40), preview: text },
    capturedVersion: state.version,
    returnFocusTo: { element: blockEl, blockPos: blockEl.dataset.pos, bid: blockEl.dataset.bid },
  };
  if (reselecting) {
    pending = null;
    sel.removeAllRanges();
    reviewComposer.retarget(captured);
    return;
  }
  pending = captured;
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
function placeEditor(rect) {
  editor.style.left = `${Math.min(window.innerWidth - 440, Math.max(8, rect.left + window.scrollX))}px`;
  editor.style.top = `${rect.bottom + window.scrollY + 8}px`;
}
function targetPreview(target) {
  if (target.kind === "text") return target.preview;
  return target.object ? `${target.bid} › ${target.object}${target.quote ? `\n“${target.quote.slice(0, 160)}”` : ""}` : `${target.bid} (whole block)`;
}
function renderComposer(view) {
  editor.hidden = view.phase === "idle";
  if (view.phase === "idle") return;
  $("#edAnchor").textContent = targetPreview(view.target);
  $("#edAnchor").hidden = false;
  const isSuggestion = view.kind === "suggest";
  $("#edRepl").hidden = !isSuggestion;
  if ($("#edRepl").value !== view.draft.replacement) $("#edRepl").value = view.draft.replacement;
  if ($("#edBody").value !== view.draft.body) $("#edBody").value = view.draft.body;
  $("#edBody").placeholder = isSuggestion ? "Note (optional)" : "Comment…";
  const stale = view.targetStatus !== "current";
  $("#edStale").hidden = !stale;
  $("#edStaleMessage").textContent = view.targetStatus === "reselecting"
    ? "Select the target again. Your draft is safe."
    : "Document changed. Reselect the target to save this draft.";
  $("#edReselect").hidden = view.targetStatus === "reselecting";
  $("#edError").hidden = !view.error;
  $("#edError").textContent = view.error ?? "";
  const submitting = view.phase === "submitting";
  $("#edSave").disabled = stale || submitting;
  $("#edCancel").disabled = submitting;
  $("#edReselect").disabled = submitting;
  $("#edBody").disabled = submitting;
  $("#edRepl").disabled = submitting;
  $("#edSave").textContent = submitting ? "Saving…" : "Save";
}
function resolveDocumentFocusTarget(target) {
  if (target?.element?.isConnected) return target.element;
  if (target?.bid) {
    const byId = docEl.querySelector(`[data-bid="${CSS.escape(target.bid)}"]`);
    if (byId) return byId;
  }
  if (target?.blockPos) {
    const byPosition = docEl.querySelector(`[data-pos="${CSS.escape(target.blockPos)}"]`);
    if (byPosition) return byPosition;
  }
  return docEl;
}
function focusResolvedDocumentTarget(target) {
  const element = resolveDocumentFocusTarget(target);
  const temporaryTabIndex = !element.hasAttribute("tabindex");
  if (temporaryTabIndex) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  if (temporaryTabIndex) element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
}
function focusDocumentTarget(target, reason) {
  focusResolvedDocumentTarget(target);
  if (reason !== "saved") return;
  composerFocusAfterReload = target;
}
function restoreComposerFocusAfterReload() {
  if (!composerFocusAfterReload) return;
  const target = composerFocusAfterReload;
  composerFocusAfterReload = null;
  if (document.activeElement !== document.body && document.activeElement !== docEl) return;
  focusResolvedDocumentTarget(target);
}
document.addEventListener("pointerdown", () => { composerFocusAfterReload = null; }, true);
document.addEventListener("focusin", (event) => {
  if (composerFocusAfterReload && event.target !== resolveDocumentFocusTarget(composerFocusAfterReload)) composerFocusAfterReload = null;
}, true);
async function submitAnnotation(view, { signal }) {
  const { target, draft } = view;
  let response;
  if (target.kind === "object") {
    if (!draft.body.trim()) return { ok: false, error: "Write a comment before saving." };
    response = await fetch("/api/annotate-object", { method: "POST", signal, body: JSON.stringify({ ...documentRef(), version: target.capturedVersion, bid: target.bid, target: target.object, quote: target.quote, body: draft.body, by: "user" }) });
  } else {
    const isSuggestion = view.kind === "suggest";
    if (!isSuggestion && !draft.body.trim()) return { ok: false, error: "Write a comment before saving." };
    response = await fetch("/api/annotate", { method: "POST", signal, body: JSON.stringify({ ...documentRef(), version: target.capturedVersion, blockPos: target.blockPos, anchorText: target.anchorText, prefix: target.prefix, kind: isSuggestion ? "suggestion" : "comment", body: draft.body, replacement: draft.replacement, note: draft.body, by: "user" }) });
  }
  const disposition = await annotationSaveDisposition(response, target.kind === "object" ? "Failed to save comment" : "Failed to save annotation");
  return { ok: disposition.close, reload: disposition.reload, error: disposition.error };
}
const reviewComposer = new ReviewComposer({
  submit: submitAnnotation,
  reload: async () => {
    if (!await load()) throw new Error("Could not reload document");
  },
  onChange: renderComposer,
  focusPrimary: (view) => (view.kind === "suggest" ? $("#edRepl") : $("#edBody")).focus({ preventScroll: true }),
  restoreFocus: focusDocumentTarget,
  onClose: clearAnnotationSelection,
});
function openDialog(kind, rect) {
  const captured = pending;
  if (!captured) return;
  const isSug = kind === "suggest";
  placeEditor(rect ?? getSelection().getRangeAt(0).getBoundingClientRect());
  reviewComposer.open({
    kind,
    ...captured,
    draft: { body: "", replacement: isSug ? captured.target.anchorText : "" },
  });
}
function closeEditor() { reviewComposer.close("cancel"); }
$("#edCancel").onclick = closeEditor;
$("#edReselect").onclick = () => reviewComposer.beginReselect();
$("#edBody").addEventListener("input", () => reviewComposer.updateDraft({ body: $("#edBody").value }));
$("#edRepl").addEventListener("input", () => reviewComposer.updateDraft({ replacement: $("#edRepl").value }));
editor.addEventListener("keydown", (e) => {
  const submit = isEditorSubmitShortcut(e);
  if (submit) { e.preventDefault(); saveEditor(); }
  if (e.key === "Escape") closeEditor();
});
$("#edSave").onclick = saveEditor;
async function saveEditor() {
  if (!reviewStatus?.tracked) return;
  await reviewComposer.submit();
}
function dismissAnnotationOverlays(target) {
  const dismissal = clickAwayDismissal(target, editor, popover);
  if (dismissal === editor && (reviewComposer.hasUnsentDrafts() || reviewComposer.state.targetStatus === "reselecting")) return;
  if (dismissal === editor) closeEditor();
  if (dismissal === popover) closePopover();
}
document.addEventListener("mousedown", (e) => dismissAnnotationOverlays(e.target));

function objectComment(blockEl, target, evt, quote = null) {
  if (!reviewStatus?.tracked) return;
  const captured = {
    target: { kind: "object", bid: blockEl.dataset.bid, object: target, quote },
    capturedVersion: state.version,
    returnFocusTo: { element: evt?.target instanceof Element ? evt.target : blockEl, bid: blockEl.dataset.bid },
  };
  if (reviewComposer.state.phase !== "idle") {
    reviewComposer.retarget(captured);
    return;
  }
  pending = null;
  const rect = (evt?.target?.getBoundingClientRect?.()) ?? blockEl.getBoundingClientRect();
  placeEditor(rect);
  reviewComposer.open({ kind: "comment", ...captured });
}

// ---------- change-focused review ----------
function changeRegion(change) {
  return docEl.querySelector(`[data-change-id="${CSS.escape(change.id)}"]`);
}

function setRailView(view) {
  railView = view;
  $("#changeCards").hidden = view !== "changes";
  railEl.hidden = view !== "comments";
  $("#changeTab").classList.toggle("active", view === "changes");
  $("#commentTab").classList.toggle("active", view === "comments");
  $("#changeTab").setAttribute("aria-pressed", String(view === "changes"));
  $("#commentTab").setAttribute("aria-pressed", String(view === "comments"));
}

function setChangeMode(enabled) {
  window.scrollTo({ top: window.scrollY, behavior: "instant" });
  let spacer = $("#modePositionSpacer");
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.id = "modePositionSpacer";
    spacer.setAttribute("aria-hidden", "true");
    document.body.append(spacer);
  }
  const pageHeight = document.documentElement.scrollHeight;
  spacer.style.height = "0px";
  const selected = reviewChanges?.changeSet.changes[selectedChangeIndex];
  let anchor = selected ? changeRegion(selected) : null;
  if (selected?.kind === "removed" && anchor) {
    const visibleDocumentNeighbor = (direction) => {
      let candidate = anchor[direction];
      while (candidate && (!candidate.matches?.("[data-bid], [data-change-position-anchor]") || candidate.getClientRects().length === 0)) candidate = candidate[direction];
      return candidate;
    };
    anchor = visibleDocumentNeighbor("nextElementSibling") ?? visibleDocumentNeighbor("previousElementSibling") ?? anchor;
  }
  const anchorTop = anchor?.getBoundingClientRect().top;
  changeModePreference = enabled;
  document.documentElement.dataset.reviewMode = enabled ? "changes" : "document";
  $("#changeModeToggle").textContent = enabled ? "Full document" : "Show changes";
  spacer.style.height = `${Math.max(0, pageHeight - document.documentElement.scrollHeight)}px`;
  if (anchor && Number.isFinite(anchorTop)) {
    const shift = anchor.getBoundingClientRect().top - anchorTop;
    if (shift) window.scrollTo({ top: window.scrollY + shift, behavior: "instant" });
  }
}

function selectChange(index, { scroll = true } = {}) {
  const changes = reviewChanges?.changeSet.changes ?? [];
  if (!changes.length) {
    $("#changePosition").textContent = "No source changes";
    $("#changePrevious").disabled = true;
    $("#changeNext").disabled = true;
    return;
  }
  selectedChangeIndex = Math.max(0, Math.min(index, changes.length - 1));
  const selected = changes[selectedChangeIndex];
  selectedChangeId = selected.id;
  docEl.querySelectorAll("[data-change-active]").forEach((element) => element.removeAttribute("data-change-active"));
  $("#changeCards").querySelectorAll(".change-card").forEach((card) => card.classList.toggle("active", card.dataset.changeId === selected.id));
  const region = changeRegion(selected);
  if (region) {
    region.dataset.changeActive = "true";
    if (scroll) {
      setChangeMode(true);
      region.scrollIntoView({ block: "center", behavior: "smooth" });
      region.focus({ preventScroll: true });
    }
  }
  $("#changePosition").textContent = `${selectedChangeIndex + 1} of ${changes.length}`;
  $("#changePrevious").disabled = selectedChangeIndex === 0;
  $("#changeNext").disabled = selectedChangeIndex === changes.length - 1;
}

function priorThreadHtml(ids, items, label = "Prior feedback") {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => {
    const root = byId.get(id);
    if (!root) return "";
    const replies = items.filter((item) => item.parentId === id);
    return `<details class="prior-thread"><summary>${escape(label)} <span class="id">${escape(id)}</span></summary>
      <div class="body">${escape(root.text)}</div>
      ${replies.map((reply) => `<div class="reply"><b>${escape(reply.author ?? "?")}</b> ${escape(reply.text)}</div>`).join("")}
    </details>`;
  }).join("");
}

function revealChangeContext(index) {
  selectChange(index, { scroll: false });
  setRailView("changes");
  setRailOpen(true);
  const card = $("#changeCards").querySelectorAll(".change-card")[index];
  if (!card) return;
  card.querySelector("details")?.setAttribute("open", "");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function applyRenderedChanges(changeSet) {
  docEl.querySelectorAll("[data-change-id], [data-change-stable], [data-semantic-change]").forEach((element) => {
    element.removeAttribute("data-change-id");
    element.removeAttribute("data-change-kind");
    element.removeAttribute("data-change-label");
    element.removeAttribute("data-change-stable");
    element.removeAttribute("data-change-collapsed");
    element.removeAttribute("data-semantic-change");
    element.removeAttribute("data-change-active");
  });
  docEl.querySelectorAll(".change-tombstone").forEach((element) => element.remove());
  docEl.querySelectorAll(".change-context-link").forEach((element) => element.remove());
  docEl.querySelectorAll(".unchanged-run-toggle").forEach((element) => element.remove());
  docEl.querySelectorAll(".unchanged-run-anchor").forEach((element) => element.remove());

  const stable = new Set(changeSet.unchangedAfterBlockIds);
  const changeLabel = (kind) => ({ modified: "Modified", added: "Added", moved: "Moved", removed: "Removed" })[kind] ?? "Changed";
  for (const element of docEl.querySelectorAll(":scope > [data-bid]")) {
    if (stable.has(element.dataset.bid)) element.dataset.changeStable = "true";
  }
  for (const [changeIndex, change] of changeSet.changes.entries()) {
    if (change.after) {
      const element = docEl.querySelector(`:scope > [data-bid="${CSS.escape(change.after.blockId)}"]`);
      if (!element) continue;
      element.dataset.changeId = change.id;
      element.dataset.changeKind = change.kind;
      element.dataset.changeLabel = changeLabel(change.kind);
      element.setAttribute("tabindex", "-1");
      for (const semantic of change.semanticChanges) {
        const object = element.querySelector(`[data-myd-target="${CSS.escape(semantic.id)}"]`);
        if (object) object.dataset.semanticChange = "true";
      }
      const contextLink = document.createElement("button");
      contextLink.type = "button";
      contextLink.className = "change-context-link";
      contextLink.textContent = `${changeLabel(change.kind)} · Review context`;
      contextLink.onclick = () => revealChangeContext(changeIndex);
      docEl.insertBefore(contextLink, element);
      continue;
    }
    const tombstone = document.createElement("section");
    tombstone.className = "change-tombstone";
    tombstone.dataset.changeId = change.id;
    tombstone.dataset.changeKind = "removed";
    tombstone.tabIndex = -1;
    const label = document.createElement("strong");
    label.textContent = `Removed · ${change.summary}`;
    const contextLink = document.createElement("button");
    contextLink.type = "button";
    contextLink.className = "link";
    contextLink.textContent = "Review context";
    contextLink.onclick = () => revealChangeContext(changeIndex);
    const details = document.createElement("details");
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "Show removed content";
    const source = document.createElement("pre");
    source.textContent = change.before?.source ?? "";
    details.append(detailsSummary, source);
    tombstone.append(label, contextLink, details);
    const insertionTarget = change.insertBeforeBlockId
      ? docEl.querySelector(`:scope > [data-bid="${CSS.escape(change.insertBeforeBlockId)}"]`)
      : null;
    docEl.insertBefore(tombstone, insertionTarget);
  }

  let stableRun = [];
  const finishStableRun = () => {
    if (stableRun.length < 3) { stableRun = []; return; }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "unchanged-run-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const run = [...stableRun];
    stableRun = [];
    const setExpanded = (expanded) => {
      for (const element of run) element.dataset.changeCollapsed = String(!expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? `Hide ${run.length} unchanged regions` : `Show ${run.length} unchanged regions`;
    };
    setExpanded(false);
    toggle.onclick = () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      for (const element of run) element.dataset.changeCollapsed = String(expanded);
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? `Show ${run.length} unchanged regions` : `Hide ${run.length} unchanged regions`;
    };
    docEl.insertBefore(toggle, run[0]);
    const positionAnchor = document.createElement("span");
    positionAnchor.className = "unchanged-run-anchor";
    positionAnchor.dataset.changePositionAnchor = "true";
    positionAnchor.setAttribute("aria-hidden", "true");
    run.at(-1).after(positionAnchor);
  };
  for (const element of docEl.querySelectorAll(":scope > [data-bid]")) {
    if (element.dataset.changeStable === "true") stableRun.push(element);
    else finishStableRun();
  }
  finishStableRun();
}

function renderChangeCards(data) {
  const changes = data.changeSet.changes;
  $("#changeCards").innerHTML = changes.map((change) => {
    const semantic = change.semanticChanges.map((field) => `${field.id}.${field.field}`).join(", ");
    const contextItemIds = change.contextItemIds ?? [];
    const attribution = change.priorItemIds.length
      ? ` · ${change.priorItemIds.map(escape).join(", ")}`
      : contextItemIds.length ? " · Other change · prior section context" : " · Other change";
    return `<article class="change-card" data-change-id="${escape(change.id)}">
      <div class="meta"><span class="change-kind ${change.kind}">${escape(change.kind)}</span>${attribution}</div>
      <strong>${escape(change.summary)}</strong>
      ${semantic ? `<div class="semantic-summary">Changed object fields: ${escape(semantic)}</div>` : ""}
      <button class="link change-jump" type="button">Jump to this change</button>
      ${priorThreadHtml(change.priorItemIds, data.priorItems ?? [])}
      ${priorThreadHtml(contextItemIds, data.priorItems ?? [], "Prior section feedback (not attributed)")}
    </article>`;
  }).join("") || "<p class='muted'>No source changes in this revision.</p>";
  $("#changeCards").querySelectorAll(".change-card").forEach((card, index) => {
    card.querySelector(".change-jump").addEventListener("click", () => selectChange(index));
  });
}

function clearReviewChanges() {
  reviewChanges = null;
  selectedChangeIndex = 0;
  selectedChangeId = null;
  changeModePreference = null;
  railView = "comments";
  applyRenderedChanges({ changes: [], unchangedAfterBlockIds: [] });
  $("#changeNavigator").hidden = true;
  $("#railTabs").hidden = true;
  $("#commentsHeading").hidden = false;
  $("#changeCards").hidden = true;
  railEl.hidden = false;
  document.documentElement.dataset.reviewMode = "document";
}

async function loadReviewChanges(documentData, seq) {
  if (!documentData.comparison) {
    clearReviewChanges();
    return false;
  }
  let response;
  try { response = await fetch(`/api/changes?${documentQuery()}&version=${encodeURIComponent(documentData.version)}`); }
  catch { if (seq === loadSeq) clearReviewChanges(); return false; }
  if (!response.ok) { if (seq === loadSeq) clearReviewChanges(); return false; }
  const data = await response.json();
  if (seq !== loadSeq) return false;
  if (!data.available || data.mode !== "review") { clearReviewChanges(); return false; }
  const firstChangeLoad = reviewChanges === null;
  const previousSelectedId = selectedChangeId;
  const previousSelectedIndex = selectedChangeIndex;
  reviewChanges = data;
  if (changeModePreference === null) {
    changeModePreference = true;
    railView = "changes";
  }
  $("#changeNavigator").hidden = false;
  $("#railTabs").hidden = false;
  $("#commentsHeading").hidden = true;
  $("#changeSummary").textContent = `${data.changeSet.changes.length} change${data.changeSet.changes.length === 1 ? "" : "s"} since review ${data.predecessorReviewId}`;
  $("#changeCount").textContent = `(${data.changeSet.changes.length})`;
  applyRenderedChanges(data.changeSet);
  renderChangeCards(data);
  setRailView(railView);
  setChangeMode(changeModePreference);
  const preservedIndex = data.changeSet.changes.findIndex((change) => change.id === previousSelectedId);
  selectChange(preservedIndex >= 0 ? preservedIndex : Math.min(previousSelectedIndex, Math.max(0, data.changeSet.changes.length - 1)), { scroll: firstChangeLoad });
  return firstChangeLoad && data.changeSet.changes.length > 0;
}

$("#changePrevious").onclick = () => selectChange(selectedChangeIndex - 1);
$("#changeNext").onclick = () => selectChange(selectedChangeIndex + 1);
$("#changeModeToggle").onclick = () => setChangeMode(!changeModePreference);
$("#changeSourceDiff").onclick = () => $("#changesBtn").click();
$("#changeTab").onclick = () => setRailView("changes");
$("#commentTab").onclick = () => setRailView("comments");

// ---------- rail ----------
function renderRail() {
  const replyState = new Map([...railEl.querySelectorAll(".replyForm")].map((form) => {
    const input = form.querySelector("input");
    return [form.dataset.id, {
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      focused: input === document.activeElement,
    }];
  }));
  const showResolved = $("#showResolved").checked;
  const roots = state.items.filter((i) => i.kind !== "reply" && (showResolved || i.status !== "resolved"));
  const replies = (id) => state.items.filter((i) => i.kind === "reply" && i.parentId === id);
  $("#count").textContent = roots.length ? `(${roots.length})` : "";
  $("#countFallback").textContent = roots.length ? `(${roots.length})` : "";
  railEl.innerHTML = roots.map((it) => {
    const anchor = it.anchorText ?? it.originalText ?? "";
    const objAnchor = it.anchor ? `<span class="obj-tag">${escape(it.anchor.target ? `${it.anchor.block} › ${it.anchor.target}` : it.anchor.block)}</span>` : "";
    const objQuote = it.anchor?.quote ? `<div class="anchor">“${escape(it.anchor.quote.slice(0, 160))}”</div>` : "";
    const sug = it.kind === "suggestion" ? `<div class="sug"><del>${escape(it.originalText ?? "")}</del> → <ins>${escape(it.replacementText ?? "")}</ins></div>` : "";
    return `<div class="thread ${it.status === "resolved" ? "resolved" : ""}" data-id="${it.id}">
      <div class="meta"><b>${escape(it.author ?? "?")}</b> <span class="id">${it.id}</span> ${objAnchor}<span class="spacer"></span>${it.status !== "resolved" ? `<button class="link" data-resolve="${it.id}">resolve</button>` : "<span class='id'>resolved</span>"}</div>
      ${anchor && !it.anchor ? `<div class="anchor">“${escape(anchor.slice(0, 120))}”</div>` : ""}${objQuote}
      ${sug}${it.kind === "suggestion" && it.text === it.replacementText ? "" : `<div class="body">${escape(it.text)}</div>`}
      ${replies(it.id).map((r) => `<div class="reply"><b>${escape(r.author ?? "?")}</b> ${escape(r.text)}</div>`).join("")}
      <form class="replyForm" data-id="${it.id}"><input placeholder="Reply…"><button class="link">send</button></form>
    </div>`;
  }).join("") || "<p class='muted'>Select text to comment or suggest. Click 💬 on a diagram or a diagram node to comment on it.</p>";
  railEl.querySelectorAll(".thread").forEach((t) => t.addEventListener("click", (e) => { if (e.target.closest("form,button")) return; scrollToItem(t.dataset.id); }));
  railEl.querySelectorAll("[data-resolve]").forEach((b) => b.onclick = async () => { await fetch("/api/resolve", { method: "POST", body: JSON.stringify({ ...documentRef(), version: state.version, id: b.dataset.resolve, by: "user" }) }); });
  railEl.querySelectorAll(".replyForm").forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const input = f.querySelector("input"); const m = input.value.trim(); if (!m) return; const response = await fetch("/api/reply", { method: "POST", body: JSON.stringify({ ...documentRef(), version: state.version, id: f.dataset.id, message: m, by: "user" }) }); const currentForm = [...railEl.querySelectorAll(".replyForm")].find((form) => form.dataset.id === f.dataset.id); const currentInput = currentForm?.querySelector("input"); if (response.ok && currentInput?.value.trim() === m) currentInput.value = ""; });
  updateWriteControls();
  for (const form of railEl.querySelectorAll(".replyForm")) {
    const saved = replyState.get(form.dataset.id); if (!saved) continue;
    const input = form.querySelector("input"); input.value = saved.value;
    if (saved.focused) { input.focus({ preventScroll: true }); input.setSelectionRange(saved.selectionStart, saved.selectionEnd); }
  }
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

// ---------- revision comparison ----------
$("#changesBtn").onclick = async () => {
  const button = $("#changesBtn");
  button.disabled = true;
  try {
    const response = await fetch(`/api/changes?${documentQuery()}&version=${encodeURIComponent(state.version)}`);
    if (!response.ok) return;
    const data = await response.json();
    if (!data.available) { button.hidden = true; return; }

    $("#changesMeta").textContent = `r${data.before.number} → r${data.after.number}`;
    const body = $("#changesBody");
    body.replaceChildren();
    if (!data.hunks.length) {
      const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No textual changes."; body.appendChild(empty);
    }
    for (const hunk of data.hunks) {
      const section = document.createElement("section"); section.className = "diff-hunk";
      const heading = document.createElement("div"); heading.className = "diff-hunk-heading";
      heading.textContent = `−${hunk.beforeStart}  +${hunk.afterStart}`;
      section.appendChild(heading);
      for (const line of hunk.lines) {
        const row = document.createElement(line.kind === "added" ? "ins" : line.kind === "removed" ? "del" : "div");
        row.className = `diff-line ${line.kind}`;
        row.textContent = line.text || " ";
        section.appendChild(row);
      }
      body.appendChild(section);
    }
    $("#changesDlg").showModal();
  } finally {
    button.disabled = false;
  }
};
$("#changesClose").onclick = () => $("#changesDlg").close();

// ---------- done ----------
$("#doneBtn").onclick = () => {
  if (!reviewStatus?.tracked) return;
  $("#doneDlg").showModal();
  $("#doneNote").focus();
};
$("#doneDlg").addEventListener("keydown", (event) => {
  if (!isModifiedEnterShortcut(event)) return;
  event.preventDefault();
  $("#doneDlg").close("ok");
});
$("#doneDlg").addEventListener("close", async () => {
  if ($("#doneDlg").returnValue !== "ok") return;
  const r = await fetch("/api/done", { method: "POST", body: JSON.stringify({ ...documentRef(), version: state.version, note: $("#doneNote").value, by: "user" }) });
  if (!r.ok) { await checkTracking(); return; }
  const data = await r.json();
  $("#doneNote").value = ""; statusEl.textContent = "sent ✓";
  applyReviewStatus(data.tracking);
});

// ---------- live ----------
function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${documentQuery()}`);
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    const m = JSON.parse(e.data);
    if (m.type === "changed") load();
    if (m.type === "done" || m.type === "tracking-changed") checkTracking();
  };
  ws.onclose = () => setTimeout(connect, 1000);
  setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
}
const trackingTimer = setInterval(checkTracking, 15000);
window.addEventListener("focus", checkTracking);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkTracking(); });
window.addEventListener("pagehide", () => clearInterval(trackingTimer));
resolveReviewRoute().then((resolved) => {
  if (!resolved) return;
  connect();
  load();
});
