# Glass of the Web

Cross-browser liquid glass refraction engine using SVG `feDisplacementMap`. Works in Chrome, Safari, and Firefox — no flags, no fallbacks.

## Architecture

Inspired by [Aave's glass technique](https://aave.com/design/building-glass-for-the-web). The SVG filter is applied via `filter: url(#id)` on the **content layer**, not via `backdrop-filter` (which only works in Chromium — WebKit bug #245510).

## Files

- `glass-engine.js` — Reusable engine class (displacement map generation, SVG filter creation, DOM wrapper)
- `index.html` — Interactive demo with Switch, Slider, Segmented Control, and Cursor Lens
- `SKILL.md` — Agent-readable skill documentation for implementing glass UI from scratch

## Demo

Serve locally and open in any browser:

```
npx serve .
```
