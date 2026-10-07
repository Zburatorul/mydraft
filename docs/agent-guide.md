# myd — agent guide

`myd` is a Markdown viewer with an annotation layer and an agent CLI. The `.md` file is the only state:
the human reads a rich rendering and annotates it; annotations are written back into the file as
Roughdraft-flavored CriticMarkup + YAML endmatter at exact source offsets; the agent reads/edits the
file with the CLI. Everything below is discoverable via `myd guide <topic>`; for one command's flags, guards and an example, use `myd help <command>` (or `myd <command> --help`).

`myd view` runs a browserless structural check before it opens anything: unparsable Markdown or review endmatter, duplicate annotation/block ids, an invalid Mermaid, explainer, or chart fence, or a document that renders an error block stops the command with a file:line diagnostic and exit 2, and no review is created. Warnings — a missing local link, a malformed block name — print and the review opens anyway. `myd check FILE [--json]` runs the same check on demand; `myd view --skip-check` opts out. It is a structural preflight only: typography, layout, clipping and client-side rendering are invisible to it, which is what `myd shot` is for.

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
- **Live review vs completed review.** While a review is live (the user has not clicked Done), mutate in place with guarded block/object ops and reply to a comment *before* replacing the text it anchors — a rewrite of anchored source is exactly what the thread is about. After Done, the review is history: for a small follow-up keep using guarded ops and `myd view` again (a new review; the completed one stays intact); for a multi-block or structural revision, make a clean revision — `cp doc.md doc.v1.md`, write the new Markdown fresh without CriticMarkup or endmatter, `myd check doc.md`, optionally `myd diff doc.v1.md doc.md doc.diff.md` for the reviewer, then `myd view`. Rewriting a file that still carries markup with an ordinary editor silently orphans its annotations.
- **Questions only the user can answer:** reply in the thread with the question, hand back with a nonblocking `myd view`, and end the turn. If a claim cannot be verified, ask in-thread or soften/remove it — never invent evidence.
- **Before handing back:** `myd view` runs a browserless structural check and refuses to open a document that would render broken (exit 2 with `file:line`; `--skip-check` overrides); `myd check FILE [--json]` runs the same check on demand. It is structural only — `myd shot` is the way to see layout, clipping and final pixels.
- **If myd itself is broken:** `bin/rd-open FILE` (Roughdraft) in the mydraft checkout — `readlink -f "$(command -v myd)"` resolves into it, and the managed block that `myd install-prompt` writes names it.
- Verify what you rendered: `myd shot /abs/doc.md out.png` (headless Chrome), then look at the PNG.

Reading `myd comments` output:

```
c3 [comment] user @b7 (guard 3e3561b3efaf, ~L38) “quoted text”  ← inline comment in block b7
c6 [comment] user @b7 (guard 3e3561b3efaf, ~L28)                 ← object comment on block b7 (whole block)
c5 [comment] user @flow›node:Viewer (guard 8fda4aa75bf8, ~L14)   ← object comment on Mermaid node "Viewer" in block {#flow}
s1 [suggestion] user @costs (guard 1b2c3d4e5f60, ~L40) “ten”     ← originalText → replacementText, then optional note
c2 [reply→s1] user L54                                           ← thread reply (no anchor of its own)
c10 [note — document-level, from Done Reviewing] user L54         ← the Done note (no anchor)
```

`@` is the block's authored name or its *current* positional id; the `guard` is that block's content guard, the same value `myd blocks --json` prints, and `~L` is only a hint. In `--json` each item carries
`anchor: {block, name, guard, target?, quote, quoteOccurrence, lineApprox}` — `name` is `null` for an unnamed block, `target` is the object inside the block (object comments only), `quote` the anchored text and `quoteOccurrence` the 0-based index of that exact text among its identical occurrences in the marker-free document. Replies and document-level notes have `anchor: null`; the old top-level `line` stays for compatibility.

