import { expect, test } from "bun:test";
import { loadDoc } from "./doc.ts";
import { applySelectionAnnotation } from "./selection-annotation.ts";

test("a comment whose rendered selection cannot map inline falls back to its containing block", () => {
  const source = "Review [the plan](https://example.com) carefully.\n";
  const doc = loadDoc("/tmp/cross-object.md", source);
  const result = applySelectionAnnotation(doc, {
    blockPos: `0-${source.trimEnd().length}`,
    anchorText: "the plan carefully",
    prefix: "Review ",
    kind: "comment",
    body: "This crosses the link boundary.",
    by: "user",
  });

  expect(result?.anchorMode).toBe("block");
  const item = loadDoc("/tmp/cross-object.md", result!.source).items[0]!;
  expect(item.anchor).toEqual({ block: "b0", quote: "the plan carefully" });
  expect(item.text).toBe("This crosses the link boundary.");
});

test("an exact selection remains an inline annotation", () => {
  const source = "Review the plan carefully.\n";
  const doc = loadDoc("/tmp/inline.md", source);
  const result = applySelectionAnnotation(doc, {
    blockPos: `0-${source.trimEnd().length}`,
    anchorText: "the plan",
    prefix: "Review ",
    kind: "comment",
    body: "Inline, please.",
  });

  expect(result?.anchorMode).toBe("inline");
  expect(result?.source).toContain("{==the plan==}{>>Inline, please.<<}{#c1}");
});

test("an unmappable suggestion is not downgraded to an imprecise replacement", () => {
  const source = "Review [the plan](https://example.com) carefully.\n";
  const doc = loadDoc("/tmp/cross-object-suggestion.md", source);
  const result = applySelectionAnnotation(doc, {
    blockPos: `0-${source.trimEnd().length}`,
    anchorText: "the plan carefully",
    prefix: "Review ",
    kind: "suggestion",
    replacement: "the proposal closely",
  });

  expect(result).toBeNull();
});
