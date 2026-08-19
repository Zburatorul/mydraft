import { describe, expect, test } from "bun:test";
import { DocumentHandles } from "./document-handles.ts";

describe("a document handle", () => {
  test("stands in for a path that would otherwise need escaping", () => {
    const handles = new DocumentHandles();
    const handle = handles.for("/home/eugeniu/My Plans/q3 roadmap.md");
    expect(handle).toMatch(/^[0-9a-z]{6}$/);
    expect(encodeURIComponent(handle)).toBe(handle);
    expect(handles.pathFor(handle)).toBe("/home/eugeniu/My Plans/q3 roadmap.md");
  });

  test("is the same handle for the same document, so re-rendering is stable", () => {
    const handles = new DocumentHandles();
    expect(handles.for("/tmp/a.md")).toBe(handles.for("/tmp/a.md"));
    expect(handles.for("/tmp/a.md")).not.toBe(handles.for("/tmp/b.md"));
  });

  test("is unknown until it is minted, and stays unknown when it never was", () => {
    const handles = new DocumentHandles();
    expect(handles.pathFor("zzzzzz")).toBeNull();
    expect(handles.pathFor(null)).toBeNull();
    expect(handles.pathFor("")).toBeNull();
  });

  test("draws again rather than pointing two documents at one handle", () => {
    const queued = ["dup", "dup", "fresh"];
    const handles = new DocumentHandles(() => queued.shift() ?? "exhausted");
    expect(handles.for("/tmp/a.md")).toBe("dup");
    expect(handles.for("/tmp/b.md")).toBe("fresh");
    expect(handles.pathFor("dup")).toBe("/tmp/a.md");
  });
});
