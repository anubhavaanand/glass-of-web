---
name: building-glass-for-web
description: >-
  Liquid-glass UI components using Aave's cross-browser SVG feDisplacementMap
  technique — a generated displacement-map PNG drives an SVG filter that bends
  the content's own pixels inside a lens-shaped region. For canvas/video,
  the same map feeds a WebGL shader. Works in Chrome, Safari, and Firefox
  with no flags or fallbacks. Use when building refractive glass switches,
  sliders, segmented controls, cursor lenses, hero chips, QR codes, video
  players, or any "liquid glass" / "Aave Glass" UI. Triggers: "liquid glass",
  "glass effect", "refraction", "Aave glass", "feDisplacementMap",
  "glassmorphic component", "WebGL glass".
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

For `<canvas>` and `<video>` (which Safari won't SVG-filter), the same displacement
map feeds a **WebGL fragment shader** instead.

## The three pieces

### 1. Displacement map PNG (generated per lens shape)

`GlassEngine.generateMap({w,h,radius,depth,curvature,curvaturePow,glowSide,glowTop})`

- Returns `{dataUrl, canvas}` — 8-bit RGB canvas → dataURL. Channels:
  - **R** = horizontal bend, **G** = vertical bend (128 = neutral)
  - **B** = specular glow ramp (white added via alpha = B − 128/255)
- **SDF normals approach**: Signed-distance field for rounded-rect → direction toward center × depth × edgeFactor encoding. Center is flat-neutral, bend ramps toward rim via `curvature`/`curvaturePow`.
- **Cross-browser**: Uses `primitiveUnits="userSpaceOnUse"` (pixel-space) with `feImage` using objectBoundingBox fractions for positioning. objectBoundingBox primitiveUnits breaks Safari/Firefox.
- Regenerate ONLY when shape changes; cache by size+params (engine does this).
  Moving the lens only shifts the filter region — cheap.

### 2. The SVG filter (exact 17-primitive chain, cross-browser)

`GlassEngine.buildFilter(defs, {lens:{x,y,w,h fractions},mapHref,scale,...})`

```
<filter filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse"
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
- **primitiveUnits="userSpaceOnUse"** — filter primitives operate in pixel-space.
  `feImage` uses objectBoundingBox fractions for lens positioning only.
  This is the cross-browser fix: objectBoundingBox primitiveUnits breaks Safari/Firefox.
- Chroma spread is SUBTLE: ±4–8% around base scale (R>G>B). Big spreads look fake.
- The hole-punch composites are what make non-lens content stay pixel-identical.
- **Fresh ID on every rebuild** (`…-vN-timestamp`). Safari caches filter output by
  ID; reusing IDs freezes animation.

### 3. Component wiring

#### SVG path (DOM content)
`const g = GlassEngine.createGlass(container, {lens:{x,y,w,h,r}, scale, ...})`

- Applies the filter straight onto the container (layout untouched), injects a
  zero-size `<svg><defs>` sibling.
- Returns `{setLens(pxRect), id, refresh(), destroy(), mapCanvas}`.
- `mapCanvas` getter returns the displacement map canvas for preview/debug.
- For animated moves (switch/toggle), tween `setLens` in rAF (~400ms easeOutBack);
  maps are cached so each frame only rebuilds the filter node.

#### WebGL path (canvas/video)
`const g = GlassEngine.createGlassWebGL(glCanvas, sourceCanvasOrVideo, opts)`

- Same displacement map, same refraction — but via a WebGL fragment shader.
- Use when the source is a `<canvas>` (e.g. QR code) or `<video>` that Safari
  refuses to SVG-filter.
- Returns `{setLens(pxRect), render(), destroy()}`.
- Call `render()` in a rAF loop for live video; for static canvas call once.

#### Specular overlay helper
`GlassEngine.applySpecular(container, lensPx)`

- Creates a positioned div with inset box-shadows and subtle white border
  to simulate specular rim highlight without filter overhead.

### 4. The refractionTarget pattern (Aave component architecture)

For controls like Switch, Slider, Toggle Group, Aave uses a **two-layer pattern**:

1. **Content layer** — the real track/buttons/fill (what gets filtered)
2. **Refraction target layer** — a scaled-down duplicate of the fill/highlight,
   clipped to the glass region. The displacement bends this copy into a moving
   highlight that gives the component depth and tactility.

Additionally, each glass container has:
- **White overlay**: `position:absolute; inset:0; background:white; opacity:0.12`
- **Box-shadow on thumb**: `0 2px 6px rgba(0,0,0,0.16), inset 0 -4px 10px rgba(0,0,0,0.12)`

## Production parameter table (pixel-based scales)

| Component | Element box | scale (px) | map profile |
|---|---|---|---|
| Switch | 64×64 | **8** | tight rim (curvature:.8/pow:2.3) |
| Slider | 36×36 | **4** | gentle bend (curvature:.7/pow:2.2) |
| Toggle group | ~104×64 | **5** | gentle bend (curvature:.8/pow:2.3) |
| Hero lens | 200×200 | **15** | wide rim (curvature:.7/pow:2.0) |
| QR Code (WebGL) | 160×160 | **10** | wide rim (curvature:.7/pow:2.0) |
| Video (WebGL) | fullscreen | **10** | wide rim (curvature:.7/pow:2.0) |

Chroma multipliers: `[1.08, 1.04, 1.0]`. Specular glow biased to side rims
(`glowSide > glowTop`) mimics their "Specular Angle".

## Aave's playground controls & defaults

| Parameter | Min | Max | Default | Maps to |
|---|---|---|---|---|
| Width | 20 | 120 | **70** | lens width |
| Height | 20 | 80 | **60** | lens height |
| BorderRadius | 0 | 64 | **28** | lens corner radius |
| Scale | 1 | 50 | **13** | displacement strength (pixels) |
| Depth | 5 | 60 | **10** | map bend depth |
| Curvature | 0 | 100 | **40** | curvature (0=flat center, 1=bend starts at center) |
| Splay | 0 | 1 | **1.00** | curvaturePow exponent |
| Chroma | 0 | 1 | **0.20** | chromatic aberration |
| Blur | 0 | 2 | **0.0** | pre-blur on source |
| Glow | 0 | 1 | **0.10** | specular intensity |
| Edge Highlight | 0 | 1 | **0.25** | edge rim light |
| Specular Angle | 0 | 180 | **45** | glowSide/glowTop bias |

## Recipes

```js
// Switch — thumb IS the lens; tween on toggle
const g = GlassEngine.createGlass(track, {
  lens: {x:8,y:8,w:48,h:48,r:24},
  scale: 8, depth:127, curvature:.8, curvaturePow:2.3, glowSide:54, glowTop:21
});
onToggle(() => tweenLens(g, {x:56,y:8,w:48,h:48,r:24}));

// Cursor magnifier — setLens every mousemove
stage.onmousemove = e => {
  const r = stage.getBoundingClientRect();
  g.setLens({x:e.clientX-r.left-100, y:e.clientY-r.top-100, w:200,h:200,r:100});
};

// QR Code (WebGL) — click to toggle glass
const wgl = GlassEngine.createGlassWebGL(glCanvas, qrCanvas, {
  lens: {x:30,y:30,w:140,h:140,r:70},
  scale:10, depth:127, curvature:.7, curvaturePow:2.0
});
wgl.render();

// Video (WebGL) — rAF loop for live refraction
const vgl = GlassEngine.createGlassWebGL(glCanvas, videoEl, {
  lens: {x:0,y:0,w:160,h:160,r:80},
  scale:10, depth:127, curvature:.7, curvaturePow:2.0
});
(function loop() { vgl.render(); requestAnimationFrame(loop); })();
```

## Debug checklist

| Symptom | Cause | Fix |
|---|---|---|
| Dark ring around thumb | pull exits colored content | bigger track / smaller scale |
| Whole content smears | map bends everywhere | raise curvature toward .7–.85 |
| No visible effect | scale too small for box | scale ≈ desired_px_pull |
| Animation freezes in Safari | reused filter ID | always fresh `-vN-timestamp` |
| Harsh rainbow fringes | chroma too strong | keep within [1.08,1.04,1.0] |
| Layout broke after init | you wrapped children | don't — filter goes ON container |
| WebGL has no effect | map image not loaded | ensure async map load completes |
| Video glass not working | Safari blocks SVG on video | use `createGlassWebGL()` |
| Gray box artifact | objectBoundingBox primitiveUnits | use `primitiveUnits="userSpaceOnUse"` |

## Files

- `glass-engine.js` — drop-in `<script>` exposing `window.GlassEngine`
  (`generateMap`, `buildFilter`, `createGlass`, `applySpecular`, `createGlassWebGL`)
- `index.html` — dark-mode demo: switch, slider, toggle group, cursor lens
- `showcase.html` — light lavender showcase: all components + QR WebGL + Dynamic Canvas WebGL + full 12-control playground
