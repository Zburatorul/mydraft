import { describe, expect, test } from "bun:test";
import { islandDocument, islandThemeMessage, parseIslandMessage } from "./island-bridge.js";

describe("sandboxed HTML island bridge", () => {
  test("accepts only bounded resize messages from the myd protocol", () => {
    expect(parseIslandMessage({ channel: "myd:island", type: "resize", height: 684 })).toEqual({ type: "resize", height: 684 });
    expect(parseIslandMessage({ channel: "elsewhere", type: "resize", height: 684 })).toBeNull();
    expect(parseIslandMessage({ channel: "myd:island", type: "resize", height: 50_000 })).toBeNull();
  });

  test("forwards click-away intent from anywhere inside a sandboxed island", () => {
    expect(parseIslandMessage({ channel: "myd:island", type: "pointerdown" })).toEqual({ type: "pointerdown" });
    expect(islandDocument("<main>island</main>")).toContain('addEventListener("pointerdown"');
  });

  test("preserves semantic identity and optional selected text", () => {
    expect(parseIslandMessage({
      channel: "myd:island",
      type: "annotate",
      target: "alice-trigger",
      text: "detector A fires",
      x: 42,
      y: 90,
    })).toEqual({ type: "annotate", target: "alice-trigger", text: "detector A fires", x: 42, y: 90 });
    expect(parseIslandMessage({ channel: "myd:island", type: "annotate", target: "" })).toBeNull();
  });

  test("injects the bridge into arbitrary HTML without granting same-origin access", () => {
    const html = islandDocument('<article data-myd-id="alice-trigger">Alice</article>');
    expect(html).toContain('data-myd-id="alice-trigger"');
    expect(html).toContain('channel:"myd:island"');
    expect(html).toContain("ResizeObserver");
    expect(html).toContain("</script>");
    expect(html).not.toContain("allow-same-origin");
  });

  test("carries an explicit parent theme across the opaque-origin boundary", () => {
    expect(islandThemeMessage("dark")).toEqual({ channel: "myd:island", type: "theme", theme: "dark" });
    expect(() => islandThemeMessage("sepia")).toThrow("theme must be light or dark");
    expect(islandDocument("<main>card</main>")).toContain("dataset.mydTheme=message.theme");
  });
});
