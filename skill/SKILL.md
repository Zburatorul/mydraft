---
name: myd
description: Review, annotate, and discuss Markdown documents with the user through the myd viewer — plans, research notes, explainers with diagrams/math/charts. Use when the user asks to review/comment on a doc, mentions myd or rd/Roughdraft, wants a plan or design to look at, or when you're about to produce a diagram, table, or explainer that deserves rich rendering instead of ASCII.
---

# myd — human–agent document review

When the user wants to review, comment on, or discuss a Markdown file (plans, research notes, explainers), use `myd` (on PATH; source `~/LocalDev/mydraft`). When asked for a plan or a design, write it as a Markdown file on disk first, then hand it over:

```bash
myd view "/abs/file.md"            # open the viewer, return immediately, then end this agent turn
myd comments "/abs/file.md"        # next turn: read what the user left, in document order
myd reply FILE c3 "…"  /  myd resolve FILE c3 [--summary "…"]
```

Use an **asynchronous handoff by default**. After `myd view FILE` opens the connected review tab, tell the user to return in chat when finished and end the turn. Do not poll the CLI, emit periodic “still waiting” updates, or spend agent turns watching an idle review. The viewer/server continue independently.

When the user returns, run **`myd comments FILE` first**; never guess ids or hand-edit `{>>…<<}` markers/YAML endmatter. Answer with `myd reply`, apply suggestions with block operations, and `myd resolve` handled items. If only the user can answer, reply with the question in-thread, reopen with nonblocking `myd view FILE`, and end the turn. Items shown as `[note]` are overall Done notes; read but do not reply to or resolve them. If a claim cannot be verified, ask in-thread or soften/remove it—never invent evidence.

Use `myd view FILE --wait --timeout N` only when the user explicitly asks for synchronous waiting **and** the execution runtime can block without polling. Never exceed 1800 seconds. If the command yields and continued waiting would require repeated polls or idle commentary, terminate only the waiter and switch to the asynchronous handoff; the detached server and browser tab remain usable.

The viewer renders GFM, KaTeX, Shiki code, `> [!NOTE]` callouts, and ```` ```mermaid ````, ```` ```vega-lite ````, ```` ```html ```` (sandboxed) fences — prefer these over ASCII diagrams/tables. Users can annotate selected text, whole blocks, and diagram nodes/chart marks; object comments show as `@block›target` in `myd comments`. Edit by block (`myd blocks | block | set-block | insert`) rather than rewriting a file the user has annotated, and name blocks you'll revisit: `## Title {#name}` / ```` ```mermaid {#name} ````.

Before doing anything non-trivial with myd, run `myd help` (all verbs) or `myd guide <topic>` — topics: `workflow blocks objects rich criticmarkup export api`. `myd guide objects` is the inventory of everything a user can annotate and how it appears to you; `myd export FILE` makes a single self-contained HTML; `myd shot FILE out.png` screenshots the rendering so you can check it. Fallback if myd is broken: `~/LocalDev/mydraft/bin/rd-open FILE` (Roughdraft).

## Deeper reference

`references/agent-guide.md` (same as `myd guide`): sections `workflow`, `blocks`, `objects` (the full inventory of annotatable things and how each appears in the file/JSON), `rich`, `criticmarkup` (on-disk format), `export`, `api`. Read the section you need before doing block edits, interpreting object comments, or hand-editing CriticMarkup.
