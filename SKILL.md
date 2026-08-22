---
name: building-glass-for-web
description: >-
  Liquid-glass UI components using Aave's cross-browser SVG feDisplacementMap
  technique — a generated displacement-map PNG drives an SVG filter that bends
  the content's own pixels inside a lens-shaped region. Works in Chrome, Safari,
  and Firefox with no flags or fallbacks. Use when building refractive glass
  switches, sliders, segmented controls, cursor lenses, hero chips, or any
  "liquid glass" / "Aave Glass" UI. Triggers: "liquid glass", "glass effect",
  "refraction", "Aave glass", "feDisplacementMap", "glassmorphic component".
---

# Building Glass for the Web (Aave technique)

Faithful port of <https://aave.com/design/building-glass-for-the-web>,
reverse-engineered from their live production DOM.

## Core idea (memorize this)

> The filter does NOT sample what's behind the glass. It bends **the content's own
> pixels** inside a lens-shaped region. Content renders normally everywhere else.
> That is why it works in every browser and text under glass stays selectable.

`backdrop-filter: url(#svg)` is Chromium-only (WebKit bug #245510) — do not use it
as the primary path. `filter: url(#id)` on real content works everywhere.

## The three pieces

### 1. Displacement map PNG (generated per lens shape)

`GlassEngine.generateLensMap({w,h,radius,depth,rimStart,rimPow,glowSide,glowTop})`

- 8-bit RGB canvas → dataURL. Channels:
  - **R** = horizontal bend, **G** = vertical bend (128 = neutral)
  - **B** = specular glow ramp (white added via alpha = B − 128/255)
- Profile fitted to Aave's real maps: **flat-neutral center, steep outer rim**
  - switch map fit: neutral until ~76% of radius, then sharp rise (`rimStart:.76, rimPow:2.3`)
  - big hero lenses use a wider band (`rimStart:.35`)
- Regenerate ONLY when shape changes; cache by size+params (engine does this).
  Moving the lens only shifts the filter region — cheap.

### 2. The SVG filter (exact 17-primitive chain, verbatim from Aave's DOM)

`GlassEngine.buildGlassFilter(defs, {lens:{x,y,w,h fractions},mapHref,scale,...})`

```
<filter filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox"
        color-interpolation-filters="sRGB" x=0 y=0 width=1 height=1>
  feFlood rgb(128,128,128)                    -> mapBg
  feImage map.png @lens-fractions preserveAspectRatio="none" -> rawMap
  feComposite rawMap over mapBg               -> map
  feGaussianBlur SourceGraphic stdDeviation≈blurPx/elW blurPx/elH -> blurred
  feDisplacementMap blurred×map scale·1.08 -> feColorMatrix keep-R -> dispR
  feDisplacementMap blurred×map scale·1.04 -> feColorMatrix keep-G -> dispG
  feDisplacementMap blurred×map scale·1.00 -> feColorMatrix keep-B -> dispB
  feComposite dispR+dispG arithmetic(k2=1,k3=1)
  feComposite   +dispB arithmetic             -> lensResult
  feColorMatrix map→white alpha=B−0.50196     -> specMask
  feComposite specMask+lensResult arithmetic  -> lensResult
  feFlood black @lens region                  -> lensMask
  feComposite SourceGraphic out lensMask      -> holedSG   ← hole punch!
  feComposite lensResult over holedSG         -> OUTPUT
</filter>
```

Critical details:
- **objectBoundingBox units everywhere** — lens coords are FRACTIONS of the element box.
  In engines, displacement scale effectively scales with element size: a `scale`
  tuned for a 116px-wide switch is far too strong for a 76px one. Start from the
  production table below, then tune visually.
- Chroma spread is SUBTLE: ±4–8% around base scale (R>G>B). Big spreads look fake.
- The hole-punch composites are what make non-lens content stay pixel-identical.
- **Fresh ID on every rebuild** (`…-v42-timestamp`). Safari caches filter output by
  ID; reusing IDs freezes animation.

### 3. Component wiring

`const g = GlassEngine.createGlass(container, {lens:{x,y,w,h,r}, scale, ...})`

- Applies the filter straight onto the container (layout untouched), injects a
  zero-size `<svg><defs>` sibling.
- Returns `{setLens(pxRect), id, refresh(), destroy()}`.
- For animated moves (switch/toggle), tween `setLens` in rAF (~400ms easeOutBack);
  maps are cached so each frame only rebuilds the filter node.
- Lens must sit fully INSIDE colored content — displaced pixels sample the source;
  pulls that exit the element render as transparency (dark halos).

## Production parameter table (extracted from Aave)

| Component | Element box | scale | map profile |
|---|---|---|---|
| Switch | 116×70 | **0.3** | tight rim (.76/2.3) |
| Slider | 290×72 | **0.113** | gentle bend |
| Toggle group | 585×206 | **0.0459** | gentle bend |
| Hero lens | 764×368 | **0.0756** | wide rim (.35/2.1) |

Chroma multipliers: `[1.08, 1.04, 1.0]`. Specular glow biased to side rims
(`glowSide > glowTop`) mimics their "Specular Angle".

## Recipes

```js
// Switch — thumb IS the lens; tween on toggle
const g = GlassEngine.createGlass(track, {
  lens: {x:8,y:8,w:36,h:36,r:18},
  scale: .14, depth:127, rimStart:.76, rimPow:2.3, glowSide:54, glowTop:21
});
onToggle(() => tweenLens(g, {x:76,y:8,w:36,h:36,r:18}));

// Cursor magnifier — setLens every mousemove
stage.onmousemove = e => {
  const r = stage.getBoundingClientRect();
  g.setLens({x:e.clientX-r.left-80, y:e.clientY-r.top-80, w:160,h:160,r:80});
};
```

## Debug checklist

| Symptom | Cause | Fix |
|---|---|---|
| Dark ring around thumb | pull exits colored content | bigger track / smaller scale |
| Whole content smears | map bends everywhere | raise rimStart toward .7–.85 |
| No visible effect | scale too small for box | scale ≈ desired_px_pull / box_width |
| Animation freezes in Safari | reused filter ID | always fresh `-vN-timestamp` |
| Harsh rainbow fringes | chroma too strong | keep within [1.08,1.04,1.0] |
| Layout broke after init | you wrapped children | don't — filter goes ON container |

## Files

- `glass-engine.js` — drop-in `<script>` exposing `window.GlassEngine`
  (`generateLensMap`, `buildGlassFilter`, `createGlass`)
- `index.html` — working demos: switch, slider, toggle group, cursor lens, hero
