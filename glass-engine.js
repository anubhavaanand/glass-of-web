/* Aave Glass — faithful port of aave.com/design/building-glass-for-the-web
 *
 * Reverse-engineered verbatim from Aave's live implementation:
 *  - 17-primitive SVG filter chain:
 *      feFlood(128gray) -> feImage(map) -> feComposite over -> feGaussianBlur(SourceGraphic)
 *      -> 3x [feDisplacementMap + feColorMatrix keep-channel]  (chromatic aberration)
 *      -> arithmetic merges -> specular mask FROM MAP'S BLUE CHANNEL
 *      -> hole-punch composites (SourceGraphic out lensMask, result over)
 *  - filterUnits & primitiveUnits = objectBoundingBox (lens coords are fractions)
 *  - displacement-map PNG encoding (sampled from their real maps):
 *      R = horizontal bend, G = vertical bend, B = specular glow ramp.
 *      CENTER IS NEUTRAL - bend lives in a thin outer rim.
 *  - fresh filter ID on every update (Safari caches filter output by ID)
 *  - map regenerated only when shape changes; lens moves only shift the region
 *
 * Their per-component scales extracted from production:
 *   switch .3 | slider .113 | toggle group .0459 | large hero lens .0756
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let _seq = 0;
const _mapCache = new Map();

function svgEl(name) { return document.createElementNS(SVG_NS, name); }

function cachedMap(o) {
  const key = [o.w, o.h, o.radius, o.depth, o.rimStart, o.rimPow, o.glowSide, o.glowTop].join('|');
  if (!_mapCache.has(key)) {
    if (_mapCache.size > 60) _mapCache.clear();
    _mapCache.set(key, generateLensMap(o));
  }
  return _mapCache.get(key);
}

/* ---------- 1. DISPLACEMENT MAP GENERATOR ----------
 * Profile fitted against Aave's actual switch map (256x256):
 *   R center-row: edge=253 -> neutral by ~20% in -> stays 128
 *   disp(t) = depth * smoothstep((t-rimStart)/(1-rimStart))^(rimPow/2)
 * ---------- */

function generateLensMap(opts) {
  const {
    w = 512,
    h = w,
    radius,             // px; default = pill (min(w,h)/2)
    depth = 127,        // peak displacement (map units around neutral 128)
    rimStart = 0.76,    // fraction of radius where bend begins (0 = bend everywhere)
    rimPow = 2.3,       // rim sharpness - higher = tighter/harder rim
    glowSide = 54,      // blue-channel glow at left/right rim ("specular angle")
    glowTop = 21,       // blue-channel glow at top/bottom rim
    inset = 0
  } = opts || {};
  const R_ = radius ?? Math.min(w, h) / 2;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const cx = w / 2, cy = h / 2;
  const hx = Math.max(cx - R_ + inset, 0);
  const hy = Math.max(cy - R_ + inset, 0);
  function ss(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      // rounded-rect SDF: distance outside inner core, normalized by radius
      const qx = Math.abs(x + 0.5 - cx) - hx;
      const qy = Math.abs(y + 0.5 - cy) - hy;
      const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));

      if (outDist >= R_) {
        d[i] = 128; d[i + 1] = 128; d[i + 2] = 128; d[i + 3] = 255;
        continue;
      }

      // rim factor: flat-neutral center, steep outer band (Aave profile)
      const rt = (outDist / R_ - rimStart) / (1 - rimStart);
      let rim = ss(Math.min(Math.max(rt, 0), 1));
      rim = Math.pow(rim, rimPow / 2);

      // outward direction
      const sx = Math.sign(x + 0.5 - cx) || 1;
      const sy = Math.sign(y + 0.5 - cy) || 1;
      let dirX, dirY, side;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        dirX = (qx / l) * sx; dirY = (qy / l) * sy; side = false;
      } else if (qx > 0) { dirX = sx; dirY = 0; side = true; }
      else               { dirX = 0; dirY = sy; side = false; }

      const Rv = Math.round(128 + dirX * depth * rim);
      const Gv = Math.round(128 + dirY * depth * rim);
      const Bv = Math.round(128 + (side ? glowSide : glowTop) * rim);

      d[i]     = Math.max(0, Math.min(255, Rv));
      d[i + 1] = Math.max(0, Math.min(255, Gv));
      d[i + 2] = Math.max(0, Math.min(255, Bv));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/* ---------- 2. FILTER BUILDER: exact 17-primitive chain ---------- */

function keepChannelMatrix(k) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    if (r === k) rows.push([0,0,0,0,0].map(function(_, c){ return c === k ? '1' : '0'; }).join(' '));
    else if (r === 3) rows.push('0 0 0 1 0');
    else rows.push('0 0 0 0 0');
  }
  return rows.join('  ');
}

