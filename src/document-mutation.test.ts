import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocumentVersionConflict, mutateDocument } from "./document-mutation.ts";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-document-mutation-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mutateDocument", () => {
  test("re-reads the document, applies a source transform, and returns both versions", () => {
    const source = path.join(workspace(), "draft.md");
    fs.writeFileSync(source, "# Before\n");

    const first = mutateDocument(source, (document) => `${document.source}After\n`);
    const second = mutateDocument(source, (document) => `${document.source}Again\n`, {
      expectedVersion: first.version,
    });

    expect(first.previousVersion).toMatch(/^[a-f0-9]{12}$/);
    expect(first.document.source).toBe("# Before\nAfter\n");
    expect(first.version).toBe(first.document.version);
    expect(second.previousVersion).toBe(first.version);
    expect(second.document.source).toBe("# Before\nAfter\nAgain\n");
    expect(fs.readFileSync(source, "utf8")).toBe(second.document.source);
  });

  test("rejects a stale expected version before calling the transform", () => {
    const source = path.join(workspace(), "draft.md");
    fs.writeFileSync(source, "# Current\n");
    let called = false;

    expect(() => mutateDocument(source, () => {
      called = true;
      return "# Should not be written\n";
    }, { expectedVersion: "stale-version" })).toThrow(DocumentVersionConflict);

    try {
      mutateDocument(source, () => "# Should not be written\n", { expectedVersion: "stale-version" });
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentVersionConflict);
      expect((error as DocumentVersionConflict).status).toBe(409);
      expect((error as DocumentVersionConflict).currentVersion).toMatch(/^[a-f0-9]{12}$/);
    }
    expect(called).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("# Current\n");
  });

  test("does not replace the file for a no-op transform", () => {
    const source = path.join(workspace(), "draft.md");
    fs.writeFileSync(source, "# Unchanged\n");
    const before = fs.statSync(source);

    const result = mutateDocument(source, (document) => document.source);

    expect(result.previousVersion).toBe(result.version);
    expect(result.document.source).toBe("# Unchanged\n");
    expect(fs.statSync(source).ino).toBe(before.ino);
    expect(fs.readdirSync(path.dirname(source)).filter((name) => name.includes(".draft.md.")).length).toBe(0);
  });

  test("preserves the existing file mode while replacing atomically", () => {
    const source = path.join(workspace(), "draft.md");
    fs.writeFileSync(source, "# Before\n", { mode: 0o640 });
    fs.chmodSync(source, 0o640);

    mutateDocument(source, (document) => `${document.source}After\n`);

    expect(fs.statSync(source).mode & 0o7777).toBe(0o640);
  });

  test("leaves the document untouched when the transform fails", () => {
    const source = path.join(workspace(), "draft.md");
    fs.writeFileSync(source, "# Safe\n");

    expect(() => mutateDocument(source, () => { throw new Error("transform failed"); })).toThrow("transform failed");
    expect(fs.readFileSync(source, "utf8")).toBe("# Safe\n");
    expect(fs.readdirSync(path.dirname(source)).filter((name) => name.includes(".draft.md.")).length).toBe(0);
  });
});
