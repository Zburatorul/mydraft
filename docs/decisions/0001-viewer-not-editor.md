# ADR 0001 — The collaboration surface is a viewer with an annotation layer, not a WYSIWYG editor

**Status:** accepted, 2026-08-15
**Context:** building a human–agent knowledge-work tool on top of / instead of Roughdraft.

## The question we discovered

When designing a shared document surface for a human and an agent, the fork in the road is:

- **Editor** (Roughdraft, Google Docs, Notion): the human's edits go through a rich-text editor whose internal model (TipTap/ProseMirror doc, etc.) is the thing being edited, and the file is *derived* from it on save.
- **Viewer + annotations**: the file (Markdown) is the only model. It is rendered one-way for reading; the human's contributions are *annotations on the rendering* (highlights, comments, suggestions, clicks on objects) that are written back into the file at source positions. Structural edits are done by the agent (CLI/MCP) or by the human in their own text editor.

We were about to extend Roughdraft's editor and realized every hard problem we'd hit was a consequence of the editor choice, not of Roughdraft.

## Technical implications (why viewer wins for this use)

| Concern | Editor | Viewer + annotations |
|---|---|---|
| Rich blocks (Mermaid, math, charts, HTML islands, canvases) | Each needs an editor node type + inverse serializer (turndown rule); anything unknown is **lost on round-trip** | Each is a render plugin; source is never rewritten, unknown things pass through untouched |
| Fidelity of the file | Editor re-serializes the whole doc on every save → reformatting churn, corrupted links/tables (Roughdraft #98/#100/#94/#125, observed live) | Only surgical splices at known offsets; the rest of the file is byte-identical |
| Comment on arbitrary objects (a diagram node, a chart mark, a widget) | Editor selection model is text-only; objects are opaque atoms | One anchor mechanism: `data-pos` source range on every rendered element + optional inner target id (`node:A`, `#el`) |
| Sanitization / interactivity | Interactive content must be an editor node → hard, and unsafe HTML must be sanitized inside the editor | Interactive content lives in sandboxed islands or declarative renderers (A2UI/Vega); the annotation layer sits *outside* them |
| Agent ergonomics | Agent must produce whole-file rewrites or fight the editor's model | Agent edits the file by block ops; viewer just re-renders (live reload) |
| Concurrency | Human's editor buffer vs agent's file writes → clobber risk on every autosave | Human never holds a divergent buffer; annotations are appended at offsets against the current version (`ifVersion`) |
| Codebase size | Editor + serializer + per-block plugins | Render pipeline + anchor mapping + small server |

Cost of the viewer choice: the human can't free-type paragraphs in the surface. Mitigations: suggestions (`{~~a~>b~~}`) cover small edits; a raw-source pane or the user's own editor covers large ones; the agent covers structural ones. For research/review workflows this is the natural division of labor anyway.

## Decision

Build `myd`: a Markdown viewer with (1) a rich one-way render pipeline, (2) an annotation layer that maps selections/clicks back to source positions and writes Roughdraft-compatible CriticMarkup + YAML endmatter, (3) a CLI (later wrapped as MCP) for agents to read/wait/reply/edit blocks. Reuse Roughdraft's file format and `rfm` parser so files stay interoperable.

## Consequences to watch

- Anchor robustness: text-based anchoring within a block (anchorText + block range) is the v1; exact char mapping across Markdown syntax is not attempted.
- If a real need for in-surface free typing appears, add a per-block "edit source" affordance (textarea over the block's source range) — still not a WYSIWYG model.
