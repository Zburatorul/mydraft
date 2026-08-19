// A review id is an opaque handle that may travel to another machine. Everything reachable
// with only that handle is checked here for the one thing it must never carry back: where
// the document lives on the server running myd.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 30_000;

let tempDir: string;
let server: Bun.Subprocess | null = null;
let baseUrl: string;
let fixture: string;

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
const text = async (route: string) => (await fetch(`${baseUrl}${route}`)).text();

async function openReview(file: string, extra: Record<string, unknown> = {}) {
  return await (await post("/api/reviews", { path: file, ...extra })).json() as { reviewId: string; currentVersion: string };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-privacy-"));
  fixture = path.join(tempDir, "quarterly-strategy.md");
  fs.writeFileSync(fixture, "# Strategy\n\nBody text.\n");
  await startServer();
});

afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("a review id never reveals the server-side path", () => {
  test("not through any endpoint a reviewer can reach with only that id", async () => {
    const review = await openReview(fixture, { title: "Quarterly strategy", context: { agent: "codex" } });
    const id = encodeURIComponent(review.reviewId);

    const surfaces = {
      "/api/doc": await text(`/api/doc?review=${id}`),
      "/api/reviews/<id>": await text(`/api/reviews/${id}`),
      "/api/reviews": await text("/api/reviews"),
      "/api/tracking": await text(`/api/tracking?review=${id}`),
      "/review/<id>": await text(`/review/${id}`),
      // The inbox lists every review to whoever can reach the server, reviewers included.
      "/api/inbox": await text("/api/inbox"),
      "/api/inbox?status=all": await text("/api/inbox?status=active,superseded,completed,archived"),
      "/ (inbox page)": await text("/"),
    };
    for (const [surface, body] of Object.entries(surfaces)) {
      expect(`${surface}: ${body.includes(tempDir)}`).toBe(`${surface}: false`);
    }

    // The document is still identified — by name and title, which the reviewer is reading anyway.
    expect((JSON.parse(surfaces["/api/doc"]) as { name: string }).name).toBe("quarterly-strategy.md");
    expect((JSON.parse(surfaces["/api/reviews/<id>"]) as any).review.title).toBe("Quarterly strategy");
    // Still identifiable in the inbox, by title rather than by location.
    expect((JSON.parse(surfaces["/api/inbox"]) as { rows: Array<{ id: string; title: string }> }).rows
      .find((row) => row.id === review.reviewId)?.title).toBe("Quarterly strategy");
  }, TEST_TIMEOUT_MS);

  test("nor through the error raised when the document is gone", async () => {
    const doomed = path.join(tempDir, "deleted-plan.md");
    fs.writeFileSync(doomed, "# Doomed\n");
    const review = await openReview(doomed);
    fs.rmSync(doomed);

    const response = await fetch(`${baseUrl}/api/doc?review=${encodeURIComponent(review.reviewId)}`);
    expect(response.status).toBe(410);
    const body = await response.text();
    expect(body).not.toContain(tempDir);
    expect(body).not.toContain("deleted-plan.md");
  }, TEST_TIMEOUT_MS);

  test("nor when a mutation is attempted against a missing document", async () => {
    const doomed = path.join(tempDir, "vanishing-notes.md");
    fs.writeFileSync(doomed, "# Vanishing\n");
    const review = await openReview(doomed);
    fs.rmSync(doomed);

    const response = await post("/api/reply", { reviewId: review.reviewId, version: review.currentVersion, id: "c1", message: "hi" });
    expect(await response.text()).not.toContain(tempDir);
  }, TEST_TIMEOUT_MS);

  // Local callers are unaffected: they passed the path in, so handing it back reveals nothing,
  // and their error messages stay specific enough to debug.
  test("a caller that supplied the path still gets it back, with a detailed error", async () => {
    const document = await (await fetch(`${baseUrl}/api/doc?path=${encodeURIComponent(fixture)}`)).json() as { path: string; name: string };
    expect(document.path).toBe(fixture);
    expect(document.name).toBe("quarterly-strategy.md");

    const missing = path.join(tempDir, "never-existed.md");
    const response = await fetch(`${baseUrl}/api/doc?path=${encodeURIComponent(missing)}`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("never-existed.md");
  }, TEST_TIMEOUT_MS);
});
