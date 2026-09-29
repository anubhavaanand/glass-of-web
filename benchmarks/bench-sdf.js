const { performance } = require('perf_hooks');

// Setup mock for context required by GlassDisplacementEngine
global.document = {
  createElement: () => ({
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }),
    toDataURL: () => 'data:image/png;base64,mock',
  }),
  getElementById: () => null, // not needed for generateMap benchmark
};

class GlassDisplacementEngineOld {
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
            data[idx]     = Math.min(255, Math.max(0, Math.round(neutral + q.dx)));
            data[idx + 1] = Math.min(255, Math.max(0, Math.round(neutral + q.dy)));
            data[idx + 2] = neutral;
            data[idx + 3] = 255;
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    const dataUrl = this.canvas.toDataURL('image/png');
    return dataUrl;
  }
}

class GlassDisplacementEngineNew {
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
            data[idx]     = Math.min(255, Math.max(0, Math.round(neutral + q.dx)));
            data[idx + 1] = Math.min(255, Math.max(0, Math.round(neutral + q.dy)));
            data[idx + 2] = neutral;
            data[idx + 3] = 255;
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    const dataUrl = this.canvas.toDataURL('image/png');
    return dataUrl;
  }
}

function runBenchmark() {
  const engineOld = new GlassDisplacementEngineOld();
  const engineNew = new GlassDisplacementEngineNew();

  const testCases = [
    { name: 'Switch (52x52)', w: 52, h: 52, r: 26 },
    { name: 'Slider Thumb (60x60)', w: 60, h: 60, r: 30 },
    { name: 'Capsule (200x90)', w: 200, h: 90, r: 45 },
    { name: 'Card (400x200)', w: 400, h: 200, r: 16 }
  ];

  const iterations = 1000;

  console.log(`Running benchmarks... (${iterations} iterations per case)`);
  console.log('--------------------------------------------------');

  for (const { name, w, h, r } of testCases) {
    // Warmup
    for (let i = 0; i < 100; i++) {
      engineOld.generateMap(w, h, r);
      engineNew.generateMap(w, h, r);
    }

    const t0Old = performance.now();
    for (let i = 0; i < iterations; i++) {
      engineOld.generateMap(w, h, r);
    }
    const t1Old = performance.now();
    const timeOld = t1Old - t0Old;

    const t0New = performance.now();
    for (let i = 0; i < iterations; i++) {
      engineNew.generateMap(w, h, r);
    }
    const t1New = performance.now();
    const timeNew = t1New - t0New;

    const diff = timeOld - timeNew;
    const percentage = ((timeOld - timeNew) / timeOld * 100).toFixed(2);

    console.log(`Test Case: ${name}`);
    console.log(`  Math.hypot (Baseline): ${timeOld.toFixed(2)} ms`);
    console.log(`  Math.sqrt (Optimized): ${timeNew.toFixed(2)} ms`);
    console.log(`  Improvement:           ${diff.toFixed(2)} ms (${percentage}%)`);
    console.log('--------------------------------------------------');
  }
}

runBenchmark();
