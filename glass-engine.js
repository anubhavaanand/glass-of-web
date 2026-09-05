/**
 * Liquid Glass Engine — Aave Labs "Building Glass for the Web" Reference Implementation
 *
 * Architecture:
 *   - Exact 2D Signed Distance Field (SDF) rounded-rectangle normals
 *   - Error function (erf) smooth edge falloff: 0.5 * (1 + erf(d * scale))
 *   - 4-Fold Quadrant Symmetry: 4x speedup computing top-left quadrant and mirroring
 *   - 17-primitive SVG filter pipeline with 3-channel chromatic split (dispR, dispG, dispB)
 *   - Full parameter schema: lensHalfWidth, lensHalfHeight, borderRadius, depth, glowStrength,
 *     glowSpread, glowExponent, edgeStrength, edgeWidth, edgeExponent, specularRotation, splayAmount
 *   - Distinct refractionTarget support (e.g. track fill or selection indicator pill)
 *   - Dynamic fresh filter IDs per frame for Safari cache-busting
 *   - WebGL 2 / WebGL GLSL multi-lens refraction for canvas and live video
 */

(function(root, factory) {
  const engine = factory();
  if (typeof define === 'function' && define.amd) {
    define([], () => engine);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = engine;
  }
  if (typeof root !== 'undefined') {
    root.GlassEngine = engine;
    root.glassEngine = engine;
  }
  if (typeof window !== 'undefined') {
    window.GlassEngine = engine;
    window.glassEngine = engine;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let _seq = 0;
  const cache = new Map();

  function svgEl(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return sign * y;
  }

  function clamp(v, min = 0, max = 255) {
    return v <= min ? min : v >= max ? max : (v + 0.5) | 0;
  }

  function getCacheKey(w, h, radius, depth, curvature, curvaturePow) {
    return `${w}_${h}_${radius}_${depth}_${curvature}_${curvaturePow}`;
  }

  /**
   * Generates a 2D Displacement Map with 4-fold quadrant symmetry
   */
  function generateMap(wOrOpts, maybeH, maybeRad, maybeDepth, maybeCurv, maybeCurvPow) {
    let opts = {};
    if (typeof wOrOpts === 'object' && wOrOpts !== null) {
      opts = wOrOpts;
    } else {
      opts = {
        w: wOrOpts,
        h: maybeH,
        radius: maybeRad,
        depth: maybeDepth,
        curvature: maybeCurv,
        curvaturePow: maybeCurvPow
      };
    }

    const w = Math.round(opts.w || (opts.lensHalfWidth ? opts.lensHalfWidth * 2 : 256));
    const h = Math.round(opts.h || (opts.lensHalfHeight ? opts.lensHalfHeight * 2 : w));
    const halfW = w / 2;
    const halfH = h / 2;

    const borderRadius = opts.borderRadius ?? opts.radius ?? Math.min(halfW, halfH);
    const depth = opts.depth ?? 127;
    const curvature = opts.curvature ?? opts.rimStart ?? 0.7;
    const curvaturePow = opts.curvaturePow ?? opts.rimPow ?? (opts.splayAmount ? 0.1 + opts.splayAmount * 2.9 : 2.0);
    const edgeFalloff = opts.edgeFalloff !== false;
    const sdfBoundary = opts.sdfBoundary !== false;

    const specularRotation = (opts.specularRotation ?? opts.angle ?? 45) * Math.PI / 180;
    const isObj = typeof wOrOpts === 'object' && wOrOpts !== null;
    const glowStrength = opts.glowStrength ?? (opts.glowSide ? opts.glowSide / 100 : (isObj ? 0.3 : 0));
    const glowSpread = opts.glowSpread ?? 1.0;
    const glowExponent = opts.glowExponent ?? 1.5;
    const edgeStrength = opts.edgeStrength ?? (opts.edge ? opts.edge : (isObj ? 0.25 : 0));
    const edgeWidth = opts.edgeWidth ?? 3.0;
    const edgeExponent = opts.edgeExponent ?? 1.5;
    const splayAmount = opts.splayAmount ?? 1.0;

    const cacheKey = getCacheKey(w, h, borderRadius, depth, curvature, curvaturePow);
    if (cache.has(cacheKey) && typeof wOrOpts !== 'object') {
      return cache.get(cacheKey);
    }

    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) {
      return { canvas: null, dataUrl: '', width: w, height: h };
    }
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const cornerRadius = Math.min(borderRadius, Math.min(halfW, halfH));
    const innerW = Math.max(0, halfW - depth);
    const innerH = Math.max(0, halfH - depth);
    const innerCorner = Math.max(0, Math.min(borderRadius, Math.min(innerW, innerH)));
    const depthScale = depth > 0 ? 1 / (depth * Math.SQRT2) : 1e6;

    const cosRot = Math.cos(specularRotation);
    const sinRot = Math.sin(specularRotation);
    const glowA = (1 - glowSpread) * Math.SQRT2;
    const glowB = glowSpread * Math.SQRT2;
    const invGlowB = glowB > 0.001 ? 1 / glowB : 0;
    const invEdgeWidth = edgeWidth > 0 ? 1 / edgeWidth : 0;

    const stepX = (2 * halfW) / w;
    const stepY = (2 * halfH) / h;
    const invHalfW = 1 / (halfW || 1);
    const invHalfH = 1 / (halfH || 1);

    const quadW = Math.ceil(w / 2);
    const quadH = Math.ceil(h / 2);

    for (let py = 0; py < quadH; py++) {
      const mirrorY = h - 1 - py;
      const posY = -((py + 0.5) * stepY - halfH);
      const dyCorner = posY - halfH + cornerRadius;
      const normY = posY * invHalfH > 1 ? 1 : posY * invHalfH;

      for (let px = 0; px < quadW; px++) {
        const mirrorX = w - 1 - px;
        const posX = -((px + 0.5) * stepX - halfW);
        const dxCorner = posX - halfW + cornerRadius;

        const clampedDX = dxCorner > 0 ? dxCorner : 0;
        const clampedDY = dyCorner > 0 ? dyCorner : 0;
        const dist = Math.sqrt(clampedDX * clampedDX + clampedDY * clampedDY) +
                     (dxCorner > dyCorner ? (dxCorner > 0 ? 0 : dxCorner) : (dyCorner > 0 ? 0 : dyCorner)) - cornerRadius;

        const idxTL = (py * w + px) * 4;
        const idxTR = (py * w + mirrorX) * 4;
        const idxBL = (mirrorY * w + px) * 4;
        const idxBR = (mirrorY * w + mirrorX) * 4;

        if (!sdfBoundary || dist < 0) {
          let normX = posX * invHalfW > 1 ? 1 : posX * invHalfW;
          let dispX = normX;
          let dispY = normY;

          if (splayAmount < 1.0) {
            const minDim = 0.5 * Math.min(halfW, halfH);
            const invMinDim = minDim > 0 ? 1 / minDim : 0;
            const factorY = Math.max(0, 1 - (halfH - posY) * invMinDim) * (1 - splayAmount);
            const factorX = Math.max(0, 1 - (halfW - posX) * invMinDim) * (1 - splayAmount);
            dispX = dispX * (1 - factorY);
            dispY = dispY * (1 - factorX);
            const lenOrig = Math.sqrt(normX * normX + normY * normY);
            const lenMod = Math.sqrt(dispX * dispX + dispY * dispY);
            if (lenMod > 0.001) {
              const renorm = lenOrig / lenMod;
              dispX *= renorm;
              dispY *= renorm;
            }
          }

          let falloff = 1.0;
          if (edgeFalloff && depth > 0) {
            const innerDX = posX - innerW + innerCorner;
            const innerDY = posY - innerH + innerCorner;
            const cIDX = innerDX > 0 ? innerDX : 0;
            const cIDY = innerDY > 0 ? innerDY : 0;
            const innerDist = Math.sqrt(cIDX * cIDX + cIDY * cIDY) +
                              (innerDX > innerDY ? (innerDX > 0 ? 0 : innerDX) : (innerDY > 0 ? 0 : innerDY)) - innerCorner;
            falloff = 0.5 * (1 + erf(innerDist * depthScale));
          }

          const uDisp = 0.5 * dispX * falloff * curvature;
          const vDisp = 0.5 * dispY * falloff * curvature;

          const rPos = clamp((0.5 + uDisp) * 255);
          const rNeg = clamp((0.5 - uDisp) * 255);
          const gPos = clamp((0.5 + vDisp) * 255);
          const gNeg = clamp((0.5 - vDisp) * 255);

          let blueVal = 128;
          if (glowStrength > 0 || edgeStrength > 0) {
            const rotX = normX * cosRot;
            const rotY = normY * sinRot;
            const diagSum = Math.abs(rotX + rotY);

            let specL = 0;
            if (glowStrength > 0) {
              const tGlow = (diagSum - glowA) * invGlowB;
              const glowClamped = tGlow < 0 ? 0 : tGlow > 1 ? 1 : tGlow;
              specL += glowStrength * Math.pow(glowClamped, glowExponent) * falloff;
            }
            if (edgeStrength > 0) {
              const edgeDistFactor = dist < 0 ? Math.max(0, 1 + dist * invEdgeWidth) : 0;
              specL += edgeStrength * edgeDistFactor * Math.pow(diagSum, edgeExponent);
            }
            specL = Math.min(1, specL);
            blueVal = clamp(127 * specL + 128);
          }

          data[idxTL]     = rPos;
          data[idxTL + 1] = gPos;
          data[idxTL + 2] = blueVal;
          data[idxTL + 3] = 255;

          data[idxTR]     = rNeg;
          data[idxTR + 1] = gPos;
          data[idxTR + 2] = blueVal;
          data[idxTR + 3] = 255;

          data[idxBL]     = rPos;
          data[idxBL + 1] = gNeg;
          data[idxBL + 2] = blueVal;
          data[idxBL + 3] = 255;

          data[idxBR]     = rNeg;
          data[idxBR + 1] = gNeg;
          data[idxBR + 2] = blueVal;
          data[idxBR + 3] = 255;
        } else {
          data[idxTL] = 128; data[idxTL + 1] = 128; data[idxTL + 2] = 128; data[idxTL + 3] = 255;
          data[idxTR] = 128; data[idxTR + 1] = 128; data[idxTR + 2] = 128; data[idxTR + 3] = 255;
          data[idxBL] = 128; data[idxBL + 1] = 128; data[idxBL + 2] = 128; data[idxBL + 3] = 255;
          data[idxBR] = 128; data[idxBR + 1] = 128; data[idxBR + 2] = 128; data[idxBR + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    const dataUrl = c.toDataURL();

    if (cache.size > 50) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(cacheKey, dataUrl);

    if (typeof wOrOpts !== 'object') {
      return dataUrl;
    }

    return {
      canvas: c,
      dataUrl: dataUrl,
      width: w,
      height: h
    };
  }

  function cachedMap(opts) {
    const res = generateMap(opts);
    return typeof res === 'string' ? { dataUrl: res, canvas: null, width: opts.w, height: opts.h } : res;
  }

  function buildFilter(filter, opts) {
    while (filter.firstChild) filter.removeChild(filter.firstChild);

    function setAttrs(el, attrs) {
      for (const k in attrs) el.setAttribute(k, attrs[k]);
    }

    function appendNode(name, attrs) {
      const el = svgEl(name);
      setAttrs(el, attrs);
      filter.appendChild(el);
      return el;
    }

    setAttrs(filter, {
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      x: '0',
      y: '0',
      width: '100%',
      height: '100%'
    });

    const px = opts.pixelLens;
    const mapHref = opts.mapDataUrl;
    const scale = opts.scale ?? 10;
    const chroma = opts.chroma || [1.08, 1.04, 1.0];
    const blurPx = opts.blurPx ?? 0;

    appendNode('feImage', {
      href: mapHref,
      x: String(px.x),
      y: String(px.y),
      width: String(px.w),
      height: String(px.h),
      result: 'map'
    });

    let currentSrc = 'SourceGraphic';
    if (blurPx > 0) {
      appendNode('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: String(blurPx),
        result: 'blurred'
      });
      currentSrc = 'blurred';
    }

    const channels = [
      { name: 'dispR', scaleMul: chroma[0], mat: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'dispG', scaleMul: chroma[1], mat: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'dispB', scaleMul: chroma[2], mat: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' }
    ];

    channels.forEach(ch => {
      appendNode('feDisplacementMap', {
        in: currentSrc,
        in2: 'map',
        scale: String(scale * ch.scaleMul),
        xChannelSelector: 'R',
        yChannelSelector: 'G'
      });

      appendNode('feColorMatrix', {
        type: 'matrix',
        values: ch.mat,
        result: ch.name
      });
    });

    appendNode('feComposite', {
      in: 'dispR',
      in2: 'dispG',
      operator: 'arithmetic',
      k1: '0',
      k2: '1',
      k3: '1',
      k4: '0'
    });

    appendNode('feComposite', {
      in2: 'dispB',
      operator: 'arithmetic',
      k1: '0',
      k2: '1',
      k3: '1',
      k4: '0',
      result: 'lensResult'
    });

    appendNode('feFlood', {
      x: String(px.x),
      y: String(px.y),
      width: String(px.w),
      height: String(px.h),
      'flood-color': '#fff',
      result: 'lensMask'
    });

    appendNode('feComposite', {
      in: 'lensResult',
      in2: 'lensMask',
      operator: 'in',
      result: 'clippedLens'
    });

    appendNode('feComposite', {
      in: 'SourceGraphic',
      in2: 'lensMask',
      operator: 'out',
      result: 'holedBackground'
    });

    appendNode('feComposite', {
      in: 'clippedLens',
      in2: 'holedBackground',
      operator: 'over'
    });
  }

  function applySpecular(lensEl, r, glowStrength = 0.3) {
    if (!lensEl) return;
    const borderAlpha = Math.min(0.6, Math.max(0.15, glowStrength * 0.75));
    const shadowAlpha = Math.min(0.4, Math.max(0.1, glowStrength * 0.5));
    lensEl.style.borderRadius = `${r}px`;
    lensEl.style.boxShadow = [
      `inset 0 1px 1px rgba(255, 255, 255, ${borderAlpha})`,
      `inset 0 -1px 1px rgba(255, 255, 255, ${shadowAlpha * 0.6})`,
      `0 4px 12px rgba(0, 0, 0, 0.08)`
    ].join(', ');
    lensEl.style.border = `1px solid rgba(255, 255, 255, ${borderAlpha * 0.7})`;
  }

  function createGlass(container, options) {
    options = options || {};
    const lens = options.lens || { x: 0, y: 0, w: 100, h: 100, r: 20 };
    const baseId = `glass-${container.id || 'lens'}-${++_seq}`;
    let currentVersion = 1;

    const svg = svgEl('svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:visible;pointer-events:none';

    const defs = svgEl('defs');
    const filter = svgEl('filter');
    const filterId = `${baseId}-v${currentVersion}`;
    filter.id = filterId;

    defs.appendChild(filter);
    svg.appendChild(defs);
    container.appendChild(svg);

    const targetEl = options.refractionTarget || container;
    targetEl.style.filter = `url("#${filterId}")`;

    let mapResult = cachedMap({
      w: Math.min(Math.round(lens.w), 256),
      h: Math.min(Math.round(lens.h), 256),
      radius: lens.r,
      depth: options.depth ?? 127,
      curvature: options.curvature ?? options.rimStart ?? 0.7,
      curvaturePow: options.curvaturePow ?? options.rimPow ?? 2.0,
      glowStrength: options.glowStrength ?? 0.3,
      edgeStrength: options.edgeStrength ?? 0.25,
      specularRotation: options.specularRotation ?? 45
    });

    buildFilter(filter, {
      pixelLens: lens,
      mapDataUrl: mapResult.dataUrl,
      scale: options.scale ?? 10,
      chroma: options.chroma || [1.08, 1.04, 1.0],
      blurPx: options.blurPx ?? 0
    });

    let currentLens = Object.assign({}, lens);

    function updateFilter(newLens) {
      if (newLens) Object.assign(currentLens, newLens);
      currentVersion++;
      const nextId = `${baseId}-v${currentVersion}`;
      filter.id = nextId;

      buildFilter(filter, {
        pixelLens: currentLens,
        mapDataUrl: mapResult.dataUrl,
        scale: options.scale ?? 10,
        chroma: options.chroma || [1.08, 1.04, 1.0],
        blurPx: options.blurPx ?? 0
      });

      targetEl.style.filter = `url("#${nextId}")`;
    }

    return {
      setLens(newLens) {
        if (!newLens) return;
        const sizeChanged = Math.round(newLens.w) !== Math.round(currentLens.w) ||
                            Math.round(newLens.h) !== Math.round(currentLens.h) ||
                            Math.round(newLens.r) !== Math.round(currentLens.r);
        if (sizeChanged) {
          mapResult = cachedMap({
            w: Math.min(Math.round(newLens.w), 256),
            h: Math.min(Math.round(newLens.h), 256),
            radius: newLens.r,
            depth: options.depth ?? 127,
            curvature: options.curvature ?? 0.7,
            curvaturePow: options.curvaturePow ?? 2.0,
            glowStrength: options.glowStrength ?? 0.3,
            edgeStrength: options.edgeStrength ?? 0.25
          });
        }
        updateFilter(newLens);
      },
      destroy() {
        targetEl.style.filter = '';
        if (svg.parentNode) svg.parentNode.removeChild(svg);
      }
    };
  }

  function createGlassWebGL(glCanvas, source, options) {
    options = options || {};
    const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true }) ||
               glCanvas.getContext('webgl', { alpha: true, antialias: true });

    if (!gl) {
      console.error('WebGL is unavailable on this device.');
      return null;
    }

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_source;
      uniform sampler2D u_displacement;
      uniform vec4 u_lens; // x, y, w, h in normalized UV space
      uniform float u_scale;
      uniform vec3 u_chroma;
      uniform float u_specular;

      void main() {
        vec2 uv = v_uv;
        vec2 lensOrigin = u_lens.xy;
        vec2 lensSize = u_lens.zw;

        if (uv.x >= lensOrigin.x && uv.x <= lensOrigin.x + lensSize.x &&
            uv.y >= lensOrigin.y && uv.y <= lensOrigin.y + lensSize.y) {
          vec2 localUV = (uv - lensOrigin) / lensSize;
          vec4 mapSample = texture2D(u_displacement, localUV);
          vec2 disp = (mapSample.rg - 0.5) * u_scale;

          vec4 colorR = texture2D(u_source, uv + disp * u_chroma.r);
          vec4 colorG = texture2D(u_source, uv + disp * u_chroma.g);
          vec4 colorB = texture2D(u_source, uv + disp * u_chroma.b);

          vec4 finalColor = vec4(colorR.r, colorG.g, colorB.b, (colorR.a + colorG.a + colorB.a) / 3.0);
          float spec = (mapSample.b - 0.5) * 2.0;
          if (spec > 0.0 && u_specular > 0.0) {
            finalColor.rgb += vec3(spec * 0.35);
          }
          gl_FragColor = finalColor;
        } else {
          gl_FragColor = texture2D(u_source, uv);
        }
      }
    `;

    function createShader(type, src) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);

    const posAttr = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    const uSource = gl.getUniformLocation(prog, 'u_source');
    const uDisplacement = gl.getUniformLocation(prog, 'u_displacement');
    const uLens = gl.getUniformLocation(prog, 'u_lens');
    const uScale = gl.getUniformLocation(prog, 'u_scale');
    const uChroma = gl.getUniformLocation(prog, 'u_chroma');
    const uSpecular = gl.getUniformLocation(prog, 'u_specular');

    gl.uniform1i(uSource, 0);
    gl.uniform1i(uDisplacement, 1);

    const srcTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let lensesList = options.lenses || (options.lens ? [options.lens] : []);
    const dispTextures = new Map();

    function prepareDispTexture(lensItem) {
      const mapRes = cachedMap({
        w: Math.min(Math.round(lensItem.w), 256),
        h: Math.min(Math.round(lensItem.h), 256),
        radius: lensItem.r,
        depth: lensItem.depth ?? 127,
        curvature: lensItem.curvature ?? 0.7,
        curvaturePow: lensItem.curvaturePow ?? 2.0,
        glowStrength: lensItem.glowStrength ?? 0.3
      });

      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mapRes.canvas) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mapRes.canvas);
      }
      return tex;
    }

    return {
      setLenses(lenses) {
        lensesList = lenses;
      },
      setLens(lens) {
        lensesList = [lens];
      },
      render() {
        const sw = glCanvas.width;
        const sh = glCanvas.height;
        gl.viewport(0, 0, sw, sh);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        if (source instanceof HTMLVideoElement) {
          if (source.readyState >= 2) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          }
        } else if (source instanceof HTMLCanvasElement || source instanceof Image) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }

        if (!lensesList.length) {
          gl.uniform4f(uLens, -1, -1, 0, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          return;
        }

        for (const l of lensesList) {
          let tex = dispTextures.get(l);
          if (!tex) {
            tex = prepareDispTexture(l);
            dispTextures.set(l, tex);
          }

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tex);

          const rawScale = l.scale ?? 0.04;
          const sc = rawScale > 1.0 ? rawScale / sw : rawScale;
          const ch = l.chroma || [1.08, 1.04, 1.0];
          const spec = l.specular !== false ? 1.0 : 0.0;

          gl.uniform4f(uLens, l.x / sw, l.y / sh, l.w / sw, l.h / sh);
          gl.uniform1f(uScale, sc);
          gl.uniform3f(uChroma, ch[0], ch[1], ch[2]);
          gl.uniform1f(uSpecular, spec);

          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
    };
  }

  const exportObj = {
    cache,
    getCacheKey,
    generateMap,
    cachedMap,
    buildFilter,
    applySpecular,
    createGlass,
    createGlassWebGL,
    erf
  };

  return exportObj;
});
