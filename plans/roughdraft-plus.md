# Roughdraft+ (working name: _mydraft_): a human–agent collaboration workspace for research

Revision 3 — incorporates rev-2 review comments: A2UI as a rendering channel (c1), soft-fork instead of hard fork (c2), and the read-write / multi-modal workspace framing (c3). Your rev-2 comments are kept inline with my replies in the endmatter.

## Framing (c3)

This is not "a Markdown viewer with comments." It is a **shared workspace where human and agent both read and write through the same object model**. Text is the first object type because Roughdraft already gives us a good one (Markdown + CriticMarkup + YAML endmatter, id-addressed). The object model must be open from day one so later object types slot in without a redesign:

- **Text blocks** (Markdown) — now.
- **Diagram / math / chart / table blocks** — typed fences, next.
- **Interactive UI blocks** (A2UI JSON) — for anything app-like.
- **Canvas blocks** (tldraw/Excalidraw JSON fence) — drawing, later.
- **Voice** — dictated comments/blocks, transcribed into the same review objects; later.
- **Datasets, references, figures-with-provenance** — research objects.

Every object type implements the same three things: `render` (TipTap node/decoration), `serialize` (to/from a Markdown fence or sibling file), and `ops` (MCP block operations). That contract is the design; everything else is instances of it.

## What we know (experiments + upstream + survey — see rev 2 details at the end)

- Roughdraft strips raw HTML/SVG; only `![img](file.svg)` renders; Mermaid/math/callouts don't. Cause: `marked → TipTap/ProseMirror → turndown` round-trip drops anything without a TipTap node type — and already reformats/mangles some plain Markdown on save (we watched it corrupt a link in this very file).
- Roughdraft's **data model is right** (file as truth, id-addressed review objects, existing MCP + SSE handoff). Its **throughput is the problem**: Mermaid/KaTeX PRs and five fixes for the >5-min crash (#127) sit unmerged — that crash hit us three times this session.
- Prior art: nothing combines local Markdown + review UI + block-addressable agent API. Patterns to steal: Block MCP's stable refs + ETag guards; Patchwork's branch-then-merge for agent edits; MyST/OXA's typed nodes; HackMD's content negotiation.

## Rendering channels (c1)

Three channels, chosen per block by *how interactive it needs to be*:

