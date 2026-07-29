/**
 * GlassEngine — Cross-browser liquid glass refraction engine
 *
 * Architecture (Aave technique):
 *   SVG feDisplacementMap applied via `filter: url(#id)` on the CONTENT layer,
 *   NOT via `backdrop-filter` (which only works in Chromium).
 *
 *   DOM structure created by this engine:
 *     <div class="glass-wrapper">
 *       <div class="glass-content" style="filter: url(#filter-id)">
 *         {children}              ← LIVE DOM gets refracted
 *       </div>
 *       <div class="glass-frost"/>  ← CSS backdrop-filter blur layer
 *       <div class="glass-rim"/>    ← Specular rim + shadow overlay
 *     </div>
 *
 * Why this works everywhere:
 *   - `filter: url(#svg)` works in Chrome, Safari, Firefox — 96.9% global support
 *   - `backdrop-filter: url(#svg)` only works in Chromium (WebKit bug #245510)
 */

export class GlassEngine {
  constructor() {
    this.svgRoot = this._initSvgRoot();
    this._filterCounter = 0;
  }

  _initSvgRoot() {
    if (document.getElementById('ge-root')) return document.getElementById('ge-root');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'ge-root';
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden;';
    document.body.appendChild(svg);
    return svg;
  }

  /**
   * Generate a displacement map PNG with 4-fold quadrant symmetry.
   *
   * Only the top-left quadrant is computed; it is mirrored across all 4
   * quadrants, cutting per-pixel work to 25%.
   *
   * Red channel   → horizontal displacement
   * Green channel → vertical displacement
   * Blue channel  → specular highlight hint
   * Neutral value = 128 (no displacement)
   */
  generateMap(width, height, radius, refractionScale = 0.15, depth = 15) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const d = imgData.data;

    const hw = Math.ceil(width / 2);
    const hh = Math.ceil(height / 2);
    const mr = Math.min(radius, hw, hh);
    const scale = refractionScale * depth;

    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        let dx = 0, dy = 0;

        if (x < mr && y < mr) {
          const cx = mr - x, cy = mr - y;
          const dist = Math.sqrt(cx * cx + cy * cy);
          if (dist > 0 && dist < mr) {
            const factor = Math.max(0, 1 - dist / mr);
            const bend = Math.sin(factor * Math.PI * 0.5) * scale;
            dx = (cx / mr) * bend;
            dy = (cy / mr) * bend;
          }
        } else {
          dx = Math.sin((1 - x / hw) * Math.PI * 0.5) * scale * 0.5;
          dy = Math.sin((1 - y / hh) * Math.PI * 0.5) * scale * 0.5;
        }

        const r = Math.min(255, Math.max(0, Math.round(128 + dx * 10)));
        const g = Math.min(255, Math.max(0, Math.round(128 + dy * 10)));
        const b = Math.min(255, Math.max(0, Math.round(Math.abs(dx + dy) * 15)));

        // Quadrant 1: TL
        this._sp(d, width, x, y, r, g, b);
        // Quadrant 2: TR (negate X)
        this._sp(d, width, width - 1 - x, y, 255 - r, g, b);
        // Quadrant 3: BL (negate Y)
        this._sp(d, width, x, height - 1 - y, r, 255 - g, b);
        // Quadrant 4: BR (negate X & Y)
        this._sp(d, width, width - 1 - x, height - 1 - y, 255 - r, 255 - g, b);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  _sp(d, w, x, y, r, g, b) {
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }

  /**
   * Create an SVG filter that refracts SourceGraphic via a displacement map.
   *
   * Dynamic filter ID solves Safari's filter caching freeze bug:
   * WebKit caches filter output by ID — changing the map without changing
   * the ID makes Safari serve stale output and the glass freezes.
   */
  createFilter({ width, height, radius, refractionScale = 0.15, scale = 25 }) {
    const id = `g-${++this._filterCounter}-${Math.random().toString(36).substring(2, 7)}`;
    const mapUrl = this.generateMap(width, height, radius, refractionScale);

    const NS = 'http://www.w3.org/2000/svg';
    const filter = document.createElementNS(NS, 'filter');
    filter.id = id;
    filter.setAttribute('x', '-20%');
    filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '140%');
    filter.setAttribute('height', '140%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const img = document.createElementNS(NS, 'feImage');
    img.setAttribute('href', mapUrl);
    img.setAttribute('result', 'map');

    const disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', scale.toString());
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');

    filter.appendChild(img);
    filter.appendChild(disp);
    this.svgRoot.appendChild(filter);

    return {
      id,
      cleanup: () => { if (filter.parentNode) filter.parentNode.removeChild(filter); }
    };
  }

  /**
   * Wrap a DOM element in the glass architecture.
   *
   * @param {HTMLElement} el - Element to make glass (its innerHTML becomes the refracted content)
   * @param {object} opts
   * @param {number} opts.radius - Border radius of the lens
   * @param {number} opts.refractionScale - How much refraction (0.05–0.4)
   * @param {number} opts.scale - feDisplacementMap scale attribute
   * @param {number} opts.blur - Frost blur amount in px (0 = no frost layer)
   * @returns {{ content: HTMLElement, filter: {id, cleanup}, destroy: Function }}
   */
  wrap(el, opts = {}) {
    const {
      radius = 20,
      refractionScale = 0.15,
      scale = 25,
      blur = 8,
    } = opts;

    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width || 100);
    const h = Math.round(rect.height || 60);
    const filter = this.createFilter({ width: w, height: h, radius, refractionScale, scale });

    // Get existing children before we restructure
    const children = Array.from(el.children);
    const innerHTML = el.innerHTML;

    el.innerHTML = '';

    // LAYER 1: Content + refraction target
    const content = document.createElement('div');
    content.className = 'ge-content';
    content.style.cssText = `position:relative;z-index:1;filter:url(#${filter.id});width:100%;height:100%;`;
    content.innerHTML = innerHTML;

    // LAYER 2: Frost (CSS backdrop-filter — works on Chromium, degrades gracefully elsewhere)
    if (blur > 0) {
      const frost = document.createElement('div');
      frost.className = 'ge-frost';
      frost.style.cssText = `position:absolute;inset:0;z-index:0;border-radius:inherit;backdrop-filter:blur(${blur}px) saturate(180%) brightness(1.05);-webkit-backdrop-filter:blur(${blur}px) saturate(180%) brightness(1.05);`;
      el.appendChild(frost);
    }

    // LAYER 3: Specular rim + shadow overlay
    const rim = document.createElement('div');
    rim.className = 'ge-rim';
    rim.style.cssText = `position:absolute;inset:0;z-index:2;pointer-events:none;border-radius:inherit;border:1px solid rgba(255,255,255,0.15);box-shadow:inset 0 1px 1px rgba(255,255,255,0.25),0 8px 32px rgba(0,0,0,0.3);`;

    el.appendChild(content);
    el.appendChild(rim);
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.style.borderRadius = radius + 'px';

    return {
      content,
      filter,
      destroy: () => {
        filter.cleanup();
        el.innerHTML = '';
      }
    };
  }
}

export const glass = new GlassEngine();
