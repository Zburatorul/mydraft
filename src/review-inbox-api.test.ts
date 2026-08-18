import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 30_000;

let tempDir: string;
let server: Bun.Subprocess | null = null;
let baseUrl: string;

async function startServer() {
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
  baseUrl = `http://localhost:${/localhost:(\d+)/.exec(output)?.[1]}`;
}

const post = (route: string, body: unknown) => fetch(`${baseUrl}${route}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const inbox = async (query = "") => ((await (await fetch(`${baseUrl}/api/inbox${query}`)).json()) as { rows: any[] }).rows;

function write(name: string, body: string) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, body);
  return file;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-inbox-api-"));
  await startServer();
});

afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("review inbox API", () => {
  test("serves the inbox at the root and the viewer for a document link", async () => {
    const inboxPage = await fetch(`${baseUrl}/`);
    expect(inboxPage.status).toBe(200);
    expect(await inboxPage.text()).toContain('id="inbox"');

    // A saved `/?path=` link predates the inbox and must still open the viewer.
    const viewerPage = await fetch(`${baseUrl}/?path=${encodeURIComponent(write("legacy.md", "# Legacy\n"))}`);
    expect(await viewerPage.text()).toContain('id="doc"');
  }, TEST_TIMEOUT_MS);

  test("lists several agents' reviews with counts, revision and caller context", async () => {
    const doc = write("counts.md", "# Counts\n\nBody text here.\n");
    const mine = await (await post("/api/reviews", { path: doc, title: "Launch plan", context: { agent: "codex", project: "mydraft" } })).json() as any;
    const theirs = await (await post("/api/reviews", { path: write("other.md", "# Other\n"), context: { agent: "claude" } })).json() as any;

    await post("/api/annotate", {
      reviewId: mine.reviewId, version: mine.currentVersion,
      blockPos: `0-${"# Counts".length}`, anchorText: "Counts", body: "needs work", by: "user",
    });

    const rows = await inbox();
    const row = rows.find((r) => r.id === mine.reviewId);
    expect(row).toMatchObject({
      title: "Launch plan", status: "active", agent: "codex", project: "mydraft",
      readable: true, unresolved: { comments: 1, suggestions: 0 },
    });
    expect(row.revision).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).toContain(theirs.reviewId);
  }, TEST_TIMEOUT_MS);

  test("keeps a completed review visible until it is archived", async () => {
    const doc = write("lifecycle.md", "# Lifecycle\n");
    const review = await (await post("/api/reviews", { path: doc })).json() as any;
    const version = ((await (await fetch(`${baseUrl}/api/doc?review=${review.reviewId}`)).json()) as any).version;
    expect((await post("/api/done", { reviewId: review.reviewId, version })).status).toBe(200);

    const afterDone = await inbox();
    expect(afterDone.find((r) => r.id === review.reviewId)).toMatchObject({ status: "completed" });

    expect((await post(`/api/reviews/${review.reviewId}/archive`, {})).status).toBe(200);
    expect((await inbox()).find((r) => r.id === review.reviewId)).toBeUndefined();
    expect((await inbox("?status=archived")).map((r) => r.id)).toContain(review.reviewId);
  }, TEST_TIMEOUT_MS);

  test("pushes a live update when a new review arrives, with no refresh", async () => {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?inbox=1`);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("inbox socket failed to open"));
    });
    const changed = new Promise<void>((resolve) => {
      socket.onmessage = (event) => { if (JSON.parse(String(event.data)).type === "reviews-changed") resolve(); };
    });
    await post("/api/reviews", { path: write("live.md", "# Live\n") });
    await Promise.race([changed, Bun.sleep(5_000).then(() => { throw new Error("no reviews-changed event"); })]);
    socket.close();
  }, TEST_TIMEOUT_MS);

  // A review whose file is gone must not take the rest of the inbox down with it.
  test("reports an unreadable document as a flagged row, not a failed request", async () => {
    const doomed = write("doomed.md", "# Doomed\n");
    const review = await (await post("/api/reviews", { path: doomed })).json() as any;
    fs.rmSync(doomed);

    const rows = await inbox();
    expect(rows.find((r) => r.id === review.reviewId)).toMatchObject({ readable: false, unresolved: null, revision: null });
    expect(rows.length).toBeGreaterThan(1);
  }, TEST_TIMEOUT_MS);

  test("rejects a status filter it does not understand", async () => {
    const response = await fetch(`${baseUrl}/api/inbox?status=nonsense`);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("nonsense");
  }, TEST_TIMEOUT_MS);
});
