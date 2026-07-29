# 🧪 Glass of the Web (`glass-of-web`)

A production-grade, cross-browser **Liquid Glass UI Refraction Engine** inspired by Aave Glass and Apple's WWDC Liquid Glass design language.

Built with SVG `feDisplacementMap`, **4-fold quadrant symmetry map generation** (75% CPU optimization), and Safari caching fixes.

---

## 🌟 Key Features

* **Cross-Browser Native Support**: Runs seamlessly in Chrome, Safari (macOS & iOS), Edge, and Firefox.
* **Refracts Live HTML / DOM**: Works on real live text, images, cards, inputs, and buttons while keeping text **fully selectable** and buttons **clickable**.
* **75% Faster 4-Fold Symmetry**: Computes only the top-left quadrant of the rounded-rectangle lens displacement map and mirrors it across 4 quadrants.
* **Safari Caching Fix**: Implements dynamic filter ID rotation to bypass WebKit's static SVG filter rendering cache bug.
* **Zero Dependencies**: Pure vanilla JavaScript, SVG Filters, and CSS.

---

## 🚀 Interactive Demo Components Included

1. **Refractive Switch**: Glass lens thumb refracting live background track states.
2. **Refractive Slider**: Glass handle sliding across a track with value labels staying crisp.
3. **Refractive Segmented Toggle**: Glass pill indicator with smooth spring translation.
4. **Interactive Cursor Lens**: Real-time cursor-following refraction over imagery and cards.

---

## 🛠️ Quick Start

```bash
# Clone the repository
git clone https://github.com/anubhavaanand/glass-of-web.git

# Serve locally
npx serve .
```

---

## 📚 Technical Skill Documentation

For complete architectural guidelines, browser edge cases, and code patterns, inspect **[`SKILL.md`](./SKILL.md)**.
