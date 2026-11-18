// Also installed by WebView2 before cross-origin frame documents are parsed.
// Wait for an explicit handshake so unrelated frames keep their own appearance.
(() => {
  if (window.parent === window || window.__mokiPreviewBridge) return;
  window.__mokiPreviewBridge = true;
  let enabled = false;
  let opacity = 0.38;
  let frame = 0;
  const pending = new Map();
  const originals = new WeakMap();
  const painted = new Set();
  const properties = ['background-color', 'background-image'];
  const transparentColor = (color, factor) => {
    // Chromium serializes computed sRGB colors to rgb()/rgba(). color-mix
    // also handles wide gamut colors without changing their hue.
    return `color-mix(in srgb, ${color} ${factor * 100}%, transparent)`;
  };
  const restore = (element, saved) => {
    for (const property of properties) {
      const current = element.style.getPropertyValue(property);
      if (current !== saved.applied[property]) {
        saved.original[property] = [current, element.style.getPropertyPriority(property)];
      }
      const [value, priority] = saved.original[property];
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
  };
  const paint = (element) => {
    if (!element.style || /^(SCRIPT|STYLE|LINK|META)$/.test(element.tagName)) return;
    let saved = originals.get(element);
    if (saved) restore(element, saved);
    if (!enabled) {
      originals.delete(element);
      painted.delete(element);
      return;
    }
    saved ||= {
      original: Object.fromEntries(properties.map((property) => [property,
        [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]])),
      applied: {},
    };
    const computed = getComputedStyle(element);
    const isRoot = element === document.documentElement || element === document.body;
    const color = computed.backgroundColor;
    const image = computed.backgroundImage;
    element.style.setProperty('background-color', isRoot ? 'transparent' : transparentColor(color, opacity), 'important');
    // Preserve actual pictures; only soften the color stops of painted gradients.
    if (/gradient\(/.test(image)) element.style.setProperty('background-image', image.replace(
      /rgba?\([^)]*\)|color\([^)]*\)/g, (stop) => transparentColor(stop, opacity)), 'important');
    for (const property of properties) saved.applied[property] = element.style.getPropertyValue(property);
    saved.cssText = element.style.cssText;
    originals.set(element, saved);
    painted.add(element);
    if (element.shadowRoot) observe(element.shadowRoot);
  };
  const queue = (root, subtree = true) => {
    if (root) pending.set(root, pending.get(root) || subtree);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const roots = [...pending];
      pending.clear();
      // A document-wide stylesheet update subsumes all smaller requests.
      const work = roots.some(([root, deep]) => root === document && deep) ? [[document, true]] : roots;
      for (const [root, deep] of work) {
        if (root.nodeType === 1) paint(root);
        if (deep) root.querySelectorAll?.('*').forEach(paint);
      }
    });
  };
  const observer = new MutationObserver((records) => {
    if (!enabled) return;
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => queue(node));
        if (record.target.nodeName === 'STYLE') queue(document.documentElement);
      } else if (record.attributeName !== 'style' || originals.get(record.target)?.cssText !== record.target.style.cssText) {
        queue(record.target);
      }
    }
  });
  const observed = new WeakSet();
  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    queue(root);
  }
  const send = (data) => window.parent.postMessage(data, '*');
  const relay = (data) => document.querySelectorAll('iframe').forEach((iframe) => iframe.contentWindow?.postMessage(data, '*'));
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== 'mokidown:preview-theme') return;
    enabled = event.data.enabled === true;
    opacity = Math.max(0, Math.min(1, Number(event.data.opacity) || 0.38));
    if (enabled) observe(document);
    else painted.forEach((element) => { paint(element); });
    queue(document);
    relay(event.data);
  });
  // Re-evaluate hover/focus surfaces while retaining the site's text and artwork.
  for (const name of ['pointerover', 'pointerout', 'focusin', 'focusout']) document.addEventListener(name, (event) => {
    if (!enabled) return;
    let element = event.target;
    while (element?.nodeType === 1) { pending.set(element, pending.get(element) || false); element = element.parentElement; }
    queue(null);
  }, true);
  document.addEventListener('load', (event) => {
    if (enabled && event.target?.tagName === 'LINK') queue(document);
  }, true);
  const ready = () => send({ type: 'mokidown:preview-ready' });
  window.addEventListener('DOMContentLoaded', ready, { once: true });
  ready();
})();
