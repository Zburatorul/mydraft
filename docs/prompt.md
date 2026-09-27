## myd — document review & rich explainers

When the user wants to review or discuss a Markdown file, or asks for a plan, design or explainer they will look at, write it to disk and run `myd view "/abs/file.md"`. Tell them the tab is open and end the turn. Never poll, and never `--wait` unless they ask for it.

On their next turn, run `myd comments FILE` first. Then `myd reply`, `myd resolve`, or a guarded `myd set-block --target-guard`. Never hand-edit CriticMarkup or endmatter. Hand back with `myd view` and end the turn.

Load the **myd** skill before revising. It covers live versus completed reviews and when to rewrite cleanly.