function buildGlassFilter(defs, o) {
  const lens = o.lens;                 // {x,y,w,h} FRACTIONS of the filtered element
  const mapHref = o.mapHref;
  const scale = o.scale ?? 0.0756;
  const chroma = o.chroma || [1.08, 1.04, 1.0];   // subtle +/-4% like Aave
  const blurPx = o.blurPx ?? 0.5;
  const elW = o.elW || 764, elH = o.elH || 368;
  const specular = o.specular !== false;
  const idBase = o.idBase || 'glass';

  const id = idBase + '-v' + (++_seq) + '-' + Date.now().toString(36);
  const L = lens;
  function region(n) {
    n.setAttribute('x', L.x); n.setAttribute('y', L.y);
    n.setAttribute('width', L.w); n.setAttribute('height', L.h);
  }

  const f = svgEl('filter');
  f.id = id;
  f.setAttribute('filterUnits', 'objectBoundingBox');
  f.setAttribute('primitiveUnits', 'objectBoundingBox');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', '0'); f.setAttribute('y', '0');
  f.setAttribute('width', '1'); f.setAttribute('height', '1');

  // 1. neutral gray everywhere outside the map image
  const floodBg = svgEl('feFlood');
  floodBg.setAttribute('flood-color', 'rgb(128,128,128)');
  floodBg.setAttribute('flood-opacity', '1');
  floodBg.setAttribute('result', 'mapBg');

  // 2. the generated map, stretched over the lens region
  const img = svgEl('feImage');
  img.setAttribute('href', mapHref);
  region(img);
  img.setAttribute('preserveAspectRatio', 'none');
  img.setAttribute('result', 'rawMap');

  // 3. map = rawMap over mapBg (neutral outside lens)
  const compMap = svgEl('feComposite');
  compMap.setAttribute('in', 'rawMap');
  compMap.setAttribute('in2', 'mapBg');
  compMap.setAttribute('operator', 'over');
  compMap.setAttribute('result', 'map');

  // 4. soften the CONTENT slightly (fractions of element size)
  const blur = svgEl('feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', (blurPx / elW) + ' ' + (blurPx / elH));
  blur.setAttribute('result', 'blurred');

  // 5-10. chromatic refraction: three displacements of the same map
  const chanNames = ['R', 'G', 'B'];
  const channels = chroma.map(function(m, k) {
    const disp = svgEl('feDisplacementMap');
    disp.setAttribute('in', 'blurred');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', String(scale * m));
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    region(disp);
    const mat = svgEl('feColorMatrix');
    mat.setAttribute('type', 'matrix');
    mat.setAttribute('values', keepChannelMatrix(k));
    mat.setAttribute('result', 'disp' + chanNames[k]);
    return { disp: disp, mat: mat };
  });

  const merge1 = svgEl('feComposite');
  merge1.setAttribute('in', 'dispR');
  merge1.setAttribute('in2', 'dispG');
  merge1.setAttribute('operator', 'arithmetic');
  merge1.setAttribute('k1', '0'); merge1.setAttribute('k2', '1');
  merge1.setAttribute('k3', '1'); merge1.setAttribute('k4', '0');

  const merge2 = svgEl('feComposite');
  merge2.setAttribute('in2', 'dispB');
  merge2.setAttribute('operator', 'arithmetic');
  merge2.setAttribute('k1', '0'); merge2.setAttribute('k2', '1');
  merge2.setAttribute('k3', '1'); merge2.setAttribute('k4', '0');
  merge2.setAttribute('result', 'lensResult');

  f.append(floodBg, img, compMap, blur);
  channels.forEach(function(ch){ f.append(ch.disp, ch.mat); });
  f.append(merge1, merge2);

  if (specular) {
    // 11. white mask whose alpha comes from the MAP's blue channel (Aave verbatim)
    const specMask = svgEl('feColorMatrix');
    specMask.setAttribute('in', 'map');
    specMask.setAttribute('type', 'matrix');
    specMask.setAttribute('values',
      '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843137255');
    specMask.setAttribute('result', 'specMask');

    // 12. add the glow onto the refracted content
    const specAdd = svgEl('feComposite');
    specAdd.setAttribute('in', 'specMask');
    specAdd.setAttribute('in2', 'lensResult');
    specAdd.setAttribute('operator', 'arithmetic');
    specAdd.setAttribute('k1', '0'); specAdd.setAttribute('k2', '1');
    specAdd.setAttribute('k3', '1'); specAdd.setAttribute('k4', '0');
    specAdd.setAttribute('result', 'lensResult');
    f.append(specMask, specAdd);
  }

  // 13. black flood covering exactly the lens region
  const lensMaskFlood = svgEl('feFlood');
  lensMaskFlood.setAttribute('flood-color', 'black');
  lensMaskFlood.setAttribute('flood-opacity', '1');
  region(lensMaskFlood);
  lensMaskFlood.setAttribute('result', 'lensMask');

  // 14. punch the lens out of the original content
  const holed = svgEl('feComposite');
  holed.setAttribute('in', 'SourceGraphic');
  holed.setAttribute('in2', 'lensMask');
  holed.setAttribute('operator', 'out');
  holed.setAttribute('result', 'holedSG');

  // 15. refracted result fills the hole
  const fin = svgEl('feComposite');
  fin.setAttribute('in', 'lensResult');
  fin.setAttribute('in2', 'holedSG');
  fin.setAttribute('operator', 'over');

  f.append(lensMaskFlood, holed, fin);
  defs.appendChild(f);
  return id;
}

