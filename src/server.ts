// myd server: renders docs, serves the viewer, applies annotations, pushes change/done events.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadDoc, annotateObject, reply, resolve, type Doc } from "./doc.ts";
import { renderDoc, topBlocks } from "./render.ts";
import { ReviewTracker } from "./review-tracker.ts";
import { RevisionTracker, type RevisionSnapshot } from "./revision-tracker.ts";
import { applySelectionAnnotation } from "./selection-annotation.ts";
import { mutateDocument } from "./document-mutation.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const WEB = path.join(ROOT, "web");
const NM = path.join(ROOT, "node_modules");
export const STATE_DIR = process.env.MYD_HOME ?? path.join(os.homedir(), ".mydraft"); // MYD_HOME + MYD_PORT → an isolated instance (used by eval)
export const STATE_FILE = path.join(STATE_DIR, "server.json");
export const REVISION_FILE = path.join(STATE_DIR, "revisions.json");

type Client = { path: string };
const topics = new Map<string, Set<any>>(); // abs path → sockets
const watchers = new Map<string, fs.FSWatcher>();
const doneLog: Array<{ path: string; at: string; note?: string }> = [];
const reviewTracker = new ReviewTracker();
const revisionTracker = new RevisionTracker(loadRevisionSnapshot(), saveRevisionSnapshot);

function loadRevisionSnapshot(): RevisionSnapshot {
  try { return JSON.parse(fs.readFileSync(REVISION_FILE, "utf8")); } catch { return {}; }
}
function saveRevisionSnapshot(snapshot: RevisionSnapshot) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const temp = `${REVISION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(temp, REVISION_FILE);
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

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".map": "application/json" };
function serveFile(base: string, rel: string) {
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(base) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return new Response("not found", { status: 404 });
  return new Response(Bun.file(abs), { headers: { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" } });
}

export function startServer(port = 7474) {
  const server = Bun.serve<Client>({
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const p = url.pathname;
      try {
        if (p === "/ws") {
          const docPath = path.resolve(url.searchParams.get("path") ?? "");
          if (srv.upgrade(req, { data: { path: docPath } })) return undefined as any;
          return new Response("upgrade failed", { status: 400 });
        }
        if (p === "/" || p === "/index.html") return serveFile(WEB, "index.html");
        if (p.startsWith("/web/")) return serveFile(WEB, p.slice(5));
        if (p.startsWith("/vendor/")) return serveFile(NM, p.slice(8));
        if (p === "/api/health") return json({ ok: true, pid: process.pid, port }, 200);
        if (p === "/api/done-events") { const dp = url.searchParams.get("path"); const f = path.join(STATE_DIR, "done.log"); const evs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; return json(evs.filter((e) => !dp || e.path === path.resolve(dp)), 200); }

        if (req.method === "POST" && p === "/api/track") {
          const b = await req.json();
          const doc = readDoc(b.path);
          ensureWatch(doc.path);
          const status = reviewTracker.track(doc.path, doc.version);
          broadcast(doc.path, { type: "tracking-changed" });
          return json({ ...status, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (p === "/api/tracking") {
          const docPath = path.resolve(url.searchParams.get("path") ?? "");
          const status = reviewTracker.status(docPath, url.searchParams.get("review"), url.searchParams.get("version"));
          return json({ ...status, revision: revisionTracker.current(docPath) }, 200);
        }

        if (p === "/api/doc") {
          const doc = readDoc(url.searchParams.get("path") ?? "");
          ensureWatch(doc.path);
          if (req.headers.get("accept")?.includes("text/markdown")) return new Response(doc.source, { headers: { "content-type": "text/markdown" } });
          const html = await renderDoc(doc);
          return json({ path: doc.path, version: doc.version, revision: revisionTracker.current(doc.path), html, items: doc.items, cleanLength: doc.clean.length }, 200);
        }
        if (p === "/api/raw") {
          const doc = readDoc(url.searchParams.get("path") ?? "");
          // serve sibling assets (images) relative to the doc
          const rel = url.searchParams.get("rel") ?? "";
          return serveFile(path.dirname(doc.path), rel);
        }
        if (req.method === "POST" && p === "/api/annotate") {
          const b = await req.json();
          requireMutationVersion(b.version);
          const doc = readDoc(b.path);
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
          const doc = readDoc(b.path);
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
          const doc = readDoc(b.path);
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            return reply(current, b.id, b.message, b.by ?? "user");
          });
          return json({ ok: true, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/resolve") {
          const b = await req.json();
          const doc = readDoc(b.path);
          const written = writeDoc(doc, (current) => {
            requireTrackedReview(current, b.reviewId, b.version);
            return resolve(current, b.id, b.by ?? "user", undefined, b.summary);
          });
          return json({ ok: true, version: written.version, revision: revisionTracker.current(doc.path) }, 200);
        }
        if (req.method === "POST" && p === "/api/done") {
          const b = await req.json();
          let doc = readDoc(b.path);
          requireTrackedReview(doc, b.reviewId, b.version);
          if (b.note && String(b.note).trim()) {
            const { appendRoughdraftDocumentComment } = await import("../vendor/rfm/index.js") as any;
            doc = writeDoc(doc, (current) => appendRoughdraftDocumentComment(current.source, { message: String(b.note).trim(), author: b.by ?? "user" }));
          }
          const tracking = reviewTracker.complete(doc.path, b.reviewId, doc.version);
          const ev = { path: doc.path, at: new Date().toISOString(), note: b.note };
          doneLog.push(ev);
          fs.appendFileSync(path.join(STATE_DIR, "done.log"), JSON.stringify(ev) + "\n");
          broadcast(doc.path, { type: "done", ...ev });
          return json({ ok: true, tracking }, 200);
        }
        return new Response("not found", { status: 404 });
      } catch (err: any) {
        return json({ error: err?.message ?? String(err), ...(err?.currentVersion ? { currentVersion: err.currentVersion } : {}) }, err?.status ?? 500);
      }
    },
    websocket: {
      open(ws) { const set = topics.get(ws.data.path) ?? new Set(); set.add(ws); topics.set(ws.data.path, set); if (fs.existsSync(ws.data.path)) ensureWatch(ws.data.path); },
      close(ws) { topics.get(ws.data.path)?.delete(ws); },
      message(ws, msg) { if (String(msg) === "ping") ws.send("pong"); },
    },
  });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port: server.port, pid: process.pid, startedAt: new Date().toISOString() }));
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.MYD_PORT ?? 7474);
  const s = startServer(port);
  console.log(`myd server on http://localhost:${s.port}`);
}
