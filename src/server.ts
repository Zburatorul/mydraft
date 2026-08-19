// myd server: renders docs, serves the viewer, applies annotations, pushes change/done events.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadDoc, annotateObject, reply, resolve, type Doc } from "./doc.ts";
import { renderDoc, topBlocks } from "./render.ts";
import { ReviewTracker, type ReviewRecord, type ReviewSnapshot } from "./review-tracker.ts";
import { inboxRow, isDefaultVisible, sortInbox, type InboxRow } from "./review-inbox.ts";
import { RevisionTracker, type RevisionSnapshot } from "./revision-tracker.ts";
import { applySelectionAnnotation } from "./selection-annotation.ts";
import { mutateDocument } from "./document-mutation.ts";
import { normalizePublicOrigin } from "./public-url.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const WEB = path.join(ROOT, "web");
const NM = path.join(ROOT, "node_modules");
export const STATE_DIR = process.env.MYD_HOME ?? path.join(os.homedir(), ".mydraft"); // MYD_HOME + MYD_PORT → an isolated instance (used by eval)
export const STATE_FILE = path.join(STATE_DIR, "server.json");
export const REVISION_FILE = path.join(STATE_DIR, "revisions.json");
export const REVIEW_FILE = path.join(STATE_DIR, "reviews.json");

type Client = { path: string; reviewId: string | null; inbox?: boolean };
const topics = new Map<string, Set<any>>(); // abs path → sockets
const inboxSockets = new Set<any>(); // the inbox spans every document, so it cannot live in `topics`
const watchers = new Map<string, fs.FSWatcher>();
const doneLog: Array<{ path: string; at: string; note?: string }> = [];
const reviewTracker = new ReviewTracker({ initial: loadSnapshot<ReviewSnapshot>(REVIEW_FILE), persist: (snapshot) => saveSnapshot(REVIEW_FILE, snapshot) });
const revisionTracker = new RevisionTracker(loadSnapshot<RevisionSnapshot>(REVISION_FILE), (snapshot) => saveSnapshot(REVISION_FILE, snapshot));

function loadSnapshot<T extends object>(file: string): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {} as T; }
}
function saveSnapshot(file: string, snapshot: object) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(temp, file);
}

function json(data: unknown, status = 400) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json" } });
}
function readDoc(p: string): Doc {
  const abs = path.resolve(p);
  const doc = loadDoc(abs, fs.readFileSync(abs, "utf8"));
  revisionTracker.observe(abs, doc.version, fs.statSync(abs).mtime.toISOString());
  return doc;
}
function writeDoc(doc: Doc, transform: (current: Doc) => string, expectedVersion?: string): Doc {
  const result = mutateDocument(doc.path, transform, expectedVersion === undefined ? {} : { expectedVersion });
  const written = result.document;
  revisionTracker.observe(doc.path, written.version);
  reviewTracker.advance(doc.path, written.version);
  return written;
}
function broadcast(p: string, msg: unknown) {
  for (const ws of topics.get(path.resolve(p)) ?? []) { try { ws.send(JSON.stringify(msg)); } catch {} }
}
function broadcastReview(p: string, reviewId: string, msg: unknown) {
  for (const ws of topics.get(path.resolve(p)) ?? []) {
    if (ws.data.reviewId !== null && ws.data.reviewId !== reviewId) continue;
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
}
function notifyInbox() {
  for (const ws of inboxSockets) { try { ws.send(JSON.stringify({ type: "reviews-changed" })); } catch {} }
}
function ensureWatch(abs: string) {
  if (watchers.has(abs)) return;
  let t: Timer | null = null;
  const dir = path.dirname(abs);
  const basename = path.basename(abs);
  const w = fs.watch(dir, (_event, filename) => {
    // Bun/Linux can report only creation of the atomic-write temporary file,
    // rather than the subsequent rename over `basename`.
    const name = filename ? String(filename) : null;
    if (name && name !== basename && !name.startsWith(`.${basename}.`)) return;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      try {
        const doc = readDoc(abs);
        reviewTracker.advance(abs, doc.version);
        broadcast(abs, { type: "changed", version: doc.version, revision: revisionTracker.current(abs) });
        notifyInbox();
      } catch {
        broadcast(abs, { type: "changed" });
      }
    }, 120);
  });
  watchers.set(abs, w);
}
function requireMutationVersion(v: unknown) {
  if (typeof v !== "string" || !v.trim()) {
    throw Object.assign(new Error("A document version is required for this mutation."), { status: 400 });
  }
}
function requireTrackedReview(doc: Doc, reviewId: unknown, version: unknown) {
  const status = reviewTracker.status(doc.path, typeof reviewId === "string" ? reviewId : null, typeof version === "string" ? version : null);
  if (!status.tracked) throw Object.assign(new Error(`This review is ${status.state}. Open a fresh review with myd view.`), { status: 409 });
}
function requireReview(reviewId: unknown): ReviewRecord {
  const review = typeof reviewId === "string" ? reviewTracker.get(reviewId) : null;
  if (!review) throw Object.assign(new Error("Review not found."), { status: 404 });
  return review;
}
function requestedDocumentPath(documentPath: unknown, reviewId: unknown): string {
  if (typeof reviewId === "string" && reviewId) return requireReview(reviewId).path;
  if (typeof documentPath === "string" && documentPath) return documentPath;
  throw Object.assign(new Error("A document path or review ID is required."), { status: 400 });
}

