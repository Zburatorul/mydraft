import { describe, expect, test } from "bun:test";
import { clickAwayDismissal } from "./annotation-overlay.js";

const outside = {};
const insideEditor = {};
const insidePopover = {};
const overlay = (hidden, inside) => ({ hidden, contains: (target) => target === inside });

describe("annotation overlay click-away", () => {
  test("dismisses whichever annotation overlay is open only when the pointer is outside", () => {
    const editor = overlay(false, insideEditor);
    const popover = overlay(true, insidePopover);
    expect(clickAwayDismissal(outside, editor, popover)).toBe(editor);
    expect(clickAwayDismissal(insideEditor, editor, popover)).toBeNull();

    editor.hidden = true;
    popover.hidden = false;
    expect(clickAwayDismissal(outside, editor, popover)).toBe(popover);
    expect(clickAwayDismissal(insidePopover, editor, popover)).toBeNull();
  });
});
