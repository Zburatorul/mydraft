import { describe, expect, test } from "bun:test";
import { ReviewComposer } from "./review-composer.js";

describe("ReviewComposer target lifecycle", () => {
  test("refuses to overwrite a non-empty draft and preserves it when retargeting", () => {
    const composer = new ReviewComposer();
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Keep this paragraph." });

    expect(composer.open({
      kind: "comment",
      target: { kind: "object", bid: "diagram", object: "node-b" },
      capturedVersion: "version-1",
    })).toBe(false);
    expect(composer.state).toMatchObject({
      target: { kind: "text", anchorText: "the plan" },
      draft: { body: "Keep this paragraph." },
    });

    expect(composer.retarget({
      target: { kind: "object", bid: "diagram", object: "node-b" },
      capturedVersion: "version-1",
    })).toBe(true);
    expect(composer.state).toMatchObject({
      target: { kind: "object", bid: "diagram", object: "node-b" },
      draft: { body: "Keep this paragraph." },
    });
  });

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

  test("retargeting a suggestion refreshes only an untouched replacement", () => {
    const composer = new ReviewComposer();
    composer.open({
      kind: "suggest",
      target: { kind: "text", blockPos: "0-20", anchorText: "old text", prefix: "Review " },
      capturedVersion: "version-1",
      draft: { body: "Explain the change.", replacement: "old text" },
    });

    expect(composer.retarget({
      target: { kind: "text", blockPos: "0-26", anchorText: "different text", prefix: "Review " },
      capturedVersion: "version-2",
    })).toBe(true);
    expect(composer.state.draft).toEqual({ body: "Explain the change.", replacement: "different text" });

    composer.updateDraft({ replacement: "purposeful rewrite" });
    expect(composer.retarget({
      target: { kind: "text", blockPos: "0-24", anchorText: "third text", prefix: "Review " },
      capturedVersion: "version-3",
    })).toBe(true);
    expect(composer.state.draft).toEqual({ body: "Explain the change.", replacement: "purposeful rewrite" });
  });

  test("a suggestion refuses an object target without changing its text draft", () => {
    const composer = new ReviewComposer();
    composer.open({
      kind: "suggest",
      target: { kind: "text", blockPos: "0-20", anchorText: "old text", prefix: "Review " },
      capturedVersion: "version-1",
      draft: { body: "Explain the change.", replacement: "purposeful rewrite" },
    });

    expect(composer.retarget({
      target: { kind: "object", bid: "diagram", object: "node-b" },
      capturedVersion: "version-2",
    })).toBe(false);
    expect(composer.state).toMatchObject({
      kind: "suggest",
      target: { kind: "text", anchorText: "old text", capturedVersion: "version-1" },
      draft: { body: "Explain the change.", replacement: "purposeful rewrite" },
      error: "Suggestions can only target text. Reselect text or cancel this draft.",
    });
  });
});

describe("ReviewComposer submission lifecycle", () => {
  test("refuses cancel and replacement while a save is in flight", async () => {
    let finish;
    const composer = new ReviewComposer({
      submit: () => new Promise((resolve) => { finish = resolve; }),
    });
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Keep the original draft." });

    const saving = composer.submit();
    expect(composer.close("cancel")).toBe(false);
    expect(composer.open({
      kind: "comment",
      target: { kind: "object", bid: "diagram", object: "node-b" },
      capturedVersion: "version-1",
    })).toBe(false);
    expect(composer.state).toMatchObject({
      phase: "submitting",
      target: { kind: "text", anchorText: "the plan" },
      draft: { body: "Keep the original draft." },
    });

    finish({ ok: false, error: "Server unavailable." });
    expect(await saving).toBe(false);
    expect(composer.state).toMatchObject({
      phase: "error",
      error: "Server unavailable.",
      target: { kind: "text", anchorText: "the plan" },
      draft: { body: "Keep the original draft." },
    });
  });

  test("a document change stales but does not unlock an in-flight save", async () => {
    let finish;
    const composer = new ReviewComposer({ submit: () => new Promise((resolve) => { finish = resolve; }) });
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Save this once." });

    const saving = composer.submit();
    composer.documentChanged({ version: "version-2" });
    expect(composer.state).toMatchObject({ phase: "submitting", targetStatus: "stale" });
    expect(composer.beginReselect()).toBe(false);
    expect(composer.retarget({
      target: { kind: "text", blockPos: "0-24", anchorText: "a different plan", prefix: "Review " },
      capturedVersion: "version-2",
    })).toBe(false);

    finish({ ok: false, error: "Document changed." });
    expect(await saving).toBe(false);
    expect(composer.state).toMatchObject({ phase: "error", targetStatus: "stale", error: "Document changed." });
  });

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
    composer.updateDraft({ body: "Retry this revised draft." });
    expect(composer.state).toMatchObject({
      phase: "editing",
      error: null,
      draft: { body: "Retry this revised draft.", replacement: "" },
    });
  });

  test("preserves a conflict message when its recovery reload fails", async () => {
    const composer = new ReviewComposer({
      submit: async () => ({ ok: false, reload: true, error: "Document changed." }),
      reload: async () => { throw new Error("offline"); },
    });
    composer.open({
      kind: "comment",
      target: { kind: "text", blockPos: "0-20", anchorText: "the plan", prefix: "Review " },
      capturedVersion: "version-1",
    });
    composer.updateDraft({ body: "Keep this through the conflict." });

    expect(await composer.submit()).toBe(false);
    expect(composer.state).toMatchObject({
      phase: "error",
      error: "Document changed. Could not reload the latest document.",
      draft: { body: "Keep this through the conflict.", replacement: "" },
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
      error: "Save timed out. It may have been saved. Reload the document before retrying.",
      draft: { body: "Keep this through a timeout.", replacement: "" },
    });
  });
});
