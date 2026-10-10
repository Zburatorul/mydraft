import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function run(args, home) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, MYD_HOME: home, MYD_PORT: "0", MYD_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, exited, output: () => ({ stdout, stderr }) };
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

test("invalid HTTP and upgrade requests return 400 without stopping the Node server", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-http-"));
  const server = run(["dist/server.js"], home);
  try {
    const url = await new Promise((resolve, reject) => {
      server.child.stdout.on("data", () => {
        const match = /http:\/\/localhost:\d+/.exec(server.output().stdout);
        if (match) resolve(match[0]);
      });
      server.exited.then(() => reject(new Error(server.output().stderr || "Server exited before startup")));
    });
    assert.equal(await request(`${url}/api/health`, { method: "TRACE" }), 400);
    assert.equal(await request(`${url}/api/health`), 200);
    assert.equal(await request(`${url}/ws`, {
      headers: { host: "[", connection: "Upgrade", upgrade: "websocket" },
    }), 400);
    assert.equal(await request(`${url}/api/health`), 200);
  } finally {
    server.child.kill();
    await server.exited;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Done detected during reconnect backoff exits the Node waiter promptly", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-wait-"));
  const file = path.join(home, "doc.md");
  const preload = path.join(home, "disconnected.mjs");
  fs.writeFileSync(file, "# Review\n");
  fs.writeFileSync(path.join(home, "server.json"), JSON.stringify({ port: 1 }));
  // Only the external socket and HTTP responses are simulated; the packaged CLI owns
  // the real retry/poll timers and must release them before its process can exit.
  fs.writeFileSync(preload, `
    globalThis.WebSocket = class {
      constructor() { queueMicrotask(() => this.onclose?.()); }
      send() {}
      close() {}
    };
    globalThis.fetch = async (url) => {
      const route = new URL(url).pathname;
      if (route === "/api/health") return Response.json({ ok: true });
      if (route === "/api/done-events") return Response.json([
        { path: ${JSON.stringify(file)}, at: new Date().toISOString() }
      ]);
      throw new Error("Unexpected route: " + route);
    };
  `);
  const waiter = run(["--import", preload, "bin/myd.js", "wait", file, "--timeout", "0", "--json"], home);
  let completedAt;
  waiter.child.stdout.on("data", () => {
    if (waiter.output().stdout.includes('"done"')) completedAt ??= performance.now();
  });
  try {
    const [code] = await waiter.exited;
    const exitedAt = performance.now();
    assert.equal(code, 0, waiter.output().stderr);
    assert.equal(JSON.parse(waiter.output().stdout).type, "done");
    assert.ok(completedAt !== undefined, "Waiter did not report Done");
    assert.ok(exitedAt - completedAt < 1000, `Waiter lingered ${Math.round(exitedAt - completedAt)}ms after Done`);
  } finally {
    waiter.child.kill();
    await waiter.exited;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
