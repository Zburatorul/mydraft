import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 30_000;

let tempDir: string;
let fixture: string;
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
  const port = /localhost:(\d+)/.exec(output)?.[1];
  if (!port) throw new Error(`Could not read server port from: ${output}`);
  baseUrl = `http://localhost:${port}`;
}

async function stopServer() {
  server?.kill();
  if (server) await server.exited;
  server = null;
}

async function postJson(route: string, body: unknown) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function openReviewSocket(reviewId: string) {
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?review=${encodeURIComponent(reviewId)}`);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("WebSocket failed to open"));
  });
  return socket;
}

// Runs the real CLI so the session it sends is covered, not just the tracker that consumes it.
async function runView(doc: string, session: string) {
  const env: Record<string, string> = { ...process.env as Record<string, string>, MYD_HOME: path.join(tempDir, "state"), MYD_NO_OPEN: "1", MYD_SESSION: session };
  delete env.CLAUDE_CODE_SESSION_ID;
  // These tests exercise registry lifecycle, not the structural gate (covered in check.test.ts).
  const cli = Bun.spawn([process.execPath, path.join(ROOT, "src/cli.ts"), "view", doc, "--json", "--no-open", "--skip-check"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(cli.stdout).text();
  expect(await cli.exited).toBe(0);
  return JSON.parse(output) as { url: string; reviewId: string };
}

// Omits `version` on purpose: this asks for the record's lifecycle state, not staleness.
async function trackedState(reviewId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/tracking?review=${encodeURIComponent(reviewId)}`);
  return (await response.json() as { state: string }).state;
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-review-api-"));
  fixture = path.join(tempDir, "plan.md");
  fs.writeFileSync(fixture, "# Launch plan\n\nReview this.\n");
});

