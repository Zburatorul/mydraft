// Issue #22: browserless structural validation, run by `myd check` and as a preflight for
// `myd view`. It answers one question — will this document open as a coherent review? — and it
// answers it without a browser and without materially delaying review startup.
//
// It is deliberately NOT a rendering-quality check. Typography, layout, clipping, overlap and
// client-side interaction are invisible from here; `myd shot` remains the stronger visual check.
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { fenceRanges, loadDoc, splitEndmatter, type Doc } from "./doc.ts";
import { renderForCheck, richFenceKind, topBlocks, topCodeFences } from "./render.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import { renderExplainer } from "./explainer.ts";
import { listSemanticObjects } from "./semantic-objects.ts";
import { validateRoughdraftMarkdown } from "../vendor/rfm/index.js";

export type Severity = "error" | "warning";
export type Diagnostic = {
  severity: Severity;
  /** Stable machine code; automation matches on this, not on the message. */
  code: string;
  message: string;
  line: number;
  column: number;
  /** What to do about it, when there is a concrete answer. */
  hint?: string;
};
export type CheckReport = {
  path: string;
  version: string;
  /** False when any error was found; warnings do not clear it. */
  ok: boolean;
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
  /** Whether Mermaid fences were parsed, and if not, why. `degraded` = the parser could not
   *  evaluate at least one diagram in this environment, so absence of errors proves nothing. */
  mermaid: "checked" | "degraded" | "skipped" | "unavailable" | "none";
};

/**
 * How myd reads the vendor validator's codes.
 *
 * The vendor locates endmatter with its own scan, which disagrees with myd's `ENDMATTER_RE` on two
 * real documents in this repo: it mistakes YAML frontmatter for endmatter, and it reads a fenced
 * `---\ncomments:` example as the real thing. Its endmatter-parse verdict is therefore dropped —
 * myd runs its own, below, against the region myd itself treats as endmatter.
 *
 * Everything else is kept, but only marker-level breakage is fatal. The metadata codes describe a
 * stricter dialect than myd writes (`at` is required there, optional in practice), so they inform
 * without blocking a review that would open perfectly well.
 */
const VENDOR_POLICY: Record<string, Severity | "drop"> = {
  "invalid-endmatter-yaml": "drop",
  "unclosed-highlight": "error",
  "duplicate-id": "error",
  "self-reply": "error",
  "missing-endmatter-entry": "warning",
  "missing-reply-target": "warning",
  "legacy-metadata": "warning",
  "invalid-metadata-at": "warning",
};
const vendorSeverity = (code: string): Severity | "drop" =>
  VENDOR_POLICY[code] ?? (code.startsWith("missing-metadata-") || code.startsWith("missing-endmatter-") ? "warning" : "warning");

function locator(source: string) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (offset: number) => {
    const clamped = Math.max(0, Math.min(offset, source.length));
    let low = 0, high = starts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid]! <= clamped) low = mid; else high = mid - 1; }
    return { line: low + 1, column: clamped - starts[low]! + 1 };
  };
}

/** Fenced code is quoted, not authored: an example inside it is not a defect in this document. */
const insideFence = (ranges: Array<[number, number]>, offset: number) =>
  ranges.some(([start, end]) => offset >= start && offset < end);

/**
 * Every code region in the clean text — fenced blocks *and* inline spans — from the parser rather
 * than a regex, because getting this wrong is what turns a check into noise. This repo's own plans
 * document `![img](file.svg)` inside backticks to explain the syntax; reporting that as a missing
 * image would be a false positive on prose that is doing nothing wrong.
 */
function codeRanges(clean: string): Array<[number, number]> {
  const tree: any = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).use(remarkMath).parse(clean);
  const ranges: Array<[number, number]> = [];
  visit(tree, (node: any) => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    if (node.position) ranges.push([node.position.start.offset, node.position.end.offset]);
  });
  return ranges;
}

/**
 * myd's own endmatter verdict, against the region myd actually treats as endmatter.
 *
 * `splitEndmatter` swallows a YAML error and yields zero comments, so a document can lose its whole
 * review layer — and, when the match is a fenced example, most of its body — with nothing said.
 * This is the check that surfaces it.
 */
