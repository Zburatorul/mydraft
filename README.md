# mydraft

Small tools that make Roughdraft (`npm i -g roughdraft`) usable for human–agent review. The current product and execution roadmap is [`plans/roadmap.md`](plans/roadmap.md).

| Tool | What |
|---|---|
| `bin/rd-open FILE.md` | Open in Roughdraft and block until Done Reviewing, without the 5-minute crash (upstream #127). |
| `bin/rd-shot FILE.md [OUT.png]` | Screenshot the rendered doc (headless Playwright, uses roughdraft's bundled browser). |
| `bin/rd-diff OLD.md NEW.md [OUT.md]` | CriticMarkup diff between two versions, viewable in Roughdraft. |

Rich documents can also use an `explainer` fence for native, responsive timing/measurement/result layouts. Authored object IDs become precise annotation targets. Agents can inventory and surgically revise those same `block›target` objects with `myd objects`, `myd object`, and `myd set-object`; the full fence is validated before a guarded write. Sandboxed `html` fences remain available for one-off visual work; elements marked with `data-myd-id="…"` can report their identity and selected text through myd's narrow annotation bridge.

## Publish an immutable release

`myd publish` composes the existing standalone exporter with a small local release transaction:

```bash
myd publish notes/wip.md --profile research
```

By default it writes `.myd-publish/wip/` beside the source document. These local generated archives are ignored by Git; `--output-dir DIR` overrides the location. Each successful run creates an immutable bundle under `releases/<timestamp>-<source-hash>/` containing `source.md`, `index.html`, and `manifest.json`. The root `index.json` points to the current release and lists prior bundles newest-first.

Publish v0 checks for server-rendered rich-block errors before committing. A failed check leaves the previous index and releases untouched. Concurrent publishes fail fast through `.publish.lock`; myd never deletes a pre-existing lock automatically, so a stale lock must be inspected and removed explicitly. Model references, links, screenshots, contrast, and responsive-layout checks remain promotion gates for later slices; the manifest does not claim they ran.

Env: `MYD_PORT`, `MYD_HOME` (state dir) run an isolated instance; `MYD_NO_OPEN=1` suppresses the browser — the eval runner uses all three (`:7575`, `~/tmp/myd-eval/.myd-home`).

Agent integration (three rungs, all installed idempotently by `myd install-prompt`): `docs/prompt.md` → ~100-word always-loaded pointer in `~/.claude/CLAUDE.md` + `~/.codex/AGENTS.md` (marker-delimited); `skill/` → symlinked to `~/.claude/skills/myd` + `~/.codex/skills/myd` (SKILL.md workflow, references/agent-guide.md); `myd help` / `myd guide <topic>` from the CLI. `--remove` uninstalls all; `--file F` targets any other agent file.
