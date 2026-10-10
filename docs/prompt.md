## myd — document review & rich explainers

When the user wants to review or discuss a Markdown file, or asks for a plan, design or explainer they will look at, write it to disk, hand it over, and end the turn. In Claude Code, run `myd view "/abs/file.md" --wait --timeout 0` as a background command; their Done wakes you. Elsewhere, run `myd view "/abs/file.md"` and ask them to return in chat. Never poll.

When you resume, run `myd comments FILE` first. Then `myd reply`, `myd resolve`, or a guarded `myd set-block --target-guard`. Never hand-edit CriticMarkup or endmatter. Hand back the same way.

Load the **myd** skill before revising. It covers live versus completed reviews and when to rewrite cleanly.
