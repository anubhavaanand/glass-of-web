# Glass of the Web

Faithful, cross-browser replica of [Aave's liquid-glass technique](https://aave.com/design/building-glass-for-the-web) — reverse-engineered from their live production DOM (July 2026).

A generated displacement-map PNG drives an SVG `feDisplacementMap` filter that bends the **content's own pixels** inside a lens-shaped region. Nothing is sampled from behind the glass — which is exactly why it runs in Chrome, Safari, and Firefox with no flags and no fallbacks.

## Features

- Exact 17-primitive filter chain from Aave's site: chromatic aberration (3 displacement passes at ±4–8% scale spread), specular highlight derived from the map's blue channel, hole-punch composites
- Displacement-map generator fitted to Aave's real maps (flat-neutral center, steep rim bend)
- Fresh filter IDs per update (Safari cache fix), cached maps per shape (cheap lens moves)
- Demos: switch, slider, toggle group, 160px cursor magnifier with visible RGB fringing, hero chips

## Usage

```html
<script src="glass-engine.js"></script>
<script>
  const g = GlassEngine.createGlass(container, {
    lens: { x: 8, y: 8, w: 36, h: 36, r: 18 },  // px rect inside container
    scale: 0.14,                                  // pull scales w/ element size
    rimStart: 0.76, rimPow: 2.3,                  // map profile (Aave switch fit)
    glowSide: 54, glowTop: 21                     // specular angle bias
  });
  g.setLens({ x: 76, y: 8, w: 36, h: 36, r: 18 }); // moves region only — cheap
</script>
```

## Files

- `glass-engine.js` — engine (`generateLensMap`, `buildGlassFilter`, `createGlass`)
- `index.html` — interactive demo page
- `SKILL.md` — agent-readable implementation guide with production parameters

## Demo

Open `index.html` via any static server (`npx serve .`, `python3 -m http.server`).
