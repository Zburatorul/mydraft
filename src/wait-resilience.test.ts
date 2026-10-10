// An agent that runs `myd view --wait` as a background command only learns about Done when the
// process exits, so the wait must survive a server restart, catch a Done that lands while it is
// disconnected, and say why it exited on every path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "cli.ts");
const PORT = "7693";
let root: string;
let home: string;
let file: string;

const env = () => ({ ...process.env, MYD_HOME: home, MYD_PORT: PORT, MYD_NO_OPEN: "1", MYD_SESSION: "wait-resilience" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function myd(...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe", env: env() });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr };
}
function background(...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe", env: env() });
  const result = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    .then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }));
  return { child, result };
}
function serverPid(): number {
  return JSON.parse(fs.readFileSync(path.join(home, "server.json"), "utf8")).pid;
}
async function killServer() {
  const pid = serverPid();
  process.kill(pid);
  while (true) { try { process.kill(pid, 0); await sleep(50); } catch { return; } }
}
function startServer() {
  Bun.spawn([process.execPath, CLI, "serve"], { stdout: "ignore", stderr: "ignore", env: env() });
  return waitFor(async () => (await fetch(`http://localhost:${PORT}/api/inbox`).catch(() => null))?.ok === true);
}
async function waitFor(check: () => Promise<boolean> | boolean, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw new Error("condition not met in time");
}
async function complete(reviewId: string, note?: string) {
  const doc = await (await fetch(`http://localhost:${PORT}/api/doc?review=${reviewId}`)).json() as { version: string };
  const r = await fetch(`http://localhost:${PORT}/api/done`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId, version: doc.version, ...(note ? { note } : {}) }),
  });
  expect(r.status).toBe(200);
}
async function openReview(): Promise<string> {
  const r = await myd("view", file, "--json");
  expect(r.exitCode).toBe(0);
  return JSON.parse(r.stdout).reviewId;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-wait-"));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  file = path.join(root, "doc.md");
  fs.writeFileSync(file, "# Wait\n\nA paragraph to review.\n");
});
afterAll(async () => {
  await myd("stop");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a background wait", () => {
  test("reconnects after a server restart and still reports Done", async () => {
    // The waiter's stdout is only readable once it exits, so take the review id from the inbox.
    const waiter = background("view", file, "--wait", "--timeout", "0", "--json");
    let reviewId: string | undefined;
    await waitFor(async () => {
      const inbox = await (await fetch(`http://localhost:${PORT}/api/inbox?status=active`).catch(() => null))?.json().catch(() => null) as { rows: Array<{ id: string }> } | null;
      reviewId = inbox?.rows[0]?.id;
      return !!reviewId;
    });

    await killServer();
    await sleep(1500);
    await startServer();
    await complete(reviewId!, "ship it");

    const result = await waiter.result;
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ type: "done", reviewId: reviewId!, note: "ship it" });
    expect(result.stderr).toContain("no timeout");
    expect(result.stderr).toContain("Lost the connection");
  }, 30000);

  test("catches a Done that lands while it is disconnected", async () => {
    const reviewId = await openReview();
    const waiter = background("wait", file, "--timeout", "0", "--json");
    await sleep(1000);
    await killServer();
    // Several failed reconnects push the backoff past the moment Done lands, so only the
    // done-log poll can see it.
    await sleep(4000);
    await startServer();
    await complete(reviewId);

    const result = await waiter.result;
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ type: "done", reviewId });
  }, 30000);

  test("says why when a signal stops it", async () => {
    await openReview();
    const waiter = background("wait", file, "--timeout", "0");
    await sleep(1000);
    waiter.child.kill("SIGTERM");
    const result = await waiter.result;
    expect(result.exitCode).toBe(143);
    expect(result.stderr).toContain("received SIGTERM before Done Reviewing");
  }, 15000);

  test("exits as obsolete when a newer review replaces its own", async () => {
    const waiter = background("view", file, "--wait", "--timeout", "0");
    await sleep(1500);
    await openReview();
    const result = await waiter.result;
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("this wait is obsolete");
  }, 20000);
});
