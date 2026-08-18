import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";

const ROOT = path.resolve(import.meta.dir, "..");
const E2E_TIMEOUT_MS = 30_000;

let browser: Browser;
let server: ReturnType<typeof Bun.spawn>;
let baseUrl: string;
let tempDir: string;

async function startIsolatedServer() {
  server = Bun.spawn([process.execPath, path.join(ROOT, "src/server.ts")], {
    cwd: ROOT,
    env: { ...process.env, MYD_HOME: path.join(tempDir, "state"), MYD_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!(server.stdout instanceof ReadableStream)) throw new Error("Isolated myd server stdout was not piped");
  const reader = server.stdout.getReader();
  let output = "";
  while (!output.includes("\n")) {
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(5_000).then(() => { throw new Error("Timed out starting isolated myd server"); }),
    ]);
    if (result.done) throw new Error(`myd server exited before startup: ${output}`);
    output += new TextDecoder().decode(result.value);
  }
  const port = /localhost:(\d+)/.exec(output)?.[1];
  if (!port) throw new Error(`Could not read myd server port from: ${output}`);
  baseUrl = `http://localhost:${port}`;
}

async function openReview(name: string, body: string, context?: Record<string, unknown>, title?: string) {
  const fixture = path.join(tempDir, name);
  fs.writeFileSync(fixture, body);
  const response = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: fixture, ...(title ? { title } : {}), ...(context ? { context } : {}) }),
  });
  expect(response.status).toBe(201);
  return { fixture, ...(await response.json() as { reviewId: string; currentVersion: string }) };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-inbox-e2e-"));
  await startIsolatedServer();
  const managedBrowserInstalled = fs.existsSync(chromium.executablePath());
  const systemExecutable = Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chromium-browser");
  browser = await chromium.launch({
    ...(!managedBrowserInstalled && systemExecutable ? { executablePath: systemExecutable } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
}, E2E_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  server?.kill();
  await server?.exited;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("review inbox", () => {
  test("lists work from several agents and opens one through its opaque route", async () => {
    const codex = await openReview("codex-plan.md", "# Codex plan\n\nBody.\n", { agent: "codex", project: "mydraft" }, "Codex plan");
    await openReview("claude-notes.md", "# Claude notes\n\nBody.\n", { agent: "claude" }, "Claude notes");

    const page = await browser.newPage();
    await page.goto(baseUrl);
    await page.locator(".inbox-row").first().waitFor();

    expect(await page.locator(".inbox-row").count()).toBe(2);
    const codexRow = page.locator(`.inbox-row[data-id="${codex.reviewId}"]`);
    expect(await codexRow.locator(".inbox-title").textContent()).toBe("Codex plan");
    expect(await codexRow.locator(".inbox-badge").textContent()).toBe("awaiting review");
    const meta = await codexRow.locator(".inbox-meta").textContent();
    expect(meta).toContain("codex");
    expect(meta).toContain("mydraft");

    // The reviewer must never see an absolute server-side path in the inbox or the URL it opens.
    expect(await page.content()).not.toContain(tempDir);
    await codexRow.locator(".inbox-open").click();
    await page.locator("#doc > *").first().waitFor();
    expect(new URL(page.url()).pathname).toBe(`/review/${codex.reviewId}`);
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a review opened by another agent appears without a refresh", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    await page.locator(".inbox-row").first().waitFor();
    const before = await page.locator(".inbox-row").count();

    const late = await openReview("late-arrival.md", "# Late arrival\n\nBody.\n", { agent: "gemini" }, "Late arrival");

    await page.locator(`.inbox-row[data-id="${late.reviewId}"]`).waitFor({ timeout: 10_000 });
    expect(await page.locator(".inbox-row").count()).toBe(before + 1);
    await page.close();
  }, E2E_TIMEOUT_MS);

  // The shared header hides `#bar > .toggle` under 640px. In the viewer that toggle is a
  // convenience; here it is the only route to completed and archived work, so inheriting
  // that rule would strand a phone reviewer with no way to reach them.
  test("the show-all control stays reachable on a narrow screen", async () => {
    const page = await browser.newPage({ viewport: { width: 420, height: 700 } });
    await page.goto(baseUrl);
    await page.locator(".inbox-row").first().waitFor();

    const box = await page.locator("#showAll").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
    await page.locator("#showAll").check(); // throws unless it is genuinely actionable
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTrue();
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a completed review stays visible until the reviewer archives it", async () => {
    const review = await openReview("finished.md", "# Finished\n\nBody.\n", undefined, "Finished");
    const page = await browser.newPage();
    await page.goto(baseUrl);
    const row = page.locator(`.inbox-row[data-id="${review.reviewId}"]`);
    await row.waitFor();

    await fetch(`${baseUrl}/api/done`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: review.reviewId, version: review.currentVersion }),
    });

    // `:text-is` auto-waits, so this asserts the live update rather than racing it.
    await row.locator('.inbox-badge:text-is("completed")').waitFor({ timeout: 10_000 });
    await row.locator("[data-archive]").click();
    await row.waitFor({ state: "detached", timeout: 10_000 });

    // Archived work is not destroyed, just cleared out of the way.
    await page.locator("#showAll").check();
    await page.locator(`.inbox-row[data-id="${review.reviewId}"]`).waitFor({ timeout: 10_000 });
    expect(await page.locator(`.inbox-row[data-id="${review.reviewId}"] .inbox-badge`).textContent()).toBe("archived");
    await page.close();
  }, E2E_TIMEOUT_MS);
});
