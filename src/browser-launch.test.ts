// Issue #17: creating a review and launching a desktop browser are two outcomes, not one.
// `myd view` may run where no launcher exists — headless boxes, containers, a stripped PATH —
// and the printed URL is usable regardless, so a launch failure must never be reported as a
// failed review creation.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "cli.ts");
let root: string;
let launchLog: string;
const homes: Array<{ home: string; port: string }> = [];

/** A launcher directory whose `xdg-open` behaves however the case under test needs. */
function launcherDir(name: string, script: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, "xdg-open");
  fs.writeFileSync(shim, script);
  fs.chmodSync(shim, 0o755);
  return dir;
}
function launches(): string[] {
  return fs.existsSync(launchLog) ? fs.readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean) : [];
}

function instance(port: string) {
  const home = path.join(root, `state-${port}`);
  fs.mkdirSync(home, { recursive: true });
  homes.push({ home, port });
  return home;
}
/**
 * `pathDir` replaces PATH entirely rather than prefixing it, so "no launcher on this machine"
 * is the real condition and not a shim pretending to be one. The CLI reaches its server through
 * process.execPath, which is absolute, so nothing else depends on PATH here.
 */
async function myd(pathDir: string, env: Record<string, string>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PATH: pathDir, MYD_NO_OPEN: "", ...env },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
function fixture(name: string) {
  const file = path.join(root, name);
  fs.writeFileSync(file, "# Launch\n\nA paragraph to review.\n");
  return file;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-launch-"));
  launchLog = path.join(root, "launched.log");
});
afterAll(async () => {
  const empty = path.join(root, "empty-path");
  fs.mkdirSync(empty, { recursive: true });
  for (const { home, port } of homes) await myd(empty, { MYD_HOME: home, MYD_PORT: port }, "stop");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("myd view when the desktop browser cannot be launched", () => {
  test("a missing launcher leaves the review successful and the URL printed", async () => {
    const noLauncher = path.join(root, "no-launcher");
    fs.mkdirSync(noLauncher, { recursive: true });
    const home = instance("7631");
    const result = await myd(noLauncher, { MYD_HOME: home, MYD_PORT: "7631" }, "view", fixture("headless.md"), "--json");

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.reviewId).toBeTruthy();
    expect(payload.url).toContain(payload.reviewId);
    // The two outcomes are reported separately: the review exists, the browser does not.
    expect(payload.browserOpened).toBe(false);
    expect(payload.browserError).toContain("xdg-open");
    expect(result.stderr).toContain("Warning: could not open a browser");
    expect(result.stderr).toContain("still works");
  });

  test("a working launcher is reported as opened and actually invoked with the review URL", async () => {
    const working = launcherDir("working", `#!/bin/sh\necho "$1" >> ${JSON.stringify(launchLog)}\n`);
    const home = instance("7632");
    const result = await myd(working, { MYD_HOME: home, MYD_PORT: "7632" }, "view", fixture("desktop.md"), "--json");

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.browserOpened).toBe(true);
    expect(payload).not.toHaveProperty("browserError");
    expect(result.stderr).not.toContain("Warning: could not open a browser");
    expect(launches()).toContain(payload.url);
  });

  test("a launcher that starts and then fails does not fail the command", async () => {
    // Deliberate: the launcher is fire-and-forget, so `browserOpened` means the launcher
    // started, not that a window appeared. Waiting for its exit code would block `myd view`
    // behind launchers that live as long as the browser does.
    const failing = launcherDir("failing", "#!/bin/sh\nexit 3\n");
    const home = instance("7633");
    const result = await myd(failing, { MYD_HOME: home, MYD_PORT: "7633" }, "view", fixture("exits-nonzero.md"), "--json");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).browserOpened).toBe(true);
  });

  test("--no-open reports no launch attempt rather than a failure, and runs no launcher", async () => {
    const working = launcherDir("suppressed", `#!/bin/sh\necho "$1" >> ${JSON.stringify(launchLog)}\n`);
    const home = instance("7634");
    const before = launches().length;
    const result = await myd(working, { MYD_HOME: home, MYD_PORT: "7634" }, "view", fixture("suppressed.md"), "--json", "--no-open");

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.browserOpened).toBe(false);
    expect(payload).not.toHaveProperty("browserError");
    expect(launches().length).toBe(before);
  });

  test("server startup failure stays fatal", async () => {
    // The nonfatal path is scoped to the launcher: if the review itself cannot be created,
    // `myd view` must still fail loudly. An unusable public origin is rejected before any spawn.
    const noLauncher = path.join(root, "no-launcher");
    fs.mkdirSync(noLauncher, { recursive: true });
    const home = instance("7635");
    const result = await myd(noLauncher, { MYD_HOME: home, MYD_PORT: "7635", MYD_PUBLIC_URL: "not-a-url" }, "view", fixture("broken-origin.md"), "--json");

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("browserOpened");
  });
});
