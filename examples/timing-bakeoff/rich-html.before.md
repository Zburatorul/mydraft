# Decision epoch — one-off rich HTML

```html {#decision-epoch-html}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #17213a; background: #f4f8ff; }
  .canvas { padding: clamp(24px, 5vw, 52px); background: radial-gradient(circle at 88% 4%, #9ce9ec77, transparent 29%), radial-gradient(circle at 8% 18%, #b9a8ff66, transparent 28%), linear-gradient(145deg, #f7f5ff, #edfaff 52%, #f4fbf6); }
  header { max-width: 720px; margin-bottom: 30px; padding-left: 18px; border-left: 5px solid #7058d6; }
  .eyebrow { color: #7058d6; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 6px 0 10px; font-size: clamp(30px, 6vw, 52px); line-height: 1.02; letter-spacing: -.04em; }
  header p { margin: 0; color: #5b6682; font-size: 17px; line-height: 1.55; }
  section { margin-top: 18px; padding: clamp(18px, 3vw, 28px); border: 1px solid #5263942e; border-radius: 16px; background: #ffffffdd; box-shadow: 0 16px 36px #303a5e14; }
  h2 { margin: 0 0 18px; font-size: 18px; }
  .lanes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .lane { padding: 14px; border-radius: 13px; background: #7058d612; }
  .lane:nth-child(2) { background: #1596a814; }
  .lane h3 { margin: 0 0 10px; color: #5b6682; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
  .event { padding: 15px; border: 1px solid #7058d63d; border-radius: 12px; background: #ffffffc4; cursor: pointer; }
  .lane:nth-child(2) .event { border-color: #1596a847; }
  .kicker { color: #5b6682; font-size: 11px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
  .step { display: grid; grid-template-columns: 54px 1fr; gap: 8px; margin-top: 14px; align-items: baseline; }
  .step span { color: #5b6682; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .step strong { font-size: 14px; line-height: 1.35; }
  .step.action strong { color: #258466; }
  .arrow { margin: 4px 0 -7px 55px; color: #7058d6; font-weight: 800; }
  .evidence { display: grid; grid-template-columns: minmax(180px, 1fr) 1.2fr; gap: 14px; }
  .measure { padding: 18px; border: 1px solid #5263942e; border-radius: 13px; background: linear-gradient(145deg, #fff, #eff7ff); cursor: pointer; }
  .label { color: #5b6682; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .value { margin: 7px 0 11px; font-size: 32px; font-weight: 780; letter-spacing: -.035em; }
  .value span { margin-left: 5px; color: #5b6682; font-size: 14px; }
  .pill { display: inline-flex; padding: 2px 8px; border-radius: 999px; color: #258466; background: #2584661f; font-size: 10px; font-weight: 800; text-transform: uppercase; }
  .result { display: grid; grid-template-columns: 1fr auto; align-items: center; padding: 22px 26px; border-radius: 14px; color: #f8fbff; background: linear-gradient(125deg, #302a66, #166879); cursor: pointer; }
  .result .label { color: #ffffffb8; }
  .result strong { font-size: clamp(36px, 7vw, 58px); letter-spacing: -.04em; }
  .result p { grid-column: 1 / -1; margin: 8px 0 0; color: #ffffffb8; font-size: 12px; }
  [data-myd-id] { transition: transform .14s ease, box-shadow .14s ease; }
  [data-myd-id]:hover { transform: translateY(-1px); box-shadow: 0 12px 28px #3a3f781f; }
  @media (max-width: 620px) { .lanes, .evidence { grid-template-columns: 1fr; } }
  @media (prefers-color-scheme: dark) { html:not([data-myd-theme]) body { color: #f1f5ff; background: #111522; } html:not([data-myd-theme]) .canvas { background: radial-gradient(circle at 88% 4%, #1596a840, transparent 29%), radial-gradient(circle at 8% 18%, #7058d647, transparent 28%), linear-gradient(145deg, #171629, #11252d 58%, #15251f); } html:not([data-myd-theme]) header p, html:not([data-myd-theme]) .lane h3, html:not([data-myd-theme]) .kicker, html:not([data-myd-theme]) .step span, html:not([data-myd-theme]) .label { color: #aab3ce; } html:not([data-myd-theme]) section { background: #181e33d1; border-color: #b0c0eb29; } html:not([data-myd-theme]) .event, html:not([data-myd-theme]) .measure { background: #0e1425ad; } }
  html[data-myd-theme="dark"] body { color: #f1f5ff; background: #111522; } html[data-myd-theme="dark"] .canvas { background: radial-gradient(circle at 88% 4%, #1596a840, transparent 29%), radial-gradient(circle at 8% 18%, #7058d647, transparent 28%), linear-gradient(145deg, #171629, #11252d 58%, #15251f); } html[data-myd-theme="dark"] header p, html[data-myd-theme="dark"] .lane h3, html[data-myd-theme="dark"] .kicker, html[data-myd-theme="dark"] .step span, html[data-myd-theme="dark"] .label { color: #aab3ce; } html[data-myd-theme="dark"] section { background: #181e33d1; border-color: #b0c0eb29; } html[data-myd-theme="dark"] .event, html[data-myd-theme="dark"] .measure { background: #0e1425ad; }
</style>
</head>
<body>
<main class="canvas">
  <header>
    <div class="eyebrow">Decision epoch</div>
    <h1>No shared referee</h1>
    <p>Each station decides from evidence available locally—not from a global round-ending signal.</p>
  </header>
  <section data-myd-id="local-recognition">
    <h2>What each station can know</h2>
    <div class="lanes">
      <div class="lane"><h3>Alice</h3><article class="event" data-myd-id="alice-trigger"><div class="kicker">Alice · unspecified</div><div class="step"><span>observes</span><strong>local timer expires</strong></div><div class="arrow">↓</div><div class="step action"><span>acts</span><strong>close Alice's decision epoch</strong></div></article></div>
      <div class="lane"><h3>Bob</h3><article class="event" data-myd-id="bob-trigger"><div class="kicker">Bob · unspecified</div><div class="step"><span>observes</span><strong>detector B fires</strong></div><div class="arrow">↓</div><div class="step action"><span>acts</span><strong>close Bob's decision epoch</strong></div></article></div>
    </div>
  </section>
  <section class="evidence" data-myd-id="evidence">
    <article class="measure" data-myd-id="coincidence-window"><div class="label">Coincidence window</div><div class="value">4.0 <span>ns</span></div><span class="pill">measured</span><p>run-042.json</p></article>
    <article class="result" data-myd-id="ld-result"><div><div class="label">LD score</div><span class="pill">derived</span></div><strong>0.68</strong><p>Illustrative value for the authoring bake-off.</p></article>
  </section>
</main>
</body>
</html>
```
