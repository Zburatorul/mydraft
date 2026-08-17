# ADR 0004 — Adopt Proof’s mutation discipline selectively

**Status:** accepted, 2026-08-17

Proof SDK validates several reliability concerns, but its proposed adoption sequence bundles together problems with very different evidence in mydraft. We will adopt one deep document-mutation seam now because the code already has multiple CLI and HTTP writers with duplicated reads, direct non-atomic writes, and inconsistent version rules. The seam should re-read the canonical Markdown, enforce the precondition appropriate to the operation, apply a pure source transformation, write atomically, and return one consistent result or conflict. Authored block names and semantic-object IDs remain the durable targets; positional block references are valid only against an exact source version.

We will not require a global base version for operations whose stable identity makes them safely applicable to the current document, such as replying to an extant comment. Selection- and content-derived edits must retain strict version checks. Caller-supplied idempotency keys, formal actor identity, cross-process coordination, and rich conflict snapshots enter this interface only when a retriable external client or a reproduced concurrency failure makes them necessary.

We adopt “what changed since this review opened?” as a product question, not the proposed snapshot platform. The first implementation, if current reviews validate the need, should be the smallest readable summary of changed named blocks and semantic objects. A durable event journal, revision picker or rollback store, machine-readable protocol discovery, capabilities, and provenance remain independently triggered workflow capabilities: event durability requires a real runtime consumer or observed restart loss; discovery requires a second external adapter; capabilities require remote or multi-user exposure; provenance requires a shared or published artifact.

We explicitly reject importing Proof’s editor authority, CRDT/storage stack, mandatory workflow metadata, or its entire protocol surface. Markdown remains mydraft’s only document model, and the current explainer collaboration loop remains the product milestone.
