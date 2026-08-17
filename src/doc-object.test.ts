import { expect, test } from "bun:test";
import { annotateObject, loadDoc } from "./doc.ts";
import { topBlocks } from "./render.ts";

test("object annotations preserve a stable target and selected quote separately", () => {
  const source = "```html {#island}\n<div data-myd-id=\"alice-trigger\">detector A fires</div>\n```\n";
  const doc = loadDoc("/tmp/island.md", source);
  const block = topBlocks(doc)[0]!;
  const next = annotateObject(doc, block.end, "Is this the local signal?", {
    block: "island",
    target: "alice-trigger",
    quote: "detector A fires",
  }, "user", "2026-08-16T00:00:00.000Z");
  const item = loadDoc("/tmp/island.md", next).items[0]!;

  expect(item.anchor).toEqual({ block: "island", target: "alice-trigger", quote: "detector A fires" });
  expect(item.text).toBe("Is this the local signal?");
});
