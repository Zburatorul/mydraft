import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveTheme, themeTogglePresentation, toggledTheme } from "./theme.js";

describe("viewer theme", () => {
  test("uses a saved choice, otherwise follows the operating-system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("unexpected", false)).toBe("light");
  });

  test("describes the theme that the button will switch to", () => {
    expect(themeTogglePresentation("light")).toEqual({
      icon: "moon",
      label: "Dark mode",
      title: "Switch to dark mode",
    });
    expect(themeTogglePresentation("dark")).toEqual({
      icon: "sun",
      label: "Light mode",
      title: "Switch to light mode",
    });
    expect(toggledTheme("light")).toBe("dark");
    expect(toggledTheme("dark")).toBe("light");
  });

  test("renders a visible, named theme control in the viewer toolbar", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    expect(html).toContain('id="themeBtn"');
    expect(html).toContain('class="theme-toggle"');
    expect(html).toContain('data-theme-label>Dark mode</span>');
    expect(html).toContain('aria-label="Switch to dark mode"');
  });
});
