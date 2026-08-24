/**
 * Liquid Glass Engine — cross-browser optical refraction
 *
 * Architecture per Aave Labs' "Building Glass for the Web":
 *   - 2D SDF normals → displacement map (R=horizontal, G=vertical, B=specular)
 *   - 4-Fold Quadrant Symmetry: 4x speedup computing top-left quadrant and mirroring
 *   - SVG filter: userSpaceOnUse (cross-browser), feImage with objectBoundingBox fractions
 *   - Chromatic aberration: 3× feDisplacementMap at scale×[1.08, 1.04, 1.0]
 *   - Specular rim highlight from map blue channel
 *   - Hole-punch: SourceGraphic OUT lensMask → lensResult OVER holedSG
 *   - Specular overlay: CSS inset box-shadow + border (reliable, no filter overhead)
 *   - Filter IDs regenerated per update (Safari caches filter output by ID)
 *   - Map cached per shape dimensions; lens movement only shifts feImage region
 *   - WebGL renderer with multi-lens setLenses support for canvas/video controls
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
    if (_mapCache.size > 60) _mapCache.clear();
    _mapCache.set(key, generateMap(opts));
  }
  return _mapCache.get(key);
}

/* ---------- 1. DISPLACEMENT MAP GENERATOR (4-FOLD QUADRANT SYMMETRY) ----------
 *
 * Rounded-rect SDF with center-inward displacement.
 * Computes top-left quadrant and mirrors to all 4 quadrants for 4x speedup.
 *
 * RGB encoding (neutral 128):
 *   R: horizontal displacement (left side → positive, right side → negative)
 *   G: vertical displacement (top → positive, bottom → negative)
 *   B: specular glow (brighter at rim, especially side edges)
 */

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
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const cx = w / 2;
  const cy = h / 2;
  const hx = Math.max(cx - R, 0);
  const hy = Math.max(cy - R, 0);

  function clamp(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  /* SDF for rounded rectangle */
  function sdf(px, py) {
    const dx = Math.abs(px - cx) - hx;
    const dy = Math.abs(py - cy) - hy;
    return Math.min(Math.max(dx, dy), 0) +
           Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - R;
  }

  const halfW = Math.ceil(w / 2);
  const halfH = Math.ceil(h / 2);

  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      const dist = sdf(x + 0.5, y + 0.5);

      let rVal = 0, gVal = 0, bVal = 128;
      if (dist < 0) {
        const t = Math.min(1, Math.abs(dist) / R);
        const edge = Math.pow(t, curvaturePow) * curvature;
        const dx = cx - (x + 0.5);
        const dy = cy - (y + 0.5);
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        rVal = nx * depth * edge;
        gVal = ny * depth * edge;
        bVal = clamp(128 + ((Math.abs(nx) > Math.abs(ny)) ? glowSide : glowTop) * edge);
      }

      const pts = [
        { px: x,         py: y,         signX: 1,  signY: 1 },
        { px: w - 1 - x, py: y,         signX: -1, signY: 1 },
        { px: x,         py: h - 1 - y, signX: 1,  signY: -1 },
        { px: w - 1 - x, py: h - 1 - y, signX: -1, signY: -1 }
      ];

      for (const p of pts) {
        if (p.px < 0 || p.px >= w || p.py < 0 || p.py >= h) continue;
        const i = (p.py * w + p.px) * 4;
        d[i]     = clamp(128 + rVal * p.signX);
        d[i + 1] = clamp(128 + gVal * p.signY);
        d[i + 2] = bVal;
        d[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return { dataUrl: c.toDataURL('image/png'), canvas: c };
}

/* ---------- 2. FILTER BUILDER: 17-primitive chain ----------
 *
 * Cross-browser architecture:
 *   - filterUnits="objectBoundingBox" (full element coverage)
 *   - primitiveUnits="userSpaceOnUse" (pixel coordinates, works everywhere)
 *   - feImage x/y/w/h in objectBoundingBox fractions (positions the map)
 *   - feDisplacementMap x/y/w/h in userSpaceOnUse pixels (samples in element space)
 *   - Gaussian blur uses fractional stdDeviation relative to element size
 *   - Safari specular pass sub-region optimization
 */

function buildFilter(defs, o) {
  const lens = o.lens;        // {x, y, w, h} as fractions of filtered element
  const mapHref = o.mapHref;
  const scale = o.scale ?? 40;
  const chroma = o.chroma || [1.08, 1.04, 1.0];
  const blurPx = o.blurPx ?? 0.5;
  const elW = o.elW || 764;
  const elH = o.elH || 368;
  const specular = o.specular !== false;
  const idBase = o.idBase || 'glass';

  const id = idBase + '-v' + (++_seq) + '-' + Date.now().toString(36);
  const L = lens;

  /* Pixel-space lens rect for userSpaceOnUse primitives */
  const px = {
    x: L.x * elW,
    y: L.y * elH,
    w: L.w * elW,
    h: L.h * elH,
  };

  const f = svgEl('filter');
  f.id = id;
  f.setAttribute('filterUnits', 'objectBoundingBox');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', '0');
  f.setAttribute('y', '0');
  f.setAttribute('width', '1');
  f.setAttribute('height', '1');

  /* 1. Neutral gray backdrop for map image */
  const floodBg = svgEl('feFlood');
  floodBg.setAttribute('flood-color', 'rgb(128,128,128)');
  floodBg.setAttribute('flood-opacity', '1');
  floodBg.setAttribute('result', 'mapBg');

  /* 2. Displacement map image (pixel rect — userSpaceOnUse) */
  const img = svgEl('feImage');
  img.setAttribute('href', mapHref);
  img.setAttribute('x', px.x);
  img.setAttribute('y', px.y);
  img.setAttribute('width', px.w);
  img.setAttribute('height', px.h);
  img.setAttribute('preserveAspectRatio', 'none');
  img.setAttribute('result', 'rawMap');

  /* 3. Composite: map over gray backdrop (neutral outside lens) */
  const compMap = svgEl('feComposite');
  compMap.setAttribute('in', 'rawMap');
  compMap.setAttribute('in2', 'mapBg');
  compMap.setAttribute('operator', 'over');
  compMap.setAttribute('result', 'map');

  /* 4. Gaussian blur of source content (pixels — userSpaceOnUse) */
  const blur = svgEl('feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', blurPx + ' ' + blurPx);
  blur.setAttribute('result', 'blurred');

  /* 5–10. Chromatic aberration: 3 displacement passes at ±4% scale */
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

  /* Arithmetic merge: dispR + dispG */
  const merge1 = svgEl('feComposite');
  merge1.setAttribute('in', 'dispR');
  merge1.setAttribute('in2', 'dispG');
  merge1.setAttribute('operator', 'arithmetic');
  merge1.setAttribute('k1', '0');
  merge1.setAttribute('k2', '1');
  merge1.setAttribute('k3', '1');
  merge1.setAttribute('k4', '0');

  /* Arithmetic merge: + dispB → lensResult */
  const merge2 = svgEl('feComposite');
  merge2.setAttribute('in2', 'dispB');
  merge2.setAttribute('operator', 'arithmetic');
  merge2.setAttribute('k1', '0');
  merge2.setAttribute('k2', '1');
  merge2.setAttribute('k3', '1');
  merge2.setAttribute('k4', '0');
  merge2.setAttribute('result', 'lensResult');

  /* Append displacement chain */
  f.append(floodBg, img, compMap, blur);
  channels.forEach(function(ch) { f.append(ch.disp, ch.mat); });
  f.append(merge1, merge2);

  /* 11–12. Specular highlight from map blue channel */
  if (specular) {
    const isSafari = typeof navigator !== 'undefined' &&
      /Safari/.test(navigator.userAgent) && !_isChrome();

    const specMask = svgEl('feColorMatrix');
    specMask.setAttribute('in', 'map');
    specMask.setAttribute('type', 'matrix');
    specMask.setAttribute('values',
      '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843137255');
    specMask.setAttribute('result', 'specMask');

    if (isSafari) {
      specMask.setAttribute('x', px.x);
      specMask.setAttribute('y', px.y);
      specMask.setAttribute('width', px.w);
      specMask.setAttribute('height', px.h);
    }

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

  /* 13–15. Hole-punch: remove lens region from original, replace with refracted */
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

function _isChrome() {
  return typeof navigator !== 'undefined' &&
    (/Chrome/.test(navigator.userAgent) || /CriOS/.test(navigator.userAgent));
}

/* Keep-one-channel matrix for chromatic aberration */
function _keepMatrix(k) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    if (r === k) {
      rows.push([0,0,0,0,0].map(function(_, c) { return c === k ? '1' : '0'; }).join(' '));
    } else if (r === 3) {
      rows.push('0 0 0 1 0');
    } else {
      rows.push('0 0 0 0 0');
    }
  }
  return rows.join('  ');
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
    return {
      x: p.x / W(),
      y: p.y / H(),
      w: p.w / W(),
      h: p.h / H(),
    };
  }

  function apply(p) {
    p = p || lens;

    const mapResult = cachedMap({
      w: Math.min(Math.round(p.w), 256),
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
    'box-shadow:inset 0 0 10px rgba(255,255,255,.1),' +
    '0 0 8px rgba(255,255,255,.08);z-index:999';
  el.style.left = lensPx.x + 'px';
  el.style.top = lensPx.y + 'px';
  el.style.width = lensPx.w + 'px';
  el.style.height = lensPx.h + 'px';
  container.appendChild(el);
  return el;
}

/* ---------- 5. WEBGL RENDERER (MULTI-LENS & CANVAS/VIDEO SUPPORT) ----------
 * Same displacement map, same refraction — via WebGL fragment shader.
 * Supports setLens(lens) AND setLenses([lens1, lens2, ...]) for multi-control
 * UI surfaces like video player controls.
 */

const _VS_BASE = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const _FS_BASE = `
precision mediump float;
uniform sampler2D u_source;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_source, v_uv);
}`;

const _FS_LENS = `
precision mediump float;
uniform sampler2D u_source;
uniform sampler2D u_map;
uniform vec4 u_lens;      // x, y, w, h in UV coords
uniform float u_scale;
uniform vec3 u_chroma;    // scale multipliers for R, G, B
uniform float u_specular; // 0 or 1
varying vec2 v_uv;

void main() {
  vec2 uv = v_uv;
  vec2 lensUV = (uv - u_lens.xy) / u_lens.zw;
  if (lensUV.x < 0.0 || lensUV.x > 1.0 || lensUV.y < 0.0 || lensUV.y > 1.0) {
    discard;
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
  const gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true });
  if (!gl) { console.warn('WebGL not available'); return null; }

  // Base program (background video/canvas)
  const baseProg = gl.createProgram();
  gl.attachShader(baseProg, _compileShader(gl, gl.VERTEX_SHADER, _VS_BASE));
  gl.attachShader(baseProg, _compileShader(gl, gl.FRAGMENT_SHADER, _FS_BASE));
  gl.linkProgram(baseProg);

  // Lens program (refraction)
  const lensProg = gl.createProgram();
  gl.attachShader(lensProg, _compileShader(gl, gl.VERTEX_SHADER, _VS_BASE));
  gl.attachShader(lensProg, _compileShader(gl, gl.FRAGMENT_SHADER, _FS_LENS));
  gl.linkProgram(lensProg);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const srcTex = gl.createTexture();

  function setupTex(tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  setupTex(srcTex, 0);

  let lensesList = [];
  if (Array.isArray(o.lenses)) {
    lensesList = o.lenses;
  } else if (o.lens) {
    lensesList = [Object.assign({
      scale: o.scale ?? 0.05,
      depth: o.depth ?? 127,
      curvature: o.curvature ?? 0.5,
      curvaturePow: o.curvaturePow ?? 1.0,
      glowSide: o.glowSide ?? 54,
      glowTop: o.glowTop ?? 21,
      chroma: o.chroma || [1.08, 1.04, 1.0],
      specular: o.specular !== false
    }, o.lens)];
  }

  const mapTexMap = new Map();

  function getMapTextureForLens(l) {
    const mapResult = cachedMap({
      w: Math.min(Math.round(l.w), 256),
      h: Math.min(Math.round(l.h), 256),
      radius: l.r,
      depth: l.depth ?? 127,
      curvature: l.curvature ?? 0.5,
      curvaturePow: l.curvaturePow ?? 1.0,
      glowSide: l.glowSide ?? 54,
      glowTop: l.glowTop ?? 21,
    });

    const href = mapResult.dataUrl;
    if (!mapTexMap.has(href)) {
      const tex = gl.createTexture();
      setupTex(tex, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mapResult.canvas);
      mapTexMap.set(href, tex);
    }
    return mapTexMap.get(href);
  }

  function render() {
    const sw = source.videoWidth || source.width || glCanvas.width;
    const sh = source.videoHeight || source.height || glCanvas.height;
    if (!sw || !sh) return;

    if (glCanvas.width !== sw || glCanvas.height !== sh) {
      glCanvas.width = sw;
      glCanvas.height = sh;
    }
    gl.viewport(0, 0, sw, sh);

    // 1. Upload source texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // 2. Draw base pass
    gl.useProgram(baseProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const aPosBase = gl.getAttribLocation(baseProg, 'a_pos');
    gl.enableVertexAttribArray(aPosBase);
    gl.vertexAttribPointer(aPosBase, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(baseProg, 'u_source'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. Draw lenses
    if (lensesList.length > 0) {
      gl.useProgram(lensProg);
      const aPosLens = gl.getAttribLocation(lensProg, 'a_pos');
      gl.enableVertexAttribArray(aPosLens);
      gl.vertexAttribPointer(aPosLens, 2, gl.FLOAT, false, 0, 0);

      const uSource = gl.getUniformLocation(lensProg, 'u_source');
      const uMap = gl.getUniformLocation(lensProg, 'u_map');
      const uLens = gl.getUniformLocation(lensProg, 'u_lens');
      const uScale = gl.getUniformLocation(lensProg, 'u_scale');
      const uChroma = gl.getUniformLocation(lensProg, 'u_chroma');
      const uSpecular = gl.getUniformLocation(lensProg, 'u_specular');

      gl.uniform1i(uSource, 0);
      gl.uniform1i(uMap, 1);

      for (const l of lensesList) {
        const tex = getMapTextureForLens(l);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex);

        const sc = l.scale ?? 0.05;
        const ch = l.chroma || [1.08, 1.04, 1.0];
        const spec = l.specular !== false ? 1.0 : 0.0;

        gl.uniform4f(uLens, l.x / sw, l.y / sh, l.w / sw, l.h / sh);
        gl.uniform1f(uScale, sc);
        gl.uniform3f(uChroma, ch[0], ch[1], ch[2]);
        gl.uniform1f(uSpecular, spec);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  function setLens(l) {
    lensesList = [l];
    render();
  }

  function setLenses(list) {
    lensesList = list;
    render();
  }

  function destroy() {
    gl.deleteTexture(srcTex);
    for (const tex of mapTexMap.values()) {
      gl.deleteTexture(tex);
    }
    gl.deleteBuffer(buf);
    gl.deleteProgram(baseProg);
    gl.deleteProgram(lensProg);
  }

  return { setLens, setLenses, render, destroy, get lenses() { return lensesList; } };
}

if (typeof window !== 'undefined') {
  window.GlassEngine = {
    generateMap,
    buildFilter,
    createGlass,
    applySpecular,
    createGlassWebGL,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateMap,
    buildFilter,
    createGlass,
    applySpecular,
    createGlassWebGL,
  };
}
