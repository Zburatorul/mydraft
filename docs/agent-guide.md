# myd — agent guide

`myd` is a Markdown viewer with an annotation layer and an agent CLI. The `.md` file is the only state:
the human reads a rich rendering and annotates it; annotations are written back into the file as
Roughdraft-flavored CriticMarkup + YAML endmatter at exact source offsets; the agent reads/edits the
file with the CLI. Everything below is discoverable via `myd help` and `myd guide <topic>`.

Topics: `workflow` · `blocks` · `objects` · `rich` · `criticmarkup` · `export` · `api`

---

## workflow — the review loop

```bash
myd view /abs/doc.md --wait          # open viewer; blocks until the user clicks Done Reviewing; prints their note
myd comments /abs/doc.md             # pending items in document order (--json; --all includes resolved)
myd reply /abs/doc.md c3 "…"         # thread reply (author AI); myd resolve /abs/doc.md c3 [--summary "…"]
myd view /abs/doc.md --wait          # hand it back
```

- Always leave `--wait` running; its exit is the signal. Missed a Done? `curl localhost:7474/api/done-events?path=/abs/doc.md`.
- Edits you make while the viewer is open show up live (file watcher). Prefer block ops (below) to whole-file rewrites: they keep the user's annotations and diff cleanly.
- After a substantial rewrite of a doc the user already reviewed: `myd diff OLD.md NEW.md` → CriticMarkup diff file they can open with `myd view`.
- Verify what you rendered: `myd shot /abs/doc.md out.png` (headless Chrome), then look at the PNG.

Reading `myd comments` output:

```
c6 [comment] user L28 @b7               ← object comment on block b7 (whole block)
c5 [comment] user L14 @flow›node:Viewer ← object comment on Mermaid node "Viewer" in block {#flow}
s1 [suggestion] user L40                ← originalText → replacementText, then optional note
c2 [reply→s1] user L54                  ← thread reply
c10 [comment] user L54                  ← document-level comment (the Done note)
```

## blocks — addressing and editing by block

Blocks are the top-level Markdown nodes: `b0…bn` positionally, or a **stable name** when the source carries one:

```markdown
## Results {#results}                 ← heading name (stripped from display, becomes the element id)
```mermaid {#flow}                    ← fence name on the info string
```

```bash
myd blocks doc.md                     # id  type  first-line          (types: h1..h6, para, code:LANG, list, table, blockquote, math, html)
myd block doc.md flow                 # print that block's source
myd set-block doc.md flow <<'EOF'     # replace it (stdin or --file F); use --version <v> from `myd blocks --json` to guard against concurrent edits
```mermaid {#flow}
graph LR; A-->B
```
EOF
myd insert doc.md results --before <<'EOF' … EOF   # insert before/after a block
```

Positional ids shift when blocks are added; name anything you expect to revisit or that the user might comment on.

## objects — what can be commented on (the annotation inventory)

| Object | How the user targets it | How it appears to you |
|---|---|---|
| Text span | select → 💬 Comment / ✏️ Suggest | `{==text==}{>>…<<}{#cN}` inline; `anchorText` in JSON |
| Whole block (any rich block) | 💬 button on the block | `@bid` — endmatter `anchor: {block}` |
| Mermaid node / edge label / cluster | click it | `@bid›node:<id or label>` |
| Vega/Vega-Lite mark | click it | `@bid›datum:{…}` |
| HTML island | 💬 on the block (inner elements are sandboxed) | `@bid` |
| Whole document | Done Reviewing note | endmatter comment without anchor |

To reference an object in your own reply, use the same notation (`b7`, `flow›node:Viewer`) — the user sees the tag in the rail. Object comments are placed as a standalone `{>>…<<}{#cN}` line right after the block so vanilla Roughdraft still reads them.

## rich — what renders

GFM (tables, task lists, strikethrough) · KaTeX `$…$`/`$$…$$` · Shiki code · `> [!NOTE|TIP|WARNING|IMPORTANT|CAUTION]` callouts · images (relative paths OK) · rich fences:

````markdown
```mermaid {#name}        → diagram (nodes clickable)
```vega-lite {#name}      → chart from Vega-Lite JSON (marks clickable); also ```vega / ```chart
```html {#name}           → sandboxed iframe island (scripts allowed, isolated); use for interactive widgets
````

Every rich block has a "source" toggle. Prefer these over ASCII diagrams/tables. Anything the viewer doesn't understand passes through untouched.

## criticmarkup — the on-disk format (Roughdraft-compatible)

```markdown
Text with {==an anchored==}{>>comment<<}{#c1} and a {~~typo~>fix~~}{#s1}.
{>>block-level comment placed after a fence<<}{#c2}

---
comments:
  c1: {by: user, at: "2026-08-16T01:00:00Z"}
  c2: {by: user, at: "…", anchor: {block: flow, target: "node:Viewer"}}
  c3: {body: "reply text", by: AI, at: "…", re: c1, status: resolved}
suggestions:
  s1: {by: user, at: "…"}
```

Markers: `{==x==}` highlight · `{>>c<<}` comment · `{++x++}` insertion · `{--x--}` deletion · `{~~a~>b~~}` substitution · `{#cN}`/`{#sN}` id ref. CriticMarkup inside fenced code is literal. Use `myd reply/resolve` rather than hand-editing endmatter; if you must hand-edit, keep ids unique and `roughdraft doctor FILE` (if installed) still passing.

## export — delivery artifact

`myd export doc.md [out.html]` → one self-contained HTML (CSS, KaTeX fonts, and Mermaid/Vega only if used, all inlined). Opens from `file://`, no server. Annotations are not included (clean render).

## api — for scripts / future MCP

Server on `localhost:7474` (`myd status`, `myd serve` foreground). `myd view` calls `POST /api/track` and puts the returned `reviewId` in the viewer URL; a newer review for the same path supersedes the older one. Tabs poll `GET /api/tracking?path=&review=&version=` and become read-only when their review is completed, superseded, or unknown. `GET /api/doc?path=` → `{version, revision: {number, version, createdAt}, html, items}` (or raw Markdown with `Accept: text/markdown`); revision numbers are persistent, monotonic per document, and advance when the backend observes a new content hash. `POST /api/annotate|annotate-object|reply|resolve|done`; `GET /api/done-events?path=`; WebSocket `/ws?path=` pushes `{type:"changed"|"done"|"tracking-changed"}`. Viewer mutations accept `reviewId` and `version`, returning 409 when either is stale.
