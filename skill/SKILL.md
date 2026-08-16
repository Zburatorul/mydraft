---
name: myd
description: Review, annotate, and discuss Markdown documents with the user through the myd viewer — plans, research notes, explainers with diagrams/math/charts. Use when the user asks to review/comment on a doc, mentions myd or rd/Roughdraft, wants a plan or design to look at, or when you're about to produce a diagram, table, or explainer that deserves rich rendering instead of ASCII.
---

# myd — human–agent document review

When the user wants to review, comment on, or discuss a Markdown file (plans, research notes, explainers), use `myd` (on PATH; source `~/LocalDev/mydraft`). When asked for a plan or a design, write it as a Markdown file on disk first, then hand it over:

```bash
myd view "/abs/file.md" --wait     # opens the viewer, blocks until the user clicks Done Reviewing (their note is printed)
myd comments "/abs/file.md"        # what they left, in document order (--json for machine output)
myd reply FILE c3 "…"  /  myd resolve FILE c3 [--summary "…"]
```

Leave `--wait` running — its exit is your signal to resume. Then, in this order: **`myd comments FILE` first** (ids come from there — never guess an id, never hand-edit `{>>…<<}` markers or the YAML endmatter; the CLI writes those); answer each comment in-thread with `myd reply`; for suggestions (`originalText → replacementText`) either apply the change to the source (`myd set-block`) or reply why not; `myd resolve` what you've handled; **then `myd view FILE --wait` again** so the user sees the result and can continue.

The viewer renders GFM, KaTeX, Shiki code, `> [!NOTE]` callouts, and ```` ```mermaid ````, ```` ```vega-lite ````, ```` ```html ```` (sandboxed) fences — prefer these over ASCII diagrams/tables. Users can annotate selected text, whole blocks, and diagram nodes/chart marks; object comments show as `@block›target` in `myd comments`. Edit by block (`myd blocks | block | set-block | insert`) rather than rewriting a file the user has annotated, and name blocks you'll revisit: `## Title {#name}` / ```` ```mermaid {#name} ````.

Before doing anything non-trivial with myd, run `myd help` (all verbs) or `myd guide <topic>` — topics: `workflow blocks objects rich criticmarkup export api`. `myd guide objects` is the inventory of everything a user can annotate and how it appears to you; `myd export FILE` makes a single self-contained HTML; `myd shot FILE out.png` screenshots the rendering so you can check it. Fallback if myd is broken: `~/LocalDev/mydraft/bin/rd-open FILE` (Roughdraft).

## Deeper reference

`references/agent-guide.md` (same as `myd guide`): sections `workflow`, `blocks`, `objects` (the full inventory of annotatable things and how each appears in the file/JSON), `rich`, `criticmarkup` (on-disk format), `export`, `api`. Read the section you need before doing block edits, interpreting object comments, or hand-editing CriticMarkup.
