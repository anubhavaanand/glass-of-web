/**
 * Liquid Glass Engine — Cross-browser optical refraction
 * 
 * Architecture per Aave Labs' "Building Glass for the Web":
 *   - 2D SDF normals → displacement map (R=horizontal, G=vertical, B=specular)
 *   - SVG filter: userSpaceOnUse (cross-browser), feImage with objectBoundingBox fractions
 *   - Chromatic aberration: 3× feDisplacementMap at scale×[1.08, 1.04, 1.0]
 *   - Specular rim highlight from map blue channel (restricted to lens region for Safari perf)
 *   - Hole-punch: SourceGraphic OUT lensMask → lensResult OVER holedSG
 *   - Filter IDs regenerated per update (forces Safari to drop cached filter output)
 *   - Map cached per shape dimensions; lens movement only shifts feImage region
 *   - QUADRANT OPTIMIZATION: Computes only top-left quadrant, mirrors to all 4 (75% less CPU)
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let _seq = 0;
const _mapCache = new Map();

function svgEl(name) {
  return document.createElementNS(SVG_NS, name);
}

function cachedMap(opts) {
  const key = [
    opts.w, opts.h, opts.radius,
    opts.depth, opts.curvature, opts.curvaturePow,
    opts.glowSide, opts.glowTop
  ].join('|');
  
  if (!_mapCache.has(key)) {
    if (_mapCache.size > 60) _mapCache.clear(); // LRU cache limit
    _mapCache.set(key, generateMap(opts));
  }
  return _mapCache.get(key);
}

/* ---------- 1. DISPLACEMENT MAP GENERATOR (4x Optimized) ---------- */

