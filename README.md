# mydraft

Small tools that make Roughdraft (`npm i -g roughdraft`) usable for human–agent review, plus the plan for where this goes (`plans/roughdraft-plus.md`).

| Tool | What |
|---|---|
| `bin/rd-open FILE.md` | Open in Roughdraft and block until Done Reviewing, without the 5-minute crash (upstream #127). |
| `bin/rd-shot FILE.md [OUT.png]` | Screenshot the rendered doc (headless Playwright, uses roughdraft's bundled browser). |
| `bin/rd-diff OLD.md NEW.md [OUT.md]` | CriticMarkup diff between two versions, viewable in Roughdraft. |

Env: `MYD_PORT`, `MYD_HOME` (state dir) run an isolated instance; `MYD_NO_OPEN=1` suppresses the browser — the eval runner uses all three (`:7575`, `~/tmp/myd-eval/.myd-home`).

Agent integration (three rungs, all installed idempotently by `myd install-prompt`): `docs/prompt.md` → ~100-word always-loaded pointer in `~/.claude/CLAUDE.md` + `~/.codex/AGENTS.md` (marker-delimited); `skill/` → symlinked to `~/.claude/skills/myd` + `~/.codex/skills/myd` (SKILL.md workflow, references/agent-guide.md); `myd help` / `myd guide <topic>` from the CLI. `--remove` uninstalls all; `--file F` targets any other agent file.
