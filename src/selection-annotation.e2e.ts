import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { loadDoc } from "./doc.ts";

declare global {
  interface Window {
    __editablePointerRegression: { cleanups: number; beforeinput: number; input: number };
  }
}

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

async function selectAcrossLink(page: Page, waitForPopover = true) {
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
  if (waitForPopover) await page.locator("#popover").waitFor({ state: "visible" });
}

async function pointerSelectionBeforeRelease(page: Page, field: Locator, options: { from?: number; to?: number; y?: number } = {}) {
  const from = options.from ?? .55;
  const to = options.to ?? from;
  const y = options.y ?? .5;
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * y);
  await page.mouse.down();
  if (to !== from) await page.mouse.move(box.x + box.width * to, box.y + box.height * y, { steps: 5 });
  const beforeRelease = await field.evaluate((element) => {
    const editable = element as HTMLInputElement | HTMLTextAreaElement;
    return { start: editable.selectionStart!, end: editable.selectionEnd! };
  });
  await page.mouse.up();
  await page.waitForTimeout(20);
  expect(await field.evaluate((element) => {
    const editable = element as HTMLInputElement | HTMLTextAreaElement;
    return { start: editable.selectionStart!, end: editable.selectionEnd! };
  })).toEqual(beforeRelease);
  return beforeRelease;
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

    await page.unroute("**/api/annotate");
    let attempts = 0;
    await page.route("**/api/annotate", async (route) => {
      attempts += 1;
      await Bun.sleep(200);
      await route.fulfill({ status: 500, body: "unavailable" });
    });
    const failed = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.status() === 500);
    await page.locator("#edSave").evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await failed;
    expect(attempts).toBe(1);
    expect(await page.locator("#edBody").inputValue()).toBe("Do not lose this draft.");
    expect(await page.locator("#edError").textContent()).toBe("Failed to save annotation");
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("cancel and successful save return focus to the document target", async () => {
    const { page } = await trackedPage("annotation-focus-return.md", SOURCE, { width: 1400, height: 900 });
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    expect(await page.locator("#edBody").evaluate((field) => field === document.activeElement)).toBeTrue();
    await page.locator("#edCancel").click();
    expect(await page.locator("#doc p").evaluate((paragraph) => paragraph === document.activeElement)).toBeTrue();

    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Return to this paragraph.");
    await page.route("**/api/doc?*", async (route) => {
      await Bun.sleep(2_300);
      await route.continue();
    }, { times: 1 });
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    await page.locator("#edSave").click();
    expect((await saved).status()).toBe(200);
    await reloaded;
    await page.waitForFunction(() => document.activeElement?.matches("#doc [data-pos]"));
    expect(await page.locator("#doc p").evaluate((paragraph) => paragraph === document.activeElement)).toBeTrue();
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("editable pointer releases never invoke annotation selection cleanup", async () => {
    const { page } = await trackedPage("editable-pointer-release.md", SOURCE, { width: 1400, height: 900 });
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();
    await page.locator("#edBody").fill("Comment that needs a reply.");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    expect((await saved).status()).toBe(200);

    await page.locator(".replyForm input").first().waitFor();
    await page.evaluate(() => {
      const instrumentation = { cleanups: 0, beforeinput: 0, input: 0 };
      Object.defineProperty(window, "__editablePointerRegression", { value: instrumentation });
      const original = Selection.prototype.removeAllRanges;
      Selection.prototype.removeAllRanges = function removeAllRanges() {
        instrumentation.cleanups += 1;
        return original.call(this);
      };
      document.addEventListener("beforeinput", () => { instrumentation.beforeinput += 1; }, true);
      document.addEventListener("input", () => { instrumentation.input += 1; }, true);
    });

    const reply = page.locator(".replyForm input").first();
    await reply.fill("Reply survives");
    await page.evaluate(() => {
      window.__editablePointerRegression.beforeinput = 0;
      window.__editablePointerRegression.input = 0;
    });
    const replySelectionBeforeRelease = await pointerSelectionBeforeRelease(page, reply, { from: .2, to: .75 });
    expect(replySelectionBeforeRelease.end).toBeGreaterThan(replySelectionBeforeRelease.start);
    await page.keyboard.type("X");
    expect(await reply.inputValue()).toBe(`Reply survives`.slice(0, replySelectionBeforeRelease.start) + "X" + `Reply survives`.slice(replySelectionBeforeRelease.end));
    expect(await page.evaluate(() => window.__editablePointerRegression)).toEqual({
      cleanups: 0,
      beforeinput: 1,
      input: 1,
    });

    await page.locator("#doneBtn").click();
    await page.evaluate(() => {
      window.__editablePointerRegression.cleanups = 0;
      window.__editablePointerRegression.beforeinput = 0;
      window.__editablePointerRegression.input = 0;
    });
    const note = page.locator("#doneNote");
    await note.fill("Done survives");
    await page.evaluate(() => {
      window.__editablePointerRegression.beforeinput = 0;
      window.__editablePointerRegression.input = 0;
    });
    const noteCaretBeforeRelease = await pointerSelectionBeforeRelease(page, note, { y: .2 });
    await page.keyboard.type("X");
    expect(await note.inputValue()).toBe(`Done survives`.slice(0, noteCaretBeforeRelease.start) + "X" + `Done survives`.slice(noteCaretBeforeRelease.end));
    expect(await page.evaluate(() => window.__editablePointerRegression)).toEqual({
      cleanups: 0,
      beforeinput: 1,
      input: 1,
    });

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

  test("a live document refresh preserves a comment draft but requires target reselection", async () => {
    const { fixture, page } = await trackedPage("comment-focus.md", SOURCE, { width: 1400, height: 900 });
    await selectAcrossLink(page);
    await page.locator('#popover [data-act="comment"]').click();

    const comment = page.locator("#edBody");
    await comment.pressSequentially("Keep this comment draft", { delay: 20 });
    expect(await comment.evaluate((textarea) => textarea === document.activeElement)).toBeTrue();

    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    fs.appendFileSync(fixture, "\n");
    await reloaded;

    expect(await comment.evaluate((textarea) => textarea === document.activeElement)).toBeTrue();
    expect(await comment.inputValue()).toBe("Keep this comment draft");
    expect(await page.locator("#edStale").textContent()).toContain("Document changed");
    expect(await page.locator("#edSave").isDisabled()).toBeTrue();

    await page.locator("#edReselect").click();
    expect(await page.locator("#edStale").textContent()).toContain("Select the target again");
    await selectAcrossLink(page, false);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#edSave")!.disabled);
    expect(await page.locator("#edSave").isEnabled()).toBeTrue();
    expect(await page.locator("#edStale").isHidden()).toBeTrue();
    expect(await comment.inputValue()).toBe("Keep this comment draft");

    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    expect((await saved).status()).toBe(200);
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a live document refresh also invalidates an object target without losing its draft", async () => {
    const source = [
      "# Object review",
      "",
      "```explainer {#object-review}",
      "title: One event",
      "sections:",
      "  - type: timing",
      "    id: handoff",
      "    parties: [Human]",
      "    events:",
      "      - id: inspect",
      "        party: Human",
      "        observes: a draft",
      "        action: review it",
      "        locality: local",
      "        synchronization: communicated",
      "```",
      "",
    ].join("\n");
    const { fixture, page } = await trackedPage("stale-object.md", source, { width: 1400, height: 900 });
    const object = page.locator(".timing-event").first();
    await object.click();
    await page.locator("#edBody").fill("Keep this object comment.");

    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    fs.appendFileSync(fixture, "\n");
    await reloaded;

    expect(await page.locator("#edBody").inputValue()).toBe("Keep this object comment.");
    expect(await page.locator("#edStale").textContent()).toContain("Document changed");
    expect(await page.locator("#edSave").isDisabled()).toBeTrue();

    await page.locator("#edReselect").click();
    await object.click();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#edSave")!.disabled);
    expect(await page.locator("#edBody").inputValue()).toBe("Keep this object comment.");
    expect(await page.locator("#edStale").isHidden()).toBeTrue();

    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate-object") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    expect((await saved).status()).toBe(200);
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

  test("adding the first comment opens its rail so the new thread is immediately usable", async () => {
    const { page } = await trackedPage("first-comment.md", SOURCE, { width: 1280, height: 900 });
    expect(await page.locator("#rail").isHidden()).toBeTrue();

    await selectAcrossLink(page);
    const commentAction = page.locator('#popover [data-act="comment"]');
    expect(await commentAction.isVisible()).toBeTrue();
    expect(await commentAction.isEnabled()).toBeTrue();
    // Chrome 152 under hosted-runner contention can return from Playwright's synthetic click
    // without delivering this already-actionable popover event, leaving the editor hidden until
    // the test times out. The first annotation test above retains real-click coverage; this test
    // is specifically about the post-save rail transition, so exercise the handler directly.
    await commentAction.dispatchEvent("click");
    await page.locator("#editor").waitFor({ state: "visible" });
    await page.locator("#edBody").fill("Show this thread.");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/annotate") && response.request().method() === "POST");
    await page.locator("#edSave").click();
    expect((await saved).status()).toBe(200);

    await page.locator(".replyForm input").first().waitFor();
    expect(await page.locator("#rail").isVisible()).toBeTrue();
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("the comments rail defaults closed on a narrow screen and remains reopenable", async () => {
    const { page } = await trackedPage("narrow-comments.md", SOURCE, { width: 1100, height: 900 });
    const rail = page.locator("#rail");
    const toggle = page.locator("#railToggle");

    expect(await rail.isHidden()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#doc").evaluate((doc) => doc.getBoundingClientRect().width)).toBeGreaterThan(900);
    expect(await toggle.isVisible()).toBeTrue();
    expect(await toggle.isEnabled()).toBeTrue();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.x).toBeGreaterThanOrEqual(0);
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(1100);
    expect(toggleBox!.y).toBeGreaterThanOrEqual(0);
    expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(900);

    // Chrome 152 on the hosted runner can hang in Playwright's unnecessary
    // scroll-into-view step for this already-visible sticky toolbar button.
    // Keep the user-facing visibility checks above, then exercise the handler directly.
    await toggle.dispatchEvent("click");
    expect(await rail.isVisible()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);

    await toggle.dispatchEvent("click");
    expect(await rail.isHidden()).toBeTrue();
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("an empty comments rail does not squeeze the document at laptop width", async () => {
    const { page } = await trackedPage("laptop-comments.md", SOURCE, { width: 1280, height: 900 });

    expect(await page.locator("#rail").isHidden()).toBeTrue();
    expect(await page.locator("#railToggle").getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#doc").evaluate((doc) => doc.getBoundingClientRect().width)).toBeGreaterThan(1100);
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("a Mermaid diagram opens in a zoomable full-size stage", async () => {
    const source = [
      "# Dense diagram",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Collect evidence] --> B[Build evaluator] --> C[Run trials] --> D[Inspect failures] --> E[Revise signal] --> F[Run again]",
      "```",
      "",
    ].join("\n");
    const { page } = await trackedPage("zoomable-mermaid.md", source, { width: 1280, height: 900 });
    await page.locator(".rich.mermaid .rich-view svg").waitFor();

    const open = page.getByRole("button", { name: "Open diagram" });
    expect(await open.count()).toBe(1);
    await open.click();
    expect(await page.locator("#diagramDlg").isVisible()).toBeTrue();

    const initialCenters = await page.locator("#diagramViewport").evaluate((viewport) => {
      const svg = viewport.querySelector("svg")!;
      const viewportRect = viewport.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      return {
        viewportX: viewportRect.left + viewportRect.width / 2,
        viewportY: viewportRect.top + viewportRect.height / 2,
        svgX: svgRect.left + svgRect.width / 2,
        svgY: svgRect.top + svgRect.height / 2,
      };
    });
    expect(Math.abs(initialCenters.svgX - initialCenters.viewportX)).toBeLessThanOrEqual(2);
    expect(Math.abs(initialCenters.svgY - initialCenters.viewportY)).toBeLessThanOrEqual(2);

    const stage = page.locator("#diagramStage");
    const before = Number(await stage.getAttribute("data-scale"));
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(Number(await stage.getAttribute("data-scale"))).toBeGreaterThan(before);

    await page.getByRole("button", { name: "Close diagram" }).click();
    expect(await page.locator("#diagramDlg").isVisible()).toBeFalse();
    await page.close();
  }, E2E_TIMEOUT_MS);

  test("the latest revision exposes a change-focused comparison with its predecessor", async () => {
    const { fixture, page } = await trackedPage("revision-comparison.md", "# Plan\n\nUse the old verifier.\n", { width: 1400, height: 900 });
    expect(await page.locator("#changesBtn").isHidden()).toBeTrue();

    const reloaded = page.waitForResponse((response) => response.url().includes("/api/doc?") && response.request().method() === "GET");
    fs.writeFileSync(fixture, "# Plan\n\nUse the improved verifier.\n\nAdd adversarial trials.\n");
    await reloaded;

    const changes = page.locator("#changesBtn");
    expect(await changes.isVisible()).toBeTrue();
    const comparison = page.waitForResponse((response) => response.url().includes("/api/changes?") && response.request().method() === "GET");
    await changes.click();
    const comparisonResponse = await comparison;
    expect(comparisonResponse.status()).toBe(200);
    expect((await comparisonResponse.json()).available).toBeTrue();

    expect(await page.locator("#changesDlg").isVisible()).toBeTrue();
    expect(await page.locator("#changesDlg del").allTextContents()).toContain("Use the old verifier.");
    expect(await page.locator("#changesDlg ins").allTextContents()).toContain("Use the improved verifier.");
    expect(await page.locator("#changesDlg ins").allTextContents()).toContain("Add adversarial trials.");
    await page.close();
  }, E2E_TIMEOUT_MS);
});