function generateMap(opts) {
  const {
    w = 256,
    h = w,
    radius,
    depth = 127,
    curvature = 0.5,
    curvaturePow = 1.0,
    glowSide = 54,
    glowTop = 21,
  } = opts || {};

  const R = radius ?? Math.min(w, h) / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const cx = w / 2;
  const cy = h / 2;
  const hx = Math.max(cx - R, 0);
  const hy = Math.max(cy - R, 0);

  function clamp(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  // Symmetric SDF for rounded rectangle
  function sdf(px, py) {
    const dx = Math.abs(px - cx) - hx;
    const dy = Math.abs(py - cy) - hy;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - R;
  }

  // OPTIMIZATION: Compute only the top-left quadrant, then mirror to all 4.
  // This cuts per-pixel computation by 75%, matching Aave's exact technique.
  const halfW = Math.ceil(w / 2);
  const halfH = Math.ceil(h / 2);

  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dist = sdf(px, py);

      let r = 128, g = 128, b = 128;

      if (dist < 0) {
        const t = Math.min(1, Math.abs(dist) / R);
        const edge = Math.pow(t, curvaturePow) * curvature;

        // Direction toward lens center
        const dx = cx - px;
        const dy = cy - py;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;

        r = clamp(128 + nx * depth * edge);
        g = clamp(128 + ny * depth * edge);
        b = clamp(128 + ((Math.abs(nx) > Math.abs(ny)) ? glowSide : glowTop) * edge);
      }

      // 1. Top-Left (Original)
      const i1 = (y * w + x) * 4;
      d[i1] = r; 
      d[i1 + 1] = g; 
      d[i1 + 2] = b; 
      d[i1 + 3] = 255;

      // 2. Top-Right (Mirror X: negate horizontal displacement)
      const x2 = w - 1 - x;
      const i2 = (y * w + x2) * 4;
      d[i2] = clamp(256 - r); // 256 - (128 + D) = 128 - D
      d[i2 + 1] = g;
      d[i2 + 2] = b;
      d[i2 + 3] = 255;

      // 3. Bottom-Left (Mirror Y: negate vertical displacement)
      const y3 = h - 1 - y;
      const i3 = (y3 * w + x) * 4;
      d[i3] = r;
      d[i3 + 1] = clamp(256 - g);
      d[i3 + 2] = b;
      d[i3 + 3] = 255;

      // 4. Bottom-Right (Mirror X and Y: negate both)
      const i4 = (y3 * w + x2) * 4;
      d[i4] = clamp(256 - r);
      d[i4 + 1] = clamp(256 - g);
      d[i4 + 2] = b; // Specular (B) is symmetric, remains unchanged
      d[i4 + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return { dataUrl: c.toDataURL('image/png'), canvas: c };
}

/* ---------- 2. FILTER BUILDER: 17-primitive chain ---------- */

function buildFilter(defs, o) {
  const lens = o.lens;
  const mapHref = o.mapHref;
  const scale = o.scale ?? 40;
  const chroma = o.chroma || [1.08, 1.04, 1.0];
  const blurPx = o.blurPx ?? 0.5;
  const elW = o.elW || 764;
  const elH = o.elH || 368;
  const specular = o.specular !== false;
  const idBase = o.idBase || 'glass';

  // SAFARI FIX: Fresh filter ID on every update to bypass aggressive SVG filter caching
  const id = idBase + '-v' + (++_seq) + '-' + Date.now().toString(36);
  const L = lens;

  const px = {
    x: L.x * elW,
    y: L.y * elH,
    w: L.w * elW,
    h: L.h * elH,
  };

  const f = svgEl('filter');
  f.id = id;
  f.setAttribute('filterUnits', 'objectBoundingBox');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse'); // Cross-browser pixel coordinates
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', '0');
  f.setAttribute('y', '0');
  f.setAttribute('width', '1');
  f.setAttribute('height', '1');

  // 1. Neutral gray backdrop for map image
  const floodBg = svgEl('feFlood');
  floodBg.setAttribute('flood-color', 'rgb(128,128,128)');
  floodBg.setAttribute('flood-opacity', '1');
  floodBg.setAttribute('result', 'mapBg');

  // 2. Displacement map image
  const img = svgEl('feImage');
  img.setAttribute('href', mapHref);
  img.setAttribute('x', px.x);
  img.setAttribute('y', px.y);
  img.setAttribute('width', px.w);
  img.setAttribute('height', px.h);
  img.setAttribute('preserveAspectRatio', 'none');
  img.setAttribute('result', 'rawMap');

  // 3. Composite: map over gray backdrop
  const compMap = svgEl('feComposite');
  compMap.setAttribute('in', 'rawMap');
  compMap.setAttribute('in2', 'mapBg');
  compMap.setAttribute('operator', 'over');
  compMap.setAttribute('result', 'map');

  // 4. Gaussian blur of source content
  const blur = svgEl('feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', blurPx + ' ' + blurPx);
  blur.setAttribute('result', 'blurred');

  // 5–10. Chromatic aberration: 3 displacement passes
  const chanNames = ['R', 'G', 'B'];
  const channels = chroma.map(function(mult, k) {
    const disp = svgEl('feDisplacementMap');
    disp.setAttribute('in', 'blurred');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', String(scale * mult));
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    disp.setAttribute('x', px.x);
    disp.setAttribute('y', px.y);
    disp.setAttribute('width', px.w);
    disp.setAttribute('height', px.h);

    const mat = svgEl('feColorMatrix');
    mat.setAttribute('type', 'matrix');
    mat.setAttribute('values', _keepMatrix(k));
    mat.setAttribute('result', 'disp' + chanNames[k]);
    return { disp, mat };
  });

  // Arithmetic merge: dispR + dispG
  const merge1 = svgEl('feComposite');
  merge1.setAttribute('in', 'dispR');
  merge1.setAttribute('in2', 'dispG');
  merge1.setAttribute('operator', 'arithmetic');
  merge1.setAttribute('k1', '0');
  merge1.setAttribute('k2', '1');
  merge1.setAttribute('k3', '1');
  merge1.setAttribute('k4', '0');

  // Arithmetic merge: + dispB → lensResult
  const merge2 = svgEl('feComposite');
  merge2.setAttribute('in2', 'dispB');
  merge2.setAttribute('operator', 'arithmetic');
  merge2.setAttribute('k1', '0');
  merge2.setAttribute('k2', '1');
  merge2.setAttribute('k3', '1');
  merge2.setAttribute('k4', '0');
  merge2.setAttribute('result', 'lensResult');

  f.append(floodBg, img, compMap, blur);
  channels.forEach(function(ch) { f.append(ch.disp, ch.mat); });
  f.append(merge1, merge2);

  // 11–12. Specular highlight from map blue channel (restricted to lens region for Safari perf)
  if (specular) {
    const specMask = svgEl('feColorMatrix');
    specMask.setAttribute('in', 'map');
    specMask.setAttribute('type', 'matrix');
    specMask.setAttribute('values', '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843137255');
    specMask.setAttribute('result', 'specMask');

    const specAdd = svgEl('feComposite');
    specAdd.setAttribute('in', 'specMask');
    specAdd.setAttribute('in2', 'lensResult');
    specAdd.setAttribute('operator', 'arithmetic');
    specAdd.setAttribute('k1', '0');
    specAdd.setAttribute('k2', '1');
    specAdd.setAttribute('k3', '1');
    specAdd.setAttribute('k4', '0');
    specAdd.setAttribute('result', 'lensResult');

    f.append(specMask, specAdd);
  }

  // 13–15. Hole-punch: remove lens region from original, replace with refracted
  const lensMaskFlood = svgEl('feFlood');
  lensMaskFlood.setAttribute('flood-color', 'black');
  lensMaskFlood.setAttribute('flood-opacity', '1');
  lensMaskFlood.setAttribute('x', px.x);
  lensMaskFlood.setAttribute('y', px.y);
  lensMaskFlood.setAttribute('width', px.w);
  lensMaskFlood.setAttribute('height', px.h);
  lensMaskFlood.setAttribute('result', 'lensMask');

  const holed = svgEl('feComposite');
  holed.setAttribute('in', 'SourceGraphic');
  holed.setAttribute('in2', 'lensMask');
  holed.setAttribute('operator', 'out');
  holed.setAttribute('result', 'holedSG');

  const fin = svgEl('feComposite');
  fin.setAttribute('in', 'lensResult');
  fin.setAttribute('in2', 'holedSG');
  fin.setAttribute('operator', 'over');

  f.append(lensMaskFlood, holed, fin);
  defs.appendChild(f);
  return id;
}

function _keepMatrix(k) {
  const m = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0'];
  m[k] = [0, 0, 0, 0, 0].map((_, i) => (i === k ? '1' : '0')).join(' ');
  return m.join(' ');
}

/* ---------- 3. HIGH-LEVEL COMPONENT HELPER ---------- */

function createGlass(container, o) {
  o = o || {};
  const lens = o.lens;
  const scale = o.scale ?? 40;
  const depth = o.depth ?? 127;
  const curvature = o.curvature ?? 0.5;
  const curvaturePow = o.curvaturePow ?? 1.0;
  const glowSide = o.glowSide ?? 54;
  const glowTop = o.glowTop ?? 21;
  const chroma = o.chroma;
  const specular = o.specular !== false;
  const blurPx = o.blurPx ?? 0.5;

  const rect = function() { return container.getBoundingClientRect(); };
  const W = function() { return rect().width || 1; };
  const H = function() { return rect().height || 1; };

  container.style.willChange = 'filter';

  const svg = svgEl('svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:visible;pointer-events:none';
  const defs = svgEl('defs');
  svg.appendChild(defs);
  container.appendChild(svg);

  let currentId = null;
  let _mapCanvas = null;

  function fracs(p) {
    return { x: p.x / W(), y: p.y / H(), w: p.w / W(), h: p.h / H() };
  }

  function apply(p) {
    p = p || lens;

    const mapResult = cachedMap({
      w: Math.min(Math.round(p.w), 256), // SAFARI FIX: Conservative footprint limit
      h: Math.min(Math.round(p.h), 256),
      radius: p.r,
      depth: depth,
      curvature: curvature,
      curvaturePow: curvaturePow,
      glowSide: glowSide,
      glowTop: glowTop,
    });
    _mapCanvas = mapResult.canvas;

    if (currentId) {
      const old = document.getElementById(currentId);
      if (old) old.remove();
    }

    currentId = buildFilter(defs, {
      lens: fracs(p),
      mapHref: mapResult.dataUrl,
      scale: scale,
      chroma: chroma,
      specular: specular,
      blurPx: blurPx,
      elW: W(),
      elH: H(),
      idBase: container.id ? 'glass-' + container.id : 'glass',
    });

    container.style.filter = 'url("#' + currentId + '")';
  }

  apply();

  return {
    setLens: apply,
    get id() { return currentId; },
    get mapCanvas() { return _mapCanvas; },
    refresh: function() { apply(); },
    destroy: function() {
      container.style.filter = '';
      container.style.willChange = '';
      svg.remove();
    },
  };
}

/* ---------- 4. SPECULAR OVERLAY HELPER ---------- */

function applySpecular(container, lensPx) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;pointer-events:none;border-radius:' + lensPx.r +
    'px;border:1px solid rgba(255,255,255,.2);' +
    'box-shadow:inset 0 0 10px rgba(255,255,255,.1), 0 0 8px rgba(255,255,255,.08);z-index:999';
  el.style.left = lensPx.x + 'px';
  el.style.top = lensPx.y + 'px';
  el.style.width = lensPx.w + 'px';
  el.style.height = lensPx.h + 'px';
  container.appendChild(el);
  return el;
}

/* ---------- 5. WEBGL RENDERER (canvas/video surfaces) ---------- */

const _VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const _FS = `
precision mediump float;
uniform sampler2D u_source;
uniform sampler2D u_map;
uniform vec4 u_lens;
uniform float u_scale;
uniform vec3 u_chroma;
uniform float u_specular;
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec2 lensUV = (uv - u_lens.xy) / u_lens.zw;
  if (lensUV.x < 0.0 || lensUV.x > 1.0 || lensUV.y < 0.0 || lensUV.y > 1.0) {
    gl_FragColor = texture2D(u_source, uv);
    return;
  }
  vec4 mapVal = texture2D(u_map, lensUV);
  vec2 disp = (mapVal.rg - 0.5) * 2.0;
  float r = texture2D(u_source, uv + disp * u_scale * u_chroma.r).r;
  float g = texture2D(u_source, uv + disp * u_scale * u_chroma.g).g;
  float b = texture2D(u_source, uv + disp * u_scale * u_chroma.b).b;
  vec3 color = vec3(r, g, b);
  if (u_specular > 0.5) {
    float spec = max(mapVal.b - 0.5019607843137255, 0.0);
    color += vec3(spec);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

function _compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function createGlassWebGL(glCanvas, source, o) {
  o = o || {};
  const lens = o.lens || { x: 0, y: 0, w: 100, h: 100, r: 50 };
  const scale = o.scale ?? 40;
  const depth = o.depth ?? 127;
  const curvature = o.curvature ?? 0.5;
  const curvaturePow = o.curvaturePow ?? 1.0;
  const glowSide = o.glowSide ?? 54;
  const glowTop = o.glowTop ?? 21;
  const chroma = o.chroma || [1.08, 1.04, 1.0];
  const specular = o.specular !== false;

  const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
  if (!gl) { console.warn('WebGL not available'); return null; }

  const prog = gl.createProgram();
  gl.attachShader(prog, _compileShader(gl, gl.VERTEX_SHADER, _VS));
  gl.attachShader(prog, _compileShader(gl, gl.FRAGMENT_SHADER, _FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uSource = gl.getUniformLocation(prog, 'u_source');
  const uMap = gl.getUniformLocation(prog, 'u_map');
  const uLens = gl.getUniformLocation(prog, 'u_lens');
  const uScale = gl.getUniformLocation(prog, 'u_scale');
  const uChroma = gl.getUniformLocation(prog, 'u_chroma');
  const uSpecular = gl.getUniformLocation(prog, 'u_specular');

  const srcTex = gl.createTexture();
  const mapTex = gl.createTexture();

  function setupTex(tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  setupTex(srcTex, 0);
  setupTex(mapTex, 1);

  let currentMapHref = null;

  function updateMap(l) {
    const mapResult = cachedMap({
      w: Math.min(Math.round(l.w), 256),
      h: Math.min(Math.round(l.h), 256),
      radius: l.r,
      depth: depth,
      curvature: curvature,
      curvaturePow: curvaturePow,
      glowSide: glowSide,
      glowTop: glowTop,
    });
    const href = mapResult.dataUrl;
    if (href !== currentMapHref) {
      currentMapHref = href;
      const img = new Image();
      img.onload = function() {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      };
      img.src = href;
    }
  }

  let currentLens = lens;
  updateMap(lens);

  function render() {
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    if (!sw || !sh) return;
    glCanvas.width = sw;
    glCanvas.height = sh;
    gl.viewport(0, 0, sw, sh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform1i(uSource, 0);
    gl.uniform1i(uMap, 1);
    gl.uniform4f(uLens, currentLens.x / sw, currentLens.y / sh, currentLens.w / sw, currentLens.h / sh);
    gl.uniform1f(uScale, scale);
    gl.uniform3f(uChroma, chroma[0], chroma[1], chroma[2]);
    gl.uniform1f(uSpecular, specular ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function setLens(l) {
    currentLens = l;
    updateMap(l);
    render();
  }

  function destroy() {
    gl.deleteTexture(srcTex);
    gl.deleteTexture(mapTex);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
  }

  return { setLens, render, destroy, get lens() { return currentLens; } };
}

/* ---------- 6. PUBLIC API ---------- */

if (typeof window !== 'undefined') {
  window.GlassEngine = {
    generateMap,
    buildFilter,
    createGlass,
    applySpecular,
    createGlassWebGL,
  };
}