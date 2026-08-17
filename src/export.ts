// myd export: render a doc to ONE self-contained HTML file (delivery artifact).
// Inlines the viewer CSS, KaTeX CSS+fonts, and — only if the doc uses them — Mermaid / Vega bundles.
import fs from "node:fs";
import path from "node:path";
import { loadDoc, type Doc } from "./doc.ts";
import { renderDoc } from "./render.ts";
import { islandExportHydrationSource } from "../web/island-bridge.js";

const ROOT = path.resolve(import.meta.dir, "..");
const NM = path.join(ROOT, "node_modules");
const read = (p: string) => fs.readFileSync(p, "utf8");

function inlineKatexCss(): string {
  const dir = path.join(NM, "katex/dist");
  let css = read(path.join(dir, "katex.min.css"));
  // inline only woff2 fonts as data URIs; drop other formats
  css = css.replace(/src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\),url\([^)]+\) format\("woff"\),url\([^)]+\) format\("truetype"\)/g, (_m, f) => {
    const b = fs.readFileSync(path.join(dir, "fonts", f)).toString("base64");
    return `src:url(data:font/woff2;base64,${b}) format("woff2")`;
  });
  return css;
}

function inlineImages(html: string, docDir: string): string {
  return html.replace(/<img([^>]*?)src="([^"]+)"/g, (m, pre, src) => {
    if (/^(https?:|data:)/.test(src)) return m;
    const p = path.resolve(docDir, decodeURIComponent(src));
    if (!fs.existsSync(p)) return m;
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return `<img${pre}src="data:${mime};base64,${fs.readFileSync(p).toString("base64")}"`;
  });
}

const HYDRATE = `
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function addToggle(el){const b=document.createElement("button");b.className="src-toggle";b.textContent="source";b.onclick=()=>el.classList.toggle("show-src");el.prepend(b);}
${islandExportHydrationSource()}
(async()=>{
  const merm=[...document.querySelectorAll(".rich.mermaid")];
  if(merm.length&&window.mermaid){mermaid.initialize({startOnLoad:false,theme:dark()?"dark":"default",securityLevel:"strict"});let i=0;
    for(const el of merm){try{const {svg}=await mermaid.render("mm"+(i++),el.querySelector(".rich-src").textContent);const h=document.createElement("div");h.className="rich-view";h.innerHTML=svg;el.appendChild(h);addToggle(el);}catch(e){el.insertAdjacentHTML("beforeend",'<div class="rich-error">'+e.message+'</div>');}}}
  const vega=[...document.querySelectorAll(".rich.vega")];
  if(vega.length&&window.vegaEmbed){for(const el of vega){const h=document.createElement("div");h.className="rich-view";el.appendChild(h);try{await vegaEmbed(h,JSON.parse(el.querySelector(".rich-src").textContent),{actions:false,theme:dark()?"dark":undefined});addToggle(el);}catch(e){h.innerHTML='<div class="rich-error">'+e.message+'</div>';}}}
  for(const el of document.querySelectorAll(".rich.island")){const f=document.createElement("iframe");f.className="rich-view island-frame";f.setAttribute("sandbox","allow-scripts");f.srcdoc=islandDocument(el.querySelector(".rich-src").textContent);el.appendChild(f);addToggle(el);}
  for(const el of document.querySelectorAll(".rich.explainer")){addToggle(el);}
})();`;

export async function exportHtml(doc: Doc, opts: { title?: string } = {}): Promise<string> {
  let html = await renderDoc(doc);
  html = inlineImages(html, path.dirname(doc.path));
  const css = read(path.join(ROOT, "web/style.css")).replace(/#bar[\s\S]*?\}\n/, "") + "\nmain{grid-template-columns:1fr;max-width:900px}#doc{padding:40px 48px}\n";
  const needMermaid = html.includes('class="rich mermaid"'), needVega = html.includes('class="rich vega"');
  const scripts: string[] = [];
  if (needMermaid) scripts.push(read(path.join(NM, "mermaid/dist/mermaid.min.js")));
  if (needVega) for (const f of ["vega/build/vega.min.js", "vega-lite/build/vega-lite.min.js", "vega-embed/build/vega-embed.min.js"]) scripts.push(read(path.join(NM, f)));
  const title = opts.title ?? (/<h1[^>]*>([^<]*)</.exec(html)?.[1] ?? path.basename(doc.path));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${inlineKatexCss()}</style>
<style>${css}</style>
</head><body>
<main><article id="doc" class="markdown-body">
${html}
</article></main>
${scripts.map((s) => `<script>${s}</script>`).join("\n")}
<script>${HYDRATE}</script>
</body></html>`;
}

if (import.meta.main) {
  const [inp, outp] = process.argv.slice(2);
  if (!inp) { console.error("usage: bun src/export.ts in.md [out.html]"); process.exit(2); }
  const abs = path.resolve(inp);
  const doc = loadDoc(abs, fs.readFileSync(abs, "utf8"));
  const out = outp ? path.resolve(outp) : abs.replace(/\.md$/, ".html");
  fs.writeFileSync(out, await exportHtml(doc));
  console.log(out);
}
