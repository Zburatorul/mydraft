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
const out = (o: unknown, human?: string) => console.log(JSON_OUT ? JSON.stringify(o, null, 2) : (human ?? JSON.stringify(o, null, 2)));
const die = (m: string, code = 1) => { console.error(m); process.exit(code); };
const abs = (p?: string) => { if (!p) die("missing <file.md>"); const a = path.resolve(p!); if (!fs.existsSync(a)) die(`no such file: ${a}`); return a; };

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
function docUrl(port: number, file: string) { return `http://localhost:${port}/?path=${encodeURIComponent(file)}`; }
function openBrowser(url: string) { try { spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref(); } catch {} }

async function waitDone(port: number, file: string, timeoutSec?: number): Promise<any> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?path=${encodeURIComponent(file)}`);
    const t = timeoutSec ? setTimeout(() => { ws.close(); res({ timedOut: true }); }, timeoutSec * 1000) : null;
    const ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 20000);
    ws.onmessage = (e) => { if (e.data === "pong") return; const m = JSON.parse(String(e.data)); if (m.type === "done") { clearInterval(ping); if (t) clearTimeout(t); ws.close(); res(m); } };
    ws.onerror = (e) => { clearInterval(ping); rej(e); };
  });
}

function blocksOf(file: string) {
  const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
  return { doc, blocks: topBlocks(doc) };
}

const HELP = `myd — Markdown viewer + annotations + agent CLI

  myd view <file.md> [--wait] [--no-open]   open in the viewer (starts server); --wait blocks until Done Reviewing
  myd wait <file.md> [--timeout S]          block until the user clicks Done Reviewing
  myd comments <file.md> [--all]            pending review items (comments/suggestions/replies) as JSON
  myd reply <file.md> <id> <message>        append a reply (by AI)
  myd resolve <file.md> <id> [--summary S]  mark an item resolved
  myd blocks <file.md>                      list blocks with ids, types, offsets
  myd block <file.md> <id>                  print one block's source
  myd set-block <file.md> <id> [--file F]   replace a block's source with stdin (or --file)
  myd insert <file.md> <id> [--file F]      insert stdin after block <id> (--before to insert before)
  myd shot <file.md> [out.png] [--width W]  screenshot the rendered document (headless Chrome)
  myd export <file.md> [out.html]           single self-contained HTML (delivery artifact)
  myd diff <old.md> <new.md> [out.md]       CriticMarkup diff between two versions
  myd serve                                 run the server in the foreground
  myd status | stop
Flags: --json for machine output.`;

switch (cmd) {
  case undefined: case "help": case "--help": console.log(HELP); break;
  case "serve": { const { startServer } = await import("./server.ts"); const s = startServer(Number(process.env.MYD_PORT ?? 7474)); console.log(`myd server on http://localhost:${s.port}`); break; }
  case "status": { const s = await serverAlive(); out(s ?? { running: false }, s ? `running on port ${s.port} (pid ${s.pid})` : "not running"); break; }
  case "stop": { const s = await serverAlive(); if (s) { try { process.kill(s.pid); } catch {} } out({ stopped: !!s }, s ? "stopped" : "not running"); break; }
  case "view": {
    const file = abs(pos[0]); const { port } = await ensureServer(); const url = docUrl(port, file);
    if (!flags["no-open"]) openBrowser(url);
    if (!flags.wait) { out({ url }, url); break; }
    console.error(url); console.error("Waiting for Done Reviewing…");
    const ev = await waitDone(port, file, flags.timeout ? Number(flags.timeout) : undefined);
    out(ev, ev.timedOut ? "timed out" : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`);
    if (ev.timedOut) process.exit(1); break;
  }
  case "wait": { const file = abs(pos[0]); const { port } = await ensureServer(); const ev = await waitDone(port, file, flags.timeout ? Number(flags.timeout) : undefined); out(ev, ev.timedOut ? "timed out" : `Review completed for ${file}${ev.note ? `\nNote: ${ev.note}` : ""}`); if (ev.timedOut) process.exit(1); break; }
  case "comments": {
    const file = abs(pos[0]); const doc = loadDoc(file, fs.readFileSync(file, "utf8"));
    const items = flags.all ? doc.items : doc.items.filter((i) => i.status !== "resolved");
    const slim = items.map(({ id, kind, suggestionKind, parentId, author, text, anchorText, originalText, replacementText, status, line, anchor }) => ({ id, kind, suggestionKind, parentId, author, status, line, anchorText, originalText, replacementText, anchor, text }));
    out({ path: file, version: doc.version, items: slim }, slim.map((i) => `${i.id} [${i.kind}${i.parentId ? `→${i.parentId}` : ""}] ${i.author ?? "?"} L${i.line}${i.anchorText ? ` “${i.anchorText.slice(0, 60)}”` : ""}${i.anchor ? ` @${i.anchor.block}${i.anchor.target ? "›" + i.anchor.target : ""}` : ""}\n    ${i.kind === "suggestion" ? `${i.originalText} → ${i.replacementText}  ` : ""}${i.text}`).join("\n") || "no pending items");
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
  case "diff": { const r = Bun.spawnSync(["python3", path.join(ROOT, "bin/rd-diff"), ...pos], { stdout: "inherit", stderr: "inherit" }); process.exit(r.exitCode); }
  default: die(`unknown command: ${cmd}\n\n${HELP}`);
}
