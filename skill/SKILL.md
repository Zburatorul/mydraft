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

When the user returns, run **`myd comments FILE` first**; never guess ids or hand-edit `{>>…<<}` markers/YAML endmatter. Answer with `myd reply`, apply suggestions with block operations, and `myd resolve` handled items. If only the user can answer, reply with the question in-thread, reopen with nonblocking `myd view FILE`, and end the turn. Only items explicitly printed as `[note — document-level, from Done Reviewing]` are overall Done notes; read but do not reply to or resolve them. An inline-anchored item is printed as `[comment]` and should be handled normally even if its prose sounds like an overall note. If a claim cannot be verified, ask in-thread or soften/remove it—never invent evidence.

Use `myd view FILE --wait --timeout N` only when the user explicitly asks for synchronous waiting **and** the execution runtime can block without polling. Never exceed 1800 seconds. If the command yields and continued waiting would require repeated polls or idle commentary, terminate only the waiter and switch to the asynchronous handoff; the detached server and browser tab remain usable.

The viewer renders GFM, KaTeX, Shiki code, `> [!NOTE]` callouts, and ```` ```mermaid ````, ```` ```vega-lite ````, ```` ```explainer ````, ```` ```html ```` (sandboxed) fences — prefer these over ASCII diagrams/tables. Users can annotate selected text, whole blocks, and semantic diagram/explainer objects; object comments show as `@block›target` in `myd comments`, and every anchored item carries its block's guard (`anchor.guard` in `--json`) — pass it straight to `myd set-block FILE --target-guard G` to edit the commented block without any positional id. Edit ordinary Markdown by block. For an authored name, use `myd blocks --json` → capture `version` → `myd set-block ... --version VERSION`. For unnamed blocks, address by content: `--target-guard GUARD` (or `bN --expect GUARD`) with guards from one planning listing — a batch then needs no `--version`, no re-listing, and applies in any order. Never refresh a guard right before the write; that re-targets whatever shifted into the position. For a native explainer, use `myd objects | object | set-object` so one stable object can change without regenerating the fence. Name blocks you'll revisit: `## Title {#name}` / ```` ```explainer {#name} ````.

Before doing anything non-trivial with myd, run `myd help` (command index), `myd help <command>` (that command's flags, guards, defaults and one example) or `myd guide <topic>` — topics: `workflow blocks objects explainers rich criticmarkup export api remote`. **Plan a batch from one `myd blocks --json` listing and pass each block's guard as `--target-guard`; never re-read a guard just before writing.** Use `myd block FILE ID --json` when you need the full source before replacement. `myd guide objects` is the annotation inventory; `myd guide explainers` explains when to use the small native catalog and how to patch it surgically. Do not force content into an explainer type that does not fit. `myd view` runs a browserless structural check first and refuses to open a document that would render broken (`--skip-check` overrides); run `myd check FILE` yourself for the same check on demand. `myd export FILE` makes a single self-contained HTML; `myd shot FILE out.png` screenshots the rendering so you can check it — the check is structural, so `shot` remains the only way to see layout, clipping and final pixels. Fallback if myd is broken: `~/LocalDev/mydraft/bin/rd-open FILE` (Roughdraft).

## Deeper reference

`references/agent-guide.md` (same as `myd guide`): sections `workflow`, `blocks`, `objects` (the annotation inventory), `explainers` (selection, composition, and surgical editing), `rich`, `criticmarkup` (on-disk format), `export`, `api`, `remote`. Read the section you need before doing block or semantic-object edits, interpreting object comments, or hand-editing CriticMarkup.
