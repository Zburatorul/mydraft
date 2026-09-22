import { describe, expect, test } from "bun:test";
import { revisionDiff } from "./revision-diff.ts";

describe("revisionDiff", () => {
  test("focuses the result on changed lines and keeps nearby context", () => {
    const hunks = revisionDiff(
      "# Plan\n\nUse the old verifier.\n\nKeep this.\n",
      "# Plan\n\nUse the improved verifier.\n\nKeep this.\n\nAdd adversarial trials.\n",
      1,
    );

    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks.flatMap((hunk) => hunk.lines)).toContainEqual({ kind: "removed", text: "Use the old verifier." });
    expect(hunks.flatMap((hunk) => hunk.lines)).toContainEqual({ kind: "added", text: "Use the improved verifier." });
    expect(hunks.flatMap((hunk) => hunk.lines)).toContainEqual({ kind: "added", text: "Add adversarial trials." });
  });

  test("returns no hunks for identical source", () => {
    expect(revisionDiff("same\n", "same\n")).toEqual([]);
  });
});
