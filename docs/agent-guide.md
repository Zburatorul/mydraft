# myd — agent guide

`myd` is a Markdown viewer with an annotation layer and an agent CLI. The `.md` file is the only state:
the human reads a rich rendering and annotates it; annotations are written back into the file as
Roughdraft-flavored CriticMarkup + YAML endmatter at exact source offsets; the agent reads/edits the
file with the CLI. Everything below is discoverable via `myd help` and `myd guide <topic>`.

Topics: `workflow` · `blocks` · `objects` · `explainers` · `rich` · `criticmarkup` · `export` · `api`

---

## workflow — the review loop

```bash
myd view /abs/doc.md                 # open viewer and return; end the agent turn
myd comments /abs/doc.md             # next turn: pending items in document order (--json; --all includes resolved)
myd reply /abs/doc.md c3 "…"         # thread reply (author AI); myd resolve /abs/doc.md c3 [--summary "…"]
myd view /abs/doc.md                 # hand revisions back, nonblocking
```

- Default to asynchronous handoff: open the review, tell the user to return in chat when finished, and end the turn. Do not poll or narrate idle status. On the next user turn, run `myd comments` first.
- Use `--wait --timeout N` only when the user explicitly requests synchronous waiting and the runtime can block without polling (maximum 1800 seconds). If the wait yields and would require polling, terminate only the waiter; the detached server and tab remain usable.
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
### Results {#results}                ← heading name (stripped from display, becomes the element id)
```mermaid {#flow}                    ← fence name on the info string
```