**Comment → edit round trip, no positional ids:**

```bash
myd comments doc.md --json                               # c3 … "anchor": {"block": "b7", "guard": "3e3561b3efaf", …}
myd set-block doc.md --target-guard 3e3561b3efaf --file new.md   # hits the commented block even if earlier edits moved it
myd reply doc.md c3 "Reworded as asked."
myd resolve doc.md c3
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
myd set-block doc.md b17 --expect <guard> <<'EOF' … EOF  # positional id: guard is mandatory
```

Positional ids shift when blocks are added; name anything you expect to revisit or that the user might comment on.

Before a multi-block edit (a replacement that splits one block into several, or an insert), run it once with `--dry-run`: same validation as the real write, prints the unified diff and which positional ids would shift, writes nothing (`--json` adds the resulting block list with guards).

> [!IMPORTANT]
> **Plan once, address by guard.** A block's `guard` is a hash of its own source (review markup included), so it names the block you planned to edit wherever it has moved. Identical blocks share a guard; one that matches several blocks is refused, so address a duplicated block by id with `--expect` and the listing's `--version`. For a batch — even on a document with no authored names — take one `myd blocks --json` listing and apply every edit with `--target-guard <guard>` from *that* listing; no `--version`, no re-listing, any order. `bN --expect <guard>` also works, and fails with the block's new position if an earlier edit shifted it. **Never refresh a guard just before writing**: a guard read after the fact names whatever now occupies the position, which is exactly the wrong-block bug. A guard expires only when its own block changes; replies and resolutions do not touch it.

```bash
myd blocks doc.md --json > plan.json          # one listing for the whole batch
myd set-block doc.md --target-guard 3e3561b3efaf --file new/costs.md
myd set-block doc.md --target-guard 8fda4aa75bf8 --file new/why.md   # order does not matter
```

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

