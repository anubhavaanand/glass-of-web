---
name: building-glass-for-web
description: Glassmorphic UI components using CSS backdrop-filter blur() and semi-transparent white backgrounds — matching Aave.com's visual style. Use when building glass cards, switches, sliders, segmented controls, or any frosted glass UI. Triggers on "glass effect", "glassmorphism", "frosted glass", "Aave glass", "backdrop-filter glass".
---

# Building Glass for the Web

## Core Concept

Glass UI is a semi-transparent layer with `backdrop-filter: blur()` that sits between the background and the content. The blur distorts whatever is visually behind the element, creating a frosted-glass appearance.

This is the exact technique used on **Aave.com** for their partner cards.

### Why this works everywhere

| Approach | Chromium | Safari | Firefox |
|---|---|---|---|
| `backdrop-filter: blur()` | ✓ | ✓ | ✓ |
| `-webkit-backdrop-filter: blur()` | ✓ | ✓ | ✓ |

`backdrop-filter` is supported in all three engines since 2020.

---

## Architecture

### DOM Structure

```
Glass container (position: relative; border-radius)
  ├─ Glass layer (position: absolute; inset: 0)     ← backdrop-filter: blur() + bg
  └─ Content (position: relative; z-index: 1)        ← renders on top
```

```
<div class="card" style="position:relative; border-radius:24px">
  <!-- Glass backdrop layer -->
  <div class="glass"
       style="position:absolute; inset:0; border-radius:24px;
              background: rgba(255,255,255,0.2);
              backdrop-filter: blur(12px);
              pointer-events: none">
  </div>

  <!-- Content on top -->
  <div class="content" style="position:relative; z-index:1">
    Card content here...
  </div>
</div>
```

### Key points

- **Glass layer is absolute** — fills the container without affecting layout
- **`pointer-events: none`** — clicks pass through to content
- **Content gets `z-index: 1`** — renders above the glass layer
- **Container needs `position: relative`** — anchor for the absolute glass layer
- **`border-radius` on glass matches container** — corners stay sharp

---

## CSS

```css
/* Glass card */
.glass-card {
  position: relative;
  border-radius: 24px;
}

.glass-backdrop {
  position: absolute;
  inset: 0;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.2);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  pointer-events: none;
}

.glass-content {
  position: relative;
  z-index: 1;
}
```

Aave.com values:
- Background: `rgba(255, 255, 255, 0.2)`
- Blur: `12px`
- Border-radius: `24px`
- No border (or subtle `rgba(255,255,255,0.08)`)

---

## Component Patterns

### Glass Card

```
<div class="card" style="position:relative; border-radius:24px">
  <div class="glass-backdrop"></div>
  <div class="glass-content" style="position:relative; z-index:1">
    <h3>Title</h3>
    <p>Description...</p>
  </div>
</div>
```

### Glass Button

```css
.glass-btn {
  position: relative;
  padding: 10px 24px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  background: transparent;
  overflow: hidden;
}
.glass-btn-backdrop {
  position: absolute; inset: 0; border-radius: 14px;
  background: rgba(255,255,255,0.2);
  backdrop-filter: blur(12px);
  pointer-events: none;
}
.glass-btn:hover .glass-btn-backdrop {
  background: rgba(255,255,255,0.25);
}
.glass-btn span { position: relative; z-index: 1; }
```

### Glass Thumb / Handle

For switches and sliders, the glass layer sits on top of the thumb element while a solid white thumb sits beneath (with z-index) to maintain the frosted look.

```
Switch thumb:
  ├─ Solid thumb (z-index: 1)        ← white circle
  └─ Glass thumb (onToggle moves)    ← backdrop-filter: blur()
```

### Cursor Lens

A circular glass layer follows the cursor, offset by `-50%, -50%` to center on the pointer. A rim overlay adds a subtle border and shadow for depth.

---

## Browser Quirks & Fixes

### 1. `-webkit-backdrop-filter` prefix

**Fix**: Always include both prefixed and unprefixed:
```css
-webkit-backdrop-filter: blur(12px);
backdrop-filter: blur(12px);
```

### 2. Safari border-radius clipping

**Fix**: Match the glass layer's `border-radius` to the container exactly.

### 3. Chromium paint order

**Fix**: Ensure the glass layer is the first child of the container so it paints behind the content.

---

## Performance

- **`backdrop-filter: blur()`** is GPU-accelerated in all engines
- Transforms and opacity changes on glass layers are composited
- Avoid animating `backdrop-filter` itself (causes repaint) — animate `transform` or `opacity` instead

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Glass appears as solid white | Missing `backdrop-filter` | Add `backdrop-filter: blur()` |
| Glass has no blur effect | Element has no content behind it | Ensure background has visible elements |
| Content not visible | Content behind glass layer | Add `z-index: 1` to content |
| Glass has square corners | `border-radius` not synced | Match border-radius on container and glass |
| Glass disappears on scroll | iOS Safari compositing | Add `will-change: transform` to glass layer |
