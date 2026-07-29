export function createGlass(container) {
  const g = document.createElement('div');
  g.className = 'glass-layer';
  g.style.cssText = 'position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,0.2);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);pointer-events:none';
  container.style.position = 'relative';
  container.prepend(g);
  return g;
}

export function glassify(el) {
  el.style.position = 'relative';
  el.style.background = 'rgba(255,255,255,0.2)';
  el.style.backdropFilter = 'blur(12px)';
  el.style.webkitBackdropFilter = 'blur(12px)';
}

export default { createGlass, glassify };
