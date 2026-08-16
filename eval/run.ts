#!/usr/bin/env bun
// Golden-case runner: `bun eval/run.ts <case-id|all> [--agent claude|codex|both] [--keep]`
// Runs a fresh headless agent session per (case, agent) with the user's real global instructions,
// plays the scripted human journey against the myd API, and scores named expectations.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dir, "..");
const CASES = path.join(ROOT, "eval/cases");
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const which = argv[0] ?? "all";
const agentSel = flag("agent") ?? "claude";
const OUT = path.join(os.homedir(), "tmp/myd-eval");
const TIMEOUT = Number(flag("timeout") ?? 600) * 1000;
// Isolated myd instance for evals: own state dir + port, browser never opened. Never touches the user's server on 7474.
const EVAL_HOME = path.join(OUT, ".myd-home"); const EVAL_PORT = Number(flag("port") ?? 7575);
const EVAL_ENV = { ...process.env, MYD_HOME: EVAL_HOME, MYD_PORT: String(EVAL_PORT), MYD_NO_OPEN: "1" };

type Case = { id: string; title: string; agents: string[]; prompt: string; fixture?: string; journey: Array<{ on: string; do: any[] }>; expect: Array<string | Record<string, any>> };
type Tool = { name: string; s: string; extra?: any };

// ---------- log parsing (claude stream-json | codex --json) ----------
function parseTools(log: string): Tool[] {
  const out: Tool[] = []; const seenIds = new Set<string>();
  for (const line of log.split("\n")) {
    let ev: any; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "item.started" && ev.item?.type === "command_execution") { seenIds.add(ev.item.id); const m = /^\/bin\/bash -lc '([\s\S]*)'$/.exec(ev.item.command ?? ""); out.push({ name: "Bash", s: m ? m[1]! : ev.item.command ?? "" }); continue; }
    if (ev.type === "item.completed") {
      const it = ev.item ?? {};
      if (it.type === "command_execution" && seenIds.has(it.id)) continue;
      if (it.type === "command_execution") { const m = /^\/bin\/bash -lc '([\s\S]*)'$/.exec(it.command ?? ""); out.push({ name: "Bash", s: m ? m[1]! : it.command ?? "" }); }
      else if (it.type === "file_change") for (const ch of it.changes ?? []) out.push({ name: ch.kind === "add" || ch.kind === "create" ? "Write" : "Edit", s: ch.path ?? "" });
      else if (it.type === "agent_message") out.push({ name: "TEXT", s: it.text ?? "" });
      continue;
    }
    if (ev.type !== "assistant") continue;
    for (const c of ev.message?.content ?? []) {
      if (c.type === "tool_use") {
        const i = c.input ?? {};
        if (c.name === "Bash") out.push({ name: "Bash", s: i.command ?? "" });
        else if (c.name === "Edit") out.push({ name: "Edit", s: i.file_path ?? "", extra: i.old_string ?? "" });
        else if (c.name === "Write" || c.name === "Read") out.push({ name: c.name, s: i.file_path ?? "" });
        else if (c.name === "Skill") out.push({ name: "Skill", s: i.skill ?? "" });
        else out.push({ name: c.name, s: JSON.stringify(i).slice(0, 200) });
      } else if (c.type === "text" && c.text?.trim()) out.push({ name: "TEXT", s: c.text });
    }
  }
  return out;
}
const isViewWait = (t: Tool) => t.name === "Bash" && /myd view .*--wait/.test(t.s);

