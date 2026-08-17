import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
let tempDir: string;
let fixture: string;
let server: Bun.Subprocess;
let baseUrl: string;

async function startIsolatedServer() {
  server = Bun.spawn([process.execPath, path.join(ROOT, "src/server.ts")], {
    cwd: ROOT,
    env: { ...process.env, MYD_HOME: path.join(tempDir, "state"), MYD_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!(server.stdout instanceof ReadableStream)) throw new Error("server stdout was not piped");
  const reader = server.stdout.getReader();
  let output = "";
  while (!output.includes("\n")) {
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(5_000).then(() => { throw new Error("Timed out starting server"); }),
    ]);
    if (result.done) throw new Error(`server exited before startup: ${output}`);
    output += new TextDecoder().decode(result.value);
  }
  const port = /localhost:(\d+)/.exec(output)?.[1];
  if (!port) throw new Error(`Could not read server port from: ${output}`);
  baseUrl = `http://localhost:${port}`;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-server-mutation-"));
  fixture = path.join(tempDir, "fixture.md");
  fs.writeFileSync(fixture, "# A heading\n\nA paragraph.\n");
  await startIsolatedServer();
});

afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("server document mutation seam", () => {
  test("successive API mutations keep emitting changed events after atomic replacement", async () => {
    const trackedResponse = await fetch(`${baseUrl}/api/track`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixture }),
    });
    expect(trackedResponse.status).toBe(200);
    const tracked = await trackedResponse.json() as { reviewId: string; currentVersion: string };
    const initial = await (await fetch(`${baseUrl}/api/doc?path=${encodeURIComponent(fixture)}`)).json() as { version: string; revision: { number: number } };
    const beforeUnversioned = fs.readFileSync(fixture, "utf8");
    const unversioned = await fetch(`${baseUrl}/api/annotate-object`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixture, reviewId: tracked.reviewId, bid: "b0", body: "Must be rejected" }),
    });
    expect(unversioned.status).toBe(400);
    expect(fs.readFileSync(fixture, "utf8")).toBe(beforeUnversioned);

    const events: Array<{ version?: string; revision?: { number: number } }> = [];
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?path=${encodeURIComponent(fixture)}`);
    let nextChanged: ((message: any) => void) | null = null;
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "changed") { events.push(message); nextChanged?.(message); nextChanged = null; }
    };
    const waitForChanged = () => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for changed event")), 5_000);
      nextChanged = (message) => { clearTimeout(timer); resolve(message); };
    });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket failed to open"));
    });

    const firstChanged = waitForChanged();
    const first = await fetch(`${baseUrl}/api/annotate-object`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixture, reviewId: tracked.reviewId, version: initial.version, bid: "b0", body: "First note" }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { version: string; revision: { number: number } };
    await firstChanged;
    const secondChanged = waitForChanged();
    const second = await fetch(`${baseUrl}/api/annotate-object`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixture, reviewId: tracked.reviewId, version: firstBody.version, bid: "b0", body: "Second note" }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { version: string; revision: { number: number } };
    await secondChanged;
    ws.close();

    expect(events.map((event) => event.version)).toEqual([firstBody.version, secondBody.version]);
    expect(events[1]!.revision!.number).toBeGreaterThan(events[0]!.revision!.number);
    const reloaded = await (await fetch(`${baseUrl}/api/doc?path=${encodeURIComponent(fixture)}`)).json() as { version: string; revision: { number: number } };
    expect(reloaded.version).toBe(secondBody.version);
    expect(reloaded.revision.number).toBe(secondBody.revision.number);
  });
});
