# Roughdraft fork survey (2026-10-07)

Three read-only surveys of the active forks of Lex-Inc/roughdraft, made with `gh`. **[F]** marks observed facts, **[I]** inferences. Forks are grouped by how far they diverged from upstream `main` (686919e, 2026-06-19).

## Major Roughdraft forks: direction survey (2026-10-07)

Method: `gh api` against repo metadata, branches, releases, commit logs (all pages), `compare` endpoints, READMEs, specs/ADRs, issues, CI runs; `npm view` for package names. Read-only, nothing written to GitHub. Raw dumps are in `scratchpad/forks/`.

Upstream baseline: Lex-Inc/roughdraft head `686919e` (2026-06-19, "Add Roughdraft setup example document (#130)"), npm `roughdraft@0.1.10` (published 2026-06-19, maintainer `nbaschez`), 452 stars, 75 forks, 55 open issues, 24 open PRs.

Legend: **[F]** observed fact, **[I]** my inference.

---

### At a glance

| Fork | Real delta | Active window | Stars | npm | Releases | Format stance | Thesis [I] |
|---|---|---|---|---|---|---|---|
| moiri-gamboni/roughdraft | 175 own commits on top of upstream head (the "256 ahead / 81 behind" is a history rewrite, see below) | 2026-08-08 → 2026-10-01 | 0 | no (README: "install from this branch, not npm") | none of its own | CriticMarkup (upstream RFM) | Hardened personal daily-driver: data safety, history, dashboard, Mermaid |
| kudzuweb/roughdraftplus | 240 commits, 225 of them on 2026-09-06 | 2026-09-04 → 2026-09-06 | 0 | no (README: install via clone + `npm pack`) | none | CriticMarkup, inline replies canonical | Self-declared "maintained fork"; agent-swarm-built review-loop contract |
| aparajita/roughdraft | 64 commits (diverged at upstream 0.1.9) | 2026-06-11, then 2026-08-28 → 2026-09-05 | 0 | no (`package.json` still `roughdraft@1.0.0`) | none | **Dropped CriticMarkup** for HTML anchors + YAML endmatter ("RFM 1.0") | UX/format redesign ("Alternate version") |
| pmbaumgartner/inkback | 23 commits on upstream head; renamed product | 2026-10-02 → 2026-10-04 | 0 | no (`inkback` 404; release tarballs on GitHub) | 3 GitHub prereleases `v0.1.11-pmbaumgartner.{1,2,3}` | CriticMarkup + compact `{#c1}` refs + endmatter | Rename/successor: slimmed core, MCP-first, packaged skill, direct Markdown persistence |

