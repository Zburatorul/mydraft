import { describe, expect, test } from "bun:test";
import { isEditorSubmitShortcut, isModifiedEnterShortcut } from "./shortcuts.js";

describe("annotation editor submit shortcuts", () => {
  test("accepts Ctrl+R and prevents bare R from submitting", () => {
    expect(isEditorSubmitShortcut({ ctrlKey: true, metaKey: false, key: "r" })).toBe(true);
    expect(isEditorSubmitShortcut({ ctrlKey: false, metaKey: false, key: "r" })).toBe(false);
  });

  test("keeps Ctrl+Enter and supports Command on macOS", () => {
    expect(isEditorSubmitShortcut({ ctrlKey: true, metaKey: false, key: "Enter" })).toBe(true);
    expect(isEditorSubmitShortcut({ ctrlKey: false, metaKey: true, key: "R" })).toBe(true);
  });
});

describe("generic submit shortcut", () => {
  test("accepts Ctrl/Command+Enter without borrowing the editor's Ctrl+R alias", () => {
    expect(isModifiedEnterShortcut({ ctrlKey: true, metaKey: false, key: "Enter" })).toBe(true);
    expect(isModifiedEnterShortcut({ ctrlKey: false, metaKey: true, key: "Enter" })).toBe(true);
    expect(isModifiedEnterShortcut({ ctrlKey: true, metaKey: false, key: "r" })).toBe(false);
  });
});
