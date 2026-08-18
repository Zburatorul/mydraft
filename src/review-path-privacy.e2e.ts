// The viewer used to learn the document's path from the registry and send it back with every
// mutation. It now works from the review id alone, so this drives the whole review loop
// through a real tab and checks that each step lands on disk without the path ever crossing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { loadDoc } from "./doc.ts";

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
  baseUrl = `http://localhost:${/localhost:(\d+)/.exec(output)?.[1]}`;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-privacy-e2e-"));
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
  if (server) await server.exited;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("a review-route tab reviews without ever holding the path", () => {
  test("annotates, replies, resolves and completes, and no response carries the path", async () => {
    const fixture = path.join(tempDir, "roadmap.md");
    fs.writeFileSync(fixture, "Ship the thing carefully.\n");
    const review = await (await fetch(`${baseUrl}/api/reviews`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixture, title: "Roadmap" }),
    })).json() as { reviewId: string };

    const page = await browser.newPage();
    // Every response this tab receives is inspected, not just the ones we thought to check.
    const leaked: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/") && !response.url().includes("/review/")) return;
      try { if ((await response.text()).includes(tempDir)) leaked.push(response.url()); } catch {}
    });

    await page.goto(`${baseUrl}/review/${encodeURIComponent(review.reviewId)}`);
    await page.locator("#doc > *").first().waitFor();
    expect(await page.locator("#title").textContent()).toBe("Roadmap");

    await page.evaluate(() => {
      const node = document.querySelector("#doc p")!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, "Ship the thing".length);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#popover").waitFor({ state: "visible" });
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Which thing?");
    const annotated = page.waitForResponse((r) => r.url().endsWith("/api/annotate") && r.request().method() === "POST");
    await page.locator("#edSave").click();
    expect((await annotated).status()).toBe(200);

    const replied = page.waitForResponse((r) => r.url().endsWith("/api/reply") && r.request().method() === "POST");
    const replyInput = page.locator(".replyForm input").first();
    await replyInput.waitFor();
    await replyInput.fill("The migration.");
    await replyInput.press("Enter");
    expect((await replied).status()).toBe(200);

    // Each write bumps the version and the tab reloads on the change event. Waiting for that
    // reload is what a human does implicitly; clicking sooner earns a 409 by design.
    const reloaded = page.waitForResponse((r) => r.url().includes("/api/doc?") && r.request().method() === "GET");
    await reloaded;
    const resolved = page.waitForResponse((r) => r.url().endsWith("/api/resolve") && r.request().method() === "POST");
    await page.locator("[data-resolve]").first().click();
    expect((await resolved).status()).toBe(200);

    const reloadedAgain = page.waitForResponse((r) => r.url().includes("/api/doc?") && r.request().method() === "GET");
    await reloadedAgain;

    const completed = page.waitForResponse((r) => r.url().endsWith("/api/done") && r.request().method() === "POST");
    await page.locator("#doneBtn").click();
    await page.locator("#doneNote").fill("Done reviewing.");
    await page.locator("#doneNote").press("Control+Enter");
    expect((await completed).status()).toBe(200);

    const doc = loadDoc(fixture, fs.readFileSync(fixture, "utf8"));
    expect(doc.items.some((item) => item.text.includes("Which thing?"))).toBeTrue();
    expect(doc.items.some((item) => item.kind === "reply" && item.text.includes("The migration."))).toBeTrue();
    expect(doc.items.some((item) => item.status === "resolved")).toBeTrue();
    expect(doc.source).toContain("Done reviewing.");

    expect(leaked).toEqual([]);
    await page.close();
  }, E2E_TIMEOUT_MS);
});
