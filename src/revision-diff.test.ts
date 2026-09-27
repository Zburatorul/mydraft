import { describe, expect, test } from "bun:test";
import { revisionDiff, unifiedDiff } from "./revision-diff.ts";

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

describe("unifiedDiff", () => {
  const labels = { from: "a.md", to: "a.md (dry-run)" };
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n") + "\n";

  test("renders diff -u hunks with three lines of context", () => {
    const after = lines(20).replace("l10\n", "L10\nextra\n");
    expect(unifiedDiff(lines(20), after, labels)).toBe([
      "--- a.md", "+++ a.md (dry-run)", "@@ -7,7 +7,8 @@",
      " l7", " l8", " l9", "-l10", "+L10", "+extra", " l11", " l12", " l13", "",
    ].join("\n"));
  });

  test("splits distant changes into separate hunks and numbers them from the right line", () => {
    const after = lines(30).replace("l2\n", "L2\n").replace("l28\n", "L28\n");
    const diff = unifiedDiff(lines(30), after, labels);
    expect(diff.match(/^@@.*@@$/gm)).toEqual(["@@ -1,5 +1,5 @@", "@@ -25,6 +25,6 @@"]);
  });

  test("uses diff(1) conventions for empty sides and returns nothing for identical input", () => {
    expect(unifiedDiff("", "new\n", labels)).toBe("--- a.md\n+++ a.md (dry-run)\n@@ -0,0 +1,1 @@\n+new\n");
    expect(unifiedDiff("gone\n", "", labels)).toBe("--- a.md\n+++ a.md (dry-run)\n@@ -1,1 +0,0 @@\n-gone\n");
    expect(unifiedDiff("same\n", "same\n", labels)).toBe("");
  });
});