None has stars, outside contributors, or an npm package. Every one is a single author (kudzuweb and inkback almost certainly agent-driven; moiri's commits carry `Co-Authored-By: Claude Opus` trailers). [F for the counts; I for "agent-driven"]

---

### 1. moiri-gamboni/roughdraft

Repo: https://github.com/moiri-gamboni/roughdraft. Description [F]: "main = upstream + fixes for the three bugs that break the review loop in 0.1.10: missing yaml dep (PR #110), waiter crash at 300s (PR #144), endmatter replies never rendering (PR #145, ours). Install from this branch, not npm." Pushed 2026-10-01.

### The 256 ahead / 81 behind is a history rewrite, not a divergent product
- [F] Merge base with upstream is `c9bf145` (2026-04-22, upstream's second commit). All 83 upstream commit subjects are present in moiri's history with different SHAs (e.g. upstream `686919e` = moiri `401eb9f`, same date/subject).
- [F] Comparing moiri's own `401eb9f...main` gives **175 ahead, 0 behind**: the real delta is 175 commits by Moïri (plus 3 cherry-picks: Sacha's yaml fix `59c54e0`, James Canterbury's watch fix `ad3c5fa` = upstream PR #144).
- [I] Upstream's history was rewritten (likely a filter of a file) or moiri re-imported it; either way, treat moiri as "upstream 0.1.10 + 175 commits".
- [F] 85 branches, but only two are moiri-only: `feat/mermaid-diagrams`, `fix/endmatter-reply-rendering`. The rest are copies of upstream branches.
- [F] Own PRs #1–#4 (all merged into its main, 2026-08-21 → 08-26). Upstream PR #145 (endmatter reply rendering) is still open.

### Features beyond upstream (with commits)
1. **Byte-faithful save / round-trip fixes** (2026-08-10 → 08-21): `6f83d78` write an unedited document back byte for byte; `1051349` an edit rewrites its own block and nothing else; `1d0085c` stop autosave rewriting task lists and bare emails; `dfba2ae` stop rewriting whitespace; `af709dc` keep line breaks in reviewed code blocks; `eb26166` escape inline markdown delimiters; seeded fuzz harnesses for edit→save→reparse and rail layout (`ffd3f4d`, `editor-fuzz.test.ts`, `rail-layout-fuzz.test.ts`, `test/fixtures/fidelity/*.md`).
2. **Endmatter-only replies render** (`1c8da0b`, `2b45fc4`, `dcbf4e5`) — the upstream PR #145 fix.
3. **Comments on images and whitespace** (`57f8b46`, `64fd32f` comment ring inside the image).
4. **Local edit persistence / crash recovery** (PR #1): durable localStorage draft cell keyed from URL (`6375961`, `draft-store.ts`), save-retry policy (`81617d5`, `save-recovery.ts`), recover unsent edits on boot (`f1a229c`), remote CLI session reconnect + ownership probe (`71a8ef4`, `c063735`).
5. **Review checkpoints / history sidecar** (PR #3): every document write snapshots into `.roughdraft-history/v1/<stem>/<stamp>--p<pid>--<trigger>.md` with triggers `save | review | replaced | hook`; spec at `docs/spec/history-sidecar.md`; `roughdraft history <path> [--json|--show id|--restore id]` (`6433b0f`); in-app history dialog with diff vs current (`fc63e5f`, `c8d148a`, `DocumentHistoryDialog.tsx`, `snapshot-diff.ts`). The `hook` trigger is written by a **Claude Code `PreToolUse` hook** (`roughdraft-write-guard.sh`, in a separate "roost" repo) that snapshots before an agent writes the file — "a format, not an API", implemented twice independently.
6. **Dashboard replaces marketing homepage** (PR #4, `6223e69`, `Dashboard.tsx`, `GET /api/dashboard` `17eda9e`): `localhost:7373/` lists documents an agent is currently blocked on, recently opened docs with comment/suggestion counts, and last finished reviews; in-memory document registry + stat-keyed summary cache.
7. **Mermaid in the editor** (`6fb7752`, `mermaid-block.ts`, e2e `mermaid-diagrams.spec.ts`): fence stays editable source; diagram rendered beside it; source hidden unless caret is inside, the fence carries comment/suggestion marks, or parse fails; renders with pending suggestions applied; lazy-loaded.
8. UI: full-width reading mode, sticky header, rail cards aligned to caret/anchor, server log rotation (`server.log` / `server.log.1`).
9. Process: `docs/solutions/*` postmortem notes (e.g. "abort signals govern the response body", "an echo of our own write is not an external change", "a time budget is not evidence").

### Model, rendering, agent, distribution
- Keeps the **WYSIWYG editor** model and upstream CriticMarkup format. Rendering: Mermaid only. Agent integration: upstream CLI + MCP tools, plus the external PreToolUse write-guard hook. Distribution: none — no npm, no releases; install from branch.

### Activity & seriousness
- [F] 168 commits in Aug, 3 in Oct (last 2026-10-01). Heavy tests (unit + Playwright e2e, fuzz). No CI runs on the fork. 0 stars, no issues.
- [I] Serious engineering quality, but personal: positioned as "upstream + fixes, use this branch", not as a public successor. Most fork-friendly to cherry-pick from because the format is unchanged.

### Borrow / overlap for mydraft
- **History sidecar + PreToolUse write-guard hook** — directly relevant: mydraft writes review state too; a snapshot-before-agent-write hook and `history --restore` is a strong safety net. Overlaps partially with `myd diff`.
- **Dashboard of "agents blocked waiting on you"** — mydraft's `view --wait` has the same "which file is the agent waiting on?" problem.
- **Mermaid UX rule**: render with pending suggestions applied; keep source visible when it carries annotations or fails to parse. mydraft already renders Mermaid and annotates diagram nodes, so this overlaps; the "render the suggested version" idea is the novel bit.
- Fidelity fuzz harness (edit→save→reparse) is a good pattern for mydraft's `set-block`/`insert` writers.

---

### 2. kudzuweb/roughdraftplus

Repo: https://github.com/kudzuweb/roughdraftplus. Description [F]: "Refining … by adding some features from my personal MD viewer tool and experimenting with enhancements." README [F]: "This is `roughdraftplus`, a **maintained fork** of Lex-Inc/roughdraft. Install from this repository, not from the npm registry — the published `roughdraft` package is the unmaintained upstream copy and ships with known bugs this fork fixes."

### Shape of the history
- [F] Strictly ahead of upstream head (240 ahead, 0 behind). 4 commits 2026-09-04, 11 on 09-05, **225 on 2026-09-06**; nothing since (pushed 2026-09-06).
- [F] Issue-per-branch workflow: 99 issues/PRs, branch names like `24-keep-a-suggested-deletion-…`, commit subjects "Review finding N: …", "Add failing tests for …", a GitHub workflow that reopens parent issues with open sub-issues (`37e481f`, `.github/workflows/keep-parent-open.yml`), and references to "Agent Dash works them as one phase" (`docs/review-loop.md`).
- [I] Built by an autonomous multi-agent pipeline in one day (TDD + reviewer agent per issue). 31 issues still open, CI on main last run **failed**.

### Features beyond upstream
1. **Review-loop contract** (`docs/review-loop.md`, 163 lines) — the thesis document:
   - `roughdraft open --loop` (`b22569f`) reports `done` + `doneReason` (`overall-comment` | `threads-cleared` | null). Done = overall comment matching a fixed phrase list ("lgtm", "done reviewing", …; "approved"/"ship it" deliberately excluded; trailing "?" is not done) **or** zero unresolved threads. The agent auto-reopens otherwise.
   - Agent must mark every meaningful change between rounds as CriticMarkup insertions/substitutions so "marks are the change surface, not a diff view" (`abcbf05`, `126b667`).
   - **Approve / reject / edit** on suggestion cards and an **approve button on agent replies**, held as tab state and applied atomically on Done Reviewing (`e71b2f9`, `dc1aeaf`, `156d4cf`). Approval resolves exactly one comment, never the stack.
   - `anchor="disposable"` flag: a thread anchored on filler text the agent added only to carry a question takes the filler with it when cleared (`e2cee7d`, `0021150`).
   - Inline replies canonical, endmatter replies legacy-read-only (`8e5b668`, `be2564a`).
2. **Id counters in endmatter** so cleared ids are never reused (`eee13f3`, `910074d`).
3. **Session labels**: `roughdraft open --label "<session name>"`, document path + session shown in header, warning before another doc replaces the tab (`e462e45`, `1f263e3`). `roughdraft status <path>` → open threads + last save (`a7c9886`).
4. **Robustness**: bounded segmented long-poll for CLI and MCP watch (`dd7fa52`, `e30949a`); blocking `open` survives server restart (`5e091a0`, `ROUGHDRAFT_WATCH_RECONNECT_SECONDS`); tab writes only on real reviewer edits and stops after Done (`fc5f299`, `7ebb63c`); packaging guard that packs/installs/runs the CLI (`8bb384f`, `scripts/check-packaging.mjs`).
5. **Serializer fidelity**: soft breaks kept (`df030ad`), fence interiors untouched (`2f0bf0b`), table separators kept (`3988bee`), single `~` no longer strikethrough (`f967941`), escaping typed CriticMarkup in reviewer text (`a06896a`), fenced CriticMarkup preserved (`60eda0c`), visible placeholder for blocks the rich-text view cannot render + guard against deleting them (`f6c9969`, `97efe4c`).
6. **Network exposure**: `ROUGHDRAFT_BIND_HOST` + mandatory `ROUGHDRAFT_TOKEN` for non-loopback binds; dormant multi-document routes removed (`3c3c53f`, `40f427d`).
7. `.context/upstream-pr-harvest.md` — a verdict for every one of upstream's 24 open PRs (which to harvest, which design wins). Useful as a map of the upstream PR landscape (e.g. Mermaid PRs #102 vs #143; six competing 5-minute-timeout fixes).

### Model, rendering, agent, distribution
- Keeps the editor model. No new rendering (Mermaid explicitly skipped: "no fork issue asks for it"). Agent focus is the CLI loop semantics. Distribution: clone + `pnpm build` + `npm i -g "$(npm pack)"`; package still named `roughdraft@0.1.10`; upstream publish workflow gated off.
- [F] Open issues hint next steps: theming (#87, #46), MCP review-round start (#85), task-list round trip (#22), raw HTML dropped on save (#90).

### Activity & seriousness
- [I] Most explicit successor claim ("maintained fork"), but the evidence is one day of agent output, then silence for a month, red CI, 0 stars. Claim > reality.

### Borrow / overlap for mydraft
- **`--loop` done-signal** semantics (`done`, `doneReason`) — mydraft's CLAUDE.md flow already says "stop only when their Done note approves and nothing is pending"; making that a machine-readable field of `myd view --wait` output would remove agent guesswork. Strong borrow.
- **Agent-marks-its-changes-as-suggestions** convention + reviewer approve/reject applied on Done — overlaps with `myd diff`/revision comparison; worth considering as an alternative presentation.
- **Approve button on agent replies**, per-comment resolution.
- **`anchor="disposable"`** — nice for agents that ask questions in a doc.
- **Session `--label`** shown in the viewer, and `status <path>` reporting open threads.
- **Id counters** to prevent id reuse (mydraft uses short ids — same hazard).
- The harvest ledger as a ready-made list of upstream pain points.

---

### 3. aparajita/roughdraft

Repo: https://github.com/aparajita/roughdraft. Pushed 2026-09-09. Upstream issue #152 "Alternate version" (2026-09-05) announces it. Upstream PR #122 (node:http long-poll fix) was closed unmerged 2026-09-01.

### Shape of the history
- [F] Diverged from upstream at `7a58f2b` (0.1.9, 2026-05-31): 64 ahead, 5 behind. Selected upstream changes re-applied by hand (`6281da3`, `47d44ee` "from upstream PR #123"). One extra branch `fix/current-entry-when-saving-a-comment` (1 ahead).
- [F] Bursts: 2026-06-11 (timeout fix, GitHub dark style), 06-26, then 08-28 → 09-05.

### Features beyond upstream
1. **New format, "Roughdraft Flavored Markdown 1.0"** (`a62bd56`, `185311e`; `docs/spec/roughdraft-flavored-markdown.md`, ADR `docs/adr/0002-anchors-and-endmatter-as-review-format.md`):
   - Anchors are HTML: `<span id="rd-c1">…</span>`, `<ins id="rd-s1">`, `<del id="rd-s2">`, replacement `<span id="rd-s3"><del>old</del><ins>new</ins></span>`; point comment `<span id="rd-c1"></span>`.
   - All records (comments, replies, suggestion metadata) in a final YAML endmatter block identified by a `roughdraft: "1.0"` key — no heuristics. Bodies are YAML block scalars, so comments can contain fenced code without escaping.
   - "**Roughdraft neither reads nor writes CriticMarkup.**" Migration is a one-off conversion.
   - Rules: anchors cannot cross block boundaries; partial overlaps refused; id allocation rules; preserve unknown keys.
2. **Review UI redesign**: sticky review footer with comment count, prev/next navigation, current thread, accept/reject, delete-thread (`b596ccd`, `122d1c5`, `ReviewEntryFooter.tsx`); GitHub-style thread dialog (`ReviewThreadDialog.tsx`, `873fab6`); rail removed in favor of footer; Source Sans 3 + Tailwind typography; keyboard shortcuts (Cmd/Ctrl+Enter opens current entry `3df2b2b`, reply-and-close `de71654`).
3. Suggesting mode rewrite (`suggesting-mode.ts`, +528), save-error alert dialog and disk-change state (`5876743`), Save button (`6621c3f`), fix for review events emitted while no poll is in flight (`deef94e`), node:http long-poll for the 5-minute crash (`0e41371`).
4. Toolchain bumps: TypeScript 7, Vite 8, marked 18, Tailwind upgrade.

### Model, rendering, agent, distribution
- Keeps and deepens the editor model; no new rendering; agent integration unchanged except spec. No distribution: `package.json` says `roughdraft@1.0.0` but nothing on npm, no releases, no CI runs.

### Activity & seriousness
- [I] Thoughtful designer-quality fork, but explicitly offered upstream as "may or may not interest you"; not branded or distributed as a successor. Format break makes it incompatible with every other fork and with mydraft.

### Borrow / overlap for mydraft
- **Compatibility risk**: if anyone adopts RFM 1.0, mydraft's Roughdraft-compatible CriticMarkup would no longer be "the Roughdraft format". Worth a reader for `<span id="rd-…">` anchors + `roughdraft:` endmatter key, or at least detection with a clear error.
- The spec's ideas are worth stealing even within CriticMarkup: identify endmatter by an explicit key/version, YAML block-scalar bodies, refuse partial overlaps rather than widen, id allocation rules.
- **Footer navigator** (count + prev/next + current thread) is a good pattern for a read-only viewer where the rail gets crowded.

---

### 4. pmbaumgartner/inkback (formerly pmbaumgartner/roughdraft)

Repo: https://github.com/pmbaumgartner/inkback (old URL `pmbaumgartner/roughdraft` redirects). Not marked as a GitHub fork, but [F] its history contains upstream unchanged: first own commit `4e70c3a` has parent `686919e` (upstream head). Compare `686919e...main`: 23 ahead, 0 behind, 247 files touched. Created as a rename 2026-10-02, pushed 2026-10-04. MIT LICENSE added with attribution to Roughdraft/Nathan Baschez.

### Two phases
**Phase A — "Roughdraft fork releases" (2026-10-02)**
- `4e70c3a` yaml dep fix, release `v0.1.11-pmbaumgartner.1` (version deliberately sorts above 0.1.10 "so the updater does not recommend reinstalling that broken package").
- `8f0d71a` review-workflow reliability (endmatter reply threads, code whitespace, abortable HTTP watchers, bounded CLI/MCP polling, saved handoffs, save-version race) → `.2`; cites upstream #145 and #121.
- `e56aa99` native MCP (newline-delimited + framed), "scoped Pi receipts", agent skill installer → `.3`.
- [F] GitHub releases ship `roughdraft-0.1.11-pmbaumgartner.N.tgz` (+ `SHA256SUMS` on .3), installed via `npm install -g <release URL>`.

**Phase B — "Inkback" (2026-10-02 → 10-04)**
- `1a58106` strip non-core scaffolding (homepage storyboard, robots toy, remote-document mode banner, prompt.md/setup.md, marketing, upstream spec/ADRs/plans: −2280 lines in `PageCard.tsx`, −1696 in `App.tsx`); `0fef7ec` rename to Inkback.
- `6a23ccd` **MCP App** (`@modelcontextprotocol/ext-apps` 2.0.3): `inkback_open_review` shows an inline card in the chat; the editor runs inside the MCP host; "Finish review" → preview exact message → "Send to conversation". Claude Desktop **MCPB bundle** (`mcpb/manifest.json`, `scripts/build-mcpb.mjs`), VS Code Copilot and Goose configs.
- MCP tools [F]: `inkback_open_review`, `inkback_get_open_documents`, `inkback_get_pending_feedback`, `inkback_get_review_index`, `inkback_reply_to_comment`, `inkback_mark_resolved` (both take `expectedVersion` for guarded writes), `inkback_watch_review_events`.
- `9c5330d` local API security: loopback-only, Host/Origin checks, filesystem scoped to project dir + `INKBACK_ALLOWED_DIRS` + MCP client roots, symlink escapes refused, 2 MiB doc / 5 MiB image caps, DOMPurify sanitizing.
- Packaged agent skill (`packages/skill/inkback/SKILL.md`, `inkback skill install <dir>`), `inkback doctor <path>` (duplicate ids, broken reply links, malformed endmatter).
- `fdd858b` separate generated release package (`packages/cli/dist`) from the private workspace; `pnpm test:package` installs the packed tarball.
- `4356451` / `04f77ee` (2026-10-03): **"Peter decided not to support embedded MCP Apps"** — the desktop compatibility gate is withdrawn (`wontfix`), MCPB distribution dropped; removal planned but not yet implemented (README still documents it). Planning moved to "Kata" (`.kata.toml`, ids like `inkback#d31j`).
- `0647e21` (2026-10-04) **direct Markdown persistence**: removes the HTML→Turndown pipeline (`turndown`, `@joplin/turndown-plugin-gfm` dropped), adds `@tiptap/markdown` 3.22.4 plus `critic-markup/direct-parser.ts` / `direct-writer.ts` / `source-blocks.ts` / `hydration.ts`; prior tooling plan said stock `@tiptap/markdown` is "not a byte-preserving replacement", so unchanged source blocks are preserved and only edited blocks are re-emitted.

### Model, rendering, agent, distribution
- Keeps the editor model, but re-architected around source-preserving direct Markdown. No new rendering (no Mermaid/math). Agent: MCP + CLI + packaged skill; MCP App experiment then withdrawn. Format: CriticMarkup with compact `{#c1}` refs + endmatter (upstream's later format).
- Distribution: GitHub release tarballs (Phase A); Phase B has no release yet, `inkback` not on npm, release package named `@inkback/cli-build`, private. CI on main green as of 2026-10-04 after two failures.

### Activity & seriousness
- [I] The only one that has **renamed, re-licensed with attribution, cut scope, and shipped versioned artifacts** — i.e. the most credible successor-shaped project, though only 5 days old, single author, 0 stars, and still making big architectural pivots (MCP Apps in, then out, within 24 h).

### Borrow / overlap for mydraft
- **`doctor <path>`** = mydraft's structural preflight (`712b237`); compare checks (duplicate ids, broken `re` links, malformed endmatter).
- **`expectedVersion` on reply/resolve** — optimistic concurrency for agent writes; mydraft's `myd reply/resolve` could take a file version to avoid clobbering concurrent human edits.
- **Path policy** (allowed dirs + client roots) — low priority given mydraft's single-user/convenience-first stance.
- **Skill shipped inside the package** with `skill install` — mydraft already has a myd skill; installing it from the CLI is a distribution idea.
- **MCP App lesson**: someone tried rendering the review UI inside Claude Desktop via MCP Apps and backed out within a day citing host-compatibility; worth knowing before mydraft considers the same.
- "Finish review does not authorize accepting every suggestion or implementing a plan" — explicit agent-authorization rule in the skill, worth copying into the myd skill.

---

### Cross-cutting observations

- [F] Every fork independently fixed the same three blockers (yaml dep, 5-minute watch crash, endmatter-only replies). Upstream PR count for the 5-minute crash alone: six (#121, #126, #136, #139, #144, #149).
- [F] Every fork that touched the save path attacked the editor's Markdown reformatting (moiri byte-faithful writes, kudzuweb serializer fidelity, inkback direct persistence). [I] That confirms mydraft's "viewer, not editor" decision avoids the single biggest maintenance sink in this ecosystem.
- [F] Rendering: only moiri added anything (Mermaid). No fork has math, charts, syntax highlighting, or annotations on diagram nodes/chart marks. Upstream PRs #102/#103/#143 (Mermaid, highlighting) remain unmerged. [I] mydraft's rich-rendering + non-text annotation niche is uncontested among forks.
- [F] Format is fragmenting: upstream/moiri/kudzuweb/inkback stay on CriticMarkup (with differing reply-placement conventions: kudzuweb = inline canonical, inkback = endmatter `body` for replies); aparajita abandoned CriticMarkup. [I] "Roughdraft-compatible" now needs a stated dialect; the upstream compact-ref + endmatter form is the common denominator.
- [F] Nobody publishes to npm; `roughdraft@0.1.10` on npm is still the broken upstream build. [I] The successor slot is open; inkback is closest in intent, kudzuweb in rhetoric, moiri in engineering depth.


## Roughdraft mid-size forks, survey A (2026-10-07)

Method: `gh api repos/Lex-Inc/roughdraft/compare/main...OWNER:roughdraft:<default branch>`, plus a local clone of upstream with every fork added as a remote (`git diff origin/main <fork>/main`). The compare API stops at 300 files, which made jjordanguy's list incomplete, so its numbers below come from the local git diff. I also read fork READMEs, ADRs, FORK docs and commit bodies, ran `gh pr/issue list` on each fork and on upstream (to see what each author contributed back), checked `actions/runs`, and ran `npm view` / `npm search roughdraft`. Nothing was written to GitHub.

Legend: **[F]** observed fact (cited sha/file), **[I]** inference.

### Cross-cutting facts

- [F] None of the six publish to npm. `npm search roughdraft` returns only upstream `roughdraft@0.1.10` (2026-06-19). `@alexandrbasis/roughdraft` 404s on npm and is distributed as GitHub release tarballs. The rest install from a local `npm pack`.
- [F] All six have 0 stars and 0 watchers. Only jmatthewpryor has issues enabled.
- [F] Many branches in every fork (`devin/*`, `homepage-*`, etc.) are copies of upstream's branches. Branches that belong to the fork: jjordanguy `batch-0..batch-9`, `jordan/main`; jmatthewpryor `pr-*`, `fix/*`; alexandrbasis `improve/*`, `codex/*` (these are squash-merged into main already); PavelKaloshin `feat/latex-math-rendering`, `chore/remove-update-notice`; augusto `augustoesquivelmasciotta/*`.
- [F] The forks all fix the same upstream bugs, each with their own patch: the 5-minute undici watch crash (#127; upstream PRs #121/#126/#149), the missing `yaml` dependency (#109/#110), single-tilde mangling (#135), endmatter-only replies (#145), and Mermaid (#102/#143). All of those upstream PRs are still OPEN.
- [F] **The review format is diverging.** Three forks now move comment bodies into YAML endmatter, and each does it differently:
  - jjordanguy: canonical `{==text==}{#c1}` with *every* body in YAML; code-block refs on the fence line (`` ```ts {#c2} ``) with `lines: [s,e]` + `quote`; `scope: document`; `<br>` line breaks; `aN` ids reserved for agents; `continues:` for multi-block suggestions.
  - alexandrbasis: empty inline marker `{==x==}{>><<}{#c1}` + `body: |-` for multi-paragraph or image comments.
  - augusto: inline one-line excerpt `{>>first line …<<}{#c4}` + full `body` in endmatter; a top-level `deleted:` list.
  - jmatthewpryor (via upstream PR #131): a `reaction: up|down|clarify` key.
- [I] A "Roughdraft-compatible" writer now has to *read* all of these forms to stay compatible with what fork users produce.
- [F] Most fork commits carry `Co-Authored-By: Claude …` trailers (PavelKaloshin, augusto, jjordanguy). jjordanguy's merge commits reference `worktree-agent-*` branches.
- [I] These forks are mostly agent-built personal tools, not community projects.

---

### 1. jjordanguy/roughdraft (default branch `jordan/main`, 54 ahead / 0 behind)

**Thesis [F]:** The README says this is "Jordan's fork… a way to open a local Markdown file with tools on top of it… rewrite it in lockstep with the agent." It runs on a Mac or a VPS over Tailscale and "never as a hosted service". Version is `0.2.0-jordan.1`, "installed from a packed build, never from the npm registry" (`docs/fork/install.md`). The repo was created 2026-10-06, and all 54 commits landed 2026-10-06..07 as 12 self-merged "Batch" PRs (#1–#12).

**Size [F]:** `git diff origin/main jjordanguy/jordan/main` gives 200 files, +60,947/−11,063. About 44% of changed files are `docs/spec/fixtures/*` (golden `.md` + `.expected.json` pairs, including `probe-R01..R12` edge cases). Test files went from 30 to 79. CI runs on `jordan/main` (11 runs, latest success).

**Features beyond upstream [F]:**
- **Wake routes instead of a blocking wait** (`815e2baa`, `b8ddf2eb`; `packages/server/src/wake-routes.ts`, `claude-session.ts`, `codex-session.ts`, `docs/fork/routes.md`).
  - On Done, the server writes to a session log (`review-log.json`), then "wakes" the chat session that opened the file.
  - `claude-session` route: reads `~/.claude/sessions/<pid>.json` plus a key file and writes an auth line and a user message to that session's Unix socket. Per the fork, this lands as a user turn.
  - `codex-queue` route runs `codex queue --thread <id> --message …`.
  - URL routes take headers and a JSON body template (used for OpenClaw).
  - `roughdraft open --no-watch` auto-registers the session from `CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`.
  - `roughdraft route test claude-code` runs once per session.
- **Durable handoff log** (`2d3ed3db`, `b8b7899c`; `handoff-log.ts`, `registry.ts`): Dones persist until acked. `pending --ack`, `ack <id>`, `watch --after <seq> --reconnect`.
- **Round/apply protocol, "the agent never types markup"** (`9d9e4cbd`, `537359ba`; `review-commands.ts`, `packages/rfm`):
  - `roughdraft round` writes `round.json` (one entry per thread with context and `needsAnswer`), `clean.md` (markup-free copy), `response.json` and `base.md`.
  - The agent edits `clean.md` and fills `response.json` with `reply`, `resolve`, `skip`, `decision` and `note`.
  - `roughdraft apply` does a 3-way rebase of anchors and writes all or nothing, idempotently (`already-applied`).
  - Single-shot commands too: `reply/resolve/accept/reject/note`.
- **Claude Code PreToolUse guard** (`guard.ts`, `roughdraft guard --claude-hook`): denies Edit/Write that touch review markup, overlap a highlight, or target a file with an open round. Fails open.
- **Canonical review format plus migrator** (`docs/spec/roughdraft-flavored-markdown.md`, +255 lines): a fixed byte-stable YAML writer. `doctor --fix --dry-run` converts legacy files, with backups in `~/.roughdraft/backups/`. `doctor --strict`.
- **Sync engine** (`c97c68bf`, `323d77a9`, `4f868403`; `tab-channel.ts`, `document-watcher.ts`, `atomic-write.ts`):
  - One WebSocket per tab, content-hash versions, atomic temp+rename writes (`ROUGHDRAFT_WRITE_MODE=inplace` turns this off; `scripts/check-drive-rename.mjs` checks a cloud-synced folder first).
  - 3-way merge of concurrent disk edits. On conflict, the user's text becomes a suggestion against the agent's text.
  - localStorage drafts. An "AI editing…" badge shows while a round is open.
- **Global comment button/section, resolved folding** (`29fa1533`).
- **Open-documents page at `/`** (`6a972cfa`): grouped by chat session, with Open/Close/Drop/"Close all finished". `roughdraft documents`, `roughdraft close`.
- **MCP rewrite** (`c3a8c40b`; `mcp.ts`, `mcp-transport.ts`):
  - Newline-delimited JSON-RPC, as Claude Code sends it. Ping, cancellation, and the agent procedure sent as MCP `instructions`, with a test that it matches the doc word for word.
  - 14 tools (`roughdraft_start_round`, `roughdraft_apply_round`, `roughdraft_wake_routes`, …).
- **Error contract:** `--json` always prints one envelope `{ok,status,exitCode,error:{code,message,retryable,hint}}`. Exit codes are typed: 0, 1 (refused), 2 (usage/path), 3 (server), 4 (timeout / tab dirty), 130/143.
- **Remote:** `ROUGHDRAFT_BIND_HOST` + `ROUGHDRAFT_TOKEN` (bearer) for a VPS on Tailscale. `ROUGHDRAFT_PEER_URL` links the two instances.
- **Skill package:** `packages/skill/SKILL.md`. Agent procedure in `docs/fork/agent-procedure.md` (replacement CLAUDE.md paragraph).

**Model [F/I]:** It keeps the TipTap editor (F) but moves the center of gravity to agent integration: wake routes, rounds, guard, MCP and the session log. It's the most agent-protocol-heavy fork (I).

**Seriousness [F]:** Very high engineering volume, tests, CI, ADR updates (`docs/adr/0001`, `0004`). But the fork is one person and two days old, with no npm release, issues disabled, and no upstream PRs.
- [I] It looks like a big agent-driven batch rewrite for personal use ("Jordan" is hard-coded in the docs). Durability is unproven.

**Successor positioning [F]:** None. It is explicitly personal ("Jordan's fork"), keeps the `roughdraft` name and reads upstream files. There is no `rd` command, "never create one".

**Borrow for mydraft [I]:**
1. **Wake-on-Done into the originating Claude Code / Codex session**, so the agent doesn't hold a `--wait` open. This fits mydraft's pain point about "a yielded process id is not completion". The socket protocol is the fork's claim and needs verifying against current Claude Code before adopting.
2. **Durable Done log with ack/sequence and `pending`**, so a Done with no watcher is never lost (mydraft has a "Done-event catch-up flow"; compare).
3. **The round/apply idea: agent edits a clean copy plus a JSON response, then one atomic checked apply.** mydraft's `set-block`/`insert` already avoids hand-editing CriticMarkup. A `round`-style batch command with all-or-nothing semantics and an idempotent retry is a useful extension.
4. **The PreToolUse guard hook** that blocks Edit/Write touching CriticMarkup in reviewed files. This is cheap to add to `myd` and backs up the CLAUDE.md rule.
5. **The fixture corpus** `docs/spec/fixtures/probe-R01..R12` + `canonical-*`. These are golden tests for format compatibility, and worth running mydraft's parser against.
6. **The single JSON error envelope** with `retryable`/`hint` and typed exit codes.
7. **MCP `instructions` = agent procedure**, with a drift test.

---

### 2. jmatthewpryor/roughdraft (40 ahead / 0 behind)

**Thesis [F]:** "This fork exists to run a locally patched build of Roughdraft while waiting for fixes to land upstream" (`FORK-PATCHES.md`). It is a patch queue: each upstream PR is kept on its own `pr-*` branch and merged into `main`.

**Features [F]** (all are upstream PRs that are still OPEN):
- #126: undici idle-timeout retry loop (`94e4b435`).
- #149: no-timeout dispatcher, adapted to a per-watch Agent in `packages/server/src/network.ts`, because a singleton Agent kept stale pooled sockets after a server restart. Documented in `FORK-PATCHES.md` "How #149 was adapted".
- #110: `yaml` root dependency, plus a `packaging.test.ts` guard (`33bb5e3d`, `883f4432`).
- #135: single tilde.
- #112: multiline legacy comments.
- #131: comment reactions (👍/👎/❓; `reaction:` key; spec diff in `docs/spec/roughdraft-flavored-markdown.md` +4 lines; `573f0126`).
- #102: Mermaid fences rendered, lazy-loaded (`95d1c3ab`; `packages/app/src/render-mermaid.ts`).
- #103: appearance settings (theme/font/width) + syntax highlighting (`289c2685`; `SettingsDialog.tsx`, `preferences.ts`).
- #142: popover arrow.
- #145: endmatter-only replies (`7ee81bcf`…).
- #148: sticky Approve button.
- Fork-local fix: GFM tables with inline code in 2+ cells silently rendered as nothing (`d4d81106`, fork PR #2, issue #1). Its fork issue #3 is still open: add a Playwright *layout* assertion so the fix can't silently regress.

**Model [F]:** Upstream editor model, unchanged. Diff is 44 files, +3,781/−158.

**Seriousness [F]:**
- Careful and well documented: version scheme `0.1.11-patched.2`, kept above upstream so the npm update banner doesn't nag.
- Merge-conflict notes, and an "Applying another upstream PR" recipe.
- No CI runs, no npm release. Last push 2026-09-11.

**Successor positioning:** None. It wants upstream to merge the PRs.

**Borrow for mydraft [I]:**
- **Reactions** (`reaction: up|down|clarify`): a cheap reviewer signal ("clarify" is a useful agent cue). mydraft should at least preserve the key, and could render or emit it.
- The per-watch undici Agent lesson, if `myd` ever long-polls over Node fetch.
- The "update banner versus fork version" pitfall.
- The table-with-inline-code silent-drop bug is a good regression fixture for mydraft's renderer.

---

### 3. peterhartree/roughdraft (32 ahead / 0 behind)

**Thesis [F]:** "feat: make Roughdraft a native review workspace" (`46182731`): "Package the existing app in a secure macOS shell, make document opens durable and non-blocking, and **remove the review-completion listener in favor of Markdown feedback**."
- `packages/server/src/review-events.ts` and the `watch` command are deleted.
- The README now says "You close the document and ask the AI to read the Roughdraft comments saved in the Markdown file."

**Features [F]:**
- Electron shell, `packages/desktop/*` (forge; `main.ts`, `permission-policy.ts`, `native-open.ts`, `dropped-markdown.ts`, `server-target.ts`). It is unsigned, bundle id `is.pjh.roughdraft`, and the README hard-codes `/Users/ph/Applications`.
  - ADR `docs/adr/0005-desktop-shell-and-open-intents.md`: typed "open intents" from the CLI, File menu, macOS open events and drops, with a last-wins pending slot.
- Multi-document sidebar (`d4c6c306`, ADR 0006): sorted by open time, with Cmd+1..9 and a Cmd+P switcher. Per-file scroll and selection state expires after 12 hours.
- Find shortcuts (`1b7c0b77`), close-all, sidebar toggle.
- Protected tables rendered as read-only previews (`7dbab6f7`; augusto later borrowed this).
- Table row insert/delete (`89d9ee17`, `e1e6c77f`).
- Missing-file recovery panel (`e9096b9b`, `8499da2a`).
- Abbreviated path prefixes (`2bf9c61b`).
- Auto-starts the managed server (`428056b1`).
- Re-implemented upstream fixes: tilde, multiline legacy comments, endmatter replies, reactions (`097a762e`).
- Uses the `.impeccable` design-lint config.

**Model [F/I]:** Doubles down on the **editor** (table editing, find, a desktop app). It moves *away* from agent integration and keeps MCP read/reply tools only (F). [I] It's a personal Mac Markdown editor with review markup.

**Seriousness [F]:**
- Steady cadence from 2026-07-08 to 09-03; 55 test files.
- No CI runs, no release. Personal paths in the README.
- Did contribute upstream: PRs #135, #136 (open) and #134 (closed).

**Successor positioning:** None ("personal desktop app", "unsigned, intended only for local use").

**Borrow for mydraft [I]:**
- The **"no completion signal; Markdown is the handoff"** stance is a counterpoint worth noting: one heavy user found the blocking wait not worth its cost.
- "Open intents" with a pending slot, for when the viewer isn't connected yet.
- The missing/moved-file panel.
- Per-file scroll restore when switching docs in an inbox.

---

### 4. alexandrbasis/roughdraft (27 ahead / 0 behind)

**Thesis [F]:** "Roughdraft, Basis fork". The package is renamed `@alexandrbasis/roughdraft` (`0.1.14-basis.6`) and distributed as **GitHub release tarballs with SHA256SUMS** (4 prereleases, 2026-09-08..09-30) via `.github/workflows/release-fork.yml`.
- `FORK.md` maps each change to the upstream issue or PR that motivated it.
- `PRODUCT.md` principles: "Improve the current review workflow without replacing the editor"; "Keep the document and feedback readable outside Roughdraft."

**Features [F]:**
- **SQLite durability** (`0e7bbc35`; `packages/server/src/review-database.ts`, `~/.roughdraft/roughdraft.sqlite`): routes, review rounds, completion events, consumer acks, snapshots and drafts.
  - Migrates the JSON stores in one transaction and keeps them as backups.
  - Atomic Markdown writes with a write journal (`atomic-markdown.ts`).
- **Review inbox** with status filters, pagination and waiting-agent counts (`cf35d070`; `packages/app/src/review-home/`).
- **Revisions:** "Track document revisions with review highlights" (`7b7d5739`) and "Show revision deletions as inline strikethrough" (`97e505e7`; `packages/app/src/revisions/`). Before/after views, previous/next, change counts.
- **Screenshot attachments in comments** (`e844a7df`): files live in `.roughdraft-assets/` beside the doc. Spec change: an empty marker `{==x==}{>><<}{#c1}` plus `body: |-` holding Markdown with `![...](./.roughdraft-assets/…)`.
- **Readable local URLs:** `roughdraft domain setup review.rd` generates hosts and Caddy snippets, giving stable routes such as `http://review.rd/<project>/<heading-slug>` (`68d052ad`; `local-domain.ts`, `review-link.ts`).
- Server start lock (`server-start-lock.ts`).
- Live server kept across failed probes (`3a470ee8`).
- Polling transports, so tabs don't exhaust the HTTP connection pool (`037c8a68`).
- "Not sent, but saved" when no watcher is present (`00745e01`).
- Mermaid preview + highlighting (re upstream #143); system/light/dark themes; `embed=1` compact layout for host panels (upstream #140).
- Persistent contents navigation (`6f12284e`).
- Nested numbered-list preservation (`f05d4a5e`).
- **Agent setup prompt** in the README: the agent installs from source, configures the domain, and writes a "compact contract" into CLAUDE.md/AGENTS.md.
- `pnpm upstream:check` (`scripts/check-upstream.mjs`) compares against upstream without merging.

**Model [F]:** Keeps the editor and the blocking `open` wait, and adds reliability, history and an inbox.

**Seriousness [F]:**
- The most release-engineered fork: 104 test files, 41 CI runs, coverage/durable/package test suites, checksum releases, and a tag/version guard.
- Self-merged PRs #1–#6. Last push 2026-10-01. No upstream PRs.

**Successor positioning [F/I]:** It doesn't claim to be the successor (F). It does have a scoped package name, a public install prompt, an update checker against its own GitHub releases, and a statement that "the upstream browser demo does not represent all fork features" (F). [I] Of the six, it's closest to a distributable continuation, though still single-maintainer.

**Borrow for mydraft [I]:**
- **Image/screenshot attachments in comments**, stored beside the doc in an assets folder and referenced in an endmatter `body: |-`. mydraft should at least *read* `{>><<}{#c1}` with a YAML body.
- **Checksummed GitHub-release distribution + `upstream:check`.**
- Readable stable routes (`review.rd/<project>/<slug>`). mydraft has short ids; compare.
- "Receipt vs processing" in CLI/MCP (delivered ≠ handled).
- `embed=1` compact layout for IDE/host panels.
- Snapshot restore with a version check.

---

### 5. PavelKaloshin/roughdraft (22 ahead / 3 behind, diverged; v0.1.9 base)

**Thesis [F]:** The README section "What's different in this fork" says: "adds directory browsing plus read-only viewing for non-Markdown files, so you can review a whole folder". ADR `docs/adr/0005-directory-review-mode.md` treats the directory as a "navigation context" while one `.md` file stays the unit of work.

**Features [F]:**
- `roughdraft open <dir>` with a live-refreshing sidebar tree (`4dc72ab1`, `c1f42a61`).
- Read-only viewer for all files: code highlighting via `@codemirror/language-data`, images, binary stub (`145946ee`; `FileViewerWorkspace.tsx`, `file-types.ts`).
- **Mermaid** NodeView, lazy-loaded, source round-trips (`358fc69c`; `MermaidCodeBlockView.tsx`).
- **KaTeX math**: `$…$`/`$$…$$` via marked extensions, TipTap atom nodes, and Turndown rules that round-trip back to TeX (`44fb3bc9`; `MathView.tsx`, `test/math.test.ts`). Offered upstream as PR #132 (CLOSED).
- Heading outline rail (`e9612c1e`; `DocumentOutline.tsx`, `file-outlines.ts`).
- Clickable links with `#anchor` scrolling (`f2c05c2e`, `7d6a71dd`). Persistent full-width view.
- "Reload from disk" button with uncached reads (`85c635a6`).
- Dot-directory path fix (`7313a623`) and the two-code-span-links table fix (`8c9ddc04`).
- `open` no longer launches a browser by default; `--open` opts in (`f23b4163`).
- In-app update notice removed (`2de57e48`).
- Committed `.claude/settings.json` allowlist + Makefile "trusted command surface" to cut agent permission prompts (`f0d4c453`).

**Model [F/I]:** Keeps the editor but adds **viewer/renderer** features (math, Mermaid, outline, read-only file viewer). [I] Of these six, it's the one whose direction is closest to mydraft's rendering thesis, but it stays inside TipTap.

**Seriousness [F]:** Moderate: 41 test files, e2e specs, no CI runs, no release. Last push 2026-08-09 (dormant for about two months).

**Successor positioning:** None.

**Borrow for mydraft [I]:**
- The **directory-as-navigation-context** idea: a sidebar tree plus a read-only viewer for neighbouring code and images when reviewing a plan that cites them.
- The outline rail that stays in sync with live file changes.
- A committed `.claude/settings.json` allowlist to cut permission prompts for the `myd` command surface.
- No browser auto-launch by default (agent prints the URL).

---

### 6. augustoesquivelmasciotta/roughdraft (15 ahead / 0 behind)

**Thesis [F]:** It fixes the known upstream pains and integrates with **Orca** (stablyai/orca, a terminal/worktree app with mobile). The repo was created 2026-10-03, and all commits are dated 2026-10-04. Version `0.1.11-fork.1`.

**Features [F]:**
- **5-minute crash:** waits became bounded polls of at most 240 s that continue from the event sequence, retry dropped connections for 2 minutes, and replay from the start after a server restart. The MCP watch shares the loop (`ebff1571`).
- **Global install:** `yaml` moved to root deps, plus a test that every runtime dependency of shipped workspace code is declared (`71988878`).
- **Reformat-on-save fix** (`164258a1`): "Each save now writes back the original markdown of every block whose content is unchanged and only serializes the blocks that were edited." Endmatter is edited in place. Unique-id generation repairs duplicates.
  - Long or multiline comments are stored as an endmatter `body` with a one-line inline excerpt (`INLINE_EXCERPT_LIMIT = 120`).
- **Endmatter-only replies** render; a reply-to-a-reply attaches to the nearest anchored ancestor.
- `<details>` blocks rendered as a sanitized (DOMPurify) collapsible preview (credited to peterhartree `7dbab6f`).
  - Heading section folding, and code fences over 20 lines start folded (view-only state) (`0b2596b4`).
- Resolve/Reopen separate from Delete. Delete leaves a record in the endmatter `deleted:` list and the ids stay reserved. A "Whole document" thread sits at the top of the rail.
  - A **navigator over open threads and threads with new agent comments since my last Done** (⌥⌘↑/↓) (`c30907bc`).
- Cmd+D = Done, Cmd+Enter = overall comment (`b160ebbe`).
- **Orca integration:** `roughdraft open` inside an Orca terminal opens an Orca browser tab and reuses it. `ROUGHDRAFT_ORCA=0/1` controls this (`1fbd7dfe`).
  - Phone review via Orca mobile, with a bottom sheet under 900px (`a5f2a859`).
- Tabs poll instead of holding SSE, because Orca shares a 6-connection pool. Paths are compared NFC/NFD-normalized (`923759f5`).
- Spec additions: "Mixed Metadata Formats", "Long Or Multi-Line Comment Text", "Resolved And Deleted Items" (`docs/spec/roughdraft-flavored-markdown.md` +51).

**Model [F]:** Editor kept. The fixes are about fidelity and integration with a host (Orca).

**Seriousness [F]:** Burst-built in one day with Claude Opus/Sonnet 5.5 co-authors. 47 test files, no CI runs, no release, one self-merged PR.

**Successor positioning:** None.

**Borrow for mydraft [I]:**
- The **"new since my last Done" navigator**: count and jump to threads with agent replies added since the reviewer's last handoff. This is high value for multi-round reviews in mydraft.
- The **`deleted:` tombstone list** with reserved ids. mydraft should preserve it, and could adopt it.
- Fold long code blocks by default (>20 lines) and fold sections by heading in the rendered view.
- A mobile bottom-sheet thread layout.
- NFC/NFD path normalization when matching watchers to documents (macOS).
- Poll rather than hold SSE when many tabs share a host browser's connection pool.

---

### Overall direction (inference)

- **Editor kept by all six.** None moved to mydraft's "one-way render + annotation" model. PavelKaloshin (math/Mermaid/outline/read-only viewer) and alexandrbasis/jmatthewpryor (Mermaid, highlighting) push rendering *inside* TipTap.
- **The agent-handoff axis splits three ways:**
  1. jjordanguy: async wake routes + rounds + guard + MCP. The most ambitious.
  2. alexandrbasis/augusto: a more reliable blocking wait + durable history.
  3. peterhartree: drop the completion signal entirely.
- **No successor claimant here.** All are personal or patch forks with 0 stars, no npm publish, and mostly no upstream PRs. alexandrbasis comes closest on distribution, with a scoped package, checksummed releases and an update checker.
- **The real risk for mydraft is format drift.** Three incompatible "body in endmatter" conventions plus new keys (`reaction`, `deleted`, `scope`, `lines`/`quote`, `continues`) and fence-line `{#id}` refs. Recommended: add reader tolerance and round-trip fixtures for each, and preserve unknown keys.


## Roughdraft forks, mid-size set B

Survey date: 2026-10-07. Method: `gh api repos/Lex-Inc/roughdraft/compare/main...OWNER:REPO:BRANCH` for each fork's default branch, plus a diff of every fork branch's SHA against the upstream branch list (82 upstream branches), so only branches that differ from upstream were inspected. Docs were read with the `contents` API. Upstream `main` head is dated 2026-06-19 (v0.1.10, the only `roughdraft` on npm, published 2026-06-19 by GitHub Actions). `npm search roughdraft` returns only the upstream package, so **none of these forks publishes to npm**.

Legend: **[F]** = observed fact (sha/file cited). **[I]** = my inference.

### At a glance

| Fork | Ahead/behind | Active window | Thesis | Seriousness |
|---|---|---|---|---|
| al-ignat | 14 / 12 | 2026-05-28 to 06-26 | Multi-format: HTML documents, with a high-fidelity preview iframe and an overlay annotation layer | High: 5 ADRs, own-repo PRs #1-#15, unit and e2e tests, new `@roughdraft/formats` package |
| blake41 | 13 / 0 | 07-16 to 09-08 | Robustness for agent and human writing concurrently, plus a git-installable build | High: long root-cause commit messages, many tests |
| aakashd | 11 / 0 | 06-04 to 06-14 | Daily-driver fixes: no reformatting on open or save, watch timeout, rail UX | Medium-high: tests, Claude-authored commits |
| joshlivsafe | 9 / 0 | 09-21 to 09-23 | Round-trip correctness, Mermaid rendering, watch reliability | Medium: tests and `.context/` plans committed |
| HenryBranchAdams/roughdraft-sites | 6 / 0 | 07-23 to 07-25 | Hosted (OpenAI Sites, D1/R2) collaboration and Codex Desktop integration | Medium: large, disclaimer-heavy, one burst |
| claudiunicolaa | 7 / 0 | 08-13 to 08-18 | Cosmetic: syntax highlighting and a width toggle | Low-medium |
| zain | 7 / 0 | 06-11 to 07-01 | Private "Eureka" build: timeout fix, update nag removed, WebSockets | Medium (maintenance fork) |
| cathrynlavery | 0 / 0 (1 branch +1) | 09-01 | One watch-timeout fix, upstream PR #149 | Trivial |
| Sokori-Inc | 0 / 0 | n/a | Pure mirror, one branch, identical to upstream | Trivial |

No fork claims to be the successor. Henry explicitly disclaims it. Zain's FORK.md says "We have given up on upstream merging our code". Blake bumps the version to `99.0.0` only to avoid npm identity collisions.

---

### al-ignat/roughdraft: Roughdraft for HTML documents (most relevant to mydraft)

**Direction [F].** Turns Roughdraft into a multi-format reviewer. ADR 0010 (`docs/adr/0010-multi-format-support.md`) introduces a `FormatAdapter` interface (parse, serialize, validateReview, extract ReviewIndex, append reply, resolve, title), with Markdown as the first adapter and HTML as the second, dispatched by extension. The CLI, MCP and doctor all accept `--as md|html` (`packages/server/src/cli.ts`). The fork was created 2026-05-21 and is 12 commits behind upstream. Its Phase 3.1 PR to upstream (#101) was closed unmerged.

**Concrete features [F].**
- `c2c0957`, `5a2a058`: a new `packages/formats` package (`format-adapter.ts`, `registry.ts`, `html-adapter.ts` +252, `html-review.ts` +390, `tiptap-html-extensions.ts`). The server, MCP and CLI dispatch on extension.
- ADR 0011 (HTML review markup): CriticMarkup maps to native elements with `data-rd-*` attributes. `{==x==}` becomes `<mark data-rd-id>`, `{++}`/`{--}` become `<ins>`/`<del>` (with `data-rd-by`/`data-rd-at`), and a substitution is a `del`+`ins` pair sharing `data-rd-pair`. Comments are `<span data-rd-comment hidden data-rd-re=…>`, so the file still renders correctly in any browser. Links are forward only (comment points to anchor, no back-link).
- ADR 0012, `39b42b4`, `2b7a101`: the author's `<style>` is wrapped in CSS `@scope (.rd-doc-content)`, with `:root` rewritten to `:scope` (`HtmlScopedStyle.tsx`, `html-style-extraction.ts`). There is a Show/Hide Comments toggle (the rail slides away and the column widens to about 1080px). Shadow DOM is the fallback.
- `3012392`, `e11c8c2`, `ba5502f`, `f520470` (ADR 0013): a `/preview` route renders the HTML as-is in a sandboxed iframe (`PreviewIframe.tsx`, `RawHtmlPreviewPage.tsx`). The preview is annotatable:
  - Each comment anchors with a **Hypothes.is-style pointer** persisted on the hidden span: `data-rd-anchor-xpath`, `-start`, `-end`, `-quote`.
  - Highlights are rebuilt at load time as `<mark data-rd-comment-highlight>` and **never written back**, so the author's DOM stays byte-for-byte unchanged.
  - Selection is observed from the parent through the iframe's `selectionchange` event. The floating "add comment" pill (`SelectionPill.tsx`) and the rail (`PreviewCommentRail.tsx`, +650) live in the parent frame.
  - New server routes: `/api/preview-document`, `/api/append-comment-with-anchor`, `/api/set-comment-status`, `/api/edit-comment`, `/api/delete-comment`.
  - Supporting code: `iframe-anchors.ts` (+389, with tests) and `iframe-selection.ts`.
- ADR 0014: a faithful-render theming rule. The app theme styles app chrome only, never the author's content. The iframe container is painted light.
- Tests: `e2e/preview-annotations.spec.ts` (+368), `open-html-file.spec.ts`, `html-adapter.test.ts` (+399), `iframe-anchors.test.ts`, and others.

**Editor model.** **[F]** Keeps TipTap for "Document mode" (with a persisted `<mark>`) and adds a non-editor rendered "Preview mode" with an overlay annotation layer. ADR 0013 openly accepts running two anchoring models side by side. **[I]** This is the closest any fork comes to mydraft's thesis: render faithfully, annotate on top, keep the file canonical. It is HTML-only, though. Diagram and chart awareness is absent.

**Seriousness.** **[F]** It follows a phased plan (Phases 2 to 3.2e), works through PRs in its own repo, writes an ADR for each decision, and ships tests. There is no npm publish. The last commit was 2026-06-26, so it has been quiet for about three months. **[I]** It looks like a personal or professional exploration that stalled after the preview-annotation milestone. It is not positioned as a successor.

**Borrow for mydraft.**
1. A **pointer anchor with a quote fallback** (`xpath`/offsets/`quote`), with runtime-only highlights. This suits annotations on rendered HTML islands, where mydraft must not rewrite the island's markup. ADR 0013 states the failure mode plainly: heavy edits outrun the quote fallback.
2. **`@scope` with `:root` rewritten to `:scope`** for author CSS inside HTML islands, as a cheaper alternative to Shadow DOM.
3. The ADR 0014 principle, "the app theme never themes author content", is worth stating explicitly for mydraft's HTML islands and Vega charts.
4. `data-rd-*` HTML review markup: if mydraft ever reviews `.html` files, this is a ready-made, Roughdraft-adjacent format.

---

### blake41/roughdraft: concurrency-safe writes, WebSockets, git install

**Direction [F].** Hardens the setup where an AI agent and a human edit the same file at once, and makes the fork installable straight from git (`bun add -g --trust github:blake41/roughdraft`). It has 1 star. The only extra branch, `websocket-migration`, equals `16c540f`, which is already on main.

**Concrete features [F].**
- `16c540f`: the two per-tab SSE streams become WebSockets (`packages/server/src/ws.ts`, `packages/app/src/reconnecting-socket.ts`, with resync on reconnect). The rationale: Chrome's limit of 6 HTTP/1.1 connections per host meant 3 open documents saturated the pool. The resync also surfaces file deletions that happen during a disconnect.
- `ef94e93`, `0488824`: a `postinstall` build (`scripts/prepare-install.sh`) so git installs work. It adds the `ws` dependency that was missing from the root package (the same class of bug as upstream's missing `yaml`).
- `52cae12`: comment drafts in progress survive external file writes (the "has open draft" state now marks the editor dirty).
- `00b8e06`: the save version is pinned to the content it was derived from, so a stale save gets a 409 instead of silently overwriting. **Review IDs are randomized** instead of max+1, so two writers working from different snapshots can't collide.
- `af78961`: `PUT /api/markdown-file` accepts `baseContent`. On a version mismatch it runs a **3-way merge with node-diff3**. Disjoint edits merge automatically. Overlapping edits still return 409.
- `e688573`: the version is bumped to `99.0.0` so the fork never resolves to npm's upstream `roughdraft`. This also disables the update banner.
- Parser fixes:
  - `69eddf2`: a blank line inside any CriticMarkup span is replaced with a sentinel before `marked` runs, so `marked` can't split the span into separate blocks.
  - `609f8ef`: a stray space is tolerated between adjacent `{>>…<<}{…}` blocks.
  - `cd63c0d`: reply threading resolves through `re=` across the whole document, with a cycle guard. A root that exists only in endmatter is anchored at its first anchored member.
- `eb49c7a`: unselected rail cards are clamped to 4 lines, which bounds how far cards drift from their anchors.

**Editor model.** **[F]** The editor stays. Everything targets reliability and multi-writer safety. **[I]** It reads as a heavy daily user patching pain points with an agent. Commit messages cite live observations ("observed live tonight").

**Seriousness.** **[F]** Each change comes with new tests (`api-backend.test.ts` +410, `ws.test.ts` +270, `markdown-events.test.ts` +305, `open-requests.test.ts` +230, plus e2e specs). There is no npm publish, and installs go through git. The last push was 2026-09-08.

**Borrow for mydraft.**
1. **3-way merge on a version conflict** when an agent `myd reply` and a browser annotation race. Today mydraft hash-versions its documents; merging disjoint edits would replace a hard reject.
2. **Collision-safe IDs.** mydraft's `nextId` in `src/doc.ts:157` is sequential (max+1). The memory note "short ids" argues for keeping short IDs, but two concurrent writers can still pick the same ID unless allocation happens under the version check.
3. **Parser tolerance cases worth testing in mydraft:**
   - blank lines inside a comment body
   - whitespace between chained comment blocks
   - `re=` pointing to a parent anchored elsewhere
   - `re=` cycles
4. **WebSocket instead of SSE** if mydraft keeps an SSE stream per tab. The 6-connection cap is a real issue when several documents are open.

---

### aakashd/roughdraft: stop churning the file

**Direction [F].** Fixes for daily use. Every commit is co-authored by Claude Opus 4.8. The side branches `fix-open-rewrites-file`, `fix-watch-longpoll-timeout` and `widen-reading-column` are pre-rebase copies of commits already on main (different SHAs, same messages).

**Concrete features [F].**
- `de47ffd`: opening a document no longer rewrites it. The fix skips `onUpdate` when `docChanged=false`, and Turndown is set to `hr:"---"`.
- `ec3b2ec`: **source-preserving merge** (`packages/app/src/source-preserving-merge.ts`, +202 lines, 12 tests). A fence-aware block tokenizer compares the original source, the serializer's output for the unchanged document, and the serializer's output after the edit. Only the blocks that changed are replaced, and everything else stays byte-identical. If block counts don't line up, it falls back to the full serializer output.
- `bfc9157`, `32f98ac`: watch long-polls in **25-second windows**, re-armed from `afterSequence = nextSequence - 1`. The logic is shared between the CLI and MCP (`packages/server/src/watch-review-events.ts`).
- `6305b66`: the "I'm done" button is shown whether or not a watcher is live. The handoff is persisted to disk before delivery is attempted, and the watcher count only drives the "Sent" / "Not sent" message.
- `773eb97`: blank lines inside comment bodies are collapsed (comments only, not suggestions).
- `75cf349`: rail cards get a left "spine" colored by item type (comment, insertion, deletion, substitution) to link each card to its span, plus WCAG contrast fixes.
- `6075e29`: a reading-width slider applied before first paint, an ErrorBoundary, and a `[roughdraft]` log prefix.

**Seriousness.** **[F]** Tests ship with the fixes. Activity ran 2026-06-04 to 06-14. No publish, no PRs to upstream.

**Borrow for mydraft.**
1. **Decouple the Done button from watcher liveness**: persist first, deliver on a best-effort basis, show "not delivered". This matches mydraft's dual-mode review-events plan.
2. Color-coded **type spines** on rail cards.
3. The source-preserving merge matters only if mydraft ever re-serializes. It doesn't (it splices surgically), so mydraft's "viewer, not editor" choice already avoids the problem this fork had to solve.

---

### joshlivsafe/roughdraft: round-trip fixes, Mermaid, watch reliability

**Direction [F].** A three-day burst (2026-09-21 to 09-23) of agent-driven fixes, with commits co-authored by Claude Sonnet 5 / Opus 5.5. Plans are committed under `.context/` and carry Roughdraft endmatter approval ("looks good, implement it"), which shows Roughdraft itself being used to review the agent's plans.

**Concrete features [F].**
- `1ab10c1`, `1786e68`, `3768da2`: round-trip fixes:
  - `---` was being rewritten as `* * *`
  - GFM table cells were padded
  - heading spacing was normalized to MD022
  - a code-span pipe tokenizer bug made whole tables and headings vanish into a raw block
  - whitespace-only lines appeared between list items
- `cb1b4d5`: **Mermaid fences rendered as live diagrams** (`components/MermaidCodeBlockView.tsx`, +186, with tests). Mermaid is loaded lazily via `import("mermaid")` with `securityLevel: "strict"` and theme awareness. Clicking a diagram switches to its source. A diagram with an active CriticMarkup mark is forced into source view. Plan: `.context/mermaid-diagram-rendering-plan.md`.
- `6aacf71`: a comment inside a code or Mermaid block no longer flattens the block's newlines. Code-span link text no longer loses its link.
- `ddde890`, `8bd9668`, `dd603a6`: a chunked watch client (`packages/server/src/review-events-watch-client.ts`).
  - A **grace period** for a reconnecting watcher before the server declares the handoff undelivered.
  - A fix for a **deterministic off-by-one in the resume cursor** (`nextSequence` used instead of `latestSequence()`) that made any watcher idle past one chunk miss its event.
- `126ed2e`: pressing Enter while suggesting inside a list item now splits the list item.

**Editor model.** **[F]** The editor stays, with rendering added to it. Annotation inside a diagram is only possible by dropping to source view. **[I]** It validates mydraft's direction ("render diagrams"), but its comment-on-diagram story is weaker than mydraft's node-level annotations.

**Borrow for mydraft.**
1. **Off-by-one risk in watch resume cursors.** Check mydraft's Done-event catch-up uses a strictly-greater comparison against the last *seen* sequence.
2. A **grace period for reconnecting watchers** before reporting "no agent is watching".
3. Mermaid `securityLevel: "strict"` as the default.

---

### HenryBranchAdams/roughdraft-sites: hosted collaboration and Codex Desktop

**Direction [F].** "Unofficial public fork … for Sites-hosted collaboration", where Sites means OpenAI Sites: `chatgpt-auth.ts`, `.openai/hosting.json`, Cloudflare D1/R2 bindings. The README carries a non-affiliation banner. The package is `private: true`, and the publish workflow is replaced by a safeguard (`scripts/check-fork-publish-safety.test.mjs`). The extra branch `codex/codex-sites-compatibility` (`37ab813`) was merged via PR #1.

**Concrete features [F].**
- `4a0a5a9`, `37ab813`: `sites/roughdraft-collaboration/`, a Next/Vinext app that **copies the upstream UI wholesale** (`app/roughdraft-ui/*`: PageCard 2440 lines, critic-markup 1540, and more).
  - Storage: D1 holds the canonical Markdown, version history, review events and owner identity. R2 holds attachments.
  - Per-document `access_scope` (`site-members`, `restricted`, `owner-only`).
  - Errors: optimistic 409 for stale writes, 428 when a version is missing, 422 for invalid RFM.
  - Explicit import and export. A Finder-like navigator adapted from Extend UI `@extend/file-system`.
  - Drizzle migrations.
- `677ee47`: a Codex Desktop skill (`.codex/skills/roughdraft/SKILL.md`, `docs/codex-desktop.md`).
  - Run `open --print-url` (which doesn't register a watcher), then start a separate retained `watch --json` *before* navigating Codex's in-app browser.
  - After Done, reread the file.
  - `scripts/sync-codex-skill.mjs` checks for **skill drift with SHA-256 tree hashes** and refuses to overwrite unknown files.
- `.codex/skills/roughdraft/references/sites-hosting-options.md`: a decision table of four hosting modes (private snapshot, browser-local, Sites-native app, upstream remote session). It is explicit that a hosted worker can't write a file on the user's Mac.
- `46e711f`: an rfm fix so a document with **frontmatter only** doesn't have its closing `---` mistaken for review endmatter (`packages/rfm/src/index.ts`).

**Seriousness.** **[F]** Most of it landed in one burst (07-23 to 07-25). Tests and smoke scripts exist. Nothing is deployed or published from this source. **[I]** It is mostly a vendored copy of the UI adapted for one hosting platform, not a maintainable successor. Its value is in its policy thinking (boundary between canonical copies, access scopes, deployment gates).

**Borrow for mydraft.**
1. A **snapshot vs. live** distinction if mydraft ever exports or shares: a frozen render labeled with its source hash and timestamp. mydraft's `src/export.ts` already does something like this.
2. A **skill drift check**: hash the installed skill against the repository copy.
3. The frontmatter/endmatter ambiguity. mydraft's `ENDMATTER_RE` (`src/doc.ts:46`) requires a `comments:`/`suggestions:` lookahead, so it is already immune to that bug.

---

### claudiunicolaa/roughdraft: cosmetic

**[F]** Two merged PRs in its own repo, written with Claude Opus 4.8 on the web. A third PR (#147) was opened upstream and is still open.
- `44523ab`: highlight.js syntax highlighting via `CodeBlockLowlight` (common grammars, untagged fences stay plain and round-trip without a language).
- `e762752`, `b5e9351`, `aa83a23`: a comfortable/wide width toggle, persisted, with `data-doc-width` set on root. The motivation was **ASCII diagrams in code blocks**.
- `e222266`: dark-mode CSS specificity fix.

Includes e2e specs. **[I]** Nothing to borrow; mydraft already uses Shiki. The ASCII-diagram motivation does confirm users want wide or diagram-friendly layouts.

### zain/roughdraft: private "Eureka" maintenance build

**[F]** `docs/FORK.md` says: "Upstream is not merging our changes (PR #121 ... ignored) ... We have given up on upstream merging our code."
- `463f225`: watch polls bounded to 240 seconds.
- `dff8b16`: update check removed end to end.
- `9e8eb78`: version `0.1.10-eureka.1`, installed globally from an `npm pack` tarball (never `npm i -g .`).
- `8cc88ab`: both per-tab SSE streams are replaced by one WebSocket per tab (`tab-socket.ts`). PR #133 was opened upstream and closed.

The other 26 branches are identical to upstream. **[I]** It shows how a team keeps internal tooling alive. It is not a product.

### cathrynlavery/roughdraft: trivial

**[F]** Main is identical to upstream (3 stars). One extra branch, `fix/watch-headers-timeout-main` (`06f1ef1`, 2026-09-01), routes watch fetches through an undici Agent with `headersTimeout`/`bodyTimeout` disabled, adds a regression test, and fixes placeholder `allowBuilds` values in `pnpm-workspace.yaml`. Opened upstream as PR #149, still open. Notably this is a third independent fix for the same 5-minute crash (alongside zain #121, aakashd and joshlivsafe).

### Sokori-Inc/roughdraft: trivial

**[F]** One branch, `main`, identical to upstream. No changes. Created 2026-05-21.

---

### Cross-fork synthesis

**[F]**
- **The 5-minute watch crash was fixed independently 5 times:** zain `463f225` (240s windows), aakashd `bfc9157` (25s windows), joshlivsafe `ddde890` (chunked), cathrynlavery `06f1ef1` (undici Agent with timeouts disabled), and the upstream branch `roadmap/watch-headers-timeout` (`24fc791`, never merged).
- **The chunked approach introduced new bugs:** an off-by-one in the resume cursor, and false "undelivered" reports in the gap between chunks.
- **SSE replaced by WebSocket twice** (blake41, zain), both because of the per-host connection limit.
- **"Stop the editor reformatting my Markdown" fixed 3 times:** aakashd (source-preserving merge), joshlivsafe (Turndown rules), blake41 (CriticMarkup span protection).
- **Widening the document column done 4 times:** al-ignat, blake41, aakashd, claudiunicolaa.
- **No fork publishes to npm.** Installs are by git (blake41), tarball (zain), or explicitly not at all (Henry).

**[I] Direction.**
- Most forks are personal patch sets that keep the WYSIWYG editor and fight its round-trip lossiness.
- Only al-ignat moves structurally toward mydraft's model: render faithfully, annotate on an overlay, keep the file canonical with pointer anchors. joshlivsafe moves partway (Mermaid rendering inside the editor).
- Henry is the only fork moving toward hosting or distribution, and it is tied to one platform.
- Nobody adds MCP or CLI capabilities beyond fixing the existing watch. Skills appear only in Henry's Codex skill.
- No credible successor in this set. **mydraft's "viewer, not editor" choice sidesteps the most common pain** (reformatting on save) that three forks spent effort on.


