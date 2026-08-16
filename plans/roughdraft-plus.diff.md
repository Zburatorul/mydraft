> **Diff view: rev 2 → rev 3.** Green `{++…++}{#s1}` = new in rev 3, red `{--…--}{#s2}` = removed from rev 2. Unmarked = unchanged. Generated at paragraph granularity, so a paragraph that changed even slightly shows as delete+insert.

{--# Roughdraft+ (working name: _mydraft_): a human–agent collaboration tool for research
Revision 2 — incorporates your review comments (c1–c5) and the results of two experiments plus an upstream/prior-art investigation.
## What changed since rev 1
- **Tested rendering for real** (c4). Verdict below.--}{#s3}

{--- **Read the upstream source and issue tracker** (c4). Verdict: fork.--}{#s4}

{--- **Verified the editor architecture** — it's TipTap/ProseMirror, not a plain renderer. This changes what "richer HTML" means.--}{#s5}

{--- **Prototyped the screenshot tool** (c2) — headless Playwright already works against the running Roughdraft server.--}{#s6}

{--- Added **artifact versioning** (c1) and a **prior-art survey** (c5, see appendix; being filled by a subagent).--}{#s7}

{--## Experiment results: what Roughdraft renders today
Tested with `roughdraft open` + a headless Playwright screenshot of the live page:--}{#s8}

{++# Roughdraft+ (working name: _mydraft_): a human–agent collaboration workspace for research++}{#s9}

{++Revision 3 — incorporates rev-2 review comments: A2UI as a rendering channel (c1), soft-fork instead of hard fork (c2), and the read-write / multi-modal workspace framing (c3). Your rev-2 comments are kept inline with my replies in the endmatter.++}{#s10}

{++## Framing (c3)++}{#s11}

{++This is not "a Markdown viewer with comments." It is a **shared workspace where human and agent both read and write through the same object model**. Text is the first object type because Roughdraft already gives us a good one (Markdown + CriticMarkup + YAML endmatter, id-addressed). The object model must be open from day one so later object types slot in without a redesign:++}{#s12}

{++- **Text blocks** (Markdown) — now.++}{#s13}

{++- **Diagram / math / chart / table blocks** — typed fences, next.++}{#s14}

{++- **Interactive UI blocks** (A2UI JSON) — for anything app-like.++}{#s15}

{++- **Canvas blocks** (tldraw/Excalidraw JSON fence) — drawing, later.++}{#s16}

{++- **Voice** — dictated comments/blocks, transcribed into the same review objects; later.++}{#s17}

{++- **Datasets, references, figures-with-provenance** — research objects.++}{#s18}

{++Every object type implements the same three things: `render` (TipTap node/decoration), `serialize` (to/from a Markdown fence or sibling file), and `ops` (MCP block operations). That contract is the design; everything else is instances of it.++}{#s19}

{++## What we know (experiments + upstream + survey — see rev 2 details at the end)++}{#s20}

{++- Roughdraft strips raw HTML/SVG; only `![img](file.svg)` renders; Mermaid/math/callouts don't. Cause: `marked → TipTap/ProseMirror → turndown` round-trip drops anything without a TipTap node type — and already reformats/mangles some plain Markdown on save (we watched it corrupt a link in this very file).++}{#s21}

{++- Roughdraft's **data model is right** (file as truth, id-addressed review objects, existing MCP + SSE handoff). Its **throughput is the problem**: Mermaid/KaTeX PRs and five fixes for the >5-min crash (#127) sit unmerged — that crash hit us three times this session.++}{#s22}

{++- Prior art: nothing combines local Markdown + review UI + block-addressable agent API. Patterns to steal: Block MCP's stable refs + ETag guards; Patchwork's branch-then-merge for agent edits; MyST/OXA's typed nodes; HackMD's content negotiation.++}{#s23}

{++## Rendering channels (c1)++}{#s24}

{++Three channels, chosen per block by *how interactive it needs to be*:++}{#s25}

{++1. **Typed Markdown fences** — `mermaid`, `math`, `chart` (Vega-Lite), `csv`/`table`, `callout`, `figure`. Rendered as presentation-only decorations over a normal code block with a Source toggle (upstream PR #143's pattern). Degrade gracefully everywhere. This covers ~80% of research content.++}{#s26}

{++2. **A2UI blocks** — ```` ```a2ui ```` fence containing A2UI's flat streaming component JSON, rendered by the A2UI web renderer against a **curated component catalog** we control. Why this beats sandboxed raw HTML: no sanitizer problem (agents can only use catalog components — no injection by construction), small streamable JSON that an agent can patch by component id instead of rewriting a page, **bidirectional** (user actions flow back to the agent — exactly the read-write property in c3), and it already has an MCP transport story. Google-backed, Apache-2, v0.9.1 with 1.0 RC. This is where visual-explainer-style rich pages, forms, dashboards, and "sit beside the conversation" UI live. Comments/suggestions still anchor to the block as a whole.++}{#s27}

{++3. **Sandboxed iframe (`html` fence)** — escape hatch only, `sandbox=""` by default, for legacy one-off HTML. Not the primary path.++}{#s28}

{++Raw HTML passthrough is never a channel.++}{#s29}

{++## Agent ergonomics: block-addressable, versioned, typed++}{#s30}

{++Unchanged from rev 2 in substance, tightened:++}{#s31}

{++- **Ops** (MCP + CLI): `get_outline`, `get_blocks(ids|range|heading)` → `{id, type, attrs, markdown}`, `replace_block`, `insert_block`, `delete_block`, `move_block`, `edit_text(id, find, replace)`, `set_frontmatter`; for A2UI blocks additionally `patch_component(blockId, componentId, json)`. All mutations take `ifVersion`, return a compact diff + new version.++}{#s32}

{++- **Ids**: content-hash by default; optional explicit `{#b7}` (same syntax family as `{#c1}`/`{#s1}`, so rfm parses it). Shown on hover.++}{#s33}

{++- **Versioning**: every save is a content-addressed snapshot in `.roughdraft/history/`; `get_versions`, `get_diff`, `restore`; agents may write to a **named draft branch** and the human merges hunks (Patchwork). Version rail + "what changed since I looked" diff in the UI.++}{#s34}

{++- **Reads without MCP**: `Accept: text/markdown` on the doc URL returns raw source.++}{#s35}

{++- **Render/screenshot tool** (prototyped with headless Playwright): `render <doc> [--block id] [--png|--pdf|--html]` + MCP equivalent, so an agent can verify what it drew.++}{#s36}

{++- **Live state, not snapshots**: the same SSE channel that carries "Done Reviewing" carries block-level change events, so an agent can subscribe rather than poll.++}{#s37}

{++## Upstream posture (c2): soft fork, upstream-first++}{#s38}

{++Not a hard fork. Concretely:++}{#s39}

{++- **GitHub fork that tracks `main`** and rebases; no package rename unless we're forced to publish.++}{#s40}

{++- **Upstream what fits the maintainer's stated vision** (a Markdown review-standard): the #127 crash fix, Mermaid/KaTeX (or endorse #143/#132), source-formatting preservation (#98/#100), the round-trip fixture suite. These are pure wins for them and unblock us.++}{#s41}

{++- **Propose one extension point upstream**: a block-type plugin registry in `app` (render + serialize) and an MCP tool-registration hook in `server`. If accepted, everything below lives in a separate package (`@mydraft/blocks`, `@mydraft/mcp`) that depends on `@roughdraft/rfm` — no fork needed at all.++}{#s42}

{++- **Decision gate**: if within ~4–6 weeks the crash fix and the extension-point proposal aren't landing, we flip to a hard fork with a rename. Either way the file format stays 100% vanilla-Roughdraft-compatible.++}{#s43}

{++## Delivery slices++}{#s44}

{++1. **Stabilize + prove the loop** (small, upstream-first): local fix for #127 (PR it), round-trip fixture suite, screenshot CLI. Get Mermaid + KaTeX rendering locally via #143/#132.++}{#s45}

{++2. **Block model + MCP + versioning** (medium): typed block parser in `rfm`, MCP/CLI ops with `ifVersion`, snapshot store, draft branches. *This is the ergonomics win — start here after slice 1.*++}{#s46}

{++3. **A2UI channel** (medium): `a2ui` fence + renderer + curated catalog + `patch_component`; actions routed back over MCP/SSE. Vega-Lite/table/callout fences alongside.++}{#s47}

{++4. **Research layer** (incremental): citations/bib, footnotes, figures with provenance + "reproduce", comment types (`question|claim|todo|verify`), multi-file project view, export.++}{#s48}

{++5. **New object types** (later, each a plugin): canvas block, voice-dictated comments, dataset block.++}{#s49}

{++## Open questions for you++}{#s50}

{++- Package/product name if we do end up publishing (`mydraft`?).++}{#s51}

{++- A2UI catalog scope for v1: start with the stock web catalog (text, card, list, form, button, image, chart?) or a minimal research set (table, chart, figure, form)?++}{#s52}

{++- Should slice 2's draft-branch merge UI come before or after A2UI (slice 3)? I'd do it before.++}{#s53}

{++---++}{#s54}

{++## Appendix — rev 2 detail (kept for reference)++}{#s55}

{++### Experiment results: what Roughdraft renders today++}{#s56}

| Content | Result |

| --- | --- |

{--| Raw HTML `<div style=…>` | Stripped to plain text — no styling |--}{#s57}

{--| Inline `<svg>` | Dropped entirely |--}{#s58}

{++| Raw HTML `<div style=…>` | Stripped to plain text |++}{#s59}

{++| Inline `<svg>` | Dropped |++}{#s60}

| `<script>` | Dropped (good) |

{--| `![img](./local.svg)` | **Renders** — the one working rich channel |--}{#s61}

{--| ` ```mermaid ` fence | Plain code block |--}{#s62}

{++| `![img](./local.svg)` | **Renders** |++}{#s63}

{++| ```` ```mermaid ```` fence | Plain code block |++}{#s64}

| `$…$` / `$$…$$` math | Literal text |

| GFM table | Renders |

| `> [!NOTE]` callout | Plain blockquote |

{--**Why**: the pipeline is `marked` → HTML → **TipTap/ProseMirror doc** → `turndown` → markdown on save. Anything TipTap has no node type for is lost in the round-trip. So "richer HTML" is not a renderer swap; every rich block needs a TipTap node/decoration + a turndown rule. That's real but bounded work, and upstream PR #143 already shows the pattern (Mermaid SVG as a presentation-only decoration over a normal `codeBlock`, source stays markdown).
## Upstream verdict (c3): fork it
Facts (github.com/Lex-Inc/roughdraft, MIT, 432 stars, last push 2026-06-19):--}{#s65}

{--- 30 open issues, 20 open PRs. Community PRs for Mermaid (#102, #143 — 2.4k lines with tests), KaTeX (#132), syntax highlighting, and _five_ separate fixes for a crash that kills every review >5 min (#127) are all unmerged. Maintainer merges are mostly own polish work.--}{#s66}

{--- Requested-but-absent features overlap ours almost exactly: Mermaid (#115), themes (#114), embed mode (#140), side-chat (#146), multi-file nav (#33), source-formatting preservation (#98/#100).--}{#s67}

{--- Design choices _are_ right for us: markdown file as source of truth; review state as CriticMarkup + YAML endmatter (a stable, id-addressed data structure); TipTap editor (block-structured, extensible, well-documented); Express server with SSE/long-poll "Done Reviewing" event; existing stdio MCP server; small codebase (`packages/{rfm,app,server}`).--}{#s68}

{--- The main limitation isn't design, it's _throughput_ — one maintainer not absorbing contributions.--}{#s69}

{--Conclusion: the data model and architecture are worth keeping; the bottleneck is upstream velocity. **Fork**, cherry-pick the good community PRs (#143 Mermaid+Shiki, #132 KaTeX, one of the #127 fixes), and build our layer on top. Keep `rfm` (the format library) compatible so files stay interoperable with vanilla Roughdraft.
## Design
### Principle: one markdown file is still the truth — but the _agent never rewrites it wholesale_
Everything below is layered on the existing file format. That's what makes it fork-safe and git-friendly.
### 1. Rich blocks (the "visual-explainer" gap)
All rich blocks are **fenced code with a language tag**, rendered as a presentation-only view with a Source toggle (the #143 pattern). Markdown stays plain; other tools degrade gracefully.--}{#s70}

{--- ` ```mermaid ` → diagram (cherry-pick #143), pan/zoom.--}{#s71}

{--- ` ```math ` / `$$` → KaTeX (cherry-pick #132).--}{#s72}

{--- ` ```chart ` (Vega-Lite JSON) → chart. Research need #1.--}{#s73}

{--- ` ```html ` → **sandboxed iframe** (`sandbox=""`, no scripts unless `allow-scripts` opted-in per doc), so visual-explainer-style pages can be embedded _inside_ a reviewed doc, not just linked. Comments anchor to the block.--}{#s74}

{--- ` ```csv ` / ` ```table ` → sortable/filterable data table.--}{#s75}

{--- Shiki highlighting for ordinary code (also in #143).--}{#s76}

{--- Callouts (`> [!NOTE]`), footnotes, citations (`[@key]` + a `references.bib` sibling) — research needs.--}{#s77}

{--- Figures with provenance: a `figure` block carrying `src`, `script`, `data`, `commit`, `hash` in its fence attributes, rendered with a "reproduce" affordance.--}{#s78}

{--Everything renders in the browser client — no server-side rendering, so `roughdraft doctor`/rfm stay dependency-light.
### 2. Agent ergonomics: block-addressable MCP tools (c1)
Today's MCP surface is review-metadata only. Add content tools, all operating on the **file** (so vanilla-compatible), all returning a compact diff + new block map instead of the whole doc:--}{#s79}

{--- `get_outline(path)` → headings + block ids + first line each (cheap orientation).--}{#s80}

{--- `get_blocks(path, ids | range | heading)` → just those blocks.--}{#s81}

{--- `replace_block(path, id, markdown)`, `insert_block(path, after|before, markdown)`, `delete_block(path, id)`, `move_block`.--}{#s82}

{--- `edit_text(path, id, find, replace)` — sub-block edit without resending the block.--}{#s83}

{--- `set_frontmatter(path, key, value)`.--}{#s84}

{--- Every mutation takes an `ifVersion` and returns the new version (see §3) so agent and human edits can't silently clobber each other.--}{#s85}

{--Block ids: content-hash-derived by default (stable across unrelated edits, no source pollution), with an optional explicit `{#b7}` attribute — same syntax family as `{#c1}`/`{#s1}`, so rfm can parse it. Ids surface in the UI on hover so a human can say "fix b12".--}{#s86}

{--Same operations exposed as CLI subcommands (`roughdraft block replace …`) for agents without MCP.
### 3. Artifact versioning (c1)
- Every save (human or agent) is a snapshot in `.roughdraft/history/<doc>/` — content-addressed, with author + timestamp + optional message. Cheap: docs are small.--}{#s87}

{--- MCP/CLI: `get_versions`, `get_diff(v1, v2)`, `restore(v)`, plus `ifVersion` on all mutations (optimistic concurrency).--}{#s88}

{--- UI: version rail with diff view; "what did the agent change since I last looked" is a one-click diff — this is the single most valuable review affordance for long agent sessions.--}{#s89}

{--- If the doc is inside a git repo, offer "commit snapshot" but don't require git.--}{#s90}

{--### 4. Screenshot / render tool (c2)
Prototype already works: `node shot.mjs <url> <out.png>` with Playwright (bundled as a Roughdraft dev dep; Chromium 1228 already installed on this system). Productize as `roughdraft render <doc.md> [--block b7] [--png|--pdf|--html]` and MCP `render_document` / `render_block`. Uses: agent verifies its own diagram rendered; export figures for papers; paste into chat.
### 5. Research/knowledge-work fit
- Multi-file: project sidebar (#33), cross-doc links, one review index across docs.--}{#s91}

{--- Citations + bibliography, footnotes, numbered figures/equations with cross-refs.--}{#s92}

{--- Provenance on figures (§1); "reproduce" button re-runs the script via a configurable runner.--}{#s93}

{--- Comment types beyond text: `question`, `claim`, `todo`, `verify` — filterable in the review rail; `verify` comments are what a research reviewer mostly writes.--}{#s94}

{--- Export: clean markdown (strip CriticMarkup), Pandoc → PDF/DOCX/HTML.--}{#s95}

{--## Delivery slices
1. **Fork + stabilize** (small): fork, cherry-pick #127 fix, #143 Mermaid+Shiki, #132 KaTeX. Rename package (`mydraft`?) to avoid npm collision; keep `rfm` compatible. Ship the screenshot CLI.--}{#s96}

{--2. **Block MCP + versioning** (medium): block parser in `rfm`, MCP/CLI tools, snapshot store, `ifVersion`. This is the ergonomics win.--}{#s97}

{--3. **Sandboxed HTML/chart/table blocks** (medium): iframe block, Vega-Lite, data tables, callouts.--}{#s98}

{--4. **Research layer** (larger, incremental): citations, figures with provenance, comment types, multi-file, export.--}{#s99}

{--Slice 1 is a weekend; 2 is the one that changes how it feels to work with an agent. Suggest starting there.
## Prior art (c5) — what exists, and the gap we'd fill
Subagent survey of ~15 tools. Headline: **no tool combines local-first Markdown-on-disk + a human review/suggestion UI + a block-addressable MCP content API.** Roughdraft has the first two (MCP is review-metadata-only); WordPress's Block MCP has the third but for Gutenberg HTML. Rich rendering and structured agent editing never co-exist anywhere: publish tools (Quarto, Curvenote/MyST, HackMD) have Mermaid/math/citations but no review loop; review tools (Roughdraft, Google Docs) have no rich content. No shipping product versions agent-authored prose (only Ink & Switch's Patchwork research). Every agent-review tool is single-document.--}{#s100}

{++Pipeline: `marked` → HTML → TipTap/ProseMirror → `turndown`. Every rich block needs a TipTap node/decoration + turndown rule; #143 shows the pattern.++}{#s101}

{++### Upstream facts++}{#s102}

{++github.com/Lex-Inc/roughdraft, MIT, 432 stars, last push 2026-06-19; 30 open issues, 20 open PRs. Unmerged community work: Mermaid (#102, #143), KaTeX (#132), highlighting, five fixes for #127. Requested features overlapping ours: Mermaid #115, themes #114, embed #140, side-chat #146, multi-file #33, formatting preservation #98/#100. Codebase: `packages/{rfm,app,server}`, TipTap 3, marked 15, turndown 7, Express 5, no allowlist sanitizer.++}{#s103}

{++### Prior art++}{#s104}

| Tool | Steal this | Gap |

| --- | --- | --- |

{--| [Block MCP (WordPress)](https://github.com/GravityKit/block-mcp) | Stable per-block refs that survive sibling shifts; 9 block ops at any depth; ETag/If-Match on every write; a revision per write | WordPress/HTML only |--}{#s105}

{--| [Ink & Switch Patchwork](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/07/) | Agent edits land on a **branch**; human does partial merge — richer than accept/reject per marker | Research prototype |--}{#s106}

{--| [BlockSuite/AFFiNE](https://blocksuite.io/guide/working-with-block-tree.html) | Block tree with stable IDs, incremental updates | Not Markdown-on-disk; heavy |--}{#s107}

{--| [obsidian-mcp-server](https://dev.co/ai/mcp/obsidian-mcp-server) | Patch at heading/block/frontmatter granularity | No review UI |--}{#s108}

{--| [marimo +](https://marimo.io/features/best-agent-for-jupyter) `marimo pair` | Plain text file _is_ the agent read API; agents drive live state, not snapshots | Code, not prose |--}{#s109}

{--| [OXA](https://oxa.dev/articles/introducing-oxa) / [MyST](https://docs.curvenote.com/publish/authoring-in-myst) | Typed nodes (math, figure, citation, code) — rich rendering _and_ agent addressing fall out of one decision; executable figures verified in CI | New / publish-oriented |--}{#s110}

{--| [HackMD](https://hackmd.io/@hackmd-blog/agentic-workflow-2026) | Content negotiation: one URL, HTML for humans, raw Markdown for agents | Hosted |--}{#s111}

{--| Notion MCP, Canvas/Artifacts, Google Docs suggestions | Zero-friction UX benchmarks | Page-level replace, ephemeral, or proprietary — none addressable by agents |--}{#s112}

{--### Adjustments to the design from the survey--}{#s113}

{--- **Branch-then-merge for agent edits (from Patchwork).** Beyond `ifVersion`, let an agent write to a named draft branch (a snapshot lineage in `.roughdraft/history/`); the human sees agent changes as a reviewable diff and merges hunks selectively. This subsumes "what did the agent change since I looked" and is a better fit for long autonomous sessions than in-place suggestions for every edit. Suggestions (CriticMarkup) remain the tool for _targeted_ proposals; branches for _bulk_ work.--}{#s114}

{--- **Make the block model typed, not just addressed (from OXA/MyST).** `get_blocks` returns `{id, type: heading|para|code|mermaid|math|figure|table|callout|citation, attrs, markdown}`. Same node model drives rendering and MCP — one design decision, two payoffs.--}{#s115}

{--- **Content negotiation (from HackMD).** `GET /doc?path=…` with `Accept: text/markdown` returns raw source; agents without MCP get a clean read API for free.--}{#s116}

{--- **Round-trip loss is the load-bearing risk.** Survey and my tests agree: marked→TipTap→turndown is already lossy on fences/tables (#125, #94, #98, #100). Slice 1 must add a **round-trip fixture suite** (markdown → open → save → byte-compare) before adding any rich block. Long-term option: preserve unknown/rich blocks as opaque raw-markdown nodes (upstream already has a `rawMarkdownBlockAttribute` hook) so nothing the editor doesn't understand gets rewritten.--}{#s117}

{--- **Sanitizer.** No allowlist sanitizer in the tree; rich HTML goes only through the sandboxed-iframe block, and everything else through typed nodes — never through raw HTML passthrough.--}{#s118}

{++| [Block MCP (WordPress)](https://github.com/GravityKit/block-mcp) | Stable per-block refs; block ops at any depth; ETag/If-Match; revision per write | WordPress/HTML only |++}{#s119}

{++| [Ink & Switch Patchwork](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/07/) | Agent edits on a branch; human partial-merges | Research prototype |++}{#s120}

{++| [A2UI](https://a2ui.org/) | Declarative streaming component JSON from a curated catalog; bidirectional actions; MCP transport | Young (0.9.1); no doc/review model of its own |++}{#s121}

{++| [BlockSuite/AFFiNE](https://blocksuite.io/guide/working-with-block-tree.html) | Block tree with stable IDs | Not Markdown-on-disk |++}{#s122}

{++| [obsidian-mcp-server](https://dev.co/ai/mcp/obsidian-mcp-server) | Heading/block/frontmatter patch granularity | Write-only from the agent side; no shared read-write UI |++}{#s123}

{++| [marimo](https://marimo.io/features/best-agent-for-jupyter) | Plain file is the read API; agents drive live state | Code, not prose |++}{#s124}

{++| [OXA](https://oxa.dev/articles/introducing-oxa) / [MyST](https://docs.curvenote.com/publish/authoring-in-myst) | Typed nodes; executable figures verified in CI | Publish-oriented |++}{#s125}

{++| [HackMD](https://hackmd.io/@hackmd-blog/agentic-workflow-2026) | Content negotiation | Hosted |++}{#s126}

{++| Notion MCP, Canvas/Artifacts, Google Docs | UX benchmarks | Not addressable by agents |++}{#s127}

{++Rev-2 comments preserved for thread continuity:++}{#s128}

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

suggestions:
  s1:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s2:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s3:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s4:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s5:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s6:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s7:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s8:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s9:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s10:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s11:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s12:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s13:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s14:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s15:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s16:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s17:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s18:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s19:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s20:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s21:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s22:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s23:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s24:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s25:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s26:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s27:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s28:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s29:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s30:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s31:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s32:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s33:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s34:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s35:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s36:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s37:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s38:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s39:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s40:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s41:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s42:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s43:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s44:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s45:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s46:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s47:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s48:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s49:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s50:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s51:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s52:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s53:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s54:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s55:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s56:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s57:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s58:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s59:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s60:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s61:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s62:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s63:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s64:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s65:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s66:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s67:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s68:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s69:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s70:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s71:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s72:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s73:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s74:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s75:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s76:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s77:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s78:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s79:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s80:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s81:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s82:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s83:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s84:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s85:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s86:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s87:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s88:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s89:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s90:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s91:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s92:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s93:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s94:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s95:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s96:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s97:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s98:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s99:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s100:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s101:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s102:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s103:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s104:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s105:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s106:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s107:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s108:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s109:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s110:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s111:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s112:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s113:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s114:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s115:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s116:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s117:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s118:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s119:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s120:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s121:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s122:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s123:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s124:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s125:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s126:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s127:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
  s128:
    by: AI
    at: "2026-08-16T01:50:00.000Z"