```bash
myd blocks doc.md                     # id  type  guard  first-line   (types: h1..h6, para, code:LANG, list, table, blockquote, math, html)
myd block doc.md flow --json          # full source, current version, and block metadata
myd blocks doc.md --json             # capture version plus each positional block's guard
myd set-block doc.md flow --version <v> <<'EOF' # version is required for content-derived edits
```mermaid {#flow}
graph LR; A-->B
```
EOF
myd insert doc.md results --before --version <v> <<'EOF' … EOF   # insert before/after a block; obtain <v> from `myd blocks --json`
myd set-block doc.md b17 --version <v> --expect <guard> <<'EOF' … EOF  # positional id: guard is mandatory
```

Positional ids shift when blocks are added; name anything you expect to revisit or that the user might comment on.

> [!IMPORTANT]
> **Re-list after every mutation before using another positional `bN` id.** A positional edit requires both the current document `--version` and that listing's per-block `--expect <guard>`. Any mutation invalidates all positional guards, so pairing a newly returned version with an old `bN` fails instead of editing shifted content. Authored names do not require `--expect` because their identity is stable.

## objects — what can be commented on (the annotation inventory)

| Object | How the user targets it | How it appears to you |
|---|---|---|
| Text span | select → 💬 Comment / ✏️ Suggest | `{==text==}{>>…<<}{#cN}` inline; `anchorText` in JSON |
| Whole block (any rich block) | 💬 button on the block | `@bid` — endmatter `anchor: {block}` |
| Mermaid node / edge label / cluster | click it | `@bid›node:<id or label>` |
| Vega/Vega-Lite mark | click it | `@bid›datum:{…}` |
| Native explainer section/card/event/result | click it | `@bid›stable-id`; inspect or patch with `myd object` / `myd set-object` |
| HTML island | 💬 on the block (inner elements are sandboxed) | `@bid` |
| Whole document | Done Reviewing note | endmatter comment without anchor |

To reference an object in your own reply, use the same notation (`b7`, `flow›node:Viewer`) — the user sees the tag in the rail. Object comments are placed as a standalone `{>>…<<}{#cN}` line right after the block so vanilla Roughdraft still reads them.

Only the CLI kind `[note — document-level, from Done Reviewing]` has the special “read but do not reply or resolve” treatment. Anything with an inline or object anchor is a normal `[comment]`, even if its wording sounds like an overall note.

## explainers — native semantic objects

Use the smallest rendering form that makes the idea easy to read:

1. Prose, lists, tables, and callouts for ordinary structure.
2. Mermaid for relationships or sequence; Vega-Lite for data-driven charts.
3. A native `explainer` fence when the reader should see and annotate stable semantic cards, events, or results.
4. Sandboxed HTML only as an escape hatch for a composition the native forms cannot express.

The current explainer catalog is deliberately small: `timing`, `measurements`, and `result`. Do not contort unrelated material into these shapes or invent unimplemented types. Add a catalog primitive only after a real document exposes a reusable reading job.

Name every explainer fence and every object. Keep one reading question per fence, a short title and lede, and usually two to four sections. Labels should scan quickly; put qualifications in caveats or surrounding prose instead of packing paragraphs into cards. Timing events must say what each party locally observes before acting. Measurement/result status must distinguish `measured`, `communicated`, `derived`, `assumed`, or `speculative`; provenance is optional.

The agent-side edit loop uses the exact `block›target` identity shown by review comments:

```bash
myd objects doc.md --json                         # inventory patchable native objects + document version
myd object doc.md 'decision-epoch›alice-trigger' # standalone editable YAML for one object
myd object doc.md 'decision-epoch›alice-trigger' > /tmp/alice.yaml
# edit /tmp/alice.yaml; keep its id unchanged
myd set-object doc.md 'decision-epoch›alice-trigger' --file /tmp/alice.yaml --version <version>
```

`set-object` replaces only that YAML mapping, preserves sibling formatting and review metadata byte-for-byte, validates the complete explainer before writing, and rejects stale versions. `objects` currently inventories native explainer objects; Mermaid and Vega targets are runtime-derived annotation targets, not source-patchable objects.

## rich — what renders

GFM (tables, task lists, strikethrough) · KaTeX `$…$`/`$$…$$` · Shiki code · `> [!NOTE|TIP|WARNING|IMPORTANT|CAUTION]` callouts · images (relative paths OK) · rich fences:

````markdown
```mermaid {#name}        → diagram (nodes clickable)
```vega-lite {#name}      → chart from Vega-Lite JSON (marks clickable); also ```vega / ```chart
```explainer {#name}      → native timing/measurement/result composition (stable ids clickable and patchable)
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

Server on `localhost:7474` (`myd status`, `myd serve` foreground). `myd view` calls `POST /api/reviews` and opens the opaque `/review/<reviewId>` route; reviews from different callers of one document remain independent. `myd view` sends a `context.session` (`--session`, else `MYD_SESSION`/`CLAUDE_CODE_SESSION_ID`), so re-opening a document supersedes only that caller's own earlier review — a stale tab goes read-only instead of completing a review nobody is waiting on. The durable registry supports `GET /api/reviews?status=active|superseded|completed|archived`, `GET /api/reviews/<reviewId>`, and `POST /api/reviews/<reviewId>/archive`. The root route serves a **Review Inbox** listing every agent's work — `GET /api/inbox[?status=…]` returns rows of `{id, title, status, agent, session, project, revision, unresolved: {comments, suggestions}, readable}` (active and completed by default, most recently touched first); `/ws?inbox=1` pushes `{type:"reviews-changed"}` so the list updates without a refresh. A review whose document is gone stays listed with `readable: false`. Tabs poll `GET /api/tracking?review=&version=` and become read-only when their review is completed, superseded, archived, or unknown. `GET /api/doc?review=` → `{name, version, revision: {number, version, createdAt}, html, items}` (or raw Markdown with `Accept: text/markdown`); revision numbers are persistent, monotonic per document, and advance when the backend observes a new content hash. `POST /api/annotate|annotate-object|reply|resolve|done`; `GET /api/done-events?review=&path=`; WebSocket `/ws?review=` pushes `{type:"changed"|"done"|"tracking-changed"}`. The legacy path-based `/api/track`, `?path=`, and `/ws?path=` forms remain compatible. Viewer mutations accept `reviewId` and `version`, returning 409 when either is stale. A review id is an opaque handle that may travel to another machine, so nothing reachable with only that id returns the server-side path: review records identify their document by `title`, `/api/doc?review=` by `name`, inbox rows carry no path at all, and a document that has gone missing yields a path-free 410. A caller that passes `?path=` still gets `path` back and the detailed filesystem error, since neither tells it anything it did not supply.
