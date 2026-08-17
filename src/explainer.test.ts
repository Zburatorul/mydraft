import { describe, expect, test } from "bun:test";
import { loadDoc } from "./doc.ts";
import { renderDoc } from "./render.ts";

const render = (source: string) => renderDoc(loadDoc("/tmp/explainer.md", source));

describe("explainer fences", () => {
  test("render a two-party decision epoch as individually annotatable visual objects", async () => {
    const html = await render(`
\`\`\`explainer {#decision-epoch}
theme: aurora
eyebrow: Decision epoch
title: No shared referee
lede: Each party advances from evidence available at its own station.
sections:
  - type: timing
    id: local-recognition
    title: Local recognition
    parties: [Alice, Bob]
    events:
      - id: alice-trigger
        party: Alice
        observes: detector A fires
        action: close Alice's epoch
        locality: local
        synchronization: measured
      - id: bob-trigger
        party: Bob
        observes: detector B fires
        action: close Bob's epoch
        locality: local
        synchronization: measured
  - type: measurements
    id: evidence
    title: Evidence
    cards:
      - id: window
        label: Coincidence window
        value: 4.0
        unit: ns
        status: measured
  - type: result
    id: ld-result
    label: LD score
    value: 0.73
    status: derived
    caveat: Illustrative bake-off value
\`\`\`
`);

    expect(html).toContain('class="rich explainer"');
    expect(html).toContain('data-bid="decision-epoch"');
    expect(html).toContain('class="explainer-canvas theme-aurora"');
    expect(html).toContain('data-myd-target="local-recognition"');
    expect(html).toContain('data-myd-target="alice-trigger"');
    expect(html).toContain('data-myd-target="bob-trigger"');
    expect(html).toContain('data-myd-target="window"');
    expect(html).toContain('data-myd-target="ld-result"');
    expect(html).toContain("No shared referee");
    expect(html).toContain("detector A fires");
    expect(html).toContain("0.73");
  });

  test("rejects a timing event that silently depends on non-local knowledge", async () => {
    const html = await render(`
\`\`\`explainer {#invalid-epoch}
title: Invalid epoch
sections:
  - type: timing
    id: timing
    parties: [Alice, Bob]
    events:
      - id: global-end
        party: Alice
        action: close the round
        locality: local
        synchronization: assumed
\`\`\`
`);

    expect(html).toContain('class="rich explainer invalid"');
    expect(html).toContain("global-end must declare a locally observable signal");
    expect(html).not.toContain('data-myd-target="global-end"');
  });

  test("rejects a signal declared as global even when it has a description", async () => {
    const html = await render(`
\`\`\`explainer {#global-epoch}
title: Invalid global epoch
sections:
  - type: timing
    id: timing
    parties: [Alice, Bob]
    events:
      - id: referee-trigger
        party: Alice
        observes: referee says the round ended
        action: close the round
        locality: global
        synchronization: assumed
\`\`\`
`);

    expect(html).toContain("referee-trigger must declare locality: local");
    expect(html).not.toContain('data-myd-target="referee-trigger"');
  });
});
