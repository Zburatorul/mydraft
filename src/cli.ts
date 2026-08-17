#!/usr/bin/env bun
// myd — agent-friendly CLI for the mydraft viewer. Every command supports --json.
import path from "node:path";
import fs from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { STATE_FILE } from "./server.ts";
import { loadDoc, reply as replyDoc, resolve as resolveDoc } from "./doc.ts";
import { topBlocks } from "./render.ts";

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
const die = (m: string, code = 1) => { console.error(m); process.exit(code); };
const abs = (p?: string) => { if (!p) die("missing <file.md>"); const a = path.resolve(p!); if (!fs.existsSync(a)) die(`no such file: ${a}`); return a; };
const waitTimeout = () => {
  if (flags.timeout === undefined) return DEFAULT_WAIT_TIMEOUT_SEC;
  const seconds = Number(flags.timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) die("--timeout must be a positive number of seconds");
  return seconds;
};

async function serverAlive(): Promise<{ port: number; pid: number } | null> {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); const r = await fetch(`http://localhost:${s.port}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) return s; } catch {}
  return null;
}
async function ensureServer(): Promise<{ port: number }> {
  const s = await serverAlive(); if (s) return s;
  const child = spawn(process.execPath, [path.join(ROOT, "src/server.ts")], { detached: true, stdio: "ignore", env: { ...process.env } });
  child.unref();
  for (let i = 0; i < 40; i++) { await Bun.sleep(100); const a = await serverAlive(); if (a) return a; }
  die("could not start myd server"); return { port: 0 };
}
async function trackReview(port: number, file: string): Promise<{ reviewId: string }> {
  const r = await fetch(`http://localhost:${port}/api/track`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: file }),
  });
  if (!r.ok) die(`could not start review: ${(await r.json().catch(() => ({})))?.error ?? r.statusText}`);
  return r.json() as Promise<{ reviewId: string }>;
}
function docUrl(port: number, file: string, reviewId?: string) {
  const review = reviewId ? `&review=${encodeURIComponent(reviewId)}` : "";
  return `http://localhost:${port}/?path=${encodeURIComponent(file)}${review}`;
}
function openBrowser(url: string) { if (process.env.MYD_NO_OPEN) return; try { spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref(); } catch {} }

async function waitDone(port: number, file: string, timeoutSec: number): Promise<any> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?path=${encodeURIComponent(file)}`);
    const t = setTimeout(() => { clearInterval(ping); ws.close(); res({ timedOut: true, timeoutSec }); }, timeoutSec * 1000);
    const ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
    ws.onmessage = (e) => { if (e.data === "pong") return; const m = JSON.parse(String(e.data)); if (m.type === "done") { clearInterval(ping); clearTimeout(t); ws.close(); res(m); } };
    ws.onerror = (e) => { clearInterval(ping); clearTimeout(t); rej(e); };
  });
}

function blocksOf(file: string) {
  const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
  return { doc, blocks: topBlocks(doc) };
}

const HELP = `myd — Markdown viewer + annotations + agent CLI

  myd view <file.md> [--wait] [--timeout S] [--no-open]   open and return; --wait is explicit synchronous mode
  myd wait <file.md> [--timeout S]          explicit synchronous wait for Done (maximum default: 1800 seconds)
  myd comments <file.md> [--all]            pending review items (comments/suggestions/replies) as JSON
  myd reply <file.md> <id> <message>        append a reply (by AI)
  myd resolve <file.md> <id> [--summary S]  mark an item resolved
  myd blocks <file.md>                      list blocks with ids, types, offsets
  myd block <file.md> <id>                  print one block's source
  myd set-block <file.md> <id> [--file F]   replace a block's source with stdin (or --file)
  myd insert <file.md> <id> [--file F]      insert stdin after block <id> (--before to insert before)
  myd shot <file.md> [out.png] [--width W]  screenshot the rendered document (headless Chrome)
  myd export <file.md> [out.html]           single self-contained HTML (delivery artifact)
  myd publish <file.md> [--output-dir DIR] [--profile NAME]   immutable release bundle + archive index
  myd diff <old.md> <new.md> [out.md]       CriticMarkup diff between two versions
  myd guide [topic]                         agent guide; topics: workflow blocks objects rich criticmarkup export api
  myd install-prompt [--claude|--codex|--file F] [--remove]   idempotently (re)install the myd block into agent instruction files (default: both)
  myd serve                                 run the server in the foreground
  myd status | stop
