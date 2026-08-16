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
import type { Doc } from "./doc.ts";

const RICH = new Set(["mermaid", "vega-lite", "vega", "chart", "html"]);

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
function remarkRichFences() {
  return (tree: MdRoot) => {
    visit(tree, "code", (node: any, index, parent: any) => {
      const lang = (node.lang ?? "").toLowerCase();
      if (!RICH.has(lang) || !parent || index === undefined) return;
      const pos = node.position ? `${node.position.start.offset}-${node.position.end.offset}` : "";
      const bid = node.data?.hProperties?.["data-bid"] ?? "";
      const src = escapeHtml(node.value);
      let html: string;
      if (lang === "mermaid") html = `<div class="rich mermaid" data-pos="${pos}" data-bid="${bid}" data-lang="mermaid"><pre class="rich-src">${src}</pre></div>`;
      else if (lang === "html") html = `<div class="rich island" data-pos="${pos}" data-bid="${bid}" data-lang="html"><pre class="rich-src">${src}</pre></div>`;
      else html = `<div class="rich vega" data-pos="${pos}" data-bid="${bid}" data-lang="${lang}"><pre class="rich-src">${src}</pre></div>`;
      parent.children[index] = { type: "html", value: html };
    });
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

let processor: ReturnType<typeof unified> | null = null;
function getProcessor() {
  if (processor) return processor;
  processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPositions)
    .use(remarkRichFences)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeCallouts)
    .use(rehypeKatex)
    .use(rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
    .use(rehypeStringify) as any;
  return processor!;
}

export type Block = { id: string; index: number; name: string | null; type: string; start: number; end: number; head: string };
/** Top-level blocks of doc.body with ORIGINAL offsets (via clean→orig map), ids b0..bn matching data-bid. */
/** Optional stable name for a block: heading `## Title {#name}`, or fence info string ```` ```mermaid {#name} ````. */
export function blockName(c: any, clean: string): string | null {
  if (c.type === "heading") { const m = /\{#([A-Za-z][\w-]*)\}\s*$/.exec(clean.slice(c.position.start.offset, c.position.end.offset)); return m ? m[1]! : null; }
  if (c.type === "code") { const m = /\{#([A-Za-z][\w-]*)\}/.exec(c.meta ?? ""); return m ? m[1]! : null; }
  return null;
}
export function topBlocks(doc: Doc): Block[] {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm).use(remarkMath).parse(doc.clean) as MdRoot;
  return tree.children.map((c: any, i) => {
    const s = doc.cleanToOrig(c.position.start.offset), e = doc.cleanToOrig(c.position.end.offset);
    const type = c.type === "heading" ? `h${c.depth}` : c.type === "code" ? `code:${c.lang ?? ""}` : c.type === "paragraph" ? "para" : c.type;
    const name = blockName(c, doc.clean);
    return { id: name ?? `b${i}`, index: i, name, type, start: s, end: e, head: doc.body.slice(s, e).split("\n")[0]!.slice(0, 80) };
  });
}

export async function renderDoc(doc: Doc): Promise<string> {
  const file = await getProcessor().process(doc.clean);
  return String(file);
}
