// One-way Markdown → HTML. Every block-level element gets data-pos="start-end" (offsets into
// doc.clean) so the annotation layer can map selections/clicks back to source. Rich blocks are
// fenced code with a language tag, rewritten into containers the client hydrates:
//   mermaid → <div class="rich mermaid">, vega-lite|vega|chart → <div class="rich vega">,
//   html → <iframe sandbox srcdoc> island. Everything else: GFM, math (KaTeX), Shiki code.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root as MdRoot } from "mdast";
import type { Root as HastRoot, Element } from "hast";
import { hashVersion, type Doc } from "./doc.ts";
import { renderExplainer } from "./explainer.ts";

export type RichFenceKind = "mermaid" | "vega" | "html" | "explainer";
const RICH_FENCE_KINDS: Record<string, RichFenceKind> = {
  mermaid: "mermaid",
  "vega-lite": "vega",
  vega: "vega",
  chart: "vega",
  html: "html",
  explainer: "explainer",
};
export function richFenceKind(lang: string): RichFenceKind | null {
  return RICH_FENCE_KINDS[lang.toLowerCase()] ?? null;
}

/** mdast plugin: stash source offsets on every node's data.hProperties so they survive to hast. */
function remarkPositions() {
  return (tree: MdRoot, file: any) => {
    (tree as any).__clean = String(file.value);
    visit(tree, (node: any) => {
      if (!node.position) return;
      const s = node.position.start.offset, e = node.position.end.offset;
      node.data ??= {};
      node.data.hProperties = { ...(node.data.hProperties ?? {}), "data-pos": `${s}-${e}` };
    });
    // block ids = name ({#name}) or index among top-level children (same scheme as `myd blocks`)
    tree.children.forEach((child: any, i) => {
      const name = blockName(child, String((tree as any).__clean ?? ""));
      child.data ??= {}; child.data.hProperties = { ...(child.data.hProperties ?? {}), "data-bid": name ?? `b${i}`, ...(name ? { id: name } : {}) };
      if (name && child.type === "heading") { const last = child.children[child.children.length - 1]; if (last?.type === "text") last.value = last.value.replace(/\s*\{#[A-Za-z][\w-]*\}\s*$/, ""); }
    });
  };
}

/** mdast plugin: turn rich fences into html nodes with the source escaped inside. */
type RenderIssue = { code: "render-error-block" | "render-math-error"; message: string; offset: number };

function addRenderIssue(file: any, issue: RenderIssue) {
  const issues = ((file.data ??= {}).mydRenderIssues ??= []) as RenderIssue[];
  issues.push(issue);
}

function remarkRichFences(options: { collectIssues: boolean }) {
  const { collectIssues } = options;
  return (tree: MdRoot, file: any) => {
    visit(tree, "code", (node: any, index, parent: any) => {
      const lang = (node.lang ?? "").toLowerCase();
      const kind = richFenceKind(lang);
      if (!kind || !parent || index === undefined) return;
      const pos = node.position ? `${node.position.start.offset}-${node.position.end.offset}` : "";
      const bid = node.data?.hProperties?.["data-bid"] ?? "";
      const src = escapeHtml(node.value);
      let html: string;
      if (kind === "mermaid") html = `<div class="rich mermaid" data-pos="${pos}" data-bid="${bid}" data-lang="mermaid"><pre class="rich-src">${src}</pre></div>`;
      else if (kind === "html") html = `<div class="rich island" data-pos="${pos}" data-bid="${bid}" data-lang="html"><pre class="rich-src">${src}</pre></div>`;
      else if (kind === "explainer") {
        try { html = `<div class="rich explainer" data-pos="${pos}" data-bid="${bid}" data-lang="explainer"><pre class="rich-src">${src}</pre><div class="rich-view">${renderExplainer(node.value)}</div></div>`; }
        catch (error) {
          const message = `Explainer: ${error instanceof Error ? error.message : String(error)}`;
          if (collectIssues) addRenderIssue(file, { code: "render-error-block", message, offset: node.position?.start.offset ?? 0 });
          html = `<div class="rich explainer invalid" data-pos="${pos}" data-bid="${bid}" data-lang="explainer"><pre class="rich-src">${src}</pre><div class="rich-error">${escapeHtml(message)}</div></div>`;
        }
      }
      else html = `<div class="rich vega" data-pos="${pos}" data-bid="${bid}" data-lang="${lang}"><pre class="rich-src">${src}</pre></div>`;
      parent.children[index] = { type: "html", value: html };
    });
  };
}

/** Collect renderer-produced KaTeX errors without scanning arbitrary authored text in the HTML. */
function rehypeRenderIssues() {
  return (tree: HastRoot, file: any) => {
    const walk = (node: any, inheritedOffset = 0) => {
      const position = String(node.properties?.dataPos ?? node.properties?.["data-pos"] ?? "");
      const offset = Number(/^\d+/.exec(position)?.[0] ?? inheritedOffset);
      if (node.type !== "element") {
        for (const child of node.children ?? []) walk(child, offset);
        return;
      }
      const classes = Array.isArray(node.properties?.className)
        ? node.properties.className.map(String)
        : String(node.properties?.className ?? "").split(/\s+/);
      if (classes.includes("katex-error")) {
        addRenderIssue(file, {
          code: "render-math-error",
          message: String(node.properties?.title ?? "KaTeX rendered an error"),
          offset,
        });
      }
      for (const child of node.children ?? []) walk(child, offset);
    };
    walk(tree);
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** hast plugin: GitHub-style callouts  > [!NOTE] … */
function rehypeCallouts() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "blockquote") return;
      const p = node.children.find((c: any) => c.type === "element" && c.tagName === "p") as Element | undefined;
      const t = p?.children[0];
      if (!t || t.type !== "text") return;
      const m = /^\[!(\w+)\]\s*/.exec(t.value);
      if (!m) return;
      t.value = t.value.slice(m[0].length);
      const kind = m[1]!.toLowerCase();
      node.properties = { ...node.properties, className: ["callout", `callout-${kind}`], "data-callout": kind };
      p!.children.unshift({ type: "element", tagName: "span", properties: { className: ["callout-title"] }, children: [{ type: "text", value: m[1]! }] } as Element);
    });
  };
}

