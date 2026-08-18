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
    expect((await documentResponse.json() as { path: string }).path).toBe(fixture);

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
});