Flags: --json for machine output.`;

switch (cmd) {
  case undefined: case "help": case "--help": console.log(HELP); break;
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
    const VERB_TOPIC: Record<string, string> = { view: "workflow", wait: "workflow", comments: "workflow", reply: "workflow", resolve: "workflow", diff: "workflow", shot: "workflow", blocks: "blocks", block: "blocks", "set-block": "blocks", insert: "blocks", export: "export", serve: "api", status: "api", annotate: "objects", comment: "objects", suggest: "objects", markup: "criticmarkup", mermaid: "rich", vega: "rich", html: "rich", math: "rich" };
    if (VERB_TOPIC[pos[0]]) pos[0] = VERB_TOPIC[pos[0]]!;
    const m = new RegExp(`\\n## ${pos[0]}\\b[\\s\\S]*?(?=\\n## |$)`).exec(g);
    if (!m) die(`no topic ${pos[0]}; topics: workflow blocks objects rich criticmarkup export api`);
    console.log(m![0].trim()); break;
  }
  case "serve": { const { startServer } = await import("./server.ts"); const s = startServer(Number(process.env.MYD_PORT ?? 7474)); console.log(`myd server on http://localhost:${s.port}`); break; }
  case "status": { const s = await serverAlive(); out(s ?? { running: false }, s ? `running on port ${s.port} (pid ${s.pid})` : "not running"); break; }
  case "stop": { const s = await serverAlive(); if (s) { try { process.kill(s.pid); } catch {} } out({ stopped: !!s }, s ? "stopped" : "not running"); break; }
  case "view": {
    const file = abs(pos[0]); const { port } = await ensureServer(); const { reviewId } = await trackReview(port, file); const url = docUrl(port, file, reviewId);
    if (!flags["no-open"]) openBrowser(url);
    if (!flags.wait) { out({ url, reviewId }, url); break; }
    const timeoutSec = waitTimeout();
    console.error(url); console.error(`Waiting for Done Reviewing… (timeout: ${timeoutSec}s)`);
    const ev = await waitDone(port, file, timeoutSec);
    out(ev, ev.timedOut ? "timed out" : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`);
    if (ev.timedOut) process.exit(1); break;
  }
  case "wait": { const file = abs(pos[0]); const { port } = await ensureServer(); const ev = await waitDone(port, file, waitTimeout()); out(ev, ev.timedOut ? "timed out" : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`); if (ev.timedOut) process.exit(1); break; }
  case "comments": {
    const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
    const items = flags.all ? doc.items : doc.items.filter((i) => i.status !== "resolved");
    // document-level notes (Done Reviewing notes): a comment with no anchor text, no object anchor, no parent
    const slim = items.map(({ id, kind, suggestionKind, parentId, author, text, anchorText, originalText, replacementText, status, line, anchor }) => ({ id, kind: kind === "comment" && !anchorText && !anchor && !parentId ? "note" as const : kind, suggestionKind, parentId, author, status, line, anchorText, originalText, replacementText, anchor, text }));
    out({ path: file, version: doc.version, items: slim }, slim.map((i) => `${i.id} [${i.kind === "note" ? "note — document-level, from Done Reviewing" : i.kind}${i.parentId ? `→${i.parentId}` : ""}] ${i.author ?? "?"} L${i.line}${i.anchorText ? ` “${i.anchorText.slice(0, 60)}”` : ""}${i.anchor ? ` @${i.anchor.block}${i.anchor.target ? "›" + i.anchor.target : ""}` : ""}\n    ${i.kind === "suggestion" ? `${i.originalText} → ${i.replacementText}  ` : ""}${i.text}`).join("\n") + (slim.length ? `\n\nNext: myd reply ${JSON.stringify(file)} <id> "…" (questions for the user go here too) · myd set-block/insert to edit · myd resolve <id> · then hand back: myd view ${JSON.stringify(file)} --wait` : "") || "no pending items");
    break;
  }
  case "reply": { const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8")); fs.writeFileSync(file, replyDoc(doc, pos[1]!, pos.slice(2).join(" "), String(flags.by ?? "AI"))); out({ ok: true }, "replied"); break; }
  case "resolve": { const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8")); fs.writeFileSync(file, resolveDoc(doc, pos[1]!, String(flags.by ?? "AI"), undefined, flags.summary ? String(flags.summary) : undefined)); out({ ok: true }, "resolved"); break; }
  case "blocks": { const file = abs(pos[0]); const { doc, blocks } = blocksOf(file); out({ path: file, version: doc.version, blocks }, blocks.map((b) => `${b.id.padEnd(16)} ${b.type.padEnd(12)} ${b.head}`).join("\n")); break; }
  case "block": { const file = abs(pos[0]); const { doc, blocks } = blocksOf(file); const b = blocks.find((x) => x.id === pos[1] || `b${x.index}` === pos[1]); if (!b) die(`no block ${pos[1]}`); process.stdout.write(doc.body.slice(b!.start, b!.end) + "\n"); break; }
  case "set-block": case "insert": {
    const file = abs(pos[0]); const { doc, blocks } = blocksOf(file); const b = blocks.find((x) => x.id === pos[1] || `b${x.index}` === pos[1]); if (!b) die(`no block ${pos[1]}`);
    if (flags.version && flags.version !== doc.version) die(`version mismatch: file is ${doc.version}`, 3);
    const content = (flags.file ? fs.readFileSync(String(flags.file), "utf8") : await Bun.stdin.text()).replace(/\s+$/, "");
    let body: string;
    if (cmd === "set-block") body = doc.body.slice(0, b!.start) + content + doc.body.slice(b!.end);
    else if (flags.before) body = doc.body.slice(0, b!.start) + content + "\n\n" + doc.body.slice(b!.start);
    else body = doc.body.slice(0, b!.end) + "\n\n" + content + doc.body.slice(b!.end);
    const next = body + doc.endmatter.raw; fs.writeFileSync(file, next);
    out({ ok: true, version: loadDoc(file, next).version }, `${cmd} ${b!.id} ok`); break;
  }
  case "shot": {
    const file = abs(pos[0]); const { port } = await ensureServer(); const url = docUrl(port, file);
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
  default: die(`unknown command: ${cmd}\n\n${HELP}`);
}
