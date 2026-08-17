import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { loadDoc } from "./doc.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const SOURCE = "Review [the plan](https://example.com) carefully.\n";
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
    const read = reader.read();
    const result = await Promise.race([
      read,
      Bun.sleep(5_000).then(() => { throw new Error("Timed out starting isolated myd server"); }),
    ]);
    if (result.done) throw new Error(`myd server exited before startup: ${output}`);
    output += new TextDecoder().decode(result.value);
  }
  const port = /localhost:(\d+)/.exec(output)?.[1];
  if (!port) throw new Error(`Could not read myd server port from: ${output}`);
  baseUrl = `http://localhost:${port}`;
}

async function trackedPage(name: string) {
  const fixture = path.join(tempDir, name);
  fs.writeFileSync(fixture, SOURCE);
  const trackedResponse = await fetch(`${baseUrl}/api/track`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: fixture }),
  });
  expect(trackedResponse.ok).toBeTrue();
  const tracked = await trackedResponse.json() as { reviewId: string };
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?path=${encodeURIComponent(fixture)}&review=${encodeURIComponent(tracked.reviewId)}`);
  await page.locator("#doc a").waitFor();
  return { fixture, page };
}

async function selectAcrossLink(page: Page) {
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>("#doc a")!;
    const paragraph = link.closest("p")!;
    const start = link.firstChild!;
    const end = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("carefully"))!;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent!.indexOf("carefully") + "carefully".length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#popover").waitFor({ state: "visible" });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-selection-e2e-"));
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
}, E2E_TIMEOUT_MS);

describe("cross-element annotation in a real browser", () => {
  test("selection across a link becomes a quoted block comment in Markdown", async () => {
    const { fixture, page } = await trackedPage("cross-element.md");
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Explain this combined phrase.");

    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect((await response.json()).anchorMode).toBe("block");

    const item = loadDoc(fixture, fs.readFileSync(fixture, "utf8")).items[0]!;
    expect(item.anchor).toEqual({ block: "b0", quote: "the plan carefully" });
    expect(item.text).toBe("Explain this combined phrase.");
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a rejected browser save keeps the typed draft available", async () => {
    const { page } = await trackedPage("rejected-save.md");
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.route("**/api/annotate", (route) => route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "Selection cannot map inline." }),
    }));
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Do not lose this draft.");
    await page.locator("#edSave").click();

    await page.locator("#edError").waitFor({ state: "visible" });
    expect(await page.locator("#editor").isVisible()).toBeTrue();
    expect(await page.locator("#edBody").inputValue()).toBe("Do not lose this draft.");
    expect(await page.locator("#edError").textContent()).toBe("Selection cannot map inline.");
    await page.close();
  }, E2E_TIMEOUT_MS);
});
