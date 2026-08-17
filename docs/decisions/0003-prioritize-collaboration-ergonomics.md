# ADR 0003 — Prioritize collaboration ergonomics before workflow specialization

**Status:** accepted, 2026-08-17

mydraft exists to make human–agent collaboration across domains flexible and convenient: an agent composes a readable artifact, a human understands and annotates meaningful parts, and the agent efficiently interprets and revises those exact parts. We will prioritize work in this dependency order: **(1) universal collaboration substrate, (2) domain-neutral object catalog, (3) agent ergonomics and domain guidance, and (4) optional workflow capabilities**. This prevents a useful but narrower workflow—such as research publishing, model-result resolution, provenance, or durable runtime delivery—from becoming the product's organizing abstraction.

## Consequences

- Ephemeral documents and collaborative works in progress are first-class. They require no authorship, provenance, publication, or archival metadata by default.
- Domain structure should normally enter through compositions of catalog objects and progressively loaded skill guidance, not through domain-specific concepts in the core renderer or review protocol.
- Workflow capabilities remain available and may become sophisticated, but they are opt-in and must stay invisible to documents that do not need them.
- Catalog additions should describe broadly reusable reading or interaction jobs. Validate important additions on materially different domains before treating them as general.
- The next milestone is **explainer collaboration ergonomics**: discoverable semantic objects for humans, semantic object inventory and targeted patching for agents, a broader but still domain-neutral catalog, and stronger explainer guidance in the myd skill.
