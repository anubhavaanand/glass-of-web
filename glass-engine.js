let _fid = 0;

function el(name) {
  return document.createElementNS('http://www.w3.org/2000/svg', name);
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

export function genMap(w, h, strength = 60) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d');
  const d = x.createImageData(w, h).data;
  const cx = w / 2, cy = h / 2;
  const mr = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(dist / mr, 1);
      const s = t * t * (3 - 2 * t) * strength;
      let r = 128, g = 128;
      if (dist > 0.001) {
        r = clamp(128 + (dx / dist) * s);
        g = clamp(128 + (dy / dist) * s);
      }
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  x.putImageData(new ImageData(d, w, h), 0, 0);
  return c.toDataURL('image/png');
}

export function buildFilter(defs, w, h, scale) {
  while (defs.firstChild) defs.removeChild(defs.firstChild);
  const id = 'gf' + (++_fid) + '-' + Date.now();
  const map = genMap(w, h);
  const pad = Math.round(scale * 0.6);
  const f = el('filter');
  f.id = id;
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', String(-pad));
  f.setAttribute('y', String(-pad));
  f.setAttribute('width', String(w + pad * 2));
  f.setAttribute('height', String(h + pad * 2));

  const fl = el('feFlood');
  fl.setAttribute('flood-color', 'rgb(128,128,128)');
  fl.setAttribute('flood-opacity', '1');
  fl.setAttribute('result', 'mapBg');
  f.appendChild(fl);

  const img = el('feImage');
  img.setAttribute('x', '0'); img.setAttribute('y', '0');
  img.setAttribute('width', String(w)); img.setAttribute('height', String(h));
  img.setAttribute('preserveAspectRatio', 'none');
  img.setAttribute('href', map);
  img.setAttribute('result', 'rawMap');
  f.appendChild(img);

  const ov = el('feComposite');
  ov.setAttribute('in', 'rawMap');
  ov.setAttribute('in2', 'mapBg');
  ov.setAttribute('operator', 'over');
  ov.setAttribute('result', 'map');
  f.appendChild(ov);

  const bl = el('feGaussianBlur');
  bl.setAttribute('in', 'map');
  bl.setAttribute('stdDeviation', `${0.5 / w} ${0.5 / h}`);
  bl.setAttribute('result', 'smoothMap');
  f.appendChild(bl);

  // Chromatic aberration: R, G, B displaced at different scales
  const dR = el('feDisplacementMap');
  dR.setAttribute('in', 'SourceGraphic');
  dR.setAttribute('in2', 'smoothMap');
  dR.setAttribute('scale', String(scale * 1.2));
  dR.setAttribute('xChannelSelector', 'R');
  dR.setAttribute('yChannelSelector', 'G');
  dR.setAttribute('result', 'displacedR');
  f.appendChild(dR);

  const dG = el('feDisplacementMap');
  dG.setAttribute('in', 'SourceGraphic');
  dG.setAttribute('in2', 'smoothMap');
  dG.setAttribute('scale', String(scale * 1.0));
  dG.setAttribute('xChannelSelector', 'R');
  dG.setAttribute('yChannelSelector', 'G');
  dG.setAttribute('result', 'displacedG');
  f.appendChild(dG);

  const dB = el('feDisplacementMap');
  dB.setAttribute('in', 'SourceGraphic');
  dB.setAttribute('in2', 'smoothMap');
  dB.setAttribute('scale', String(scale * 0.8));
  dB.setAttribute('xChannelSelector', 'R');
  dB.setAttribute('yChannelSelector', 'G');
  dB.setAttribute('result', 'displacedB');
  f.appendChild(dB);

  const mR = el('feColorMatrix');
  mR.setAttribute('type', 'matrix');
  mR.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
  mR.setAttribute('result', 'chanR');
  f.appendChild(mR);

  const mG = el('feColorMatrix');
  mG.setAttribute('type', 'matrix');
  mG.setAttribute('values', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0');
  mG.setAttribute('result', 'chanG');
  f.appendChild(mG);

  const mB = el('feColorMatrix');
  mB.setAttribute('type', 'matrix');
  mB.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
  mB.setAttribute('result', 'chanB');
  f.appendChild(mB);

  const mr1 = el('feComposite');
  mr1.setAttribute('in', 'chanR');
  mr1.setAttribute('in2', 'chanG');
  mr1.setAttribute('operator', 'arithmetic');
  mr1.setAttribute('k1', '0'); mr1.setAttribute('k2', '1');
  mr1.setAttribute('k3', '1'); mr1.setAttribute('k4', '0');
  mr1.setAttribute('result', 'mergedRG');
  f.appendChild(mr1);

  const mr2 = el('feComposite');
  mr2.setAttribute('in', 'mergedRG');
  mr2.setAttribute('in2', 'chanB');
  mr2.setAttribute('operator', 'arithmetic');
  mr2.setAttribute('k1', '0'); mr2.setAttribute('k2', '1');
  mr2.setAttribute('k3', '1'); mr2.setAttribute('k4', '0');
  mr2.setAttribute('result', 'out');
  f.appendChild(mr2);

  defs.appendChild(f);
  return id;
}

export function applyFilter(el, id) {
  el.style.filter = 'url(#' + id + ')';
}

export default { genMap, buildFilter, applyFilter };