afterAll(async () => {
  await stopServer();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("durable review registry API", () => {
  test("coexisting reviews survive restart and open through opaque routes", async () => {
    await startServer();

    const firstResponse = await postJson("/api/reviews", {
      path: fixture,
      title: "Launch plan",
      context: { project: "mydraft", agent: "codex", session: "s1", priority: 2 },
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as { reviewId: string; currentVersion: string };

    const secondResponse = await postJson("/api/reviews", { path: fixture, context: { agent: "claude" } });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as { reviewId: string };
    expect(second.reviewId).not.toBe(first.reviewId);

    const firstRecord = await (await fetch(`${baseUrl}/api/reviews/${encodeURIComponent(first.reviewId)}`)).json() as {
      review: { title: string; context: { project: string; agent: string; session: string; priority: number } };
    };
    expect(firstRecord.review).toMatchObject({
      title: "Launch plan",
      context: { project: "mydraft", agent: "codex", session: "s1", priority: 2 },
    });

    const activeBefore = await (await fetch(`${baseUrl}/api/reviews?status=active`)).json() as { reviews: Array<{ id: string }> };
    expect(activeBefore.reviews.map((review) => review.id)).toEqual([first.reviewId, second.reviewId]);
    const supersededBefore = await fetch(`${baseUrl}/api/reviews?status=superseded`);
    expect(supersededBefore.status).toBe(200);

    const cli = Bun.spawn([process.execPath, path.join(ROOT, "src/cli.ts"), "view", fixture, "--json", "--no-open"], {
      cwd: ROOT,
      env: { ...process.env, MYD_HOME: path.join(tempDir, "state"), MYD_NO_OPEN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const cliOutput = await new Response(cli.stdout).text();
    expect(await cli.exited).toBe(0);
    const viewed = JSON.parse(cliOutput) as { url: string; reviewId: string };
    const viewedUrl = new URL(viewed.url);
    expect(viewedUrl.pathname).toBe(`/review/${viewed.reviewId}`);
    expect(viewedUrl.searchParams.has("path")).toBeFalse();
    await postJson(`/api/reviews/${encodeURIComponent(viewed.reviewId)}/archive`, {});

    const direct = await fetch(`${baseUrl}/review/${encodeURIComponent(first.reviewId)}`);
    expect(direct.status).toBe(200);
    const documentResponse = await fetch(`${baseUrl}/api/doc?review=${encodeURIComponent(first.reviewId)}`);
    expect(documentResponse.status).toBe(200);
    // Addressed by review id, so the document is named but not located.
    const document = await documentResponse.json() as { path?: string; name: string };
    expect(document.path).toBeUndefined();
    expect(document.name).toBe(path.basename(fixture));

    const firstSocket = await openReviewSocket(first.reviewId);
    const secondSocket = await openReviewSocket(second.reviewId);
    let secondReceivedDone = false;
    secondSocket.onmessage = (event) => {
      if (JSON.parse(String(event.data)).type === "done") secondReceivedDone = true;
    };
    const firstReceivedDone = new Promise<void>((resolve) => {
      firstSocket.onmessage = (event) => {
        if (JSON.parse(String(event.data)).type === "done") resolve();
      };
    });
    const completed = await postJson("/api/done", { reviewId: first.reviewId, version: first.currentVersion });
    expect(completed.status).toBe(200);
    await firstReceivedDone;
    await Bun.sleep(100);
    expect(secondReceivedDone).toBeFalse();
    firstSocket.close();
    secondSocket.close();
    await stopServer();
    await startServer();

    const completedAfter = await (await fetch(`${baseUrl}/api/reviews?status=completed`)).json() as { reviews: Array<{ id: string; status: string }> };
    expect(completedAfter.reviews).toEqual([expect.objectContaining({ id: first.reviewId, status: "completed" })]);
    const activeAfter = await (await fetch(`${baseUrl}/api/reviews?status=active`)).json() as { reviews: Array<{ id: string; status: string }> };
    expect(activeAfter.reviews).toEqual([expect.objectContaining({ id: second.reviewId, status: "active" })]);

    const archivedResponse = await postJson(`/api/reviews/${encodeURIComponent(second.reviewId)}/archive`, {});
    expect(archivedResponse.status).toBe(200);
    expect((await archivedResponse.json() as { review: { status: string } }).review.status).toBe("archived");
  }, TEST_TIMEOUT_MS);

  // Regression: `myd view` must send a session, or an earlier tab of the same caller stays
  // live and can complete a review nobody is waiting on while the agent blocks to timeout.
  test("re-viewing a document from one agent session retires that session's earlier review", async () => {
    if (!server) await startServer();
    const doc = path.join(tempDir, "session-scoped.md");
    fs.writeFileSync(doc, "# Session scoped\n\nBody.\n");

    const first = await runView(doc, "agent-A");
    const second = await runView(doc, "agent-A");
    expect(second.reviewId).not.toBe(first.reviewId);

    expect(await trackedState(first.reviewId)).toBe("superseded");
    expect(await trackedState(second.reviewId)).toBe("active");

    const version = (await (await fetch(`${baseUrl}/api/doc?review=${encodeURIComponent(second.reviewId)}`)).json() as { version: string }).version;
    const staleDone = await postJson("/api/done", { reviewId: first.reviewId, version });
    expect(staleDone.status).toBe(409);
  }, TEST_TIMEOUT_MS);

  test("reviews from different agent sessions coexist", async () => {
    if (!server) await startServer();
    const doc = path.join(tempDir, "two-agents.md");
    fs.writeFileSync(doc, "# Two agents\n\nBody.\n");

    const b = await runView(doc, "agent-B");
    const c = await runView(doc, "agent-C");

    expect(await trackedState(b.reviewId)).toBe("active");
    expect(await trackedState(c.reviewId)).toBe("active");
  }, TEST_TIMEOUT_MS);

  test("done events can be filtered to a single review of a shared document", async () => {
    if (!server) await startServer();
    const doc = path.join(tempDir, "done-filter.md");
    fs.writeFileSync(doc, "# Done filter\n\nBody.\n");

    const mine = await runView(doc, "agent-D");
    const theirs = await runView(doc, "agent-E");
    const version = (await (await fetch(`${baseUrl}/api/doc?review=${encodeURIComponent(theirs.reviewId)}`)).json() as { version: string }).version;
    expect((await postJson("/api/done", { reviewId: theirs.reviewId, version })).status).toBe(200);

    const forMine = await (await fetch(`${baseUrl}/api/done-events?review=${encodeURIComponent(mine.reviewId)}`)).json() as unknown[];
    expect(forMine).toEqual([]);
    const forTheirs = await (await fetch(`${baseUrl}/api/done-events?review=${encodeURIComponent(theirs.reviewId)}`)).json() as Array<{ reviewId: string }>;
    expect(forTheirs).toEqual([expect.objectContaining({ reviewId: theirs.reviewId })]);
    const byPath = await (await fetch(`${baseUrl}/api/done-events?path=${encodeURIComponent(doc)}`)).json() as unknown[];
    expect(byPath.length).toBe(1);
  }, TEST_TIMEOUT_MS);
});
