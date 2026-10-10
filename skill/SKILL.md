---
name: myd
description: Review, annotate, and discuss Markdown documents with the user through the myd viewer — plans, research notes, explainers with diagrams/math/charts. Use when the user asks to review/comment on a doc, mentions myd or rd/Roughdraft, wants a plan or design to look at, or when you're about to produce a diagram, table, or explainer that deserves rich rendering instead of ASCII.
---

# myd — human–agent document review

## Mental model

- **Markdown is canonical; myd is the review transport.** The file on disk is the document. Comments and replies live inside it as CriticMarkup plus endmatter — never hand-edit either.
- **Handoff is asynchronous.** Open a review, end your turn, never poll.
- **Read before you write.** The next turn starts with `myd comments`.
- **A completed review is history.** Once the user clicks Done, revise and open the result as a *new* review; do not keep mutating the old one.
- **In a live review, reply before you replace.** Answer a comment in its thread before rewriting the text it is anchored to.

## Core loop

```bash
myd view "/abs/doc.md" --wait --timeout 0  # Claude Code, run in the background: Done wakes you
myd view "/abs/doc.md"                    # elsewhere: tell the user, end the turn
myd comments "/abs/doc.md"                # when you resume: pending items, each with its block's guard
myd reply FILE c3 "…"  ·  myd resolve FILE c3 [--summary "…"]
myd set-block FILE --target-guard G --file new.md    # edit the block a comment points at
myd view "/abs/doc.md" ... --from-review  # after Done: hand back showing changes since that review
```

Never poll a background wait; ignore one that reports its review was replaced.

`[note — document-level, from Done Reviewing]` items are read-only: act on them, never reply or resolve. If only the user can answer, ask in the thread and hand back.

## Choosing how to revise

| Situation | Do this |
|---|---|
| One localized change, or the document still carries review markup | Guarded op: `myd set-block` / `insert` (`--target-guard` from `myd comments` or one `myd blocks --json` listing), `myd set-object` for explainer objects. Batch many edits from **one** listing; never refresh a guard right before writing. |
| Completed review, and the revision is multi-block or structural (best written as one patch) | Clean revision: write the new Markdown fresh with no CriticMarkup or endmatter, `myd check doc.md`, then `myd view doc.md --from-review`; it opens in Changes mode against the completed review, whose snapshot myd keeps. |

Name blocks you will revisit: `## Title {#name}`, ```` ```explainer {#name} ````.

## Go deeper only when needed

`myd help <command>` gives exact flags and guards. `myd guide <topic>` (same text as `references/agent-guide.md`) covers:

- `workflow`: the background `--wait` handoff, reading comment output, and verifying renders with `check` and `shot`.
- `blocks`: guards, batches, `--dry-run`.
- `objects`: what can be commented on.
- `explainers`: native semantic objects.
- `rich`: which fences render.
- `criticmarkup`: the on-disk format.
- `export`: self-contained HTML.
- `api`
- `remote`

Load the topic before an operation it covers.
