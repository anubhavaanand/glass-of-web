/**
 * Aave Glass Web Engine — Optical Refraction Engine
 * Implements 2D Signed Distance Fields, 4-Fold Symmetry, and Realtime Normal Mapping.
 */

class GlassDisplacementEngine {
  constructor() {
    this.cache = new Map();
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  getCacheKey(w, h, r, scale, depth, curvature) {
    return `${w}_${h}_${r}_${scale}_${depth}_${curvature}`;
  }

  generateMap(width, height, radius, scale = 35, depth = 1.0, curvature = 1.2, targetCanvas = null) {
    const w = Math.max(8, Math.round(width));
    const h = Math.max(8, Math.round(height));
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

    const canvas = targetCanvas || this.offscreenCanvas;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const neutral = 128;

    const halfW = Math.ceil(w / 2);
    const halfH = Math.ceil(h / 2);

    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        const qx = Math.abs(x - w / 2) - (w / 2 - r);
        const qy = Math.abs(y - h / 2) - (h / 2 - r);
        const maxQx = Math.max(qx, 0);
        const maxQy = Math.max(qy, 0);
        const dist = Math.min(Math.max(qx, qy), 0) + Math.sqrt(maxQx * maxQx + maxQy * maxQy) - r;

        let nx = 0, ny = 0;
        if (dist < 0) {
          const localX = (x - (w / 2 - r)) / (r || 1);
          const localY = (y - (h / 2 - r)) / (r || 1);

          if (qx > 0 && qy > 0) {
            const angle = Math.atan2(localY, localX);
            const cornerDist = Math.sqrt(localX * localX + localY * localY);
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

            const rVal = Math.round(neutral + q.dx);
            data[idx]     = rVal < 0 ? 0 : rVal > 255 ? 255 : rVal;

            const gVal = Math.round(neutral + q.dy);
            data[idx + 1] = gVal < 0 ? 0 : gVal > 255 ? 255 : gVal;

            data[idx + 2] = neutral;
            data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  updateFilter(filterId, feImgId, width, height, radius, scale, depth = 1.0, curvature = 1.2) {
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

const engine = new GlassDisplacementEngine();

document.addEventListener('DOMContentLoaded', () => {
  // 1. Switch
  const aaveSwitch = document.getElementById('aaveSwitch');
  if (aaveSwitch) {
    engine.updateFilter('switch-lens-filter', 'feImg-switch', 52, 52, 26, 28);
    aaveSwitch.addEventListener('click', () => {
      aaveSwitch.classList.toggle('active');
    });
  }

  // 2. Slider
  const slider = document.getElementById('sliderContainer');
  const fillBar = document.getElementById('sliderFillBar');
  const glassThumb = document.getElementById('sliderGlassThumb');
  const fillDup = document.getElementById('sliderFillDuplicate');
  const readout = document.getElementById('sliderReadout');
  if (slider && fillBar && glassThumb) {
    engine.updateFilter('slider-lens-filter', 'feImg-slider', 60, 60, 30, 24);
    let dragging = false;
    const updateSlider = (clientX) => {
      const rect = slider.getBoundingClientRect();
      let ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pct = Math.round(ratio * 100);
      fillBar.style.width = `${pct}%`;
      glassThumb.style.left = `calc(${pct}% - 30px)`;
      if (fillDup) fillDup.style.transform = `translateX(-${ratio * rect.width}px)`;
      if (readout) readout.textContent = `${pct}%`;
    };
    slider.addEventListener('mousedown', (e) => { dragging = true; updateSlider(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (dragging) updateSlider(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });
    slider.addEventListener('touchstart', (e) => { dragging = true; updateSlider(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) updateSlider(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchend', () => { dragging = false; });
  }

  // 3. Segmented Toggle Group (5 Options)
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
      engine.updateFilter('toggle-lens-filter', 'feImg-toggle', width, 36, 18, 26);
      if (dupOptions) dupOptions.style.transform = `translateX(-${offset}px)`;
    };
    options.forEach(btn => btn.addEventListener('click', () => updatePill(btn)));
    const active = document.querySelector('.toggle-option.active') || options[0];
    if (active) setTimeout(() => updatePill(active), 50);
  }

  // 4. Interactive Displacement Map Inspector
  const inspectorStage = document.getElementById('inspectorStage');
  const inspectorLens = document.getElementById('inspectorLens');
  const inspectorRefracted = document.getElementById('inspectorRefractedContent');
  const mapCanvas = document.getElementById('displacementMapCanvas');

  const sWidth = document.getElementById('sWidth');
  const sHeight = document.getElementById('sHeight');
  const sRadius = document.getElementById('sRadius');
  const sScale = document.getElementById('sScale');
  const sDepth = document.getElementById('sDepth');
  const sCurvature = document.getElementById('sCurvature');

  const updateInspector = () => {
    const w = parseInt(sWidth?.value || '180', 10);
    const h = parseInt(sHeight?.value || '80', 10);
    const r = parseInt(sRadius?.value || '40', 10);
    const s = parseInt(sScale?.value || '35', 10);
    const d = parseFloat(sDepth?.value || '1.0');
    const c = parseFloat(sCurvature?.value || '1.2');

    if (inspectorLens) {
      inspectorLens.style.width = `${w}px`;
      inspectorLens.style.height = `${h}px`;
      inspectorLens.style.borderRadius = `${r}px`;
    }

    const rim = document.getElementById('inspectorSpecularRim');
    if (rim) rim.style.borderRadius = `${r}px`;

    // Render live into SVG filter & into the inspector canvas preview
    const dataUrl = engine.generateMap(w, h, r, s, d, c, mapCanvas);
    const feImg = document.getElementById('feImg-inspector');
    if (feImg) {
      feImg.setAttribute('href', dataUrl);
      feImg.setAttribute('width', w);
      feImg.setAttribute('height', h);
    }
    const filter = document.getElementById('inspector-lens-filter');
    if (filter) {
      filter.setAttribute('width', w);
      filter.setAttribute('height', h);
      const feDisp = filter.querySelector('feDisplacementMap');
      if (feDisp) feDisp.setAttribute('scale', s);
    }

    document.getElementById('vWidth') && (document.getElementById('vWidth').textContent = `${w}px`);
    document.getElementById('vHeight') && (document.getElementById('vHeight').textContent = `${h}px`);
    document.getElementById('vRadius') && (document.getElementById('vRadius').textContent = `${r}px`);
    document.getElementById('vScale') && (document.getElementById('vScale').textContent = `${s}`);
    document.getElementById('vDepth') && (document.getElementById('vDepth').textContent = `${d.toFixed(1)}`);
    document.getElementById('vCurvature') && (document.getElementById('vCurvature').textContent = `${c.toFixed(1)}`);
  };

  [sWidth, sHeight, sRadius, sScale, sDepth, sCurvature].forEach(inp => {
    if (inp) inp.addEventListener('input', updateInspector);
  });

  if (inspectorStage && inspectorLens) {
    inspectorStage.addEventListener('mousemove', (e) => {
      const rect = inspectorStage.getBoundingClientRect();
      const w = inspectorLens.offsetWidth;
      const h = inspectorLens.offsetHeight;
      const x = e.clientX - rect.left - w / 2;
      const y = e.clientY - rect.top - h / 2;
      inspectorLens.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (inspectorRefracted) inspectorRefracted.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
    });
  }

  updateInspector();
});