function checkEndmatter(source: string, at: (offset: number) => { line: number; column: number }): Diagnostic[] {
  const { body, endmatter } = splitEndmatter(source);
  if (!endmatter.raw) return [];
  const start = body.length;
  const where = at(start);
  const fenced = insideFence(fenceRanges(source), start);
  const yamlText = endmatter.raw.replace(/^\n---\n/, "");
  let parsed: unknown;
  try { parsed = parseYaml(yamlText); }
  catch (error) {
    const dropped = source.length - body.length;
    return [{
      ...where,
      severity: "error",
      code: fenced ? "endmatter-inside-fence" : "endmatter-unparsable",
      message: fenced
        ? `A fenced \`---\` example is being read as review endmatter, so ${dropped} bytes of this document are dropped and no comments load.`
        : `Review endmatter is not valid YAML, so every comment and suggestion on this document is lost: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      hint: fenced
        ? "Endmatter is the first `\\n---\\n` followed by `comments:` or `suggestions:`. Indent the example, or write its fence marker differently, so it is not mistaken for the real thing."
        : "Fix the YAML under the final `---`, or remove the endmatter block entirely.",
    }];
  }
  const diagnostics: Diagnostic[] = [];
  if (parsed !== null && typeof parsed === "object") {
    for (const key of ["comments", "suggestions"] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value))) {
        diagnostics.push({
          ...where, severity: "error", code: "endmatter-not-a-mapping",
          message: `Endmatter \`${key}\` must be a mapping of id to metadata, not ${Array.isArray(value) ? "a list" : typeof value}.`,
          hint: `Write \`${key}:\` with indented \`id: {…}\` entries beneath it.`,
        });
      }
    }
  } else if (parsed !== null && parsed !== undefined) {
    diagnostics.push({
      ...where, severity: "error", code: "endmatter-not-a-mapping",
      message: "Review endmatter must be a YAML mapping with `comments:` and/or `suggestions:` keys.",
    });
  }
  return diagnostics;
}

