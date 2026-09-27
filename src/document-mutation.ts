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
  /** The document as it was read, before the transform. */
  previous: Doc;
  /** The transformed document: what is now on disk, or what would be under dryRun. */
  document: Doc;
  /** True when nothing was written (dryRun); version is then the would-be version, not the file's. */
  dryRun: boolean;
  previousVersion: string;
  version: string;
};

export function mutateDocument(
  file: string,
  transform: (document: Doc) => string,
  // dryRun runs the identical read → version check → transform → reparse path and stops short of
  // the write, so a preview can never accept an edit that the real write would reject (issue #27).
  options: { expectedVersion?: string; dryRun?: boolean } = {},
): DocumentMutationResult {
  const canonicalFile = path.resolve(file);
  const source = fs.readFileSync(canonicalFile, "utf8");
  const current = loadDoc(canonicalFile, source);

  if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
    throw new DocumentVersionConflict(current.version);
  }

  const nextSource = transform(current);
  const next = loadDoc(canonicalFile, nextSource);
  const result = { previous: current, document: next, dryRun: !!options.dryRun, previousVersion: current.version, version: next.version };
  if (nextSource === source || options.dryRun) return result;

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

  return result;
}
