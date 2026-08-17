# Decision epoch — semantic source

```explainer {#decision-epoch}
theme: aurora
eyebrow: Decision epoch
title: No shared referee
lede: Each station decides from evidence available locally—not from a global round-ending signal.
sections:
  - type: timing
    id: local-recognition
    title: What each station can know
    parties: [Alice, Bob]
    events:
      - id: alice-trigger
        party: Alice
        observes: local timer expires
        action: close Alice's decision epoch
        locality: local
        synchronization: assumed
      - id: bob-trigger
        party: Bob
        observes: detector B fires
        action: close Bob's decision epoch
        locality: local
        synchronization: assumed
  - type: measurements
    id: evidence
    title: Evidence carried into the decision
    cards:
      - id: coincidence-window
        label: Coincidence window
        value: 4.0
        unit: ns
        status: measured
        provenance: run-042.json
  - type: result
    id: ld-result
    label: LD score
    value: 0.68
    status: derived
    caveat: Illustrative value for the authoring bake-off.
```
