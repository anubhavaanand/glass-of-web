import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// Load the source code
const sourcePath = path.resolve('./glass-engine.js');
const sourceCode = fs.readFileSync(sourcePath, 'utf8');

// Global test variables
let glassEngine;

// Create a robust mock element
class MockElement {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    this.children.push(child);
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }
}

// Create a mock document
const mockDocument = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: () => {}
        }),
        toDataURL: () => 'data:image/png;base64,mockDataUrl'
      };
    }
    return new MockElement(tag);
  },
  createElementNS: (ns, tag) => {
    return new MockElement(tag);
  }
};

describe('buildFilter', () => {
  beforeEach(() => {
    // Setup context for vm
    const sandbox = {
      document: mockDocument,
      window: {},
      Math: Math,
      console: console
    };
    vm.createContext(sandbox);

    // Execute the code in the sandbox
    vm.runInContext(sourceCode, sandbox);

    glassEngine = vm.runInContext('GlassEngine', sandbox);
  });

  it('clears existing elements inside the filter', () => {
    const filter = new MockElement('filter');
    const existingChild = new MockElement('feGaussianBlur');
    filter.appendChild(existingChild);

    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock'
    };

    assert.strictEqual(filter.children.length, 1);
    glassEngine.buildFilter(filter, opts);

    // Existing child should be gone, only the newly generated ones remain.
    // Let's check that the first child is feImage, not the old existing child.
    assert.strictEqual(filter.children[0].tagName, 'feImage');
    assert.ok(filter.children.indexOf(existingChild) === -1);
  });

  it('sets the correct root attributes on the filter', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock'
    };
    glassEngine.buildFilter(filter, opts);

    assert.strictEqual(filter.getAttribute('filterUnits'), 'userSpaceOnUse');
    assert.strictEqual(filter.getAttribute('primitiveUnits'), 'userSpaceOnUse');
    assert.strictEqual(filter.getAttribute('x'), '0');
    assert.strictEqual(filter.getAttribute('y'), '0');
    assert.strictEqual(filter.getAttribute('width'), '100%');
    assert.strictEqual(filter.getAttribute('height'), '100%');
  });

  it('creates the feImage element for the map correctly', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 10, y: 20, w: 100, h: 150 },
      mapDataUrl: 'data:mockmap'
    };
    glassEngine.buildFilter(filter, opts);

    const feImg = filter.children.find(c => c.tagName === 'feImage');
    assert.ok(feImg, 'feImage should exist');
    assert.strictEqual(feImg.getAttribute('href'), 'data:mockmap');
    assert.strictEqual(feImg.getAttribute('x'), '10');
    assert.strictEqual(feImg.getAttribute('y'), '20');
    assert.strictEqual(feImg.getAttribute('width'), '100');
    assert.strictEqual(feImg.getAttribute('height'), '150');
    assert.strictEqual(feImg.getAttribute('result'), 'map');
  });

  it('skips feGaussianBlur when blurPx is 0 or omitted', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock'
    };
    glassEngine.buildFilter(filter, opts);

    const blur = filter.children.find(c => c.tagName === 'feGaussianBlur');
    assert.strictEqual(blur, undefined, 'feGaussianBlur should not exist when blurPx is 0');

    // First displacement map should use SourceGraphic
    const disp = filter.children.find(c => c.tagName === 'feDisplacementMap');
    assert.strictEqual(disp.getAttribute('in'), 'SourceGraphic');
  });

  it('creates feGaussianBlur when blurPx > 0', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock',
      blurPx: 5
    };
    glassEngine.buildFilter(filter, opts);

    const blur = filter.children.find(c => c.tagName === 'feGaussianBlur');
    assert.ok(blur, 'feGaussianBlur should exist when blurPx > 0');
    assert.strictEqual(blur.getAttribute('in'), 'SourceGraphic');
    assert.strictEqual(blur.getAttribute('stdDeviation'), '5');
    assert.strictEqual(blur.getAttribute('result'), 'blurred');

    // First displacement map should use blurred
    const disp = filter.children.find(c => c.tagName === 'feDisplacementMap');
    assert.strictEqual(disp.getAttribute('in'), 'blurred');
  });

  it('creates chromatic aberration pipeline (3 displacements + color matrices)', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock',
      scale: 20,
      chroma: [1.1, 1.05, 1.0]
    };
    glassEngine.buildFilter(filter, opts);

    const displacements = filter.children.filter(c => c.tagName === 'feDisplacementMap');
    const colorMatrices = filter.children.filter(c => c.tagName === 'feColorMatrix');

    assert.strictEqual(displacements.length, 3, 'Should have 3 displacement maps');
    assert.strictEqual(colorMatrices.length, 3, 'Should have 3 color matrices');

    // Check R channel
    assert.strictEqual(displacements[0].getAttribute('scale'), String(20 * 1.1));
    assert.strictEqual(displacements[0].getAttribute('xChannelSelector'), 'R');
    assert.strictEqual(displacements[0].getAttribute('yChannelSelector'), 'G');
    assert.strictEqual(colorMatrices[0].getAttribute('result'), 'dispR');

    // Check G channel
    assert.strictEqual(displacements[1].getAttribute('scale'), String(20 * 1.05));
    assert.strictEqual(colorMatrices[1].getAttribute('result'), 'dispG');

    // Check B channel
    assert.strictEqual(displacements[2].getAttribute('scale'), String(20 * 1.0));
    assert.strictEqual(colorMatrices[2].getAttribute('result'), 'dispB');
  });

  it('creates the final composite chain operations correctly', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 10, y: 20, w: 100, h: 100 },
      mapDataUrl: 'data:mock'
    };
    glassEngine.buildFilter(filter, opts);

    const composites = filter.children.filter(c => c.tagName === 'feComposite');
    assert.strictEqual(composites.length, 5, 'Should have 5 composites');

    // feCompRG
    assert.strictEqual(composites[0].getAttribute('in'), 'dispR');
    assert.strictEqual(composites[0].getAttribute('in2'), 'dispG');
    assert.strictEqual(composites[0].getAttribute('operator'), 'arithmetic');

    // feCompRGB
    assert.strictEqual(composites[1].getAttribute('in2'), 'dispB');
    assert.strictEqual(composites[1].getAttribute('operator'), 'arithmetic');
    assert.strictEqual(composites[1].getAttribute('result'), 'lensResult');

    // lensMask via feFlood
    const flood = filter.children.find(c => c.tagName === 'feFlood');
    assert.ok(flood);
    assert.strictEqual(flood.getAttribute('result'), 'lensMask');
    assert.strictEqual(flood.getAttribute('x'), '10');
    assert.strictEqual(flood.getAttribute('y'), '20');

    // clippedLens
    assert.strictEqual(composites[2].getAttribute('in'), 'lensResult');
    assert.strictEqual(composites[2].getAttribute('in2'), 'lensMask');
    assert.strictEqual(composites[2].getAttribute('operator'), 'in');
    assert.strictEqual(composites[2].getAttribute('result'), 'clippedLens');

    // holedBackground
    assert.strictEqual(composites[3].getAttribute('in'), 'SourceGraphic');
    assert.strictEqual(composites[3].getAttribute('in2'), 'lensMask');
    assert.strictEqual(composites[3].getAttribute('operator'), 'out');
    assert.strictEqual(composites[3].getAttribute('result'), 'holedBackground');

    // feFinal
    assert.strictEqual(composites[4].getAttribute('in'), 'clippedLens');
    assert.strictEqual(composites[4].getAttribute('in2'), 'holedBackground');
    assert.strictEqual(composites[4].getAttribute('operator'), 'over');
  });

  it('applies default fallback values correctly', () => {
    const filter = new MockElement('filter');
    const opts = {
      pixelLens: { x: 0, y: 0, w: 100, h: 100 },
      mapDataUrl: 'data:mock'
    };
    glassEngine.buildFilter(filter, opts);

    const displacements = filter.children.filter(c => c.tagName === 'feDisplacementMap');

    // Default scale is 10, default chroma is [1.08, 1.04, 1.0]
    assert.strictEqual(displacements[0].getAttribute('scale'), String(10 * 1.08));
    assert.strictEqual(displacements[1].getAttribute('scale'), String(10 * 1.04));
    assert.strictEqual(displacements[2].getAttribute('scale'), String(10 * 1.0));
  });
});
