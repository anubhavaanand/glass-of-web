# Glass of the Web

Faithful, cross-browser replica of [Aave's liquid-glass technique](https://aave.com/design/building-glass-for-the-web) — reverse-engineered from their live production DOM (July 2026).

A generated displacement-map PNG drives an SVG `feDisplacementMap` filter that bends the **content's own pixels** inside a lens-shaped region. Nothing is sampled from behind the glass — which is exactly why it runs in Chrome, Safari, and Firefox with no flags and no fallbacks.

## Features

- Cross-browser SVG pipeline: `primitiveUnits="userSpaceOnUse"` with `feImage` objectBoundingBox fractions (fixes Safari/Firefox)
- 17-primitive filter chain: chromatic aberration (3 displacement passes at ±4–8% scale spread), specular highlight from map blue channel, hole-punch composites
- SDF-based displacement map: rounded-rect SDF → direction-toward-center × depth × edgeFactor encoding
- **4-fold quadrant symmetry**: computes only top-left quadrant and mirrors to all 4 quadrants for a **4× speedup** in map generation
- **Safari specular optimization**: restricts specular `feColorMatrix` pass to lens bounding box on Safari, reducing filter cost
- Fresh filter IDs per update (Safari cache fix), cached maps per shape (cheap lens moves)
- **Multi-lens WebGL renderer**: supports `setLens(lens)` and `setLenses([lens1, lens2, ...])` for canvas/video control surfaces
- Demos: switch, slider, toggle group, cursor magnifier, hero drift lens, QR WebGL, dynamic canvas scene, **video player with multi-lens controls**
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

### Multi-Lens WebGL (Video / Canvas)

```js
const wgl = GlassEngine.createGlassWebGL(canvas, videoElement, {
  lenses: [
    { x: 20, y: 400, w: 70, h: 36, r: 18, scale: 0.04, depth: 100 },
    { x: 100, y: 400, w: 60, h: 36, r: 18, scale: 0.04, depth: 100 },
    // ... more lenses
  ]
});
wgl.render();
wgl.setLenses(newLensesArray); // update all lenses at once
```

## Files

- `glass-engine.js` — engine (`generateMap`, `buildFilter`, `createGlass`, `applySpecular`, `createGlassWebGL`)
- `index.html` — dark-mode interactive demo with video player
- `showcase.html` — light-theme showcase with all components + playground
- `index-dark.html` — dark edition with cosmic background
- `SKILL.md` — agent-readable implementation guide with production parameters

## Demo

Open `index.html` or `showcase.html` via any static server (`npx serve .`, `python3 -m http.server`).

## How It Works

The effect rests on a single SVG filter primitive, `feDisplacementMap`. It takes two inputs — the painted content and a generated displacement map — and for each pixel of the content it reads the matching pixel of the map and uses that color to decide which way to push. Nothing is sampled from underneath the glass. The content's own pixels are the ones moving, which is why text under the lens stays selectable and links stay clickable.

The map is a small PNG generated on the fly from the glass's shape and size. Its red and green channels encode horizontal and vertical displacement (neutral value 128), and the blue channel encodes the specular rim highlight. Everywhere outside the lens the map sits at a neutral value, so only the region under the glass moves.

For `<canvas>` and `<video>` elements (which Safari won't SVG-filter), the same displacement map feeds a **WebGL fragment shader** instead — rendering identical optical refraction in real-time.

## Performance Notes

- Map generation uses **4-fold quadrant symmetry**: only the top-left quadrant is computed, then mirrored to all four quadrants, cutting per-frame computation by ~75%.
- Safari filter cache is busted by generating a fresh filter ID on every update.
- Safari specular pass runs over the lens-sized sub-region only, avoiding full-element cost.