/* ---------- 3. HIGH-LEVEL COMPONENT HELPER ----------
 * createGlass(container, {
 *   container,           positioned parent; its pixels bend inside the lens
 *   lens: {x,y,w,h,r},   lens rect in PX relative to container
 *   scale, depth, rimStart, rimPow, glowSide, glowTop,
 *   chroma, specular, blurPx, chromiumLens
 * })
 * Returns { setLens(pxRect), id, refresh(), destroy() }
 *
 * Structure mirrors Aave: filter goes STRAIGHT ON the content element,
 * svg<defs> sits beside it as a zero-size sibling. Layout untouched.
 * ---------- */

function createGlass(container, o) {
  o = o || {};
  const lens = o.lens;
  const scale = o.scale ?? 0.0756;
  const depth = o.depth ?? 127;
  const rimStart = o.rimStart ?? 0.76;
  const rimPow = o.rimPow ?? 2.3;
  const glowSide = o.glowSide ?? 54;
  const glowTop = o.glowTop ?? 21;
  const chroma = o.chroma;
  const specular = o.specular !== false;
  const blurPx = o.blurPx ?? 0.5;
  const chromiumLens = !!o.chromiumLens;

  const rect = function(){ return container.getBoundingClientRect(); };
  const W = function(){ return rect().width || 1; };
  const H = function(){ return rect().height || 1; };

  container.style.willChange = 'filter';

  const svg = svgEl('svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:visible;pointer-events:none';
  const defs = svgEl('defs');
  svg.appendChild(defs);
  container.appendChild(svg);

  let currentId = null;
  let chromiumLensObj = null;

  function applyMask(el, p) {
    const m = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + p.w + " " + p.h +
      "' preserveAspectRatio='none'><rect x='0.5' y='0.5' width='" + (p.w - 1) +
      "' height='" + (p.h - 1) + "' rx='" + p.r + "' ry='" + p.r + "' fill='black'/></svg>";
    const url = "url(\"data:image/svg+xml;charset=utf-8," + encodeURIComponent(m) + "\")";
    el.style.borderRadius = p.r + 'px';
    el.style.maskImage = url; el.style.webkitMaskImage = url;
    el.style.maskSize = '100% 100%'; el.style.webkitMaskSize = '100% 100%';
  }

  function fracs(p) {
    return { x: p.x / W(), y: p.y / H(), w: p.w / W(), h: p.h / H() };
  }

  function apply(p) {
    p = p || lens;
    const mapHref = cachedMap({
      w: Math.round(p.w), h: Math.round(p.h),
      radius: p.r, depth: depth, rimStart: rimStart,
      rimPow: rimPow, glowSide: glowSide, glowTop: glowTop
    });
    if (currentId) {
      const old = document.getElementById(currentId);
      if (old) old.remove();
    }
    currentId = buildGlassFilter(defs, {
      lens: fracs(p), mapHref: mapHref, scale: scale, chroma: chroma,
      specular: specular, blurPx: blurPx, elW: W(), elH: H(),
      idBase: container.id ? 'glass-' + container.id : 'glass'
    });
    container.style.filter = 'url("#' + currentId + '")';
    if (chromiumLensObj) {
      applyMask(chromiumLensObj, p);
      chromiumLensObj.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
      chromiumLensObj.style.width = p.w + 'px';
      chromiumLensObj.style.height = p.h + 'px';
    }
  }

  if (chromiumLens) {
    chromiumLensObj = document.createElement('div');
    chromiumLensObj.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;will-change:backdrop-filter,transform;';
    container.appendChild(chromiumLensObj);
    applyMask(chromiumLensObj, lens);
    requestAnimationFrame(function() {
      if (currentId) chromiumLensObj.style.backdropFilter = 'url("#' + currentId + '")';
    });
  }

  apply();

  return {
    setLens: apply,
    get id() { return currentId; },
    get lensEl() { return chromiumLensObj; },
    refresh: function(){ apply(); },
    destroy: function(){
      container.style.filter = '';
      container.style.willChange = '';
      svg.remove();
      if (chromiumLensObj) chromiumLensObj.remove();
    }
  };
}

if (typeof window !== 'undefined') {
  window.GlassEngine = { generateLensMap, buildGlassFilter, createGlass };
}