Do not force content into an explainer type that does not fit; plain Markdown is the default.

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

 ````markdown
 Text with {==an anchored==}{>>comment<<}{#c1} and a {~~typo~>fix~~}{#s1}.
 {>>block-level comment placed after a fence<<}{#c2}

 ---
 comments:
   c1: {by: user, at: "2026-08-16T01:00:00Z"}
   c2: {by: user, at: "…", anchor: {block: flow, target: "node:Viewer"}}
   c3: {body: "reply text", by: AI, at: "…", re: c1, status: resolved}
 suggestions:
   s1: {by: user, at: "…"}
 ````

Markers: `{==x==}` highlight · `{>>c<<}` comment · `{++x++}` insertion · `{--x--}` deletion · `{~~a~>b~~}` substitution · `{#cN}`/`{#sN}` id ref. CriticMarkup inside fenced code is literal. Use `myd reply/resolve` rather than hand-editing endmatter; if you must hand-edit, keep ids unique and `roughdraft doctor FILE` (if installed) still passing.

## export — delivery artifact

`myd export doc.md [out.html]` → one self-contained HTML (CSS, KaTeX fonts, and Mermaid/Vega only if used, all inlined). Opens from `file://`, no server. Annotations are not included (clean render).

## api — for scripts / future MCP

Server on `localhost:7474` (`myd status`, `myd serve` foreground). `myd view` calls `POST /api/reviews` and opens the opaque `/review/<reviewId>` route; reviews from different callers of one document remain independent. `myd view` sends a `context.session` (`--session`, else `MYD_SESSION`/`CLAUDE_CODE_SESSION_ID`), so re-opening a document supersedes only that caller's own earlier review — a stale tab goes read-only instead of completing a review nobody is waiting on. A review id is six characters from a 32-character alphabet that omits `i`, `l`, `o` and `u`, so it survives being retyped or read aloud and needs no URL escaping; the tracker draws again on the rare repeat, and ids issued earlier as UUIDs keep resolving. The durable registry supports `GET /api/reviews?status=active|superseded|completed|archived`, `GET /api/reviews/<reviewId>`, and `POST /api/reviews/<reviewId>/archive`. The root route serves a **Review Inbox** listing every agent's work — `GET /api/inbox[?status=…]` returns rows of `{id, title, status, agent, session, project, revision, unresolved: {comments, suggestions}, readable}` (active and completed by default, most recently touched first); `/ws?inbox=1` pushes `{type:"reviews-changed"}` so the list updates without a refresh. A review whose document is gone stays listed with `readable: false`. Tabs poll `GET /api/tracking?review=&version=` and become read-only when their review is completed, superseded, archived, or unknown. `GET /api/doc?review=` → `{name, version, revision: {number, version, createdAt}, html, items}` (or raw Markdown with `Accept: text/markdown`); revision numbers are persistent, monotonic per document, and advance when the backend observes a new content hash. `POST /api/annotate|annotate-object|reply|resolve|done`; `GET /api/done-events?review=&path=`; WebSocket `/ws?review=` pushes `{type:"changed"|"done"|"tracking-changed"}`. `POST /api/handles {path}` → `{handle}` mints a six-character stand-in for a path, and every `path=` route also accepts `doc=<handle>`; `myd shot` uses it so a document renders through `/?doc=x7k2m9` whatever the file is called, instead of a URL full of escapes. Handles are in-memory, stable per path for the life of the server, and an unknown one is a 404. The legacy path-based `/api/track`, `?path=`, and `/ws?path=` forms remain compatible. Viewer mutations accept `reviewId` and `version`, returning 409 when either is stale. A review id is an opaque handle that may travel to another machine, so nothing reachable with only that id returns the server-side path: review records identify their document by `title`, `/api/doc?review=` by `name`, inbox rows carry no path at all, and a document that has gone missing yields a path-free 410. A caller that passes `?path=` still gets `path` back and the detailed filesystem error, since neither tells it anything it did not supply.

## remote — reviewing from another device

`myd view` defaults to a `localhost` URL and an `xdg-open` on the machine running the server, which is wrong when the reviewer is elsewhere or the box is headless. Launching that browser is best-effort and never decides the command's fate: creating the review is the outcome `myd view` reports on, so when no launcher exists the command still prints a working URL, warns on stderr and exits 0, reporting `{"browserOpened": false, "browserError": …}` under `--json`. Server startup, review tracking and URL generation stay fatal. That keeps an agent on a headless box unblocked, but the reviewer still needs a way in — Set a public origin — `MYD_PUBLIC_URL=https://review.example.test` or `myd serve --public-url https://review.example.test` — and point an authenticated HTTPS reverse proxy or tunnel at the local port. `myd view` then registers the review over localhost as usual, prints `https://review.example.test/review/<reviewId>`, launches no browser, and reports `{"remote": true, "publicUrl": …}` under `--json`. Only the origin changes: `/review/<reviewId>` is the same route the local viewer uses, and it carries nothing but the opaque id, which is already all a review id ever discloses (see the path rules above). The reviewer can also reach the document from the Review Inbox.

Anyone who can reach that origin can reach every review on the server, not just the one whose link you sent: the root route is the Review Inbox, it lists every review id, and any id opens, annotates, or completes that review. The opaque id keeps the file path off the wire; it is not an access control. Restrict the proxy to people trusted with every document under review on that machine, and give a narrower review its own instance (`MYD_HOME`, `MYD_PORT`). Prefer `https://` — an `http://` origin is accepted, but then document text and annotations travel in cleartext.

Remote review is a property of the deployment, not of one command: the server records the origin in its state file, so later `myd view` calls in other shells pick it up, and `myd status` reports it. `MYD_PUBLIC_URL` in the calling process wins, and setting it empty takes one call back to local. A public URL with a path prefix, a non-HTTP scheme, or a query/fragment is rejected with an explanation rather than printed — the viewer loads `/web` and `/api` from the origin root, so a subpath would 404.