1. **Typed Markdown fences** — `mermaid`, `math`, `chart` (Vega-Lite), `csv`/`table`, `callout`, `figure`. Rendered as presentation-only decorations over a normal code block with a Source toggle (upstream PR #143's pattern). Degrade gracefully everywhere. This covers ~80% of research content.
2. **A2UI blocks** — ```` ```a2ui ```` fence containing A2UI's flat streaming component JSON, rendered by the A2UI web renderer against a **curated component catalog** we control. Why this beats sandboxed raw HTML: no sanitizer problem (agents can only use catalog components — no injection by construction), small streamable JSON that an agent can patch by component id instead of rewriting a page, **bidirectional** (user actions flow back to the agent — exactly the read-write property in c3), and it already has an MCP transport story. Google-backed, Apache-2, v0.9.1 with 1.0 RC. This is where visual-explainer-style rich pages, forms, dashboards, and "sit beside the conversation" UI live. Comments/suggestions still anchor to the block as a whole.
3. **Sandboxed iframe (`html` fence)** — escape hatch only, `sandbox=""` by default, for legacy one-off HTML. Not the primary path.

Raw HTML passthrough is never a channel.

## Agent ergonomics: block-addressable, versioned, typed

Unchanged from rev 2 in substance, tightened:

- **Ops** (MCP + CLI): `get_outline`, `get_blocks(ids|range|heading)` → `{id, type, attrs, markdown}`, `replace_block`, `insert_block`, `delete_block`, `move_block`, `edit_text(id, find, replace)`, `set_frontmatter`; for A2UI blocks additionally `patch_component(blockId, componentId, json)`. All mutations take `ifVersion`, return a compact diff + new version.
- **Ids**: content-hash by default; optional explicit `{#b7}` (same syntax family as `{#c1}`/`{#s1}`, so rfm parses it). Shown on hover.
- **Versioning**: every save is a content-addressed snapshot in `.roughdraft/history/`; `get_versions`, `get_diff`, `restore`; agents may write to a **named draft branch** and the human merges hunks (Patchwork). Version rail + "what changed since I looked" diff in the UI.
- **Reads without MCP**: `Accept: text/markdown` on the doc URL returns raw source.
- **Render/screenshot tool** (prototyped with headless Playwright): `render <doc> [--block id] [--png|--pdf|--html]` + MCP equivalent, so an agent can verify what it drew.
- **Live state, not snapshots**: the same SSE channel that carries "Done Reviewing" carries block-level change events, so an agent can subscribe rather than poll.

## Upstream posture (c2): soft fork, upstream-first

Not a hard fork. Concretely:

- **GitHub fork that tracks `main`** and rebases; no package rename unless we're forced to publish.
- **Upstream what fits the maintainer's stated vision** (a Markdown review-standard): the #127 crash fix, Mermaid/KaTeX (or endorse #143/#132), source-formatting preservation (#98/#100), the round-trip fixture suite. These are pure wins for them and unblock us.
- **Propose one extension point upstream**: a block-type plugin registry in `app` (render + serialize) and an MCP tool-registration hook in `server`. If accepted, everything below lives in a separate package (`@mydraft/blocks`, `@mydraft/mcp`) that depends on `@roughdraft/rfm` — no fork needed at all.
- **Decision gate**: if within ~4–6 weeks the crash fix and the extension-point proposal aren't landing, we flip to a hard fork with a rename. Either way the file format stays 100% vanilla-Roughdraft-compatible.

## Delivery slices

1. **Stabilize + prove the loop** (small, upstream-first): local fix for #127 (PR it), round-trip fixture suite, screenshot CLI. Get Mermaid + KaTeX rendering locally via #143/#132.
2. **Block model + MCP + versioning** (medium): typed block parser in `rfm`, MCP/CLI ops with `ifVersion`, snapshot store, draft branches. *This is the ergonomics win — start here after slice 1.*
3. **A2UI channel** (medium): `a2ui` fence + renderer + curated catalog + `patch_component`; actions routed back over MCP/SSE. Vega-Lite/table/callout fences alongside.
4. **Research layer** (incremental): citations/bib, footnotes, figures with provenance + "reproduce", comment types (`question|claim|todo|verify`), multi-file project view, export.
5. **New object types** (later, each a plugin): canvas block, voice-dictated comments, dataset block.

## Open questions for you

- Package/product name if we do end up publishing (`mydraft`?).
- A2UI catalog scope for v1: start with the stock web catalog (text, card, list, form, button, image, chart?) or a minimal research set (table, chart, figure, form)?
- Should slice 2's draft-branch merge UI come before or after A2UI (slice 3)? I'd do it before.

---

## Appendix — rev 2 detail (kept for reference)

### Experiment results: what Roughdraft renders today

| Content | Result |
| --- | --- |
| Raw HTML `<div style=…>` | Stripped to plain text |
| Inline `<svg>` | Dropped |
| `<script>` | Dropped (good) |
| `![img](./local.svg)` | **Renders** |
| ```` ```mermaid ```` fence | Plain code block |
| `$…$` / `$$…$$` math | Literal text |
| GFM table | Renders |
| `> [!NOTE]` callout | Plain blockquote |

Pipeline: `marked` → HTML → TipTap/ProseMirror → `turndown`. Every rich block needs a TipTap node/decoration + turndown rule; #143 shows the pattern.

### Upstream facts

github.com/Lex-Inc/roughdraft, MIT, 432 stars, last push 2026-06-19; 30 open issues, 20 open PRs. Unmerged community work: Mermaid (#102, #143), KaTeX (#132), highlighting, five fixes for #127. Requested features overlapping ours: Mermaid #115, themes #114, embed #140, side-chat #146, multi-file #33, formatting preservation #98/#100. Codebase: `packages/{rfm,app,server}`, TipTap 3, marked 15, turndown 7, Express 5, no allowlist sanitizer.

### Prior art

| Tool | Steal this | Gap |
| --- | --- | --- |
| [Block MCP (WordPress)](https://github.com/GravityKit/block-mcp) | Stable per-block refs; block ops at any depth; ETag/If-Match; revision per write | WordPress/HTML only |
| [Ink & Switch Patchwork](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/07/) | Agent edits on a branch; human partial-merges | Research prototype |
| [A2UI](https://a2ui.org/) | Declarative streaming component JSON from a curated catalog; bidirectional actions; MCP transport | Young (0.9.1); no doc/review model of its own |
| [BlockSuite/AFFiNE](https://blocksuite.io/guide/working-with-block-tree.html) | Block tree with stable IDs | Not Markdown-on-disk |
| [obsidian-mcp-server](https://dev.co/ai/mcp/obsidian-mcp-server) | Heading/block/frontmatter patch granularity | Write-only from the agent side; no shared read-write UI |
| [marimo](https://marimo.io/features/best-agent-for-jupyter) | Plain file is the read API; agents drive live state | Code, not prose |
| [OXA](https://oxa.dev/articles/introducing-oxa) / [MyST](https://docs.curvenote.com/publish/authoring-in-myst) | Typed nodes; executable figures verified in CI | Publish-oriented |
| [HackMD](https://hackmd.io/@hackmd-blog/agentic-workflow-2026) | Content negotiation | Hosted |
| Notion MCP, Canvas/Artifacts, Google Docs | UX benchmarks | Not addressable by agents |

{==Rev-2 comments preserved for thread continuity:==}{>>let's remember that we could also just consider rendering UI straight-up, like https://a2ui.org/quickstart/#step-4-install-and-run<<}{id="c1" by="user" at="2026-08-16T01:32:07.677Z"}{>>we dont have to do a hard fork, im ok with using upstream if it jives well with our goal<<}{id="c2" by="user" at="2026-08-16T01:33:41.605Z"}{>>Crucial. It should be a read-write interface. Eventually we'll add voice input, a canvas for drawing, and all kinds of affordances on other knowledge work objects<<}{id="c3" by="user" at="2026-08-16T01:34:31.397Z"}

---
comments:
  c4:
    body: Let's keep going with this but take my comments into account.
    by: user
    at: 2026-08-16T01:35:36.045Z
  c5:
    body: "Adopted — A2UI is now the primary channel for interactive/app-like blocks (see 'Rendering channels' #2): curated catalog means no sanitizer problem, JSON is small and patchable per component id, and actions flow back to the agent, which is exactly the read-write property from c3. Typed Markdown fences stay the channel for diagrams/math/charts; sandboxed iframe demoted to an escape hatch."
    by: AI
    at: "2026-08-16T01:45:00.000Z"
    re: c1
  c6:
    body: "Agreed — changed to a soft fork: track upstream main, PR the crash fix / round-trip suite / rendering upstream, and propose a block-type + MCP-tool extension point so our work can live in a separate package on top of @roughdraft/rfm. Hard fork only if the decision gate (~4–6 weeks) fails. File format stays vanilla-compatible either way."
    by: AI
    at: "2026-08-16T01:45:00.000Z"
    re: c2
  c7:
    body: "Reframed the whole plan around this (new 'Framing' section): a shared workspace where both parties read AND write through one open object model — text now, typed fences and A2UI next, canvas/voice/datasets later — each object type implementing render + serialize + ops. Also fixed the table cell: obsidian-mcp-server's gap is that it's write-only from the agent side with no shared read-write UI."
    by: AI
    at: "2026-08-16T01:45:00.000Z"
    re: c3
  c8:
    body: "Acknowledged. Rev 3 written; three open questions for you at the end of the main body."
    by: AI
    at: "2026-08-16T01:45:00.000Z"
    re: c4
