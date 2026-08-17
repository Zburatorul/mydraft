# mydraft collaboration context

mydraft is a shared document surface for human–agent knowledge work. Markdown remains the source, while rendering, semantic objects, annotations, and agent operations make the source convenient to understand and revise together.

## Language

**Collaboration substrate**:
The domain-neutral foundation shared by every document: Markdown source, rich rendering, semantic identity, annotations, replies, revisions, and review handoff.
_Avoid_: Research platform, publishing pipeline

**Semantic object**:
A meaningful rendered unit with a stable identity and a source representation, suitable for precise human annotation and agent revision.
_Avoid_: Widget, DOM element

**Object catalog**:
The domain-neutral vocabulary of composable semantic objects available to agents, such as flows, comparisons, timelines, cards, metrics, relationships, decisions, and callouts.
_Avoid_: Domain schema, component marketplace

**Domain guidance**:
Progressively loaded skill instructions that teach an agent how to select and compose catalog objects for a field or task without changing the collaboration substrate.
_Avoid_: Core domain model

**Workflow capability**:
An optional facility around the collaboration loop, such as publishing, external-value resolution, citation checking, durable events, provenance, or archival. A document does not need workflow capabilities to be a first-class collaboration surface.
_Avoid_: Core requirement