function buildProcessor(highlight: boolean, collectIssues = false) {
  const p = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPositions)
    .use(remarkRichFences, { collectIssues })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeCallouts)
    .use(rehypeKatex);
  if (collectIssues) p.use(rehypeRenderIssues);
  if (highlight) p.use(rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
  return p.use(rehypeStringify) as any;
}

let processor: ReturnType<typeof unified> | null = null;
let checkProcessor: ReturnType<typeof unified> | null = null;
function getProcessor() {
  return (processor ??= buildProcessor(true));
}

/**
 * The viewer's pipeline minus syntax highlighting, for `myd check` (issue #22).
 *
 * Same plugins in the same order, so every construct that can produce an error block — an invalid
 * explainer, unrenderable math, raw HTML — is exercised exactly as the server exercises it. Shiki
 * is the one omission: loading its grammars and themes costs ~7s on a cold process against ~30ms
 * for everything else, and highlighting cannot fail into an error block (an unknown language falls
 * back to plain text). Dropping it buys the whole check for a rounding error on review startup.
 */
export async function renderForCheck(clean: string): Promise<{ html: string; issues: RenderIssue[] }> {
  checkProcessor ??= buildProcessor(false, true);
  const file = await (checkProcessor as any).process(clean);
  return { html: String(file), issues: ((file.data?.mydRenderIssues ?? []) as RenderIssue[]) };
}

export type Block = { id: string; index: number; name: string | null; type: string; start: number; end: number; head: string; guard: string };
export type CodeFence = { block: Block; lang: string; meta: string; source: string; sourceStart: number };
/** Top-level blocks of doc.body with ORIGINAL offsets (via clean→orig map), ids b0..bn matching data-bid. */
/** Optional stable name for a block: heading `## Title {#name}`, or fence info string ```` ```mermaid {#name} ````. */
export function blockName(c: any, clean: string): string | null {
  if (c.type === "heading") { const m = /\{#([A-Za-z][\w-]*)\}\s*$/.exec(clean.slice(c.position.start.offset, c.position.end.offset)); return m ? m[1]! : null; }
  if (c.type === "code") { const m = /\{#([A-Za-z][\w-]*)\}/.exec(c.meta ?? ""); return m ? m[1]! : null; }
  return null;
}
/** Content guard: hash of the block's exact source (inline markup included) plus its occurrence index
 *  among identical blocks. It names *what* a caller planned to edit, independent of version and position,
 *  so it survives unrelated edits elsewhere and fails when the target itself changed or moved. */
function parsedTopBlocks(doc: Doc): Array<{ node: any; block: Block }> {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).use(remarkMath).parse(doc.clean) as MdRoot;
  const seen = new Map<string, number>();
  return tree.children.map((c: any, i) => {
    const s = doc.cleanToOrig(c.position.start.offset), e = doc.cleanToOrig(c.position.end.offset);
    const type = c.type === "heading" ? `h${c.depth}` : c.type === "code" ? `code:${c.lang ?? ""}` : c.type === "paragraph" ? "para" : c.type;
    const name = blockName(c, doc.clean);
    const id = name ?? `b${i}`;
    const source = doc.body.slice(s, e), occurrence = seen.get(source) ?? 0;
    seen.set(source, occurrence + 1);
    return { node: c, block: { id, index: i, name, type, start: s, end: e, head: source.split("\n")[0]!.slice(0, 80), guard: hashVersion(`${source}\0${occurrence}`) } };
  });
}

export function topBlocks(doc: Doc): Block[] {
  return parsedTopBlocks(doc).map(({ block }) => block);
}

/** Parsed top-level fences, with delimiters removed for every CommonMark fence style. */
export function topCodeFences(doc: Doc): CodeFence[] {
  return parsedTopBlocks(doc).flatMap(({ node, block }) => {
    if (node.type !== "code" || !node.lang) return [];
    const fenced = doc.body.slice(block.start, block.end);
    const firstNewline = fenced.indexOf("\n");
    const lastNewline = fenced.lastIndexOf("\n");
    if (firstNewline < 0 || lastNewline < firstNewline) return [];
    return [{
      block,
      lang: String(node.lang).toLowerCase(),
      meta: String(node.meta ?? ""),
      source: fenced.slice(firstNewline + 1, lastNewline),
      sourceStart: block.start + firstNewline + 1,
    }];
  });
}

export async function renderDoc(doc: Doc): Promise<string> {
  const file = await getProcessor().process(doc.clean);
  return String(file);
}
