# Proposal: move CI from GitHub Actions to self-hosted runners

## Why

Our CI bill has doubled in six months. Self-hosted runners on a spare box would cut it to zero.

## Plan

1. Provision one runner on the office server.
2. Point all workflows at it.
3. Turn off hosted runners.

## Risks

None significant; the runner box is already backed up nightly.
