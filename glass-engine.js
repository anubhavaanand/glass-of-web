let _fid = 0;

export function genMap(w, h, strength = 55) {
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
      if (dist > 0.001) { r = clamp(128 + (dx / dist) * s); g = clamp(128 + (dy / dist) * s); }
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  x.putImageData(new ImageData(d, w, h), 0, 0);
  return c.toDataURL('image/png');
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

export function buildFilter(defs, w, h, scale) {
  while (defs.firstChild) defs.removeChild(defs.firstChild);
  const id = 'gf' + (++_fid) + '-' + Date.now();
  const NS = 'http://www.w3.org/2000/svg';
  const map = genMap(w, h);
  const f = document.createElementNS(NS, 'filter');
  f.id = id;
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('primitiveUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.setAttribute('x', String(-scale / 2));
  f.setAttribute('y', String(-scale / 2));
  f.setAttribute('width', String(w + scale));
  f.setAttribute('height', String(h + scale));
  const fi = document.createElementNS(NS, 'feImage');
  fi.setAttribute('x', '0'); fi.setAttribute('y', '0');
  fi.setAttribute('width', String(w)); fi.setAttribute('height', String(h));
  fi.setAttribute('preserveAspectRatio', 'none');
  fi.setAttribute('href', map); fi.setAttribute('result', 'map');
  const fd = document.createElementNS(NS, 'feDisplacementMap');
  fd.setAttribute('in', 'SourceGraphic');
  fd.setAttribute('in2', 'map');
  fd.setAttribute('scale', String(scale));
  fd.setAttribute('xChannelSelector', 'R');
  fd.setAttribute('yChannelSelector', 'G');
  f.appendChild(fi); f.appendChild(fd);
  defs.appendChild(f);
  return id;
}

export function applyFilter(el, id) {
  el.style.filter = 'url(#' + id + ')';
}

export default { genMap, buildFilter, applyFilter };
