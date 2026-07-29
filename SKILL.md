---
name: building-glass-for-web
description: Cross-browser liquid glass UI components using SVG feDisplacementMap refraction on a lens-shaped content copy. Use when building refractive glass switches, sliders, segmented controls, cursor lenses, modals, or glassmorphic web elements that work in Chrome, Safari, and Firefox. Triggers on requests for "glass effect", "liquid glass", "refraction UI", "Aave glass", "SVG displacement glass", or "cross-browser glass components".
---

# Building Glass for the Web

## Core Concept

This technique refracts **live HTML content** using SVG `feDisplacementMap`. The glass effect is a **lens** — a small circular or pill-shaped element that contains a copy of the content behind it. The SVG filter displaces the copy's pixels inside the lens, creating the refraction effect. Outside the lens, content renders normally.

**The filter bends the content copy's own pixels** — nothing is sampled from underneath. The content's own pixels are the ones moving.

### Why this works everywhere

| Approach | Chromium | Safari | Firefox |
|---|---|---|---|
| `filter: url(#svg)` on lens element | ✓ | ✓ | ✓ |
| `backdrop-filter: url(#svg)` | ✓ | ✗ | ✗ |
| CSS `backdrop-filter: blur()` (static) | ✓ | ✓ | ✓ |

`backdrop-filter: url(#svg)` only works in Chromium (WebKit bug #245510, open since 2022). Using `filter: url(#svg)` on a lens element works in all three engines.

---

## Architecture

### DOM Structure

```
Real content (track, labels, etc.)       ← renders normally, no filter
  └─ Glass lens (position:absolute)      ← contains filter + copy
       ├─ Content copy (offset to align) ← pixels get displaced
       ├─ <svg><defs><filter />          ← inline per-component
       └─ Rim overlay                    ← specular highlight + shadow
```

```
<div class="switch-root" style="position:relative; width:80px; height:36px">

  <!-- Real thumb (no filter, visible) -->
  <div class="thumb" style="..."/>

  <!-- Glass lens — this element has filter: url(#id) -->
  <div class="lens"
       style="position:absolute; top:3px; left:3px;
              width:30px; height:30px; border-radius:50%;
              overflow:hidden; will-change:filter,transform;
              filter: url(#gf1-123456)">
    <!-- Content copy — offset so correct region aligns with lens -->
    <div class="copy" style="position:absolute; left:-3px; top:-3px;
                             width:80px; height:36px">
      ... copy of the track content behind the lens ...
    </div>
  </div>

  <!-- SVG filter defs (inline, absolute, 0-size) -->
  <svg style="position:absolute;width:0;height:0;overflow:visible">
    <defs>
      <filter id="gf1-123456" filterUnits="userSpaceOnUse" ...>
        <feImage href="map.png" result="map"/>
        <feDisplacementMap in="SourceGraphic" in2="map" scale="18"
          xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  </svg>

  <!-- Specular rim overlay -->
  <div class="rim" style="..."/>
</div>
```

### Key points

- **The lens element gets the filter** — the 30×30 circle containing the content copy
- **The content copy is offset** to align the correct background region through the lens
- **Moving the lens** updates its `transform` and the copy's `left`/`top` — no map regen
- **The map only changes** when the lens shape changes (resize, radius change)

---

## How feDisplacementMap Works

`P'(x,y) = P(x + scale × (R(x,y)/255 - 0.5), y + scale × (G(x,y)/255 - 0.5))`

- Red channel = horizontal shift (128 = neutral)
- Green channel = vertical shift (128 = neutral)
- < 128 shifts one direction, > 128 shifts opposite
- Outward radial values → convex lens (magnifying) effect

### Chromatic Aberration

The SVG filter uses **three separate displacement passes** at different scales, then extracts each color channel and merges:

| Pass | Scale Factor | Channel Extracted |
|------|-------------|-------------------|
| R | 1.2× | Red (feColorMatrix preserves R only) |
| G | 1.0× | Green (feColorMatrix preserves G only) |
| B | 0.8× | Blue (feColorMatrix preserves B only) |

```
feDisplacementMap(scale*1.2) → feColorMatrix(keep R) → channel R
feDisplacementMap(scale*1.0) → feColorMatrix(keep G) → channel G
feDisplacementMap(scale*0.8) → feColorMatrix(keep B) → channel B
feComposite(arithmetic, k2=1, k3=1) to merge R+G
feComposite(arithmetic, k2=1, k3=1) to merge RG+B
```

Lower scale for blue = less displacement → light separates more at the edges (blue inside, red outside), mimicking real glass dispersion.

---

## Implementation

```javascript
// 1. Generate the displacement map
function genMap(w, h, strength = 55) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d');
  const d = x.createImageData(w, h).data;
  const cx = w / 2, cy = h / 2;
  const mr = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(dist / mr, 1);
      const s = t * t * (3 - 2 * t) * strength;  // smoothstep
      let r = 128, g = 128;
      if (dist > 0.001) {
        r = clamp(128 + (dx / dist) * s);
        g = clamp(128 + (dy / dist) * s);
      }
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  x.putImageData(new ImageData(d, w, h), 0, 0);
  return c.toDataURL('image/png');
}

// 2. Build the SVG filter (fresh ID every call — Safari cache fix)
function el(name) { return document.createElementNS('http://www.w3.org/2000/svg', name); }

function buildFilter(defs, w, h, scale) {
  while (defs.firstChild) defs.removeChild(defs.firstChild);
  const id = 'gf' + (++_fid) + '-' + Date.now();
  const map = genMap(w, h);
  const pad = Math.round(scale * 0.6);
  const f = el('filter');
  f.id = id;
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', String(-pad));
  f.setAttribute('y', String(-pad));
  f.setAttribute('width', String(w + pad * 2));
  f.setAttribute('height', String(h + pad * 2));

  const fl = el('feFlood');
  fl.setAttribute('flood-color', 'rgb(128,128,128)');
  fl.setAttribute('flood-opacity', '1');
  fl.setAttribute('result', 'mapBg');
  f.appendChild(fl);

  const img = el('feImage');
  img.setAttribute('x', '0'); img.setAttribute('y', '0');
  img.setAttribute('width', String(w)); img.setAttribute('height', String(h));
  img.setAttribute('preserveAspectRatio', 'none');
  img.setAttribute('href', map); img.setAttribute('result', 'rawMap');
  f.appendChild(img);

  const ov = el('feComposite');
  ov.setAttribute('in', 'rawMap');
  ov.setAttribute('in2', 'mapBg');
  ov.setAttribute('operator', 'over');
  ov.setAttribute('result', 'map');
  f.appendChild(ov);

  const bl = el('feGaussianBlur');
  bl.setAttribute('in', 'map');
  bl.setAttribute('stdDeviation', `${0.5 / w} ${0.5 / h}`);
  bl.setAttribute('result', 'smoothMap');
  f.appendChild(bl);

  // Chromatic aberration: 3 passes
  const dR = el('feDisplacementMap');
  dR.setAttribute('in', 'SourceGraphic');
  dR.setAttribute('in2', 'smoothMap');
  dR.setAttribute('scale', String(scale * 1.2));
  dR.setAttribute('xChannelSelector', 'R');
  dR.setAttribute('yChannelSelector', 'G');
  dR.setAttribute('result', 'displacedR');
  f.appendChild(dR);

  const dG = el('feDisplacementMap');
  dG.setAttribute('in', 'SourceGraphic');
  dG.setAttribute('in2', 'smoothMap');
  dG.setAttribute('scale', String(scale * 1.0));
  dG.setAttribute('xChannelSelector', 'R');
  dG.setAttribute('yChannelSelector', 'G');
  dG.setAttribute('result', 'displacedG');
  f.appendChild(dG);

  const dB = el('feDisplacementMap');
  dB.setAttribute('in', 'SourceGraphic');
  dB.setAttribute('in2', 'smoothMap');
  dB.setAttribute('scale', String(scale * 0.8));
  dB.setAttribute('xChannelSelector', 'R');
  dB.setAttribute('yChannelSelector', 'G');
  dB.setAttribute('result', 'displacedB');
  f.appendChild(dB);

  const mR = el('feColorMatrix');
  mR.setAttribute('type', 'matrix');
  mR.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
  mR.setAttribute('result', 'chanR');
  f.appendChild(mR);

  const mG = el('feColorMatrix');
  mG.setAttribute('type', 'matrix');
  mG.setAttribute('values', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0');
  mG.setAttribute('result', 'chanG');
  f.appendChild(mG);

  const mB = el('feColorMatrix');
  mB.setAttribute('type', 'matrix');
  mB.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
  mB.setAttribute('result', 'chanB');
  f.appendChild(mB);

  const mr1 = el('feComposite');
  mr1.setAttribute('in', 'chanR');
  mr1.setAttribute('in2', 'chanG');
  mr1.setAttribute('operator', 'arithmetic');
  mr1.setAttribute('k1', '0'); mr1.setAttribute('k2', '1');
  mr1.setAttribute('k3', '1'); mr1.setAttribute('k4', '0');
  mr1.setAttribute('result', 'mergedRG');
  f.appendChild(mr1);

  const mr2 = el('feComposite');
  mr2.setAttribute('in', 'mergedRG');
  mr2.setAttribute('in2', 'chanB');
  mr2.setAttribute('operator', 'arithmetic');
  mr2.setAttribute('k1', '0'); mr2.setAttribute('k2', '1');
  mr2.setAttribute('k3', '1'); mr2.setAttribute('k4', '0');
  mr2.setAttribute('result', 'out');
  f.appendChild(mr2);

  defs.appendChild(f);
  return id;
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

// 3. Apply filter to the lens element
function applyFilter(el, id) {
  el.style.filter = 'url(#' + id + ')';
}

// 4. Set up a glass component
const defs = document.getElementById('my-defs');
const lens = document.getElementById('my-lens');
const copy = document.getElementById('my-copy');
applyFilter(lens, buildFilter(defs, 30, 30, 18));

// When the lens moves to position (lx, ly):
function setLensPosition(lx, ly) {
  lens.style.transform = 'translate(' + lx + 'px, ' + ly + 'px)';
  copy.style.left = (-lx) + 'px';
  copy.style.top = (-ly) + 'px';
}
```

---

## Component Patterns

### Glass Switch

The thumb is the lens (30×30 circle). Inside it: a copy of the 80×36 track, offset by `-(thumbLeft)`.

On toggle: CSS transitions the lens and thumb simultaneously; JS updates copy offset.

### Glass Slider

The handle is the lens (30×30 circle). Inside it: a copy of the track fill, offset by `trackLeft - handleLeft`.

On drag: JS updates `lens.style.left`, `copy.style.left`, `fill.style.width` — no map regen.

### Glass Segmented Control

The glass pill IS the selection indicator. It springs between options with a cubic-bezier easing.

Inside it: a copy of all options, offset by `-pillLeft` to show the active one through the lens.

### Cursor Lens / Magnifier

A 80×80 circular lens follows the cursor. Inside it: a copy of the full stage content, offset by `-(cursorX - 40), -(cursorY - 40)`.

On mousemove: lens follows cursor, copy offset tracks to align.

---

## Browser Quirks & Fixes

### 1. Safari Filter Caching Freeze

**Fix**: Fresh filter ID + random suffix on every `buildFilter()` call.

### 2. Safari DOM Size Ceiling (~2048px)

**Fix**: Keep refracted DOM under ~800px. Expand filter bounds. No full-page glass.

### 3. Chromium Sub-Pixel Specular Artifacts

**Fix**: Restrict specular to lens-sized region only.

### 4. Safari Refuses to Filter `<video>`

**Fix**: WebGL shader fallback (pass displacement map as texture).

### 5. `filter` and `backdrop-filter` coexistence

**Fix**: Apply `filter` to lens, `backdrop-filter: blur()` to a separate frost sibling.

---

## Performance

- **Position changes are free**: Only transform + copy offset update
- **Map regeneration is expensive**: Only on lens shape/size change
- **Map caching**: Cache by `w × h` key for identically-sized elements
- **Lens size matters**: Smaller lens = smaller map = faster generation

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Glass frozen / no animation | Safari cached stale filter output | Add random ID suffix on every buildFilter call |
| Black tiles where glass should be | Safari DOM ~2048px ceiling | Reduce area, expand filter bounds |
| Content uniformly sheared | Map doesn't match lens dimensions | Regenerate with matching w/h |
| Glass has no effect | Filter on wrong element | Apply to lens element, not wrapper |
| Fish-eye instead of refraction | Wrong displacement direction | Use outward radial vector (dx/dist, dy/dist) |
| Text unreadable under glass | Refraction too strong | Reduce strength/scale |
| Glass breaks on mobile scroll | iOS compositing thread | Use backdrop-filter:blur frost as mobile fallback |
