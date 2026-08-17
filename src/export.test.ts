import { expect, test } from "bun:test";
import { loadDoc } from "./doc.ts";
import { exportHtml } from "./export.ts";

test("standalone export keeps the island bootstrap inside its hydration script", async () => {
  const doc = loadDoc("/tmp/export.md", "# Export\n\n```html {#card}\n<div data-myd-id=\"card\">Card</div>\n```\n");
  const html = await exportHtml(doc);
  expect(html.match(/<\/script>/g)).toHaveLength(1);
  expect(html).toContain("islandBootstrap");
});
