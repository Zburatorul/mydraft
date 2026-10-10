import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
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

async function startServer(home, preload) {
  const server = run([...(preload ? ["--import", preload] : []), "dist/server.js"], home);
  try {
    server.url = await new Promise((resolve, reject) => {
      server.child.stdout.on("data", () => {
        const match = /http:\/\/localhost:\d+/.exec(server.output().stdout);
        if (match) resolve(match[0]);
      });
      server.exited.then(() => reject(new Error(server.output().stderr || "Server exited before startup")));
    });
    return server;
  } catch (error) {
    server.child.kill();
    await server.exited;
    throw error;
  }
}

test("invalid HTTP and upgrade requests return 400 without stopping the Node server", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-http-"));
  const server = await startServer(home);
  try {
    const url = server.url;
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

test("abrupt disconnects from unknown review upgrades do not stop the server", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-reset-"));
  const server = await startServer(home);
  const { hostname, port } = new URL(server.url);
  try {
    // Reset after the request is written, while the asynchronous upgrade route is
    // deciding how to reject the stale review. Repeat to exercise the write/RST race.
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 20 }, () => new Promise((resolve) => {
        const socket = net.connect(Number(port), hostname, () => {
          socket.write("GET /ws?review=missing-review HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", () => socket.resetAndDestroy());
        });
        socket.on("error", () => socket.destroy());
        socket.on("close", resolve);
      })));
      assert.equal(await request(`${server.url}/api/health`), 200, server.output().stderr);
    }
  } finally {
    server.child.kill();
    await server.exited;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a file-watch failure closes the accepted WebSocket with 1011", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-watch-"));
  const file = path.join(home, "doc.md");
  const preload = path.join(home, "watch-failure.mjs");
  fs.writeFileSync(file, "# Review\n");
  // A deterministic equivalent of a permissions error or exhausted inotify quota.
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    fs.watch = () => { throw Object.assign(new Error("watch-limit probe"), { code: "ENOSPC" }); };
  `);
  const server = await startServer(home, preload);
  try {
    const ws = new WebSocket(`${server.url.replace("http", "ws")}/ws?path=${encodeURIComponent(file)}`);
    const errors = [];
    const closeCode = await new Promise((resolve) => {
      ws.onerror = (event) => errors.push(event);
      ws.onclose = (event) => resolve(event.code);
    });
    assert.equal(closeCode, 1011, "Watch failures must use WebSocket close frames after the 101 response");
    assert.equal(errors.length, 0, "The accepted connection received invalid WebSocket data");
    assert.match(server.output().stderr, /watch-limit probe/);
    assert.equal(await request(`${server.url}/api/health`), 200);
  } finally {
    server.child.kill();
    await server.exited;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("response failures after parsing return a logged 500", { timeout: 15000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "myd-node-response-"));
  const preload = path.join(home, "response-failure.mjs");
  fs.writeFileSync(preload, `
    const read = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function () {
      if (this.headers.get("content-type") === "application/json") throw new Error("response-body probe");
      return read.call(this);
    };
  `);
  const server = await startServer(home, preload);
  try {
    assert.equal(await request(`${server.url}/api/health`), 500);
    assert.match(server.output().stderr, /response-body probe/);
    assert.equal(await request(`${server.url}/web/style.css`), 200);
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