/** Reading a document can fail (moved, deleted, unreadable); that costs one row its counts,
 *  never the whole inbox, so the reviewer still sees the review and that it went stale. */
function buildInbox(statuses: string[] | null): InboxRow[] {
  const rows = reviewTracker.list()
    .filter((record) => statuses ? statuses.includes(record.status) : isDefaultVisible(record.status))
    .map((record) => {
      try {
        const doc = loadDoc(record.path, fs.readFileSync(record.path, "utf8"));
        return inboxRow(record, { revision: revisionTracker.current(record.path)?.number ?? null, items: doc.items });
      } catch { return inboxRow(record, null); }
    });
  return sortInbox(rows);
}
/** A review is addressed by an opaque id that may travel to another machine, so the record
 *  the API hands back identifies its document by `title` — never by server-side path. */
function publicReview(record: ReviewRecord) {
  const { path: _serverPath, ...shareable } = record;
  return shareable;
}
/** Reading for a caller who supplied only a review id: filesystem errors quote the absolute
 *  path, so they are replaced rather than forwarded. A caller who passed a path keeps the
 *  detailed error, because it cannot tell them anything they did not already know. */
function readDocFor(pathParam: unknown, reviewId: unknown): Doc {
  const resolved = requestedDocumentPath(pathParam, reviewId);
  if (!(typeof reviewId === "string" && reviewId)) return readDoc(resolved);
  try { return readDoc(resolved); }
  catch { throw Object.assign(new Error("This review's document is no longer readable."), { status: 410 }); }
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".map": "application/json" };
function serveFile(base: string, rel: string) {
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(base) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return new Response("not found", { status: 404 });
  return new Response(Bun.file(abs), { headers: { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" } });
}

export function startServer(port = 7474, options: { publicUrl?: string | null } = {}) {
  // Remote review is a property of the deployment, not of a single command: whoever
  // starts the server records the origin, and every later `myd view` reads it back.
  const publicOrigin = normalizePublicOrigin(options.publicUrl ?? process.env.MYD_PUBLIC_URL ?? null);
  const server = Bun.serve<Client>({
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const p = url.pathname;
      try {
        if (p === "/ws") {
          // The inbox watches every review at once, so it subscribes without a document.
          if (url.searchParams.get("inbox")) {
            if (srv.upgrade(req, { data: { path: "", reviewId: null, inbox: true } })) return undefined as any;
            return new Response("upgrade failed", { status: 400 });
          }
          const reviewId = url.searchParams.get("review");
          const docPath = path.resolve(requestedDocumentPath(url.searchParams.get("path"), reviewId));
          if (srv.upgrade(req, { data: { path: docPath, reviewId } })) return undefined as any;
          return new Response("upgrade failed", { status: 400 });
        }
        // A bare root is the inbox; `/?path=…` and `/?review=…` stay the viewer for saved links.
        if (p === "/") return serveFile(WEB, url.searchParams.get("path") || url.searchParams.get("review") ? "index.html" : "inbox.html");
        if (p === "/index.html") return serveFile(WEB, "index.html");
        if (p === "/inbox" || p === "/inbox.html") return serveFile(WEB, "inbox.html");
        const reviewRoute = /^\/review\/([^/]+)$/.exec(p);
        if (reviewRoute) {
          requireReview(decodeURIComponent(reviewRoute[1]!));
          return serveFile(WEB, "index.html");
        }
        if (p.startsWith("/web/")) return serveFile(WEB, p.slice(5));
        if (p.startsWith("/vendor/")) return serveFile(NM, p.slice(8));
        if (p === "/api/health") return json({ ok: true, pid: process.pid, port }, 200);
        // Reviews of one document now coexist, so a path filter alone cannot tell an agent
        // whether the Done it is catching up on belongs to its own review; `review` can.
        if (p === "/api/done-events") { const rid = url.searchParams.get("review"); const dp = url.searchParams.get("path"); const f = path.join(STATE_DIR, "done.log"); const evs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; return json(evs.filter((e) => (!rid || e.reviewId === rid) && (!dp || e.path === path.resolve(dp))), 200); }

        if (req.method === "POST" && (p === "/api/reviews" || p === "/api/track")) {
          const b = await req.json();
          const doc = readDocFor(b.path, b.reviewId);
          ensureWatch(doc.path);
          const status = reviewTracker.track(doc.path, doc.version, {
            title: typeof b.title === "string" ? b.title : undefined,
            context: b.context && typeof b.context === "object" ? b.context : undefined,
          });
          broadcast(doc.path, { type: "tracking-changed" });
          notifyInbox();
          return json({ ...status, review: publicReview(reviewTracker.get(status.reviewId)!), revision: revisionTracker.current(doc.path) }, p === "/api/reviews" ? 201 : 200);
        }
        if (req.method === "GET" && p === "/api/inbox") {
          const requested = url.searchParams.getAll("status").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
          const unknown = requested.filter((v) => !["active", "superseded", "completed", "archived"].includes(v));
          if (unknown.length) return json({ error: `Unknown review status: ${unknown.join(", ")}` }, 400);
          return json({ rows: buildInbox(requested.length ? requested : null) }, 200);
        }
        if (req.method === "GET" && p === "/api/reviews") {
          const requestedStatus = url.searchParams.get("status");
          if (requestedStatus && !["active", "superseded", "completed", "archived"].includes(requestedStatus)) {
            return json({ error: `Unknown review status: ${requestedStatus}` }, 400);
          }
          return json({ reviews: reviewTracker.list(requestedStatus as ReviewRecord["status"] | undefined).map(publicReview) }, 200);
        }
        const reviewApiRoute = /^\/api\/reviews\/([^/]+)$/.exec(p);
        if (req.method === "GET" && reviewApiRoute) {
          const review = requireReview(decodeURIComponent(reviewApiRoute[1]!));
          return json({ review: publicReview(review), revision: revisionTracker.current(review.path) }, 200);
        }
        const archiveRoute = /^\/api\/reviews\/([^/]+)\/archive$/.exec(p);
        if (req.method === "POST" && archiveRoute) {
          const review = reviewTracker.archive(decodeURIComponent(archiveRoute[1]!));
          if (!review) return json({ error: "Review not found." }, 404);
          broadcast(review.path, { type: "tracking-changed" });
          notifyInbox();
          return json({ review: publicReview(review) }, 200);
        }
        if (p === "/api/tracking") {
          const reviewId = url.searchParams.get("review");
          const docPath = path.resolve(requestedDocumentPath(url.searchParams.get("path"), reviewId));
          const status = reviewTracker.status(docPath, reviewId, url.searchParams.get("version"));
          return json({ ...status, revision: revisionTracker.current(docPath) }, 200);
        }

        if (p === "/api/doc") {
          const doc = readDocFor(url.searchParams.get("path"), url.searchParams.get("review"));
          ensureWatch(doc.path);
          if (req.headers.get("accept")?.includes("text/markdown")) return new Response(doc.source, { headers: { "content-type": "text/markdown" } });
          const html = await renderDoc(doc);
          const byPath = !url.searchParams.get("review") && !!url.searchParams.get("path");
          return json({ ...(byPath ? { path: doc.path } : {}), name: path.basename(doc.path), version: doc.version, revision: revisionTracker.current(doc.path), html, items: doc.items, cleanLength: doc.clean.length }, 200);
        }
        if (p === "/api/raw") {
          const doc = readDocFor(url.searchParams.get("path"), url.searchParams.get("review"));
          // serve sibling assets (images) relative to the doc
          const rel = url.searchParams.get("rel") ?? "";
          return serveFile(path.dirname(doc.path), rel);
        }
        if (req.method === "POST" && p === "/api/annotate") {
          const b = await req.json();
          requireMutationVersion(b.version);
          const doc = readDocFor(b.path, b.reviewId);
          let anchorMode: string | undefined;
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            const result = applySelectionAnnotation(current, b);
            if (!result) throw Object.assign(new Error("Could not locate the selected text in the source. Try a shorter selection."), { status: 422 });
            anchorMode = result.anchorMode;
            return result.source;
          }, b.version);
          return json({ ok: true, anchorMode, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/annotate-object") {
          const b = await req.json();
          requireMutationVersion(b.version);
          const doc = readDocFor(b.path, b.reviewId);
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            const blk = topBlocks(current).find((x) => x.id === b.bid || `b${x.index}` === b.bid);
            if (!blk) throw Object.assign(new Error(`no block ${b.bid}`), { status: 404 });
            return annotateObject(current, blk.end, b.body, { block: b.bid, ...(b.target ? { target: b.target } : {}), ...(b.quote ? { quote: String(b.quote).slice(0, 500) } : {}) }, b.by);
          }, b.version);
          return json({ ok: true, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/reply") {
          const b = await req.json();
          const doc = readDocFor(b.path, b.reviewId);
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            return reply(current, b.id, b.message, b.by ?? "user");
          });
          return json({ ok: true, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/resolve") {
          const b = await req.json();
          const doc = readDocFor(b.path, b.reviewId);
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            return resolve(current, b.id, b.by ?? "user", undefined, b.summary);
          });
          return json({ ok: true, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/done") {
          const b = await req.json();
          let doc = readDocFor(b.path, b.reviewId);
          requireTrackedReview(doc, b.reviewId, b.version);
          if (b.note && String(b.note).trim()) {
            const { appendRoughdraftDocumentComment } = await import("../vendor/rfm/index.js") as any;
            doc = writeDoc(doc, (current) => appendRoughdraftDocumentComment(current.source, { message: String(b.note).trim(), author: b.by ?? "user" }));
          }
          const tracking = reviewTracker.complete(doc.path, b.reviewId, doc.version);
          const ev = { path: doc.path, reviewId: String(b.reviewId), at: new Date().toISOString(), note: b.note };
          doneLog.push(ev);
          fs.appendFileSync(path.join(STATE_DIR, "done.log"), JSON.stringify(ev) + "\n");
          broadcastReview(doc.path, ev.reviewId, { type: "done", ...ev });
          notifyInbox();
          return json({ ok: true, tracking }, 200);
        }
        return new Response("not found", { status: 404 });
      } catch (err: any) {
        return json({ error: err?.message ?? String(err), ...(err?.currentVersion ? { currentVersion: err.currentVersion } : {}) }, err?.status ?? 500);
      }
    },
    websocket: {
      open(ws) { if (ws.data.inbox) { inboxSockets.add(ws); return; } const set = topics.get(ws.data.path) ?? new Set(); set.add(ws); topics.set(ws.data.path, set); if (fs.existsSync(ws.data.path)) ensureWatch(ws.data.path); },
      close(ws) { if (ws.data.inbox) { inboxSockets.delete(ws); return; } topics.get(ws.data.path)?.delete(ws); },
      message(ws, msg) { if (String(msg) === "ping") ws.send("pong"); },
    },
  });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port: server.port, pid: process.pid, startedAt: new Date().toISOString(), ...(publicOrigin ? { publicUrl: publicOrigin } : {}) }));
  return Object.assign(server, { publicOrigin });
}

if (import.meta.main) {
  const port = Number(process.env.MYD_PORT ?? 7474);
  const s = startServer(port);
  console.log(`myd server on http://localhost:${s.port}`);
  if (s.publicOrigin) console.log(`public review origin ${s.publicOrigin}`);
}