// ---------- myd API (the simulated human) ----------
async function serverPort() { return EVAL_PORT; }
async function ensureEvalServer() {
  try { const r = await fetch(`http://localhost:${EVAL_PORT}/api/health`, { signal: AbortSignal.timeout(500) }); if (r.ok) return; } catch {}
  fs.mkdirSync(EVAL_HOME, { recursive: true });
  const child = spawn(process.execPath, [path.join(ROOT, "src/server.ts")], { env: EVAL_ENV, detached: true, stdio: "ignore" }); child.unref();
  for (let i = 0; i < 40; i++) { await Bun.sleep(100); try { const r = await fetch(`http://localhost:${EVAL_PORT}/api/health`); if (r.ok) return; } catch {} }
  throw new Error("could not start eval myd server");
}
async function api(p: string, body?: any) {
  const port = await serverPort();
  const r = await fetch(`http://localhost:${port}${p}`, body ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } } : undefined);
  const txt = await r.text(); try { return { ok: r.ok, data: JSON.parse(txt) }; } catch { return { ok: r.ok, data: txt }; }
}
async function doc(file: string) { return (await api(`/api/doc?path=${encodeURIComponent(file)}`)).data; }
function nthParagraph(html: string, n: number) {
  const re = /<p data-pos="(\d+-\d+)"[^>]*>([\s\S]*?)<\/p>/g; let m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(html))) { if (++i === n) return { pos: m[1]!, text: m[2]!.replace(/<[^>]+>/g, "") }; }
  return null;
}
// The server tracks reviews by id (myd view → POST /api/track). Headless, there is no human tab, so the
// simulator opens its own review on the path (superseding the agent's, which nothing is looking at) and
// acts under that id. `done` is path-scoped, so the agent's `--wait` still resolves.
const reviewIds = new Map<string, string>();
async function reviewId(file: string) {
  if (!reviewIds.has(file)) { const r = await api("/api/track", { path: file }); if (r.ok && r.data?.reviewId) reviewIds.set(file, r.data.reviewId); }
  return reviewIds.get(file);
}
async function act(file: string, a: any, log: (s: string) => void) {
  const rid = await reviewId(file);
  const d = await doc(file);
  if (a.annotate) { const p = nthParagraph(d.html, a.annotate.paragraph ?? 1); if (!p) return log("no paragraph"); const anchor = p.text.split(/\s+/).slice(0, a.annotate.words ?? 5).join(" "); const r = await api("/api/annotate", { path: file, reviewId: rid, version: d.version, blockPos: p.pos, anchorText: anchor, prefix: "", kind: "comment", body: a.annotate.body, by: "user" }); log(`annotate "${anchor}" → ${r.ok}`); }
  if (a.suggest) { const p = nthParagraph(d.html, a.suggest.paragraph ?? 1); if (!p) return log("no paragraph"); const anchor = p.text.split(/\s+/).slice(0, a.suggest.words ?? 4).join(" "); const r = await api("/api/annotate", { path: file, reviewId: rid, version: d.version, blockPos: p.pos, anchorText: anchor, prefix: "", kind: "suggestion", replacement: a.suggest.replacement, note: a.suggest.note, by: "user" }); log(`suggest "${anchor}"→"${a.suggest.replacement}" → ${r.ok}`); }
  if (a.object) { const r = await api("/api/annotate-object", { path: file, reviewId: rid, version: d.version, bid: a.object.block, target: a.object.target, body: a.object.body, by: "user" }); log(`object ${a.object.block}›${a.object.target} → ${r.ok} ${JSON.stringify(r.data).slice(0, 80)}`); }
  if (a.reply) { const r = await api("/api/reply", { path: file, reviewId: rid, id: a.reply.to, message: a.reply.body, by: "user" }); log(`reply→${a.reply.to} → ${r.ok}`); }
  if (a.done !== undefined) { const r = await api("/api/done", { path: file, reviewId: rid, note: a.done, by: "user" }); log(`done "${a.done}" → ${r.ok} ${r.ok ? "" : JSON.stringify(r.data)}`); reviewIds.delete(file); }
}

