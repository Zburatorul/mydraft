# mydraft

Small tools that make Roughdraft (`npm i -g roughdraft`) usable for human–agent review, plus the plan for where this goes (`plans/roughdraft-plus.md`).

| Tool | What |
|---|---|
| `bin/rd-open FILE.md` | Open in Roughdraft and block until Done Reviewing, without the 5-minute crash (upstream #127). |
| `bin/rd-shot FILE.md [OUT.png]` | Screenshot the rendered doc (headless Playwright, uses roughdraft's bundled browser). |
| `bin/rd-diff OLD.md NEW.md [OUT.md]` | CriticMarkup diff between two versions, viewable in Roughdraft. |

Agent instructions: `docs/prompt.md` is the canonical block; `myd install-prompt` installs/updates it idempotently in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (marker-delimited; `--remove` to uninstall; `--file F` for other agents). Deep docs: `myd guide <topic>` ← `docs/agent-guide.md`.
