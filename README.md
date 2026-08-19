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

## Review from another device

`myd view` prints a `localhost` URL and opens a browser on the machine running the server, which is wrong when the reviewer is elsewhere or the box is headless. Configure a public origin instead:

```bash
export MYD_PUBLIC_URL=https://review.example.test    # or: myd serve --public-url https://review.example.test
myd view plans/roadmap.md --wait
# https://review.example.test/review/6f1b…
```

The review is still created and tracked over localhost; only the printed origin changes, and no desktop browser is launched. Put an HTTPS reverse proxy or tunnel in front of the port — the viewer already speaks root-relative HTTP and derives `wss://` from the page, so nothing needs host rewriting. That is also why a public URL carrying a path prefix is rejected rather than printed: the viewer loads `/web` and `/api` from the origin root. Prefer `https://`: an `http://` origin is accepted for a LAN or a test, but the document text and every annotation then travel in cleartext.

Remote review is a property of the deployment, so `myd serve --public-url` records the origin and later `myd view` calls in other shells pick it up. `MYD_PUBLIC_URL` in the calling process wins; setting it empty takes one call back to local. The URL carries only the opaque review id — the same `/review/<id>` route the local viewer uses.

> **Anyone who can reach the origin can reach every review on that server.** The root route is the Review Inbox: it lists every review with its id, and any id opens, annotates, or completes that review. The id is six characters and therefore guessable, and it keeps the *file path* off the wire rather than scoping access to one document — and sharing one review link is closer to handing out an account than a single-document link. So restrict the proxy to people you trust with every document under review on that machine; authenticating them is not the same as scoping them. When a review needs a narrower audience, give it its own instance with `MYD_HOME` and `MYD_PORT`.

Env: `MYD_PORT`, `MYD_HOME` (state dir) run an isolated instance; `MYD_PUBLIC_URL` enables remote review; `MYD_NO_OPEN=1` suppresses the browser — the eval runner uses all three (`:7575`, `~/tmp/myd-eval/.myd-home`).

Agent integration (three rungs, all installed idempotently by `myd install-prompt`): `docs/prompt.md` → ~100-word always-loaded pointer in `~/.claude/CLAUDE.md` + `~/.codex/AGENTS.md` (marker-delimited); `skill/` → symlinked to `~/.claude/skills/myd` + `~/.codex/skills/myd` (SKILL.md workflow, references/agent-guide.md); `myd help` / `myd guide <topic>` from the CLI. `--remove` uninstalls all; `--file F` targets any other agent file.
