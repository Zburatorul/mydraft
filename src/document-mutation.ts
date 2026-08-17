import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadDoc, type Doc } from "./doc.ts";

export class DocumentVersionConflict extends Error {
  readonly status = 409;
  readonly currentVersion: string;

  constructor(currentVersion: string) {
    super(`document version conflict (current version: ${currentVersion})`);
    this.name = "DocumentVersionConflict";
    this.currentVersion = currentVersion;
  }
}

export type DocumentMutationResult = {
  document: Doc;
  previousVersion: string;
  version: string;
};

export function mutateDocument(
  file: string,
  transform: (document: Doc) => string,
  options: { expectedVersion?: string } = {},
): DocumentMutationResult {
  const canonicalFile = path.resolve(file);
  const source = fs.readFileSync(canonicalFile, "utf8");
  const current = loadDoc(canonicalFile, source);

  if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
    throw new DocumentVersionConflict(current.version);
  }

  const nextSource = transform(current);
  const next = loadDoc(canonicalFile, nextSource);
  if (nextSource === source) {
    return { document: next, previousVersion: current.version, version: next.version };
  }

  const mode = fs.statSync(canonicalFile).mode & 0o7777;
  const temporary = path.join(
    path.dirname(canonicalFile),
    `.${path.basename(canonicalFile)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, nextSource, { flag: "wx", mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, canonicalFile);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }

  return { document: next, previousVersion: current.version, version: next.version };
}
