---
name: building-glass-for-web
description: Cross-browser liquid glass UI components using SVG feDisplacementMap refraction. Use when building refractive glass switches, sliders, segmented controls, cursor lenses, modals, navbars, or glassmorphic web elements. Triggers on requests for "glass effect", "liquid glass", "refraction UI", "Aave glass", "SVG displacement glass", or "cross-browser glass components". Works in Chrome, Safari, Firefox — no flags, no fallbacks.
---

# Building Glass for the Web

## Core Principle

This technique refracts **live HTML content** using SVG's `feDisplacementMap` filter primitive applied via the CSS `filter` property. It is NOT `backdrop-filter: blur()` — that creates a static blur. This creates a **physical 3D optical lens** that bends real DOM pixels.

### How it differs from other approaches

| Approach | Chromium | Safari | Firefox | Text selectable? |
|---|---|---|---|---|
| **This technique** (`filter: url(#svg)`) | ✓ | ✓ | ✓ | Yes |
| `backdrop-filter: url(#svg)` | ✓ | ✗ | ✗ | Yes |
| HTML-in-Canvas API | Behind flag | ✗ | ✗ | No |

The critical distinction: `backdrop-filter: url(#svg)` only works in Chromium (WebKit bug #245510, open since 2022). Aave's technique uses `filter: url(#svg)` on the **content layer** instead, which works everywhere.

---

## Architecture

### DOM Structure (3 layers)

```html
<div class="glass-wrapper">                         <!-- outermost container -->
  <!-- LAYER 1: Content that gets refracted -->
  <div class="glass-content" style="filter: url(#filter-id)">
    ... children (text, images, inputs, buttons) ...
  </div>

  <!-- LAYER 2: Frost + tint (CSS backdrop-filter) -->
  <div class="glass-frost"
       style="backdrop-filter: blur(8px) saturate(180%)" />

  <!-- LAYER 3: Specular rim + shadow overlay -->
  <div class="glass-rim" />
</div>
```

The SVG filter is applied to **Layer 1** (the content). The glass visual (frost, rim, shadow) are CSS overlays on Layers 2 and 3 that sit above the refracted content.

---

## How `feDisplacementMap` Works

`feDisplacementMap` takes two inputs:
1. **SourceGraphic** — the live-rendered HTML content
2. **A displacement map** — a PNG where each pixel's color encodes how far to shift the source pixel

The formula: `P'(x,y) = P(x + scale × (R(x,y) - 128), y + scale × (G(x,y) - 128))`

- **Red channel** = horizontal shift (128 = neutral = no shift)
- **Green channel** = vertical shift (128 = neutral)
- Values < 128 shift one direction, > 128 shift the opposite

---

## Implementation

### Step 1: Generate the Displacement Map

```javascript
function generateMap(width, height, radius, refractionScale = 0.15) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(width, height);
  const d = data.data;

  const halfW = Math.ceil(width / 2);
  const halfH = Math.ceil(height / 2);
  const maxRad = Math.min(radius, halfW, halfH);
  const scale = refractionScale * 15;

  // Compute top-left quadrant only (4-fold symmetry)
  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      let dx = 0, dy = 0;

      if (x < maxRad && y < maxRad) {
        // Corner region — smooth curvature falloff
        const cx = maxRad - x, cy = maxRad - y;
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist > 0 && dist < maxRad) {
          const factor = Math.max(0, 1 - dist / maxRad);
          const bend = Math.sin(factor * Math.PI * 0.5) * scale;
          dx = (cx / maxRad) * bend;
          dy = (cy / maxRad) * bend;
        }
      } else {
        // Edge region — gentle radial falloff
        dx = Math.sin((1 - x / halfW) * Math.PI * 0.5) * scale * 0.5;
        dy = Math.sin((1 - y / halfH) * Math.PI * 0.5) * scale * 0.5;
      }

      // Encode displacement into RGB channels
      const r = 128 + Math.round(dx * 10);
      const g = 128 + Math.round(dy * 10);
      const b = Math.round(Math.abs(dx + dy) * 15);

      // Mirror across all 4 quadrants
      setPixel(d, width, x, y, r, g, b);                          // TL
      setPixel(d, width, width-1-x, y, 255-r, g, b);              // TR
      setPixel(d, width, x, height-1-y, r, 255-g, b);             // BL
      setPixel(d, width, width-1-x, height-1-y, 255-r, 255-g, b); // BR
    }
  }

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function setPixel(d, w, x, y, r, g, b) {
  const i = (y * w + x) * 4;
  d[i] = Math.min(255, Math.max(0, r));
  d[i+1] = Math.min(255, Math.max(0, g));
  d[i+2] = Math.min(255, Math.max(0, b));
  d[i+3] = 255;
}
```

### Step 2: Create the SVG Filter

```javascript
function createGlassFilter({ width, height, radius, refractionScale, scale = 25 }) {
  // Dynamic ID: Safari caches filter output by ID. Changing the map without
  // changing the ID → Safari serves stale output → glass freezes mid-motion.
  const filterId = 'glass-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const mapUrl = generateMap(width, height, radius, refractionScale);

  const svg = document.getElementById('glass-svg-root') || createSvgRoot();
  const NS = 'http://www.w3.org/2000/svg';
  const filter = document.createElementNS(NS, 'filter');
  filter.id = filterId;
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const feImage = document.createElementNS(NS, 'feImage');
  feImage.setAttribute('href', mapUrl);
  feImage.setAttribute('result', 'map');

  const feDisplacement = document.createElementNS(NS, 'feDisplacementMap');
  feDisplacement.setAttribute('in', 'SourceGraphic');
  feDisplacement.setAttribute('in2', 'map');
  feDisplacement.setAttribute('scale', scale.toString());
  feDisplacement.setAttribute('xChannelSelector', 'R');
  feDisplacement.setAttribute('yChannelSelector', 'G');

  filter.appendChild(feImage);
  filter.appendChild(feDisplacement);
  svg.appendChild(filter);

  return { filterId, cleanup: () => filter.remove() };
}
```

### Step 3: Apply to the Content Layer

```css
.glass-content {
  filter: url(#glass-filter-id);
}
```

---

## 4-Fold Symmetry (75% Performance Gain)

The displacement map for a rounded rectangle has **four-fold quadrant symmetry**. Only the top-left quadrant is computed; values are mirrored with sign flips:

- Top-Left → Top-Right: **negate X** displacement (mirror vertical axis)
- Top-Left → Bottom-Left: **negate Y** displacement (mirror horizontal axis)
- Top-Left → Bottom-Right: **negate both** X and Y

This cuts per-pixel computation to **25%** of the naive approach, keeping map generation inside the 60fps frame budget even during resize animations.

---

## Browser Quirks & Engineering Fixes

### 1. Safari Filter Caching Freeze

**Problem**: WebKit caches SVG filter rendering output by the filter's ID. When the displacement map changes but the filter ID stays the same, Safari serves the cached output — the glass appears frozen.

**Fix**: Generate a **fresh unique filter ID** every time the map is updated. The `Date.now()` + random suffix pattern ensures uniqueness.

### 2. Safari DOM Size Ceiling

**Problem**: Safari has a cap on the source graphic size an SVG filter can process (approximately 2048px). Beyond this, Safari either breaks the effect into mismatched black tiles or drops it entirely.

**Fix**: Keep the refracted DOM area conservative. Set filter bounds to `x="-20%" y="-20%" width="140%" height="140%"` to minimize edge clipping. Avoid refracting full-page layouts — restrict glass to small UI elements (< 800px).

### 3. Chromium Sub-Pixel Specular Artifacts

**Problem**: When the specular highlight pass covers the full filter bounds (not just the lens region), Chromium browsers produce 0.5px line flickering artifacts at the lens edge.

**Fix**: Restrict the specular highlight to only the lens-sized region. Safari's filter implementation does not exhibit these artifacts, so the restriction is safe to apply universally.

### 4. Safari Refuses to Filter `<video>`

**Problem**: Safari composites `<video>` on the GPU and never hands those pixels to the SVG filter pipeline. The SVG filter simply has no effect.

**Fix**: Use a **WebGL shader fallback**. Pass the displacement map as a texture to a WebGL shader that samples the video frame and applies the same refraction math. Aave's implementation uses `initRefraction(canvas, video)` for this.

### 5. Coexistence of `filter` and `backdrop-filter`

**Problem**: Using both `filter: url(#svg)` and `backdrop-filter` on the same element causes `backdrop-filter` to break because `filter` creates a new compositing layer.

**Fix**: Split them across **sibling elements**:
```html
<div class="wrapper">
  <div class="content" style="filter: url(#glass)">  <!-- Layer 1: refraction -->
    ... children ...
  </div>
  <div class="frost" style="backdrop-filter: blur(8px)"/>  <!-- Layer 2: frost -->
</div>
```

---

## Component Patterns

### Glass Switch

The thumb is a glass lens. It refracts the track's **fill** (the `refractionTarget`) as it moves:

```html
<div class="switch" onclick="this.classList.toggle('active')">
  <div class="switch-content" style="filter: url(#glass-filter)">
    <div class="switch-track-bg"></div>
    <div class="switch-fill" style="opacity: ${active ? 1 : 0}"></div>
  </div>
  <div class="switch-thumb" style="left: ${active ? 60 : 6}px">
    <div class="glass-rim"></div>
  </div>
</div>
```

### Glass Slider

The handle refracts the track fill beneath it. Dragging is cheap to animate — only the filter's bounding box shifts while the displacement map stays cached. The map is regenerated only on shape changes, never on position changes.

```html
<div class="slider">
  <div class="slider-content" style="filter: url(#glass-filter)">
    <div class="slider-track"></div>
    <div class="slider-fill" style="width: ${pct}%"></div>
  </div>
  <div class="slider-handle" style="left: ${pct}%"></div>
</div>
```

### Glass Segmented Control

The glass effect serves as the **selection indicator itself**, not just a thumb. A glass pill glides between options with spring physics, refracting the highlighted text beneath it.

```html
<div class="segmented">
  <div class="segmented-content" style="filter: url(#glass-filter)">
    <div class="seg-pill" style="transform: translateX(${idx * 100}%)"></div>
  </div>
  <div class="seg-items">
    <div class="seg-item" data-index="0">Daily</div>
    <div class="seg-item" data-index="1">Weekly</div>
    <div class="seg-item" data-index="2">Monthly</div>
  </div>
</div>
```

### Cursor Lens / Magnifier

A circular glass lens that follows the user's cursor, refracting the content underneath. This is the simplest component — the lens is the glass itself, and the filter refracts the page content beneath it.

---

## Tuning Parameters

| Parameter | Range | Effect |
|---|---|---|
| `refractionScale` | 0.05–0.4 | How much the content bends. Low = subtle, high = dramatic. Sliders use gentler values (0.12) than switches (0.2). |
| `scale` | 10–50 | SVG filter scale attribute. Controls pixel displacement magnitude. |
| `depth` | 5–30 | Virtual lens curvature. Deeper = more edge refraction. |
| `radius` | element's border-radius | Must match the lens shape. Pill shapes use radius = height/2. |
| `blur` (frost) | 0–12 | CSS backdrop-filter blur. 0 = no frost layer. |

---

## Performance Guide

- **Position changes are free**: Moving the lens only shifts the filter bounding box — the displacement map stays cached.
- **Map regeneration is expensive**: Only happens when lens shape changes (resize, radius change).
- **4-fold symmetry**: Already cuts map generation cost by 75%.
- **Map caching**: Cache generated maps by `width × height × radius` key — same-sized elements reuse the same map.
- **Map pixel ratio**: Use `mapPixelRatio: 2` for retina, but cap to 0.3× on mobile for Tensor-class device headroom.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Glass frozen / no animation | Safari cached stale filter output | Add random suffix to filter ID on every update |
| Black tiles instead of glass | Safari DOM exceeds size ceiling (~2048px) | Reduce refracted DOM area, clamp filter bounds |
| Fish-eye lens instead of refraction | Wrong sign on displacement scale | Set scale to negative value or flip displacement direction |
| Content looks uniformly sheared / sliding | Map doesn't follow element's shape | Regenerate map with matching `radius` and `width/height` |
| Glass has no effect in Safari/Firefox | Used `backdrop-filter: url(#svg)` instead of `filter: url(#svg)` | Apply filter to content via CSS `filter`, not `backdrop-filter` |
| Sub-pixel flickering at edge | Specular highlight over full filter bounds on Chromium | Restrict specular pass to lens-sized region |
| Glass breaks on mobile scroll | iOS Safari scrolls on separate thread | Use CSS `backdrop-filter` frost as mobile fallback |
| Text becomes unreadable | Refraction too strong for the content | Reduce `refractionScale` and `scale` |

---

## When to Use vs When Not To

**Use this technique when:**
- Building switches, sliders, segmented controls, navbars, cards
- You need text to remain selectable and links clickable under the glass
- You need cross-browser support (Chrome + Safari + Firefox)
- You want a distinctive, premium UI look with minimal code

**Do NOT use this technique when:**
- You need the glass to refract arbitrary background content behind it (use `backdrop-filter` — but only in Chromium)
- You're building large full-page layouts with glass (Safari DOM ceiling)
- Performance on low-end mobile devices is critical (use CSS `backdrop-filter: blur()` as a lighter alternative)
- You need to refract `<video>` elements in all browsers (use WebGL fallback)

---

## Alternative: Static Map (Zero JS)

For fixed-size glass elements (navbars, cards, buttons), pre-generate the displacement map as a static PNG:

```bash
# Build script to generate the PNG once
python3 generate-map.py --width 700 --height 64 --radius 32 --output glass-map.png
```

Then use it directly in HTML (no canvas, no JS):

```html
<svg style="position:absolute;width:0;height:0">
  <filter id="glass-static" color-interpolation-filters="sRGB">
    <feImage href="/glass-map.png" result="map" />
    <feDisplacementMap in="SourceGraphic" in2="map" scale="25"
      xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="glass-content" style="filter: url(#glass-static)">
  ... children ...
</div>
```

---

## References

- [Aave: Building Glass for the Web](https://aave.com/design/building-glass-for-the-web) — the canonical article
- [MDN: \<feDisplacementMap\>](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap) — 96.9% global browser support
- [WebKit Bug #245510](https://bugs.webkit.org/show_bug.cgi?id=245510) — backdrop-filter: url() with SVG filters (reported 2022, still open)
- [W3C SVGWG Issue #1142](https://github.com/w3c/svgwg/issues/1142) — standards discussion on interoperable backdrop displacement
