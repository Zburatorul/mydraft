// Issue #30: installation must not assume where the checkout lives. install-prompt derives every
// path from the CLI it runs as, and installs a `myd` launcher that points back at that checkout.
// Every case runs against a throwaway HOME so nothing touches the real agent configuration.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "cli.ts");
const ROOT = path.resolve(import.meta.dir, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "myd-install-"));
let home: string;
let n = 0;

beforeEach(() => { home = path.join(tmp, `home-${n++}`); fs.mkdirSync(home, { recursive: true }); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function install(args: string[], opts: { onPath?: boolean } = {}) {
  const bin = path.join(home, ".local/bin");
  const PATH = [...(opts.onPath ? [bin] : []), path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
  const child = Bun.spawn([process.execPath, CLI, "install-prompt", ...args], {
    env: { HOME: home, CODEX_HOME: path.join(home, ".codex"), PATH }, stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr, json: args.includes("--json") ? JSON.parse(stdout) as Array<{ file: string; action: string; warning?: string }> : [] };
}
const launcher = () => path.join(home, ".local/bin/myd");
const actionFor = (rows: Array<{ file: string; action: string }>, file: string) => rows.find((r) => r.file === file)?.action;

describe("install-prompt is location-independent", () => {
  test("the managed block names this checkout, not a developer path", async () => {
    const r = await install(["--claude", "--json"], { onPath: true });
    expect(r.exitCode).toBe(0);
    const md = fs.readFileSync(path.join(home, ".claude/CLAUDE.md"), "utf8");
    expect(md).toContain(`edit ${path.join(ROOT, "docs/prompt.md")} instead`);
    expect(md).not.toContain("LocalDev");
  });

  test("a block installed from another checkout is replaced, not duplicated", async () => {
    const file = path.join(home, "AGENTS.md");
    fs.writeFileSync(file, "# mine\n\n<!-- myd:begin (managed by `myd install-prompt`; edit ~/LocalDev/mydraft/docs/prompt.md instead) -->\nold\n<!-- myd:end -->\n");
    const r = await install(["--file", file, "--json"]);
    expect(actionFor(r.json, file)).toBe("updated");
    const md = fs.readFileSync(file, "utf8");
    expect(md.match(/myd:begin/g)?.length).toBe(1);
    expect(md).not.toContain("LocalDev");
    expect(md).toStartWith("# mine\n");
    // --file installs no launcher
    expect(r.json.some((row) => row.file === launcher())).toBe(false);
  });
});

describe("the myd launcher", () => {
  test("links ~/.local/bin/myd to this checkout's cli.ts, idempotently", async () => {
    const first = await install(["--claude", "--json"], { onPath: true });
    expect(actionFor(first.json, launcher())).toBe("linked");
    expect(fs.realpathSync(launcher())).toBe(fs.realpathSync(CLI));
    expect(fs.readFileSync(CLI, "utf8")).toStartWith("#!/usr/bin/env bun\n");
    expect(fs.statSync(CLI).mode & 0o111).not.toBe(0);
    expect(first.stderr).not.toContain("not on PATH");
    const again = await install(["--claude", "--json"], { onPath: true });
    expect(actionFor(again.json, launcher())).toBe("unchanged");
  });

  test("warns when the bin dir is not on PATH", async () => {
    const r = await install(["--claude", "--json"]);
    expect(actionFor(r.json, launcher())).toBe("linked");
    expect(r.stderr).toContain("is not on PATH");
  });

  test("never clobbers a myd it does not own", async () => {
    fs.mkdirSync(path.dirname(launcher()), { recursive: true });
    fs.writeFileSync(launcher(), "#!/bin/sh\necho someone else\n");
    const r = await install(["--claude", "--json"], { onPath: true });
    expect(actionFor(r.json, launcher())).toBe("skipped");
    expect(r.stderr).toContain("not a myd symlink");
    expect(fs.readFileSync(launcher(), "utf8")).toContain("someone else");
    const removed = await install(["--remove", "--json"]);
    expect(actionFor(removed.json, launcher())).toBe("kept");
    expect(fs.existsSync(launcher())).toBe(true);
  });

  test("relinks a launcher left by a moved checkout", async () => {
    fs.mkdirSync(path.dirname(launcher()), { recursive: true });
    fs.symlinkSync(path.join(tmp, "old-checkout/src/cli.ts"), launcher());
    const r = await install(["--claude", "--json"], { onPath: true });
    expect(actionFor(r.json, launcher())).toBe("relinked");
    expect(fs.realpathSync(launcher())).toBe(fs.realpathSync(CLI));
  });

  test("--bin-dir overrides the location, and --remove only removes our link", async () => {
    const bin = path.join(home, "tools");
    const own = path.join(bin, "myd");
    const r = await install(["--claude", "--bin-dir", bin, "--json"]);
    expect(actionFor(r.json, own)).toBe("linked");
    expect(fs.existsSync(launcher())).toBe(false);
    // a scoped removal keeps the launcher: the other agent may still rely on it
    const scoped = await install(["--remove", "--claude", "--bin-dir", bin, "--json"]);
    expect(actionFor(scoped.json, own)).toBeUndefined();
    expect(fs.existsSync(own)).toBe(true);
    const removed = await install(["--remove", "--bin-dir", bin, "--json"]);
    expect(actionFor(removed.json, own)).toBe("removed");
    expect(fs.existsSync(own)).toBe(false);
  });
});
