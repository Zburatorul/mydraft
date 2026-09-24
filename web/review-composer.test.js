import { describe, expect, test } from "bun:test";
import { ReviewComposer } from "./review-composer.js";

describe("ReviewComposer target lifecycle", () => {
  test("a document change stales an immutable target without losing its draft", async () => {
    const submitted = [];
    const target = { kind: "object", bid: "diagram", object: "node-a", quote: "Original node" };
    const composer = new ReviewComposer({ submit: async (snapshot) => { submitted.push(snapshot); } });

    composer.open({ kind: "comment", target, capturedVersion: "version-1" });
    composer.updateDraft({ body: "Keep this explanation." });
    target.bid = "changed-outside-the-composer";
    composer.documentChanged({ version: "version-2" });

    expect(composer.state.target).toEqual({
      kind: "object",
      bid: "diagram",
      object: "node-a",
      quote: "Original node",
      capturedVersion: "version-1",
    });
    expect(composer.state).toMatchObject({
      phase: "editing",
      targetStatus: "stale",
      draft: { body: "Keep this explanation.", replacement: "" },
    });
    expect(await composer.submit()).toBe(false);
    expect(submitted).toHaveLength(0);

    composer.beginReselect();
    composer.retarget({
      target: { kind: "object", bid: "diagram", object: "node-a", quote: "Current node" },
      capturedVersion: "version-2",
    });
    expect(composer.state).toMatchObject({
      phase: "editing",
      targetStatus: "current",
      draft: { body: "Keep this explanation.", replacement: "" },
      target: { bid: "diagram", object: "node-a", quote: "Current node", capturedVersion: "version-2" },
    });
  });
});

describe("ReviewComposer submission lifecycle", () => {
  test("locks duplicate submissions and restores focus once after acknowledgement", async () => {
    let finish;
    const submitted = [];
    const restored = [];
    const composer = new ReviewComposer({
      submit: (snapshot) => {
        submitted.push(snapshot);
        return new Promise((resolve) => { finish = resolve; });
      },
      restoreFocus: (target, reason) => restored.push({ target, reason }),
    });
    const returnFocusTo = { id: "source-paragraph" };
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
      returnFocusTo,
    });
    composer.updateDraft({ body: "Explain this." });

    const first = composer.submit();
    const duplicate = composer.submit();
    expect(composer.state.phase).toBe("submitting");
    expect(submitted).toHaveLength(1);
    expect(await duplicate).toBe(false);

    finish({ ok: true });
    expect(await first).toBe(true);
    expect(composer.state.phase).toBe("idle");
    expect(restored).toEqual([{ target: returnFocusTo, reason: "saved" }]);
  });

  test("normalizes request failures while preserving the draft for retry", async () => {
    const composer = new ReviewComposer({ submit: async () => { throw new TypeError("fetch failed"); } });
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Do not lose this." });

    expect(await composer.submit()).toBe(false);
    expect(composer.state).toMatchObject({
      phase: "error",
      error: "Could not save. Check your connection and try again.",
      draft: { body: "Do not lose this.", replacement: "" },
    });
  });

  test("times out a hung request and preserves the draft for retry", async () => {
    const composer = new ReviewComposer({
      requestTimeoutMs: 5,
      submit: async (_snapshot, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    });
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Keep this through a timeout." });

    expect(await composer.submit()).toBe(false);
    expect(composer.state).toMatchObject({
      phase: "error",
      error: "Save timed out. Check your connection and try again.",
      draft: { body: "Keep this through a timeout.", replacement: "" },
    });
  });
});
