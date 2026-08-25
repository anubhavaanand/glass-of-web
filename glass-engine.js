/**
 * Aave Glass Web Engine — Optical Refraction for Live HTML Content
 * Based on Aave Labs "Building Glass for the Web" architecture.
 */

class GlassDisplacementEngine {
  constructor() {
    this.cache = new Map();
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  getCacheKey(w, h, r, scale, depth = 1.0, curvature = 1.0) {
    return `${w}_${h}_${r}_${scale}_${depth}_${curvature}`;
  }

  generateMap(width, height, radius, scale = 40, depth = 1.0, curvature = 1.0) {
    const w = Math.max(8, Math.round(width));
    const h = Math.max(8, Math.round(height));
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

    const cacheKey = this.getCacheKey(w, h, r, scale, depth, curvature);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    this.canvas.width = w;
    this.canvas.height = h;
    const imgData = this.ctx.createImageData(w, h);
    const data = imgData.data;
    const neutral = 128;

    const halfW = Math.ceil(w / 2);
    const halfH = Math.ceil(h / 2);

    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        const qx = Math.abs(x - w / 2) - (w / 2 - r);
        const qy = Math.abs(y - h / 2) - (h / 2 - r);
        const dist = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;

        let nx = 0, ny = 0;
        if (dist < 0) {
          const localX = (x - (w / 2 - r)) / (r || 1);
          const localY = (y - (h / 2 - r)) / (r || 1);

          if (qx > 0 && qy > 0) {
            const angle = Math.atan2(localY, localX);
            const cornerDist = Math.hypot(localX, localY);
            const falloff = Math.pow(Math.min(1, cornerDist), curvature);
            nx = Math.cos(angle) * falloff;
            ny = Math.sin(angle) * falloff;
          } else if (qx > 0) {
            nx = (x - w / 2 < 0 ? -1 : 1) * Math.pow(Math.min(1, (r - x) / (r || 1)), curvature);
          } else if (qy > 0) {
            ny = (y - h / 2 < 0 ? -1 : 1) * Math.pow(Math.min(1, (r - y) / (r || 1)), curvature);
          } else {
            nx = ((x - w / 2) / (w / 2)) * depth * 0.4;
            ny = ((y - h / 2) / (h / 2)) * depth * 0.4;
          }
        }

        const deltaX = nx * scale;
        const deltaY = ny * scale;

        const quadrants = [
          { px: x, py: y, dx: deltaX, dy: deltaY },
          { px: w - 1 - x, py: y, dx: -deltaX, dy: deltaY },
          { px: x, py: h - 1 - y, dx: deltaX, dy: -deltaY },
          { px: w - 1 - x, py: h - 1 - y, dx: -deltaX, dy: -deltaY }
        ];

        for (const q of quadrants) {
          if (q.px >= 0 && q.px < w && q.py >= 0 && q.py < h) {
            const idx = (q.py * w + q.px) * 4;
            const rVal = neutral + q.dx;
            const gVal = neutral + q.dy;
            data[idx]     = rVal <= 0 ? 0 : rVal >= 255 ? 255 : (rVal + 0.5) | 0;
            data[idx + 1] = gVal <= 0 ? 0 : gVal >= 255 ? 255 : (gVal + 0.5) | 0;
            data[idx + 2] = neutral;
            data[idx + 3] = 255;
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    const dataUrl = this.canvas.toDataURL('image/png');
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(cacheKey, dataUrl);
    return dataUrl;
  }

  updateFilter(filterId, feImgId, width, height, radius, scale, depth = 1.0, curvature = 1.0) {
    const filter = document.getElementById(filterId);
    const feImg = document.getElementById(feImgId);
    if (!filter || !feImg) return;

    const dataUrl = this.generateMap(width, height, radius, scale, depth, curvature);
    feImg.setAttribute('href', dataUrl);
    feImg.setAttribute('width', width);
    feImg.setAttribute('height', height);
    filter.setAttribute('width', width);
    filter.setAttribute('height', height);

    const feDisp = filter.querySelector('feDisplacementMap');
    if (feDisp) feDisp.setAttribute('scale', scale);
  }
}

const glassEngine = new GlassDisplacementEngine();

document.addEventListener('DOMContentLoaded', () => {
  // 1. Hero Lens
  const heroStage = document.getElementById('heroStage');
  const heroLens = document.getElementById('heroLens');
  const refractedHeroLayer = document.getElementById('refractedHeroLayer');
  if (heroStage && heroLens && refractedHeroLayer) {
    const w = 200, h = 90, r = 45;
    glassEngine.updateFilter('hero-filter', 'feImg-hero', w, h, r, 42, 1.0, 1.2);
    let targetX = heroStage.clientWidth / 2, targetY = heroStage.clientHeight / 2;
    let currX = targetX, currY = targetY;

    const render = () => {
      currX += (targetX - currX) * 0.15;
      currY += (targetY - currY) * 0.15;
      const posX = currX - w / 2;
      const posY = currY - h / 2;
      heroLens.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;
      refractedHeroLayer.style.transform = `translate3d(${-posX}px, ${-posY}px, 0)`;
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const onMove = (e) => {
      const rect = heroStage.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      targetX = Math.max(w / 2, Math.min(rect.width - w / 2, clientX - rect.left));
      targetY = Math.max(h / 2, Math.min(rect.height - h / 2, clientY - rect.top));
    };
    heroStage.addEventListener('mousemove', onMove);
    heroStage.addEventListener('touchmove', onMove, { passive: true });
  }

  // 2. Switch
  const aaveSwitch = document.getElementById('aaveSwitch');
  if (aaveSwitch) {
    glassEngine.updateFilter('switch-filter', 'feImg-switch', 52, 52, 26, 32);
    aaveSwitch.addEventListener('click', () => aaveSwitch.classList.toggle('active'));
  }

  // 3. Slider
  const slider = document.getElementById('sliderContainer');
  const fillBar = document.getElementById('sliderFillBar');
  const glassThumb = document.getElementById('sliderGlassThumb');
  const fillDup = document.getElementById('sliderFillDuplicate');
  const readout = document.getElementById('sliderReadout');
  if (slider && fillBar && glassThumb) {
    glassEngine.updateFilter('slider-filter', 'feImg-slider', 60, 60, 30, 30);
    let dragging = false;
    const update = (clientX) => {
      const rect = slider.getBoundingClientRect();
      let ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pct = Math.round(ratio * 100);
      fillBar.style.width = `${pct}%`;
      glassThumb.style.left = `calc(${pct}% - 30px)`;
      if (fillDup) fillDup.style.transform = `translateX(-${ratio * rect.width}px)`;
      if (readout) readout.textContent = `${pct}%`;
    };
    slider.addEventListener('mousedown', (e) => { dragging = true; update(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (dragging) update(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // 4. Toggle Group
  const options = document.querySelectorAll('.toggle-option');
  const pill = document.getElementById('togglePill');
  const dupOptions = document.getElementById('duplicateOptions');
  if (options.length && pill) {
    const updatePill = (btn) => {
      options.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const offset = btn.offsetLeft;
      const width = btn.offsetWidth;
      pill.style.transform = `translateX(${offset}px)`;
      pill.style.width = `${width}px`;
      glassEngine.updateFilter('toggle-filter', 'feImg-toggle', width, 42, 21, 28);
      if (dupOptions) dupOptions.style.transform = `translateX(-${offset}px)`;
    };
    options.forEach(btn => btn.addEventListener('click', () => updatePill(btn)));
    const active = document.querySelector('.toggle-option.active') || options[0];
    if (active) setTimeout(() => updatePill(active), 50);
  }
});
