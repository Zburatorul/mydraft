# myd golden eval

Regression suite for **how agents use myd** given the installed prompt (`docs/prompt.md`), skill (`skill/`), and CLI. Each case is a
natural user prompt (never mentions myd), a scripted human journey, and named expectations. Fresh headless sessions of the real
agents run against an **isolated myd instance** (`:7575`, state in `~/tmp/myd-eval/.myd-home`, browser suppressed).

```bash
bun eval/run.ts all --agent both          # full matrix (≈6 min, 10 agent sessions); exit 1 on any hard FAIL
bun eval/run.ts draft-roundtrip --agent claude
```

Artifacts per run: `~/tmp/myd-eval/<agent>-<case>-<hhmmss>/{session.log,tools.txt,sim.log,report.txt,*.md}`. When a cell goes red,
read `tools.txt` (ordered tool calls) and `sim.log` (what the simulated human did) — it is usually obvious within a minute whether the
agent, the prompt/skill, or the harness is at fault. Every red so far has been triaged that way; several were harness bugs.

## Cases (`cases/*.yaml`)

| id | journey | must |
|---|---|---|
| plan-handover | ask for a plan to look over → comment → done ×2 | write .md, `view --wait`, `comments` first, reply/resolve via CLI, hand back |
| explainer-diagram | explain Raft election with a diagram | mermaid fence in .md, no ASCII art, same loop |
| draft-roundtrip | flag an unverifiable claim; answer in thread **or** in chat | no fabrication before the answer; ask/hedge; real figures applied after; resolve; hand back |
| suggestion-apply | user leaves a `{~~a~>b~~}` suggestion | applied to source or declined with a reply |
| object-comment | comment on a Mermaid node (`@flow›node:Cache`) | interpret anchor, edit the `{#flow}` block or justify in-thread |

Journey steps: `on: wait N` (agent's Nth `myd view --wait`) with `annotate` / `suggest` / `object` / `reply` / `done`; `on: turn N`,
`if: question` with `chat:` — resumes the session (`claude -p --resume`, `codex exec resume`) when the agent ended its turn on a question.

Checks live in `run.ts` (`CHECKS`); advisory ones (`asked_in_thread`, `guidance_consulted`) report `warn`, never fail.

## Baselines

`baselines/<date>-<agents>.txt` — copy of the matrix at known-good points. Re-run before/after changing `docs/prompt.md`,
`skill/SKILL.md`, `myd comments` output, or the CLI surface; compare against the latest baseline.

Known agent tendencies (not bugs): Claude tends to end its turn and ask in chat when a comment poses a question it can't answer
(three prompt wordings tried); Codex over-services Done notes unless told they need no reply. Both are handled by the journeys.
