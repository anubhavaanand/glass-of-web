import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// Load the source code
const sourcePath = path.resolve('./glass-engine.js');
const sourceCode = fs.readFileSync(sourcePath, 'utf8');

// Global test variables to access engine and canvas buffer
let glassEngine;
let latestImgData = null;

const createMockElement = (tag = 'div') => {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    attributes: {},
    parentNode: null,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
  };
};

// Create a mock canvas
const createMockCanvas = () => {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => {
        const imgData = { data: new Uint8ClampedArray(w * h * 4) };
        latestImgData = imgData; // Keep track for testing
        return imgData;
      },
      putImageData: (imgData) => {
        latestImgData = imgData;
      }
    }),
    toDataURL: () => 'data:image/png;base64,mockDataUrl'
  };
};

// Create a mock document
const mockDocument = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return createMockCanvas();
    }
    return createMockElement(tag);
  },
  createElementNS: (_ns, tag) => createMockElement(tag),
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => []
};

describe('GlassDisplacementEngine', () => {
  beforeEach(() => {
    latestImgData = null;

    // Setup context for vm
    const sandbox = {
      document: mockDocument,
      window: { addEventListener: () => {} },
      Math: Math,
      requestAnimationFrame: () => {},
      setTimeout: () => {}
    };
    vm.createContext(sandbox);

    // Execute the code in the sandbox
    vm.runInContext(sourceCode, sandbox);

    glassEngine = vm.runInContext('glassEngine', sandbox);
  });

  describe('generateMap', () => {
    it('returns a dataUrl and uses cache correctly', () => {
      const dataUrl1 = glassEngine.generateMap(64, 64, 32, 10, 1.0, 1.0);
      assert.strictEqual(dataUrl1, 'data:image/png;base64,mockDataUrl');
      assert.strictEqual(glassEngine.cache.size, 1);

      // Should hit the cache
      const dataUrl2 = glassEngine.generateMap(64, 64, 32, 10, 1.0, 1.0);
      assert.strictEqual(dataUrl1, dataUrl2);
      assert.strictEqual(glassEngine.cache.size, 1);

      // Different parameters should not hit the cache
      glassEngine.generateMap(64, 64, 30, 10, 1.0, 1.0);
      assert.strictEqual(glassEngine.cache.size, 2);
    });

    it('evicts old items from cache when size reaches 50', () => {
      // In code: if (this.cache.size > 50) this.cache.delete(...)
      // Fill cache to 50
      for (let i = 0; i < 50; i++) {
        glassEngine.generateMap(64 + i, 64, 32, 10, 1.0, 1.0);
      }
      assert.strictEqual(glassEngine.cache.size, 50);

      // Add one more, cache size will be 51 briefly, then the oldest deleted, keeping it at 50 or 51?
      // Wait, let's look at the code:
      // if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
      // this.cache.set(cacheKey, dataUrl);
      // If size is 50, >50 is false. So set makes it 51.
      // Next time it's 51, >50 is true, it deletes 1, making it 50, then sets, making it 51.
      // Ah! So max size is actually 51.

      // Add 51st
      glassEngine.generateMap(200, 64, 32, 10, 1.0, 1.0);
      assert.strictEqual(glassEngine.cache.size, 51);

      // Add 52nd
      glassEngine.generateMap(201, 64, 32, 10, 1.0, 1.0);
      assert.strictEqual(glassEngine.cache.size, 51);

      // The first item (64_64...) should have been evicted
      const firstKey = glassEngine.getCacheKey(64, 64, 32, 10, 1.0, 1.0);
      assert.strictEqual(glassEngine.cache.has(firstKey), false);
    });

    it('generates flat neutral center (128, 128, 128, 255) when distance < 0', () => {
      // Create a large map where center is definitely flat
      glassEngine.generateMap(256, 256, 64, 10, 1.0, 1.0);

      assert.ok(latestImgData, 'ImageData should have been created');
      const data = latestImgData.data;

      // Check the exact center point (128, 128)
      const centerIdx = (128 * 256 + 128) * 4;
      assert.strictEqual(data[centerIdx], 128, 'Center R should be neutral');
      assert.strictEqual(data[centerIdx + 1], 128, 'Center G should be neutral');
      assert.strictEqual(data[centerIdx + 2], 128, 'Center B should be neutral');
      assert.strictEqual(data[centerIdx + 3], 255, 'Center Alpha should be 255');
    });

    it('mirrors displacements correctly across quadrants', () => {
      const w = 64;
      const h = 64;
      // generate with some curve to ensure we have non-zero delta
      glassEngine.generateMap(w, h, 16, 20, 1.0, 1.0);

      const data = latestImgData.data;
      const getPixel = (x, y) => {
        const idx = (y * w + x) * 4;
        return { r: data[idx], g: data[idx + 1] };
      };

      // The logic in glass-engine:
      // data[idx]     = rVal <= 0 ? 0 : rVal >= 255 ? 255 : (rVal + 0.5) | 0;
      // This means we might have slight rounding differences like +-1.
      // So we should check if they are very close.
      const x = 10;
      const y = 10;

      const tl = getPixel(x, y);
      const tr = getPixel(w - 1 - x, y);
      const bl = getPixel(x, h - 1 - y);
      const br = getPixel(w - 1 - x, h - 1 - y);

      const dx = tl.r - 128;
      const dy = tl.g - 128;

      // Use Math.abs(diff) <= 1 for strictEqual to handle rounding
      const isClose = (a, b) => Math.abs(a - b) <= 1;

      assert.ok(isClose(tr.r - 128, -dx), `Top-right mirror X: expected ${-dx}, got ${tr.r - 128}`);
      assert.ok(isClose(tr.g - 128, dy), `Top-right mirror Y: expected ${dy}, got ${tr.g - 128}`);

      assert.ok(isClose(bl.r - 128, dx), `Bottom-left mirror X: expected ${dx}, got ${bl.r - 128}`);
      assert.ok(isClose(bl.g - 128, -dy), `Bottom-left mirror Y: expected ${-dy}, got ${bl.g - 128}`);

      assert.ok(isClose(br.r - 128, -dx), `Bottom-right mirror X: expected ${-dx}, got ${br.r - 128}`);
      assert.ok(isClose(br.g - 128, -dy), `Bottom-right mirror Y: expected ${-dy}, got ${br.g - 128}`);
    });

    it('clamps RGB values properly under extreme parameters', () => {
      // Very high scale and depth should push values past 255 and below 0
      glassEngine.generateMap(64, 64, 32, 1000, 1000.0, 1.0);

      const data = latestImgData.data;
      for (let i = 0; i < data.length; i += 4) {
        assert.ok(data[i] >= 0 && data[i] <= 255, `R channel clamped at index ${i}`);
        assert.ok(data[i+1] >= 0 && data[i+1] <= 255, `G channel clamped at index ${i}`);
        assert.strictEqual(data[i+2], 128, `B channel neutral at index ${i}`);
        assert.strictEqual(data[i+3], 255, `Alpha solid at index ${i}`);
      }
    });
  });

  describe('createGlass', () => {
    it('sanitizes container ID before generating filter reference', () => {
      const container = createMockElement('div');
      container.id = 'demo-1") ;body{background:red}/*';
      container.style.filter = 'blur(2px)';

      const glass = glassEngine.createGlass(container, {
        lens: { x: 0, y: 0, w: 100, h: 60, r: 16 }
      });

      const filter = container.children[0].children[0].children[0];
      assert.match(filter.id, /^glass-[a-zA-Z0-9_-]+-\d+-v1$/);
      assert.strictEqual(container.style.filter, `url("#${filter.id}")`);
      assert.strictEqual(filter.id.includes('"'), false);
      assert.strictEqual(filter.id.includes(';'), false);

      glass.destroy();
      assert.strictEqual(container.style.filter, 'blur(2px)');
    });
  });
});
