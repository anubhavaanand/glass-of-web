# Glass of the Web

Faithful, cross-browser replica of [Aave's liquid-glass technique](https://aave.com/design/building-glass-for-the-web) — reverse-engineered from their live production DOM (July 2026).

A generated displacement-map PNG drives an SVG `feDisplacementMap` filter that bends the **content's own pixels** inside a lens-shaped region. Nothing is sampled from behind the glass — which is exactly why it runs in Chrome, Safari, and Firefox with no flags and no fallbacks.

## Features

- Cross-browser SVG pipeline: `primitiveUnits="userSpaceOnUse"` with `feImage` objectBoundingBox fractions (fixes Safari/Firefox)
- 17-primitive filter chain: chromatic aberration (3 displacement passes at ±4–8% scale spread), specular highlight from map blue channel, hole-punch composites
- SDF-based displacement map: rounded-rect SDF → direction-toward-center × depth × edgeFactor encoding
- Fresh filter IDs per update (Safari cache fix), cached maps per shape (cheap lens moves)
- Demos: switch, slider, toggle group, cursor magnifier, hero drift lens, QR WebGL, dynamic canvas scene
- Full 12-control playground for tuning all parameters live

## Usage

```html
<script src="glass-engine.js"></script>
<script>
  const g = GlassEngine.createGlass(container, {
    lens: { x: 8, y: 8, w: 48, h: 48, r: 24 },  // px rect inside container
    scale: 8,                                       // displacement in pixels
    curvature: 0.8, curvaturePow: 2.3,             // rim bend profile
    glowSide: 54, glowTop: 21                      // specular angle bias
  });
  g.setLens({ x: 56, y: 8, w: 48, h: 48, r: 24 }); // moves region only — cheap
</script>
```

## Files

- `glass-engine.js` — engine (`generateMap`, `buildFilter`, `createGlass`, `applySpecular`, `createGlassWebGL`)
- `index.html` — dark-mode interactive demo
- `showcase.html` — light-theme showcase with all components + playground
- `SKILL.md` — agent-readable implementation guide with production parameters

## Demo

Open `index.html` or `showcase.html` via any static server (`npx serve .`, `python3 -m http.server`).