// ---------- checks ----------
type Ctx = { tools: Tool[]; work: string; c: Case; snapshots: Record<number, string> };
const bash = (ctx: Ctx, re: RegExp) => ctx.tools.filter((t) => t.name === "Bash" && re.test(t.s));
const idx = (ctx: Ctx, pred: (t: Tool) => boolean) => ctx.tools.findIndex(pred);
const mdFiles = (ctx: Ctx) => fs.readdirSync(ctx.work).filter((f) => f.endsWith(".md")).map((f) => fs.readFileSync(path.join(ctx.work, f), "utf8"));
const CHECKS: Record<string, (ctx: Ctx, arg?: any) => boolean | "n/a"> = {
  wrote_md: (ctx) => ctx.tools.some((t) => t.name === "Write" && t.s.endsWith(".md")) || bash(ctx, /cat >.*\.md|tee .*\.md/).length > 0,
  view_wait: (ctx) => ctx.tools.some(isViewWait),
  no_roughdraft: (ctx) => bash(ctx, /roughdraft open|rd-open/).length === 0,
  comments_first: (ctx) => { const v = idx(ctx, isViewWait); const c = idx(ctx, (t) => t.name === "Bash" && /myd comments/.test(t.s)); const act = idx(ctx, (t) => (t.name === "Bash" && /myd (reply|resolve|set-block|insert)/.test(t.s)) || (t.name === "Edit" && t.s.endsWith(".md"))); return v >= 0 && c > v && (act < 0 || c < act); },
  reply_or_resolve: (ctx) => bash(ctx, /myd (reply|resolve)/).length > 0,
  no_marker_hand_edit: (ctx) => !ctx.tools.some((t) => t.name === "Edit" && t.s.endsWith(".md") && /\{>>|\{==|\{~~|\{#[cs]\d|^comments:|^\s+c\d+:/m.test(t.extra ?? "")),
  reopen_after_handling: (ctx) => { const a = idx(ctx, (t) => t.name === "Bash" && /myd (reply|resolve|set-block|insert)/.test(t.s)); return a >= 0 && ctx.tools.slice(a + 1).some(isViewWait); },
  guidance_consulted: (ctx) => ctx.tools.some((t) => t.name === "Skill" && /myd/.test(t.s)) || bash(ctx, /myd (help|guide)/).length > 0,
  no_ascii_diagram: (ctx) => !ctx.tools.some((t) => t.name === "TEXT" && /(\+-{3,}\+|┌|──►|─┐|│.*│.*│)/.test(t.s)),
  mermaid_in_doc: (ctx) => mdFiles(ctx).some((s) => /```mermaid/.test(s)),
  asked_in_thread: (ctx) => bash(ctx, /myd reply .*\?/).length > 0,
  // replied on c1 with a question, or edited the block conservatively (no invented figures) and replied on c1
  asked_or_hedged_in_thread: (ctx) => bash(ctx, /myd reply .* c1 .*\?/).length > 0 || (bash(ctx, /myd reply .* c1 /).length > 0 && CHECKS.doc_not_fabricated!(ctx) === true),
  // body of the doc as it stood after the agent's first pass (snapshot taken at wait 2, before the user's answer), endmatter and inline comments stripped
  doc_not_fabricated: (ctx) => { const s = (ctx.snapshots[2] ?? ctx.snapshots[1] ?? "").split(/\n---\n(?=comments:|suggestions:)/)[0]!; return !/\$\s?\d{2,}|\d+\s?%/.test(s.replace(/\{>>[\s\S]*?<<\}/g, "")); },
  resolved: (ctx, id) => mdFiles(ctx).some((s) => new RegExp(`\\n  ${id}:\\n(?:    [^\\n]*\\n)*?    status: resolved`).test(s)),
  suggestion_handled: (ctx) => { const s = mdFiles(ctx)[0] ?? ""; const applied = /Our CI spend has roughly doubled/.test(s.replace(/\{~~[\s\S]*?~~\}/g, "")); const declined = bash(ctx, /myd reply .* s1 /).length > 0; return applied || declined; },
  block_edited: (ctx, name) => { const before = ctx.snapshots[0] ?? ""; const after = mdFiles(ctx)[0] ?? ""; const grab = (s: string) => (new RegExp("```mermaid \\{#" + name + "\\}[\\s\\S]*?```").exec(s) ?? [""])[0]; return grab(before) !== grab(after) || bash(ctx, /myd reply .* c1 /).length > 0; },
};

// ---------- run one (case, agent) ----------
async function runOne(c: Case, agent: string) {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const work = path.join(OUT, `${agent}-${c.id}-${stamp}`); fs.mkdirSync(work, { recursive: true });
  const snapshots: Record<number, string> = {};
  if (c.fixture) { fs.copyFileSync(path.join(ROOT, "eval/fixtures", c.fixture), path.join(work, c.fixture)); snapshots[0] = fs.readFileSync(path.join(work, c.fixture), "utf8"); }
  const prompt = c.prompt.replace(/__WORK__/g, work).trim();
  const logPath = path.join(work, "session.log"), simPath = path.join(work, "sim.log");
  const simLog = (s: string) => fs.appendFileSync(simPath, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
  const args = agent === "claude"
    ? ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--max-turns", "40", "--allowedTools", "Bash,Read,Write,Edit,Skill,Glob,Grep"]
    : ["codex", "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-c", "shell_environment_policy.inherit=all", "-C", work, prompt];
  const logFd = fs.openSync(logPath, "w");
  const child = spawn(args[0]!, args.slice(1), { cwd: work, env: EVAL_ENV, stdio: ["ignore", logFd, fs.openSync(path.join(work, "stderr.log"), "w")] });
  let done = false; child.on("exit", () => { done = true; });
  const killer = setTimeout(() => { try { child.kill(); } catch {} }, TIMEOUT);
  // human simulator
  let seen = 0;
  while (!done) {
    await Bun.sleep(3000);
    const tools = parseTools(fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "");
    const waits = tools.filter(isViewWait);
    if (waits.length > seen) {
      seen = waits.length; await Bun.sleep(6000);
      const m = /myd view "?([^" ]+)/.exec(waits[seen - 1]!.s); let file = m ? m[1]! : "";
      if (!path.isAbsolute(file)) file = path.join(work, file);
      simLog(`wait #${seen} on ${file}`);
      const step = c.journey.find((j) => j.on === `wait ${seen}`);
      if (fs.existsSync(file)) snapshots[seen] = fs.readFileSync(file, "utf8");
      if (!step) { simLog("no journey step; posting done"); await act(file, { done: "Done." }, simLog); continue; }
      for (const a of step.do) { try { await act(file, a, simLog); } catch (e: any) { simLog(`ERR ${e.message}`); } await Bun.sleep(500); }
    }
  }
  clearTimeout(killer);
  const tools = parseTools(fs.readFileSync(logPath, "utf8"));
  fs.writeFileSync(path.join(work, "tools.txt"), tools.map((t) => `${t.name.padEnd(6)} ${t.s.replace(/\n/g, " ⏎ ").slice(0, 400)}`).join("\n"));
  const ctx: Ctx = { tools, work, c, snapshots };
  const results = c.expect.map((e) => { const [name, arg] = typeof e === "string" ? [e, undefined] : Object.entries(e)[0]!; let ok: any; try { ok = CHECKS[name] ? CHECKS[name]!(ctx, arg) : "unknown"; } catch { ok = false; } return { name: arg ? `${name}:${arg}` : name, ok }; });
  const report = [`case=${c.id} agent=${agent} work=${work}`, ...results.map((r) => `${r.ok === true ? "PASS" : r.ok === "n/a" ? "N/A " : "FAIL"} ${r.name}`), "--- sim ---", fs.existsSync(simPath) ? fs.readFileSync(simPath, "utf8") : ""].join("\n");
  fs.writeFileSync(path.join(work, "report.txt"), report);
  return { c, agent, work, results };
}

// ---------- main ----------
const files = fs.readdirSync(CASES).filter((f) => f.endsWith(".yaml"));
const cases: Case[] = files.map((f) => parseYaml(fs.readFileSync(path.join(CASES, f), "utf8")));
const selected = which === "all" ? cases : cases.filter((c) => c.id === which);
if (!selected.length) { console.error(`no case ${which}; have: ${cases.map((c) => c.id).join(", ")}`); process.exit(2); }
const agents = agentSel === "both" ? ["claude", "codex"] : [agentSel];
const jobs = selected.flatMap((c) => agents.filter((a) => c.agents.includes(a)).map((a) => ({ c, a })));
await ensureEvalServer();
console.error(`eval myd server on :${EVAL_PORT} (MYD_HOME=${EVAL_HOME}); browsers suppressed`);
console.error(`running ${jobs.length} job(s): ${jobs.map((j) => `${j.a}/${j.c.id}`).join(", ")}`);
const results = await Promise.all(jobs.map((j) => runOne(j.c, j.a)));
// matrix
const names = [...new Set(results.flatMap((r) => r.results.map((x) => x.name)))];
const W = Math.max(...names.map((n) => n.length)) + 1;
console.log("check".padEnd(W) + results.map((r) => `${r.agent[0]}/${r.c.id}`.slice(0, 18).padEnd(19)).join(""));
for (const n of names) console.log(n.padEnd(W) + results.map((r) => { const x = r.results.find((y) => y.name === n); return (x ? x.ok === true ? "PASS" : x.ok === "n/a" ? "n/a" : "FAIL" : "-").padEnd(19); }).join(""));
const fails = results.flatMap((r) => r.results.filter((x) => x.ok === false).map((x) => `${r.agent}/${r.c.id}: ${x.name}  (${r.work})`));
console.log(fails.length ? `\n${fails.length} failing:\n  ` + fails.join("\n  ") : "\nall green");
process.exit(fails.length ? 1 : 0);
