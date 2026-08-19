// Issue #5: `myd view` must be usable by a reviewer on another device — a public URL
// instead of localhost, and no desktop browser launched on the server's machine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "cli.ts");
const PUBLIC_URL = "https://review.example.test";
let root: string;
let fakeBin: string;
let launchLog: string;
const homes: Array<{ home: string; port: string }> = [];

/** A stand-in for the desktop browser launcher, so "no browser ran" is an observation. */
function installFakeBrowserLauncher() {
  fakeBin = path.join(root, "bin");
  launchLog = path.join(root, "launched.log");
  fs.mkdirSync(fakeBin, { recursive: true });
  const shim = path.join(fakeBin, "xdg-open");
  fs.writeFileSync(shim, `#!/bin/sh\necho "$1" >> ${JSON.stringify(launchLog)}\n`);
  fs.chmodSync(shim, 0o755);
}
function launches(): string[] {
  return fs.existsSync(launchLog) ? fs.readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean) : [];
}

/** An isolated myd instance, so these cases never touch the developer's own server. */
function instance(port: string) {
  const home = path.join(root, `state-${port}`);
  fs.mkdirSync(home, { recursive: true });
  homes.push({ home, port });
  return home;
}
async function myd(env: Record<string, string>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, MYD_NO_OPEN: "", ...env },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
function fixture(name: string) {
  const file = path.join(root, name);
  fs.writeFileSync(file, "# Remote\n\nA paragraph to review.\n");
  return file;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-remote-"));
  installFakeBrowserLauncher();
});
afterAll(async () => {
  for (const { home, port } of homes) await myd({ MYD_HOME: home, MYD_PORT: port }, "stop");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("myd view with a public origin configured", () => {
  test("prints that origin's review URL, launches no browser, and says so under --json", async () => {
    const home = instance("7621");
    const env = { MYD_HOME: home, MYD_PORT: "7621", MYD_PUBLIC_URL: PUBLIC_URL };
    const before = launches().length;

    const result = await myd(env, "view", fixture("remote.md"), "--json");
    expect(result.exitCode).toBe(0);
    const view = JSON.parse(result.stdout);

    expect(view.remote).toBe(true);
    expect(view.publicUrl).toBe(PUBLIC_URL);
    expect(view.url).toBe(`${PUBLIC_URL}/review/${encodeURIComponent(view.reviewId)}`);
    // The reviewer's URL carries an opaque id, never a server-side file path.
    expect(view.url).not.toContain(root);
    expect(view.url).not.toContain("path=");
    // Not merely absent from this run: the launcher is on PATH and stayed unused.
    expect(launches().length).toBe(before);
  }, 20_000);

  test("keeps the origin for later calls in a shell that does not set it", async () => {
    const home = instance("7622");
    const started = { MYD_HOME: home, MYD_PORT: "7622", MYD_PUBLIC_URL: PUBLIC_URL };
    await myd(started, "view", fixture("first.md"), "--json");

    // Remote review is a property of the deployment: the server recorded the origin.
    const state = JSON.parse(fs.readFileSync(path.join(home, "server.json"), "utf8"));
    expect(state.publicUrl).toBe(PUBLIC_URL);

    const later = await myd({ MYD_HOME: home, MYD_PORT: "7622" }, "view", fixture("second.md"), "--json");
    expect(JSON.parse(later.stdout).url).toStartWith(`${PUBLIC_URL}/review/`);

    const status = await myd({ MYD_HOME: home, MYD_PORT: "7622" }, "status");
    expect(status.stdout).toContain(`public review origin ${PUBLIC_URL}`);
  }, 20_000);

  test("an empty MYD_PUBLIC_URL takes one call back to local", async () => {
    const home = instance("7623");
    await myd({ MYD_HOME: home, MYD_PORT: "7623", MYD_PUBLIC_URL: PUBLIC_URL }, "view", fixture("deployed.md"), "--json");

    const local = await myd({ MYD_HOME: home, MYD_PORT: "7623", MYD_PUBLIC_URL: "" }, "view", fixture("local-again.md"), "--json", "--no-open");
    const view = JSON.parse(local.stdout);
    expect(view.remote).toBe(false);
    expect(view.url).toStartWith("http://localhost:7623/review/");
  }, 20_000);

  test("a public URL myd cannot honour fails loudly instead of printing a broken link", async () => {
    const home = instance("7624");
    const result = await myd({ MYD_HOME: home, MYD_PORT: "7624", MYD_PUBLIC_URL: `${PUBLIC_URL}/sub` }, "view", fixture("rejected.md"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without a path prefix");
    expect(result.stdout).not.toContain("review");
  }, 20_000);
});

describe("without a public origin", () => {
  test("the local default is unchanged, and the browser launcher still runs", async () => {
    const home = instance("7625");
    const env = { MYD_HOME: home, MYD_PORT: "7625" };
    const before = launches().length;

    const result = await myd(env, "view", fixture("local.md"), "--json");
    const view = JSON.parse(result.stdout);
    expect(view.remote).toBe(false);
    expect(view.url).toBe(`http://localhost:7625/review/${encodeURIComponent(view.reviewId)}`);

    // The positive control for the case above: this shim does fire when myd opens a browser.
    expect(launches().length).toBe(before + 1);
    expect(launches().at(-1)).toBe(view.url);
  }, 20_000);
});
