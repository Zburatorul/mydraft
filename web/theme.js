const THEMES = new Set(["light", "dark"]);

export function resolveTheme(savedTheme, prefersDark) {
  if (THEMES.has(savedTheme)) return savedTheme;
  return prefersDark ? "dark" : "light";
}

export function toggledTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

export function themeTogglePresentation(theme) {
  if (theme === "dark") {
    return { icon: "sun", label: "Light mode", title: "Switch to light mode" };
  }
  return { icon: "moon", label: "Dark mode", title: "Switch to dark mode" };
}
