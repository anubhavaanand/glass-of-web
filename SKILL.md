---
name: building-glass-for-web
description: Use when building cross-browser liquid glass UI components, refractive lenses, glass switches, glass sliders, glass modals, or glassmorphic web elements in React/HTML/CSS. Triggers include requests for "glass effect", "liquid glass", "refraction web UI", "Aave glass", "glassmorphism", "SVG displacement glass", or "cross-browser glass components".
---

# Building Glass for the Web

A production-ready technique for building real-time, cross-browser refractive glass UI components (Switches, Sliders, Segmented Controls, Modals, Navbars, and Magnifiers) using SVG `feDisplacementMap`, 4-Fold Symmetry Map Generation, and WebGL fallbacks.

## Core Principle

Traditional `backdrop-filter: blur()` only applies static Gaussian blur. **Liquid Glass** acts as a physical 3D optical lens that refracts real, live DOM pixels (text, images, cards, buttons) in real time while keeping text fully selectable and links clickable.

---

## 1. Quick Start Implementation

### Step A: The Glass Displacement Engine

```javascript
// glassEngine.js - 4-Fold Symmetry Map Generator
export class GlassEngine {
  constructor() {
    this.svgRoot = this.getOrCreateSvgRoot();
  }

  getOrCreateSvgRoot() {
    let svg = document.getElementById('glass-svg-root');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'glass-svg-root';
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden;';
      document.body.appendChild(svg);
    }
    return svg;
  }

  // Generates displacement map with 4-fold quadrant symmetry (75% faster)
  generateMap(w, h, radius, refractionScale = 0.15, depth = 15) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const halfW = Math.ceil(w / 2);
    const halfH = Math.ceil(h / 2);

    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        let dx = (x / halfW) * refractionScale * depth;
        let dy = (y / halfH) * refractionScale * depth;

        const rVal = Math.min(255, Math.max(0, Math.round(128 + dx * 10)));
        const gVal = Math.min(255, Math.max(0, Math.round(128 + dy * 10)));
        const bVal = Math.min(255, Math.max(0, Math.round(Math.abs(dx + dy) * 15)));

        // Mirror across 4 quadrants
        this.setPixel(data, w, x, y, rVal, gVal, bVal);
        this.setPixel(data, w, w - 1 - x, y, 255 - rVal, gVal, bVal);
        this.setPixel(data, w, x, h - 1 - y, rVal, 255 - gVal, bVal);
        this.setPixel(data, w, w - 1 - x, h - 1 - y, 255 - rVal, 255 - gVal, bVal);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  setPixel(data, w, x, y, r, g, b) {
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }

  createGlassFilter({ width, height, radius, scale = 25 }) {
    // Dynamic Filter ID solves Safari caching freeze bug
    const filterId = `glass-${Math.random().toString(36).substring(2, 9)}`;
    const mapUrl = this.generateMap(width, height, radius);

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = filterId;
    filter.setAttribute('x', '-20%'); filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '140%'); filter.setAttribute('height', '140%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    feImage.setAttribute('href', mapUrl);
    feImage.setAttribute('result', 'map');

    const feDisplacement = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDisplacement.setAttribute('in', 'SourceGraphic');
    feDisplacement.setAttribute('in2', 'map');
    feDisplacement.setAttribute('scale', scale.toString());
    feDisplacement.setAttribute('xChannelSelector', 'R');
    feDisplacement.setAttribute('yChannelSelector', 'G');

    filter.appendChild(feImage);
    filter.appendChild(feDisplacement);
    this.svgRoot.appendChild(filter);

    return { filterId, filter };
  }
}
```

---

## 2. Browser Drawbacks & Engineering Fixes

| Issue / Drawback | Cause | Proven Solution |
| :--- | :--- | :--- |
| **Safari Filter Caching Freeze** | WebKit caches SVG filter rendering outputs by filter ID. Updating displacement maps without changing the ID freezes the glass lens. | **Dynamic Filter ID Rotation**: Append a random hash/timestamp to the filter ID on every map update. |
| **Safari DOM Size Ceiling** | WebKit drops filters or displays black tiles if target DOM exceeds ~2048px. | **Filter Bounds Clamping**: Set `x="-20%" y="-20%" width="140%" height="140%"` and force hardware acceleration (`will-change: filter`). |
| **Chromium Sub-Pixel Artifacts** | Specular highlight passes spanning full filter bounds cause 0.5px line flickering on Chrome/Edge. | **Inset Mask Cropping**: Apply a 0.5px inset clip-path/mask to the specular highlight filter node. |
| **Safari GPU Video Bypassing** | WebKit bypasses SVG filter pipelines for hardware-composited `<video>` streams. | **WebGL Texture Fallback**: Pass the displacement map into a WebGL shader for `<video>` or `<canvas>` targets. |
| **Map Re-generation FPS Drop** | Re-calculating full 2D displacement maps on every frame during dragging drops frame rate. | **4-Fold Symmetry + Position Caching**: Compute 1 quadrant and mirror 4x (75% faster). Reuse cached map during positional `x`/`y` translates. |

---

## 3. Recommended Component Patterns

1. **Glass Switch**: Lens thumb glides across a track, refracting the track's fill to provide depth.
2. **Glass Slider**: Lens handle moves along a track, refracting the progress bar while keeping numeric labels readable.
3. **Glass Segmented Toggle**: Glass pill indicator gliding between radio options with spring physics.
4. **Glass Navbar / Card**: Floating glass panels with specular light rim highlights.
