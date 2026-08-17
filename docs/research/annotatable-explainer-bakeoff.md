# Annotatable explainer bake-off

## Provisional decision

Continue with a **small native explainer vocabulary**, while retaining the sandboxed HTML bridge as an escape hatch—but validate it on one real model-backed research explainer before building `myd publish`. The semantic source reached comparable visual hierarchy with substantially less per-document presentation code, produced first-class annotation targets, and could enforce the two-party timing gate before rendering.

This does not prove that Markdown or a fixed component catalog can express every visual explainer. The fixtures use an explicitly illustrative LD value because no model/result artifact exists in this repository. The result therefore supports a narrower architectural hypothesis: the timing/measurement/result family looks like a good native component seam.

## What was compared

The fixtures render the same decision-epoch story:

- [semantic source](../../examples/timing-bakeoff/semantic.md), using one `explainer` YAML fence;
- [one-off rich HTML](../../examples/timing-bakeoff/rich-html.md), using a sandboxed `html` fence and local CSS;
- corresponding `.before.md` fixtures with the same three pending revisions.

The three revisions were:

1. replace Alice's timer assumption with the local signal `detector A fires`;
2. mark Alice and Bob's synchronization evidence as `measured`;
3. update the illustrative LD result from `0.68` to `0.73`.

## Observations

| Property | Native `explainer` | One-off HTML |
|---|---:|---:|
| Final source | 1,135 bytes / 42 lines | 6,641 bytes / 70 lines |
| Relative source size | 1× | 5.9× |
| Plain line diff for three revisions | +4 / −4 | +3 / −3 |
| Stable semantic targets | 6 | 6, when manually authored |
| Timing correctness gate | Yes | No |
| Main-DOM annotation | Direct | `postMessage` bridge |
| Standalone light/mobile capture | Verified | Island itself runs; top-level headless capture is incomplete |

Line counts understate the HTML burden because much of its markup is compressed onto long lines. The meaningful difference is ownership: in the semantic version, presentation CSS lives once in myd and the document carries research values and IDs; in the HTML version, every document owns its styling and responsive behavior.

The ID-keyed semantic diff names four changes without touching generated HTML: `alice-trigger.observes`, `alice-trigger.synchronization`, `bob-trigger.synchronization`, and `ld-result.value`. Both semantic revisions validate: the earlier version declares synchronization `assumed`, while the accepted revision reclassifies it as `measured`. The HTML fixture can display the same words but cannot enforce the allowed evidence categories.

No token-saving claim is established here. Source bytes are only a proxy. A real token result requires capturing model input/output across first authoring and repeated edits, including the component-catalog instructions loaded by the semantic condition.

## Annotation result

Native explainer objects render in the main DOM with stable `data-myd-target` values. A reader can independently target the timing section, Alice's event, Bob's event, evidence section, measurement, and result.

The HTML compatibility path injects a script into the sandbox without adding `allow-same-origin`. It sends only bounded resize events and semantic clicks from elements carrying `data-myd-id`; selected text is included when present and stored as a quote alongside the stable target rather than being folded into its identity. The parent accepts messages only from a known island window and validates the payload before opening the normal object-comment editor.

The bridge successfully resized the test island to 1,091px while the parent remained unable to read `contentDocument`, confirming that the sandbox boundary stayed intact. Parent light/dark selection is sent through the same narrow channel because an opaque iframe cannot inherit myd's `data-theme`. Headless Chrome's top-level screenshot omitted the out-of-process iframe and reported missing GPU mailboxes, even though DevTools showed the live iframe and correct height. Publish screenshots therefore need an iframe-aware capture or a deliberate flattening step; the current screenshot cannot be treated as evidence that an HTML island is visually empty.

Protocol parsing, quote persistence, and two semantic IDs are covered at their public seams, but this spike does not yet contain a browser-to-API test that saves comments from two iframe objects. That remains an acceptance requirement for promoting the bridge beyond compatibility status.

## Visual result

The native renderer now supplies the hierarchy missing from the uniform Markdown view: an accented hero, distinct party lanes, signal/action rhythm, measurement cards, status colors, and a high-contrast result panel. Desktop and 390px mobile captures were inspected. Light and dark tokens are defined in the shared stylesheet, and the mobile layout collapses lanes and results vertically.

## Consequence

Build the catalog by adding components only when a real explainer needs them. Keep the HTML bridge for compositions outside the catalog, but do not make arbitrary HTML the default authoring surface: it cannot offer the same validation or clean semantic revisions, and its isolated rendering complicates deterministic publishing.

The next implementation slice is to replace the illustrative value and provenance with one real model artifact, repeat the three revisions with model token accounting, and add the browser-to-API bridge round trip. If that holds, build `myd publish`: resolve the model reference, emit a manifest, capture native light/dark desktop/mobile screenshots, and include the ID-keyed semantic diff. The HTML path should remain supported but may report reduced screenshot guarantees until iframe-aware capture is solved.
