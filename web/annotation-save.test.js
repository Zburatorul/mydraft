import { describe, expect, test } from "bun:test";
import { annotationSaveDisposition } from "./annotation-save.js";

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("annotation save disposition", () => {
  test("closes the editor only after the annotation is saved", async () => {
    expect(await annotationSaveDisposition(response(200))).toEqual({ close: true, reload: false, error: null });
    expect(await annotationSaveDisposition(response(422, { error: "Selection cannot map inline." }))).toEqual({
      close: false,
      reload: false,
      error: "Selection cannot map inline.",
    });
  });

  test("preserves the draft while refreshing a stale document", async () => {
    expect(await annotationSaveDisposition(response(409, { error: "Document changed." }))).toEqual({
      close: false,
      reload: true,
      error: "Document changed.",
    });
  });
});
