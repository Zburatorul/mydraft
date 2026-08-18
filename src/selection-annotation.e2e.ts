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

async function trackedPage(name: string, source = SOURCE, viewport?: { width: number; height: number }) {
  const fixture = path.join(tempDir, name);
  fs.writeFileSync(fixture, source);
  const trackedResponse = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: fixture }),
  });
  expect(trackedResponse.status).toBe(201);
  expect(trackedResponse.ok).toBeTrue();
  const tracked = await trackedResponse.json() as { reviewId: string };
  const page = await browser.newPage({ viewport });
  await page.goto(`${baseUrl}/review/${encodeURIComponent(tracked.reviewId)}`);
  expect(page.url()).not.toContain(encodeURIComponent(fixture));
  await page.locator("#doc > *").first().waitFor();
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

  test("a reply draft keeps focus across a live document refresh", async () => {
    const { fixture, page } = await trackedPage("reply-focus.md", SOURCE, { width: 1400, height: 900 });
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Comment that needs a reply.");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    await saved;

    const reply = page.locator(".replyForm input").first();
    await reply.waitFor();
    await reply.click();
    await reply.pressSequentially("Keep this draft", { delay: 60 });
    expect(await reply.inputValue()).toBe("Keep this draft");
    const inputBeforeRefresh = await reply.elementHandle();
    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    fs.appendFileSync(fixture, "\n");
    await reloaded;
    await page.waitForFunction((input) => !input.isConnected, inputBeforeRefresh);

    expect(await reply.evaluate((input) => input === document.activeElement)).toBeTrue();
    expect(await reply.inputValue()).toBe("Keep this draft");

    await page.route("**/api/reply", async (route) => {
      const response = await route.fetch();
      await Bun.sleep(300);
      await route.fulfill({ response });
    });
    const inputBeforeReply = await reply.elementHandle();
    const replyReloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    const replySaved = page.waitForResponse((response) => response.url().endsWith("/api/reply") && response.request().method() === "POST");
    await reply.press("Enter");
    await replyReloaded;
    await page.waitForFunction((input) => !input.isConnected, inputBeforeReply);
    await replySaved;
    expect(await reply.inputValue()).toBe("");
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("the Done note keeps focus and its draft across a live document refresh", async () => {
    const { fixture, page } = await trackedPage("done-focus.md", SOURCE, { width: 1400, height: 900 });
    await page.locator("#doneBtn").click();

    const note = page.locator("#doneNote");
    await note.click();
    await note.pressSequentially("Keep this overall note", { delay: 20 });
    expect(await note.evaluate((textarea) => textarea === document.activeElement)).toBeTrue();

    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    fs.appendFileSync(fixture, "\n");
    await reloaded;

    expect(await note.evaluate((textarea) => textarea === document.activeElement)).toBeTrue();
    expect(await note.inputValue()).toBe("Keep this overall note");
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("Ctrl+Enter submits the Done note", async () => {
    const { page } = await trackedPage("done-shortcut.md");
    await page.locator("#doneBtn").click();
    const note = page.locator("#doneNote");
    await note.fill("Ready for the agent.");

    const submitted = page.waitForResponse((response) => response.url().endsWith("/api/done") && response.request().method() === "POST");
    await note.press("Control+Enter");
    const response = await submitted;

    expect(response.status()).toBe(200);
    expect(await page.locator("#doneDlg").isVisible()).toBeFalse();
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a narrow explainer stacks timing lanes without horizontal overflow", async () => {
    const source = [
      "# Review: responsive explainer {#title}",
      "",
      "```explainer {#responsive}",
      "title: Local decisions",
      "sections:",
      "  - type: timing",
      "    id: handoff",
      "    parties: [Human, Agent]",
      "    events:",
      "      - id: human-event",
      "        party: Human",
      "        observes: a specific card needs attention",
      "        action: comment on that object",
      "        locality: local",
      "        synchronization: communicated",
      "      - id: agent-event",
      "        party: Agent",
      "        observes: responsive›human-event",
      "        action: inspect and replace only that YAML mapping",
      "        locality: local",
      "        synchronization: communicated",
      "```",
      "",
    ].join("\n");
    const { page } = await trackedPage("narrow-explainer.md", source, { width: 760, height: 900 });
    await page.locator(".timing-event").first().waitFor();

    const [first, second] = await page.locator(".timing-lane").evaluateAll((lanes) => lanes.map((lane) => lane.getBoundingClientRect().toJSON()));
    const overflow = await page.locator(".explainer-canvas").evaluate((canvas) => canvas.scrollWidth - canvas.clientWidth);

    expect(second!.top).toBeGreaterThanOrEqual(first!.bottom);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1100, height: 900 });
    const screenshotWidthLanes = await page.locator(".timing-lane").evaluateAll((lanes) => lanes.map((lane) => lane.getBoundingClientRect().width));
    expect(Math.min(...screenshotWidthLanes)).toBeGreaterThan(350);
    expect(await page.locator("#rail").isHidden()).toBeTrue();

    await page.setViewportSize({ width: 375, height: 800 });
    const worstOverflow = await page.locator(".explainer-canvas, .explainer-canvas *").evaluateAll((elements) => Math.max(...elements.map((element) => element.scrollWidth - element.clientWidth)));
    expect(worstOverflow).toBeLessThanOrEqual(1);
    expect(await page.locator("#doc h1").evaluate((heading) => heading.scrollWidth - heading.clientWidth)).toBeLessThanOrEqual(1);
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("the comments rail defaults closed on a narrow screen and remains reopenable", async () => {
    const { page } = await trackedPage("narrow-comments.md", SOURCE, { width: 1100, height: 900 });
    const rail = page.locator("#rail");
    const toggle = page.locator("#railToggle");

    expect(await rail.isHidden()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#doc").evaluate((doc) => doc.getBoundingClientRect().width)).toBeGreaterThan(900);

    await toggle.click();
    expect(await rail.isVisible()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);

    await toggle.click();
    expect(await rail.isHidden()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    await page.close();
  }, E2E_TIMEOUT_MS);
});
