# Persistent generative UI: prior art and benchmark landscape

## Bottom line

The proposal is a coherent combination of two active lines of work:

1. **Generative (or agentic) UI**: an agent chooses and composes an interactive interface from conversational context.
2. **Experience-driven, lifelong agents**: an agent turns experience into persistent, reusable procedures and improves later tasks.

The combination is not, from the sources below, an established end-to-end benchmark: I found no benchmark that simultaneously tests multi-session human collaboration, dynamically generated UI, persistent reusable UI artifacts, and the causal benefit of that reuse. That is a real research/product gap rather than evidence that the idea is incoherent.

The important design distinction is between an agent *composing trusted primitives* and an agent *authoring new executable widgets*. The former is now a fairly standard generative-UI architecture; the latter is an interesting but higher-risk self-evolving-system extension. A useful first implementation would learn and reuse **UI recipes** (a task/schema, component composition, interaction policy, and evaluation evidence) while keeping executable widgets in a developer-governed catalog.

## Closest prior work

### Dynamic, domain-specific interactive UI

- [Google Generative UI / PAGEN](https://generativeui.github.io/) is the closest conceptual prior art for “make a bespoke interactive page for the current user need.” The project describes an LLM system that makes a custom visual-interactive experience for an arbitrary prompt, and releases the PAGEN dataset; its [paper](https://generativeui.github.io/static/pdfs/paper.pdf) reports human-preference evaluation. It is prompt/page-level generation, not a persistent component library.
- [A2UI](https://github.com/a2ui-project/a2ui) is the closest open protocol and implementation shape. An agent streams declarative UI structure and data; the client renders it with native components. Its [protocol specification](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_8/docs/a2ui_protocol.md) explicitly separates a component tree, data model, and client-owned component **catalog**, supports updates after user actions, and supports versioned custom catalogs. The repository even uses dynamic reservation forms as an example. This is almost the proposed rendering layer, but the catalog is trusted and client-owned rather than automatically expanded by the model.
- [Vercel json-render](https://github.com/vercel-labs/json-render) is a compact open-source reference implementation of the same safe pattern: natural-language control produces a UI constrained to a developer-defined registry and event handlers.
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) is the official MCP extension for tools that display interactive UIs inline in a conversation. It is useful for packaging reusable interactive artifacts, but its normal ownership model is developer-authored app UIs invoked by tools, rather than agent-created UI vocabulary.
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) is complementary plumbing for agent-to-frontend events and shared state. It does not itself provide a persistent component-learning mechanism.

### Persistent skill libraries and self-improvement

- [Voyager](https://arxiv.org/abs/2305.16291) is the early archetype: an LLM agent grows an executable skill library, retrieves skills in new environments, and iteratively improves them from feedback. The [reference implementation](https://github.com/MineDojo/Voyager) makes its three elements explicit: curriculum, skill library, and iterative prompting. The domain is Minecraft, not user interfaces.
- [SkillCraft](https://arxiv.org/abs/2603.00718) is the closest benchmark for the **reuse** half of the proposal. It explicitly tests whether agents form, cache, and reuse higher-level compositions of tools across tasks, and reports gains from the persistent library. It does not assess UI selection or human interaction quality.
- [PAST-Bench](https://arxiv.org/abs/2608.04003) is the closest benchmark for the **multi-session self-improvement** half. It runs ordered, fresh-session personal-agent tasks with retained experience enabled/disabled, across memory, procedural reuse, information gathering, and updating. Its pathway checks (save, retrieve, update) are especially relevant to avoiding a vague claim that “the agent improved.”
- [Ratchet](https://arxiv.org/abs/2605.22148) and its [reference implementation](https://github.com/amazon-science/Self-Evolving-Agents-Ratchet) provide a valuable warning and lifecycle model. A self-written skill library can drift and hurt performance; Ratchet evaluates contribution, caps library size, and retires weak skills. This is directly applicable to a registry of UI recipes.
- [AutoSkill](https://github.com/ECNU-ICALK/AutoSkill) is an open-source lifelong-learning system that extracts reusable skills from traces and supports skill evolution. It is another implementation reference for the library-management layer, not a UI system.

## Benchmarks: what exists and what is missing

| Benchmark / project | Tests well | Missing relative to this idea |
| --- | --- | --- |
| [A2UI-Bench / Macaron-A2UI](https://arxiv.org/abs/2605.24830) | Controlled evaluation of generating lightweight executable UI actions for personal agents | Persistent reuse/evolution across sessions and end-user task outcomes |
| [Design Theater](https://arxiv.org/abs/2607.22928) | 24 generative-UI tasks; structural, styling, and functional requirements, plus rationale-to-implementation consistency | Conversation, persistence, and reuse |
| [VISTA](https://arxiv.org/abs/2605.26144) | Functional web-app/UI generation using browser tests and DOM/visual similarity | Multi-session personal-agent interaction and learned reuse |
| [SkillCraft](https://arxiv.org/abs/2603.00718) | Formation, caching, and reuse of composed tools | Interface generation and human usability |
| [PAST-Bench](https://arxiv.org/abs/2608.04003) | Causal effect of retained experience over sequences of personal-agent sessions | UI generation and interactive usability |

The most defensible answer is therefore: **there are adjacent benchmarks, but not one that measures the complete proposed harness.** A credible new benchmark could combine their ideas rather than invent all evaluation machinery from zero.

## A sharp formulation of the idea

> A persistent generative-UI agent that learns, validates, and reuses task-specific interaction recipes across user sessions, over a safe declarative component vocabulary.

“Interaction recipe” is deliberately broader and safer than “component”: it can include a domain data schema, a composition of standard primitives, questions/actions, state transitions, and evidence about when it helped. This provides reuse without granting the model unreviewed code execution.

For the stronger variant, use: **self-evolving UI vocabulary** or **agent-authored UI extensions**. Those terms describe the novelty more honestly, but also signal that versioning, sandboxing, accessibility, privacy, and retirement policies are first-class research problems.

## Recommended experimental shape

Use recurring domains (travel is good: compare, constrain, clarify, select, confirm) plus unrelated domains. Create ordered user sessions where later needs overlap but are not identical. Compare:

1. text-only agent;
2. fixed catalog, no persistent recipes;
3. persistent recipes, no new recipe creation;
4. proposed system, with learned recipes;
5. optionally, proposed system with human/developer approval before promotion.

Measure task completion and decision quality, elapsed interaction/turns, user correction burden and preference, schema/action validity, accessibility and safety checks, and reuse efficiency. For the library itself, measure appropriate retrieval, positive contribution against the no-recipe counterfactual, generalization to held-out variants, and regressions/library drift. Preserve the save → retrieve → apply/update trace, as PAST-Bench does, so apparent gains are attributable to reuse.

## Search vocabulary

Use these queries rather than only “self-improving harness”:

- `generative UI agent component registry`
- `agent-to-user interface A2UI catalog`
- `declarative UI protocol LLM`
- `LLM-driven UI synthesis interactive`
- `mixed-initiative adaptive user interface`
- `persistent personal agents procedural memory benchmark`
- `experience-driven lifelong learning agent`
- `self-evolving agent skill library`
- `tool composition caching reuse benchmark`
- `agent-authored UI extensions` / `self-evolving UI vocabulary`

## Practical thesis

The promising novelty is not “an LLM can draw a flight table”; that capability is already being standardized and implemented. It is the **closed learning loop**: observe whether a particular interactive representation actually helped a person complete a recurring kind of work, promote a safe recipe only with evidence, retrieve it later, adapt it, and retire it when it ceases to help. That is a plausible general-purpose improvement harness, and it is narrow enough to benchmark.
