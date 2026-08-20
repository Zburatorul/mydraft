#!/usr/bin/env bun
// myd — agent-friendly CLI for the mydraft viewer. Every command supports --json.
import path from "node:path";
import fs from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { STATE_FILE } from "./server.ts";
import { loadDoc, reply as replyDoc, resolve as resolveDoc } from "./doc.ts";
import { DocumentVersionConflict, mutateDocument } from "./document-mutation.ts";
import { topBlocks } from "./render.ts";
import { getSemanticObject, listSemanticObjects, replaceSemanticObject } from "./semantic-objects.ts";
import { InvalidPublicOrigin, normalizePublicOrigin, reviewUrl } from "./public-url.ts";
import { handleViewerUrl, reviewViewerUrl } from "./viewer-url.ts";
import { pathParam } from "./url-path.ts";
import { commandHelp, topLevelHelp, unknownCommand } from "./cli-help.ts";
import { checkDocument, formatDiagnostics, formatReport } from "./check.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); if (v !== undefined) flags[k!] = v; else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) flags[k!] = argv[++i]!; else flags[k!] = true; }
  else pos.push(a);
}
const cmd = pos.shift();
const JSON_OUT = !!flags.json;
const DEFAULT_WAIT_TIMEOUT_SEC = 30 * 60;
const out = (o: unknown, human?: string) => console.log(JSON_OUT ? JSON.stringify(o, null, 2) : (human ?? JSON.stringify(o, null, 2)));
const die = (m: string, code = 1): never => { console.error(m); process.exit(code); };
const mutationError = (error: unknown): never => {
  if (error instanceof DocumentVersionConflict) die(`version mismatch: file is ${error.currentVersion}`, 3);
  return die(error instanceof Error ? error.message : String(error));
};
const abs = (p?: string) => { if (!p) die("missing <file.md>"); const a = path.resolve(p!); if (!fs.existsSync(a)) die(`no such file: ${a}`); return a; };
const waitTimeout = () => {
  if (flags.timeout === undefined) return DEFAULT_WAIT_TIMEOUT_SEC;
  const seconds = Number(flags.timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) die("--timeout must be a positive number of seconds");
  return seconds;
};

/**
 * The origin a reviewer on another device uses, or null for local-only mode.
 * MYD_PUBLIC_URL in this process wins; otherwise whatever the running server recorded,
 * so a remote deployment stays remote for every shell that talks to it.
 */
function publicOriginOf(state: { publicUrl?: string } | null): string | null {
  try { return normalizePublicOrigin(process.env.MYD_PUBLIC_URL ?? state?.publicUrl ?? null); }
  catch (error) { return die(error instanceof InvalidPublicOrigin ? error.message : String(error)); }
}

async function serverAlive(): Promise<{ port: number; pid: number; publicUrl?: string } | null> {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); const r = await fetch(`http://localhost:${s.port}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) return s; } catch {}
  return null;
}
async function ensureServer(): Promise<{ port: number; publicUrl?: string }> {
  const s = await serverAlive(); if (s) return s;
  // Check this process's MYD_PUBLIC_URL before spawning: the server refuses to boot on a
  // bad value, and "could not start myd server" would not say which value was wrong.
  publicOriginOf(null);
  const child = spawn(process.execPath, [path.join(ROOT, "src/server.ts")], { detached: true, stdio: "ignore", env: { ...process.env } });
  child.unref();
  for (let i = 0; i < 40; i++) { await Bun.sleep(100); const a = await serverAlive(); if (a) return a; }
  die("could not start myd server"); return { port: 0 };
}
// One agent session that re-opens the same document is continuing its own review, not
// competing with itself: passing a session lets the backend retire the tab it replaces,
// so the reviewer cannot finish in a stale tab whose completion nobody is waiting on.
// Independent agents keep distinct sessions, so their reviews still coexist (issue #3).
function reviewSession(): string | undefined {
  const explicit = typeof flags.session === "string" ? flags.session.trim() : "";
  if (explicit) return explicit;
  for (const key of ["MYD_SESSION", "CLAUDE_CODE_SESSION_ID"]) {
    const value = process.env[key]?.trim();
    if (value) return `${key}:${value}`;
  }
  return undefined;
}
async function trackReview(port: number, file: string): Promise<{ reviewId: string }> {
  const session = reviewSession();
  const r = await fetch(`http://localhost:${port}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: file, ...(session ? { context: { session } } : {}) }),
  });
  if (!r.ok) die(`could not start review: ${(await r.json().catch(() => ({})))?.error ?? r.statusText}`);
  return r.json() as Promise<{ reviewId: string }>;
}
/**
 * Best-effort desktop launch, reported rather than enforced. By the time this runs the review
 * exists and its URL already works, so a missing or broken launcher — headless boxes, containers,
 * a stripped PATH — must not turn a created review into a failed command (issue #17).
 *
 * `spawn` reports failure asynchronously via an `error` event, so the old synchronous try/catch
 * never saw ENOENT: the unhandled event crashed the CLI *after* it had printed a working URL.
 * Exactly one of `spawn`/`error` fires, both within a few milliseconds, and `unref` is deferred
 * until then so the verdict is delivered before the process can exit.
 */