/** Block addressing: `myd set-block` resolves a name to the first match, so duplicates are a trap. */
function checkBlocks(doc: Doc, at: (offset: number) => { line: number; column: number }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, number>();
  for (const block of topBlocks(doc)) {
    if (!block.name) continue;
    const first = seen.get(block.name);
    if (first === undefined) { seen.set(block.name, block.start); continue; }
    diagnostics.push({
      ...at(block.start), severity: "error", code: "block-name-duplicate",
      message: `Two blocks are named \`${block.name}\`; \`myd set-block\` would always edit the first and the viewer emits a duplicate HTML id.`,
      hint: "Rename one of them, or drop its {#name} and address it positionally.",
    });
  }
  // A malformed name is silently *not* a name, so a planned revisit addresses a block that has none.
  const NAME_LIKE = /\{#([^}]*)\}/g;
  const fences = codeRanges(doc.clean);
  for (const match of doc.clean.matchAll(NAME_LIKE)) {
    const raw = match[1]!;
    if (/^[cs][0-9]+$/.test(raw) || /^[A-Za-z][\w-]*$/.test(raw)) continue;
    if (insideFence(fences, match.index!)) continue;
    diagnostics.push({
      ...at(doc.cleanToOrig(match.index!)), severity: "warning", code: "block-name-malformed",
      message: `\`{#${raw}}\` is not a usable block name, so this block stays positional.`,
      hint: "A name must start with a letter and contain only letters, numbers, `_` or `-`.",
    });
  }
  return diagnostics;
}

/** Rich fences whose payload myd can validate without a browser. */
function checkFences(doc: Doc, at: (offset: number) => { line: number; column: number }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const { block, lang, meta, source } of topCodeFences(doc)) {
    const trimmedMeta = meta.trim();
    if (trimmedMeta && !/^\{#[A-Za-z][\w-]*\}$/.test(trimmedMeta)) {
      const malformedName = /\{#([^}]*)\}/.exec(trimmedMeta);
      diagnostics.push({
        ...at(block.start), severity: "warning",
        code: malformedName && !/^[A-Za-z][\w-]*$/.test(malformedName[1]!) ? "block-name-malformed" : "fence-metadata-unsupported",
        message: malformedName && !/^[A-Za-z][\w-]*$/.test(malformedName[1]!)
          ? `\`{#${malformedName[1]!}}\` is not a usable block name, so this fence stays positional.`
          : `Fence metadata \`${trimmedMeta}\` is unsupported; only one optional \`{#name}\` is recognized.`,
        hint: "Use one name that starts with a letter and contains only letters, numbers, `_` or `-`.",
      });
    }
    if (lang === "explainer") {
      try { renderExplainer(source); }
      catch (error) {
        diagnostics.push({
          ...at(block.start), severity: "error", code: "explainer-invalid",
          message: `Explainer will not render: ${error instanceof Error ? error.message : String(error)}`,
          hint: "Run `myd guide explainers` for the supported section types and their required fields.",
        });
      }
    } else if (richFenceKind(lang) === "vega") {
      try { JSON.parse(source); }
      catch (error) {
        diagnostics.push({
          ...at(block.start), severity: "error", code: "vega-spec-invalid",
          message: `\`${lang}\` block is not valid JSON, so the chart renders as an error: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
        });
      }
    }
  }
  return diagnostics;
}

/** Local links and images the document depends on. Missing ones are rot, not a reason to block. */
function checkReferences(doc: Doc, at: (offset: number) => { line: number; column: number }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const dir = path.dirname(doc.path);
  const tree: any = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).use(remarkMath).parse(doc.clean);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node: any) => {
    definitions.set(String(node.identifier).toLowerCase(), String(node.url));
  });
  visit(tree, (node: any) => {
    let target: string | undefined;
    let image = false;
    if (node.type === "link" || node.type === "image") {
      target = String(node.url);
      image = node.type === "image";
    } else if (node.type === "linkReference" || node.type === "imageReference") {
      target = definitions.get(String(node.identifier).toLowerCase());
      image = node.type === "imageReference";
    }
    if (!target || !node.position) return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return; // absolute, protocol-relative, in-page
    let decoded: string;
    try { decoded = decodeURIComponent(target.split(/[?#]/)[0]!); }
    catch { decoded = target.split(/[?#]/)[0]!; }
    const resolved = path.resolve(dir, decoded);
    if (!resolved || fs.existsSync(resolved)) return;
    diagnostics.push({
      ...at(doc.cleanToOrig(node.position.start.offset)),
      severity: "warning",
      code: image ? "local-image-missing" : "local-reference-missing",
      message: `${image ? "Image" : "Link"} target \`${target}\` does not exist relative to this document.`,
    });
  });
  return diagnostics;
}

/**
 * Mermaid is parsed only on request. Importing the parser costs ~1.4s against a ~140ms baseline for
 * `myd view`, which is exactly the delay this issue forbids on the automatic path, so `myd check`
 * pays it and the preflight does not.
 *
 * Mermaid is a browser library, and in a headless process it fails on perfectly valid diagrams for
 * environment reasons — `DOMPurify.addHook is not a function` on any flowchart with edge labels.
 * Reporting that as a broken diagram would be worse than not checking at all, so only two error
 * shapes are trusted as the document's fault: a jison parse error (which carries `hash`) and
 * `UnknownDiagramError`. Anything else means the parser, not the diagram, is the problem, and the
 * run is reported as `degraded` so nobody reads a clean result as proof.
 */
function isDiagramFault(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("hash" in error && (error as { hash?: unknown }).hash) return true;
  return (error as { name?: string }).name === "UnknownDiagramError";
}

async function checkMermaid(doc: Doc, at: (offset: number) => { line: number; column: number }): Promise<{ diagnostics: Diagnostic[]; state: CheckReport["mermaid"] }> {
  const fences = topCodeFences(doc).filter((fence) => fence.lang === "mermaid");
  if (!fences.length) return { diagnostics: [], state: "none" };
  let parse: (source: string) => unknown;
  try {
    const mod: any = await import("mermaid");
    const api = mod.default ?? mod;
    if (typeof api.parse !== "function") throw new Error("no parse()");
    parse = (source) => api.parse(source);
  } catch {
    return { diagnostics: [], state: "unavailable" };
  }
  const diagnostics: Diagnostic[] = [];
  let degraded = false;
  for (const { block, source } of fences) {
    try { await parse(source); }
    catch (error) {
      if (!isDiagramFault(error)) { degraded = true; continue; }
      diagnostics.push({
        ...at(block.start), severity: "error", code: "mermaid-invalid",
        message: `Mermaid diagram will not render: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
      });
    }
  }
  return { diagnostics, state: degraded ? "degraded" : "checked" };
}

/**
 * Structural validation of one document.
 *
 * `mermaid` defaults off: see checkMermaid. Everything else runs on both paths, so `myd check` and
 * the `myd view` preflight agree on what "structurally sound" means.
 */
export async function checkDocument(file: string, options: { mermaid?: boolean } = {}): Promise<CheckReport> {
  const source = fs.readFileSync(file, "utf8");
  const at = locator(source);
  const diagnostics: Diagnostic[] = [];
  let mermaid: CheckReport["mermaid"] = options.mermaid ? "none" : "skipped";

  for (const raw of (validateRoughdraftMarkdown(source) as any).diagnostics as any[]) {
    const severity = vendorSeverity(raw.code);
    if (severity === "drop") continue;
    diagnostics.push({ severity, code: raw.code, message: String(raw.message), line: raw.line ?? 1, column: raw.column ?? 1 });
  }
  diagnostics.push(...checkEndmatter(source, at));

  let doc: Doc | null = null;
  try { doc = loadDoc(file, source); }
  catch (error) {
    diagnostics.push({ line: 1, column: 1, severity: "error", code: "markdown-unparsable", message: `Document could not be parsed: ${error instanceof Error ? error.message : String(error)}` });
  }

  if (doc) {
    try { diagnostics.push(...checkBlocks(doc, at), ...checkFences(doc, at), ...checkReferences(doc, at)); }
    catch (error) {
      diagnostics.push({ line: 1, column: 1, severity: "error", code: "markdown-unparsable", message: `Document structure could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
    try { listSemanticObjects(doc); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blockId = /reference:\s*([^›\s]+)›/.exec(message)?.[1];
      const explainerFences = topCodeFences(doc).filter((fence) => fence.lang === "explainer");
      const fence = blockId ? explainerFences.filter((candidate) => candidate.block.id === blockId).at(-1) : explainerFences[0];
      diagnostics.push({
        ...(fence ? at(fence.block.start) : { line: 1, column: 1 }),
        severity: "error", code: "objects-unlistable", message: `Semantic objects could not be listed: ${message}`,
      });
    }
    try {
      const rendered = await renderForCheck(doc.clean);
      for (const issue of rendered.issues) {
        diagnostics.push({
          ...at(doc.cleanToOrig(issue.offset)),
          severity: "error", code: issue.code, message: `Server-side rendering produced an error block: ${issue.message}`,
        });
      }
    } catch (error) {
      diagnostics.push({ line: 1, column: 1, severity: "error", code: "render-failed", message: `Server-side rendering threw: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (options.mermaid) {
      const mermaidResult = await checkMermaid(doc, at);
      diagnostics.push(...mermaidResult.diagnostics);
      mermaid = mermaidResult.state;
    }
  }

  // Dedupe: the vendor and myd can reach the same conclusion from different directions.
  const seen = new Set<string>();
  const unique = diagnostics.filter((d) => { const key = `${d.code}:${d.line}:${d.column}`; if (seen.has(key)) return false; seen.add(key); return true; });
  unique.sort((a, b) => a.line - b.line || a.column - b.column);
  const errors = unique.filter((d) => d.severity === "error");
  const warnings = unique.filter((d) => d.severity === "warning");
  return {
    path: file,
    version: doc?.version ?? "",
    ok: errors.length === 0,
    diagnostics: unique,
    errors,
    warnings,
    mermaid,
  };
}

/** `file:line:col severity code` with the message, and the hint, indented beneath it. */
export function formatDiagnostics(file: string, diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => {
    const head = `${file}:${d.line}:${d.column} ${d.severity} ${d.code}`;
    return d.hint ? `${head}\n  ${d.message}\n  hint: ${d.hint}` : `${head}\n  ${d.message}`;
  }).join("\n");
}

/** Human-readable report, with a count line so "ok" and "ok apart from warnings" read differently. */
export function formatReport(report: CheckReport): string {
  const caveat = report.mermaid === "degraded" || report.mermaid === "unavailable"
    ? `\nNote: Mermaid could not be fully parsed here (${report.mermaid}); use \`myd shot\` to confirm the diagrams render.`
    : "";
  if (!report.diagnostics.length) return `${report.path}: ok${caveat}`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    formatDiagnostics(report.path, report.diagnostics),
    "",
    `${plural(report.errors.length, "error")}, ${plural(report.warnings.length, "warning")}${caveat}`,
  ].join("\n");
}