type BrowserLaunch = { opened: boolean; error?: string };
const LAUNCH_VERDICT_MS = 2000;
function openBrowser(url: string): Promise<BrowserLaunch> {
  if (process.env.MYD_NO_OPEN) return Promise.resolve({ opened: false });
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  let child: ReturnType<typeof spawn>;
  try { child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" }); }
  catch (error) { return Promise.resolve({ opened: false, error: reason(error) }); }
  return new Promise((res) => {
    const settle = (verdict: BrowserLaunch) => { clearTimeout(timer); child.unref(); res(verdict); };
    // Backstop only: no launcher may hold up `myd view`. Silence is not evidence of failure,
    // so an unreported launch counts as opened and raises no warning.
    const timer = setTimeout(() => settle({ opened: true }), LAUNCH_VERDICT_MS);
    child.on("spawn", () => settle({ opened: true }));
    child.on("error", (error) => settle({ opened: false, error: reason(error) }));
  });
}

async function reviewLifecycle(port: number, reviewId: string): Promise<string | null> {
  // No `version` here: we want the record's lifecycle state, not a staleness verdict.
  try {
    const r = await fetch(`http://localhost:${port}/api/tracking?review=${encodeURIComponent(reviewId)}`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? ((await r.json()) as { state: string }).state : null;
  } catch { return null; }
}
async function doneEvent(port: number, reviewId: string): Promise<any | null> {
  try {
    const r = await fetch(`http://localhost:${port}/api/done-events?review=${encodeURIComponent(reviewId)}`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const events = (await r.json()) as any[];
    return events.at(-1) ?? null;
  } catch { return null; }
}
// Subscribes by path so a Done landing on a *different* review of this document is still
// observed, and polls our own record so a review that can no longer be completed ends the
// wait with a reason instead of burning the full timeout in silence.
async function waitDone(port: number, file: string, timeoutSec: number, reviewId?: string): Promise<any> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?path=${pathParam(file)}`);
    const settle = (value: unknown) => { clearInterval(ping); clearInterval(lifecycle); clearTimeout(t); ws.close(); res(value); };
    const t = setTimeout(() => settle({ timedOut: true, timeoutSec }), timeoutSec * 1000);
    const ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
    const lifecycle = setInterval(async () => {
      if (!reviewId) return;
      const state = await reviewLifecycle(port, reviewId);
      if (!state || state === "active") return;
      if (state === "completed") { const ev = await doneEvent(port, reviewId); if (ev) return settle({ type: "done", ...ev }); return; }
      settle({ stopped: state, reviewId });
    }, 5000);
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const m = JSON.parse(String(e.data));
      if (m.type !== "done") return;
      if (!reviewId || m.reviewId === reviewId) return settle(m);
      console.error(`Note: a different review of this document (${m.reviewId}) was completed; still waiting on ${reviewId}.`);
    };
    ws.onerror = (e) => { clearInterval(ping); clearInterval(lifecycle); clearTimeout(t); rej(e); };
  });
}

function blocksOf(file: string) {
  const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
  return { doc, blocks: topBlocks(doc) };
}

// `myd <cmd> --help` and `myd help <cmd>` render the same page; the flag is checked before the
// switch so it never reaches a command that would demand arguments first.
if (flags.help && cmd && cmd !== "help") {
  const page = commandHelp(cmd);
  if (page) { console.log(page); process.exit(0); }
  die(unknownCommand(cmd));
}

switch (cmd) {
  case undefined: case "help": case "--help": {
    if (!pos[0]) { console.log(topLevelHelp()); break; }
    const page = commandHelp(pos[0]!);
    if (!page) die(unknownCommand(pos[0]!));
    console.log(page); break;
  }
  case "install-prompt": {
    const block = fs.readFileSync(path.join(ROOT, "docs/prompt.md"), "utf8").trim();
    const BEGIN = "<!-- myd:begin (managed by `myd install-prompt`; edit ~/LocalDev/mydraft/docs/prompt.md instead) -->", END = "<!-- myd:end -->";
    const home = require("node:os").homedir();
    const targets: string[] = [];
    if (flags.file) targets.push(path.resolve(String(flags.file)));
    else { if (flags.claude || !flags.codex) targets.push(path.join(home, ".claude/CLAUDE.md")); if (flags.codex || !flags.claude) targets.push(path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "AGENTS.md")); }
    const results: any[] = [];
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      const cur = fs.existsSync(t) ? fs.readFileSync(t, "utf8") : "";
      const re = new RegExp(`\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
      const had = re.test(cur);
      let next = cur.replace(re, "\n");
      // also strip a legacy unmanaged block (Roughdraft's, or an earlier hand-written myd block) that starts with a known heading
      next = next.replace(/(^|\n)## (?:Roughdraft|myd — document review[^\n]*|Document review with myd[^\n]*)\n[\s\S]*?(?=\n## (?!myd)|$)/, "$1");
      next = next.replace(/\n{3,}/g, "\n\n").trim();
      if (!flags.remove) next = (next ? next + "\n\n" : "") + `${BEGIN}\n${block}\n${END}\n`; else next = next ? next + "\n" : "";
      const changed = next !== cur;
      if (changed) fs.writeFileSync(t, next);
      results.push({ file: t, action: flags.remove ? (had ? "removed" : "absent") : had ? (changed ? "updated" : "unchanged") : "installed" });
    }
    // skill: symlink the repo's skill/ dir into each agent's skills directory (live-updating)
    const skillSrc = path.join(ROOT, "skill");
    const skillTargets = flags.file ? [] : [ ...((flags.claude || !flags.codex) ? [path.join(home, ".claude/skills/myd")] : []), ...((flags.codex || !flags.claude) ? [path.join(process.env.CODEX_HOME ?? path.join(home, ".codex"), "skills/myd")] : []) ];
    for (const t of skillTargets) {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      const exists = fs.existsSync(t) || (() => { try { fs.lstatSync(t); return true; } catch { return false; } })();
      if (flags.remove) { if (exists) fs.rmSync(t, { recursive: true, force: true }); results.push({ file: t, action: exists ? "removed" : "absent" }); continue; }
      let isLink = false; try { isLink = fs.lstatSync(t).isSymbolicLink() && fs.realpathSync(t) === fs.realpathSync(skillSrc); } catch {}
      if (isLink) { results.push({ file: t, action: "unchanged" }); continue; }
      if (exists) fs.rmSync(t, { recursive: true, force: true });
      fs.symlinkSync(skillSrc, t); results.push({ file: t, action: "linked" });
    }
    out(results, results.map((r) => `${r.action.padEnd(9)} ${r.file}`).join("\n")); break;
  }
  case "guide": {
    const g = fs.readFileSync(path.join(ROOT, "docs/agent-guide.md"), "utf8");
    if (!pos[0]) { console.log(g); break; }
    const VERB_TOPIC: Record<string, string> = { view: "workflow", wait: "workflow", comments: "workflow", reply: "workflow", resolve: "workflow", diff: "workflow", shot: "workflow", blocks: "blocks", block: "blocks", "set-block": "blocks", insert: "blocks", object: "explainers", "set-object": "explainers", explainer: "explainers", export: "export", serve: "api", status: "api", annotate: "objects", comment: "objects", suggest: "objects", markup: "criticmarkup", mermaid: "rich", vega: "rich", html: "rich", math: "rich" };
    if (VERB_TOPIC[pos[0]]) pos[0] = VERB_TOPIC[pos[0]]!;
    const m = new RegExp(`\\n## ${pos[0]}\\b[\\s\\S]*?(?=\\n## |$)`).exec(g);
    if (!m) die(`no topic ${pos[0]}; topics: workflow blocks objects explainers rich criticmarkup export api remote`);
    console.log(m![0].trim()); break;
  }
  case "serve": {
    const { startServer } = await import("./server.ts");
    if (flags["public-url"] === true) die("--public-url requires a URL, e.g. --public-url https://review.example.test");
    let s;
    try { s = startServer(Number(process.env.MYD_PORT ?? 7474), { publicUrl: flags["public-url"] === undefined ? null : String(flags["public-url"]) }); }
    catch (error) { die(error instanceof InvalidPublicOrigin ? error.message : String(error)); break; }
    console.log(`myd server on http://localhost:${s!.port}`);
    if (s!.publicOrigin) console.log(`public review origin ${s!.publicOrigin}`);
    break;
  }
  case "check": {
    const file = abs(pos[0]);
    const report = await checkDocument(file, { mermaid: !flags["no-mermaid"] });
    out(report, formatReport(report));
    if (!report.ok) process.exit(2);
    break;
  }
  case "status": { const s = await serverAlive(); const origin = s ? publicOriginOf(s) : null; out(s ?? { running: false }, s ? `running on port ${s.port} (pid ${s.pid})${origin ? `\npublic review origin ${origin}` : ""}` : "not running"); break; }
  case "stop": { const s = await serverAlive(); if (s) { try { process.kill(s.pid); } catch {} } out({ stopped: !!s }, s ? "stopped" : "not running"); break; }
  case "view": {
    const file = abs(pos[0]);
    // Preflight before the server is even started: a document that cannot open as a coherent
    // review should not become one. Mermaid is left to `myd check` — parsing it costs an order of
    // magnitude more than everything else here, which is the delay issue #22 rules out.
    if (!flags["skip-check"]) {
      const report = await checkDocument(file);
      if (!report.ok) {
        console.error(formatReport(report));
        console.error("\nNo review was created. Fix these, or re-run with --skip-check.");
        process.exit(2);
      }
      if (report.warnings.length) console.error(formatDiagnostics(file, report.warnings));
    }
    const server = await ensureServer(); const { port } = server;
    const origin = publicOriginOf(server);
    const { reviewId } = await trackReview(port, file);
    // Remote mode prints a URL for another machine and never touches a desktop browser:
    // the box running the server is usually not the box doing the reviewing.
    const url = origin ? reviewUrl(origin, reviewId) : reviewViewerUrl(port, reviewId);
    const launch = origin || flags["no-open"] ? { opened: false } as BrowserLaunch : await openBrowser(url);
    if (launch.error) console.error(`Warning: could not open a browser (${launch.error}). The review was created and its URL still works.`);
    const remoteHint = origin ? "\nSend this link to the reviewer; it is also waiting in their Review Inbox." : "";
    // browserOpened/browserError keep "the review exists" separate from "a browser appeared",
    // so automation can tell a real failure from a headless host that merely could not launch one.
    if (!flags.wait) { out({ url, reviewId, remote: !!origin, browserOpened: launch.opened, ...(launch.error ? { browserError: launch.error } : {}), ...(origin ? { publicUrl: origin } : {}) }, url + remoteHint); break; }
    const timeoutSec = waitTimeout();
    console.error(url); if (remoteHint) console.error(remoteHint.trim()); console.error(`Waiting for Done Reviewing… (timeout: ${timeoutSec}s)`);
    const ev = await waitDone(port, file, timeoutSec, reviewId);
    out(ev, ev.timedOut ? "timed out"
      : ev.stopped ? `This review is ${ev.stopped}; nobody can complete it. Open a fresh review with myd view.`
      : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`);
    if (ev.timedOut || ev.stopped) process.exit(1); break;
  }
  case "wait": { const file = abs(pos[0]); const { port } = await ensureServer(); const ev = await waitDone(port, file, waitTimeout()); out(ev, ev.timedOut ? "timed out" : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`); if (ev.timedOut) process.exit(1); break; }
  case "comments": {
    const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
    const resolved = new Set(doc.items.filter((item) => item.status === "resolved").map((item) => item.id));
    const items = flags.all ? doc.items : doc.items.filter((item) => item.status !== "resolved" && (!item.parentId || !resolved.has(item.parentId)));
    const blocks = topBlocks(doc);
    const contextFor = (item: typeof items[number]) => {
      if ((!item.anchorText && !item.originalText) || item.parentId || item.anchor) return undefined;
      const block = blocks.find((candidate) => item.offset >= candidate.start && item.endOffset <= candidate.end);
      const blockStart = block ? doc.origToClean(block.start) : Math.max(0, item.cleanOffset - 100);
      const blockEnd = block ? doc.origToClean(block.end) : Math.min(doc.clean.length, item.cleanEndOffset + 100);
      const from = blockEnd - blockStart <= 280 ? blockStart : Math.max(blockStart, item.cleanOffset - 100);
      const to = blockEnd - blockStart <= 280 ? blockEnd : Math.min(blockEnd, item.cleanEndOffset + 100);
      const snippet = doc.clean.slice(from, to).replace(/\s+/g, " ").trim();
      return `${from > blockStart ? "…" : ""}${snippet}${to < blockEnd ? "…" : ""}`;
    };
    // document-level notes (Done Reviewing notes): a comment with no anchor text, no object anchor, no parent
    const slim = items.map(({ id, kind, suggestionKind, parentId, author, text, anchorText, originalText, replacementText, status, line, anchor }, index) => ({ id, kind: kind === "comment" && !anchorText && !anchor && !parentId ? "note" as const : kind, suggestionKind, parentId, author, status, line, anchorText, originalText, replacementText, anchor, context: contextFor(items[index]!), text }));
    out({ path: file, version: doc.version, items: slim }, slim.map((i) => `${i.id} [${i.kind === "note" ? "note — document-level, from Done Reviewing" : i.kind}${i.parentId ? `→${i.parentId}` : ""}] ${i.author ?? "?"} L${i.line}${i.anchorText ? ` “${i.anchorText.slice(0, 60)}”` : ""}${i.anchor ? ` @${i.anchor.block}${i.anchor.target ? "›" + i.anchor.target : ""}` : ""}\n    ${i.kind === "suggestion" ? `${i.originalText} → ${i.replacementText}  ` : ""}${i.text}${i.context ? `\n    context: ${i.context}` : ""}`).join("\n") + (slim.length ? `\n\nNext: myd reply ${JSON.stringify(file)} <id> "…" (questions for the user go here too) · myd blocks ${JSON.stringify(file)} --json to get the version and positional guard before myd set-block/insert · myd resolve <id> · then hand back: myd view ${JSON.stringify(file)}` : "") || "no pending items");
    break;
  }
  case "reply": {
    const file = abs(pos[0]);
    try {
      const result = mutateDocument(file, (doc) => replyDoc(doc, pos[1]!, pos.slice(2).join(" "), String(flags.by ?? "AI")));
      out({ ok: true, id: pos[1], previousVersion: result.previousVersion, version: result.version }, "replied");
    } catch (error) { mutationError(error); }
    break;
  }
  case "resolve": {
    const file = abs(pos[0]);
    try {
      const result = mutateDocument(file, (doc) => resolveDoc(doc, pos[1]!, String(flags.by ?? "AI"), undefined, flags.summary ? String(flags.summary) : undefined));
      out({ ok: true, id: pos[1], previousVersion: result.previousVersion, version: result.version }, "resolved");
    } catch (error) { mutationError(error); }
    break;
  }
  case "blocks": { const file = abs(pos[0]); const { doc, blocks } = blocksOf(file); out({ path: file, version: doc.version, blocks }, blocks.map((b) => `${b.id.padEnd(16)} ${b.type.padEnd(12)} ${b.guard} ${b.head}`).join("\n")); break; }
  case "block": { const file = abs(pos[0]); const { doc, blocks } = blocksOf(file); const b = blocks.find((x) => x.id === pos[1] || `b${x.index}` === pos[1]); if (!b) die(`no block ${pos[1]}`); const source = doc.body.slice(b!.start, b!.end); if (JSON_OUT) out({ path: file, version: doc.version, block: b, source }); else process.stdout.write(source + "\n"); break; }
  case "objects": {
    const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8")); let objects;
    try { objects = listSemanticObjects(doc); } catch (error) { die(error instanceof Error ? error.message : String(error)); break; }
    out({ path: file, version: doc.version, objects }, objects.map((object) => `${object.ref.padEnd(32)} ${object.kind.padEnd(14)} ${object.path}`).join("\n") || "no semantic objects"); break;
  }
  case "object": {
    const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8")); const object = getSemanticObject(doc, pos[1] ?? "");
    if (!object) die(`no semantic object ${pos[1] ?? ""}`);
    out(object, object!.source); break;
  }
  case "set-object": {
    const file = abs(pos[0]);
    if (!flags.version) die("set-object requires --version from myd objects --json");
    const replacement = flags.file ? fs.readFileSync(String(flags.file), "utf8") : await Bun.stdin.text();
    try {
      const result = mutateDocument(file, (doc) => replaceSemanticObject(doc, pos[1] ?? "", replacement), { expectedVersion: String(flags.version) });
      out({ ok: true, ref: pos[1], previousVersion: result.previousVersion, version: result.version }, `set-object ${pos[1]} ok`);
    } catch (error) { mutationError(error); }
    break;
  }
  case "set-block": case "insert": {
    const file = abs(pos[0]);
    if (!flags.version) die(`${cmd} requires --version from myd blocks --json`);
    const content = (flags.file ? fs.readFileSync(String(flags.file), "utf8") : await Bun.stdin.text()).replace(/\s+$/, "");
    let positional = false;
    try {
      const result = mutateDocument(file, (doc) => {
        const blocks = topBlocks(doc);
        const b = blocks.find((x) => x.id === pos[1] || `b${x.index}` === pos[1]);
        if (!b) throw new Error(`no block ${pos[1]}`);
        positional = !b.name;
        if (positional && !flags.expect) throw new Error(`positional block ${pos[1]} requires --expect <guard> from myd blocks --json; re-list blocks after every mutation`);
        if (positional && flags.expect !== b.guard) throw new Error(`positional block ${pos[1]} no longer matches --expect; re-list blocks before editing again`);
        let body: string;
        if (cmd === "set-block") body = doc.body.slice(0, b.start) + content + doc.body.slice(b.end);
        else if (flags.before) body = doc.body.slice(0, b.start) + content + "\n\n" + doc.body.slice(b.start);
        else body = doc.body.slice(0, b.end) + "\n\n" + content + doc.body.slice(b.end);
        return body + doc.endmatter.raw;
      }, { expectedVersion: String(flags.version) });
      out({ ok: true, block: pos[1], previousVersion: result.previousVersion, version: result.version, relistRequired: positional }, `${cmd} ${pos[1]} ok${positional ? "; re-list blocks before another positional edit" : ""}`);
    } catch (error) { mutationError(error); }
    break;
  }
  case "shot": {
    const file = abs(pos[0]); const { port } = await ensureServer();
    // A handle rather than the path: whatever the file is called, the URL stays plain.
    const handleResponse = await fetch(`http://localhost:${port}/api/handles`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: file }),
    });
    if (!handleResponse.ok) die(`could not prepare ${file} for rendering`);
    const url = handleViewerUrl(port, ((await handleResponse.json()) as { handle: string }).handle);
    const outPng = pos[1] ? path.resolve(pos[1]) : file.replace(/\.md$/, "") + ".png";
    const width = Number(flags.width ?? 1200), height = Number(flags.height ?? 1600);
    const chrome = ["google-chrome", "chromium", "chromium-browser"].find((c) => { try { execFileSync("which", [c], { stdio: "ignore" }); return true; } catch { return false; } });
    if (!chrome) die("no chrome/chromium found");
    const udd = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "myd-chrome-"));
    execFileSync(chrome!, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--user-data-dir=${udd}`, `--window-size=${width},${height}`, "--virtual-time-budget=4000", `--screenshot=${outPng}`, url], { stdio: "ignore" });
    fs.rmSync(udd, { recursive: true, force: true });
    out({ png: outPng }, outPng); break;
  }
  case "export": {
    const file = abs(pos[0]); const { exportHtml } = await import("./export.ts");
    const doc = loadDoc(file, fs.readFileSync(file, "utf8")); const outHtml = pos[1] ? path.resolve(pos[1]) : file.replace(/\.md$/, ".html");
    fs.writeFileSync(outHtml, await exportHtml(doc)); out({ html: outHtml }, outHtml); break;
  }
  case "publish": {
    const file = abs(pos[0]); const { publishDocument } = await import("./publish.ts");
    const result = await publishDocument(file, {
      outputDir: flags["output-dir"] ? path.resolve(String(flags["output-dir"])) : undefined,
      profile: flags.profile ? String(flags.profile) : undefined,
    });
    out(result, `Published ${result.releaseId}\nArtifact: ${result.artifactPath}\nManifest: ${result.manifestPath}`); break;
  }
  case "diff": { const r = Bun.spawnSync(["python3", path.join(ROOT, "bin/rd-diff"), ...pos], { stdout: "inherit", stderr: "inherit" }); process.exit(r.exitCode); }
  default: die(unknownCommand(cmd));
}
