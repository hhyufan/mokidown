// WebView2 installs this in cross-origin documents. Each preview opts in.
(() => {
  const native = window.parent === window && window.__mokiNativePreview === true;
  if (window.__mokiPreviewBridge || (window.parent === window && !native)) return;
  window.__mokiPreviewBridge = true;

  const marker = 'data-moki-preview-surface';
  const overlaySelector = [
    'dialog', '[popover]', '[aria-modal="true"]',
    '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[role="tooltip"]',
    '.notif', '.monaco-context-menu', '.ant-notification-notice', '.ant-message-notice-content',
    '.ant-modal-content', '.ant-drawer-content', '.ant-popover-inner', '.ant-tooltip-inner',
    '.ant-dropdown-menu', '.ant-select-dropdown',
    '.search-overlay > .search-box', '.settings-overlay > .settings-card',
    '.search-dropdown__panel', '.search-dropdown__scope-menu', '.footer__dropdown', '.sort-dropdown',
  ].join(',');
  const backdropSelector = '.search-overlay, .settings-overlay, .ant-modal-mask, .ant-drawer-mask';
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const pending = new Map();
  const scopes = new Map();
  const ids = new WeakMap();
  const floatingSurfaces = new WeakSet();
  let nextId = 0;
  let frame = 0;
  let settings;
  let reportedTheme;
  let colorContext;
  let reportedPage = '';
  let wallpaper;
  let wallpaperVersion = 0;

  function updateWallpaper(theme) {
    if (!wallpaper) return;
    const { host, canvas, mask, placement } = wallpaper;
    host.hidden = !settings?.enabled || !placement || !canvas.width;
    if (host.hidden) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.append(host);
    const scale = devicePixelRatio || 1;
    canvas.style.left = `${placement.x / scale}px`;
    canvas.style.top = `${placement.y / scale}px`;
    canvas.style.width = `${placement.width / scale}px`;
    canvas.style.height = `${placement.height / scale}px`;
    mask.style.backgroundColor = mix(theme === 'dark' ? '#181818' : '#fff', settings[theme]);
  }

  function createWallpaper() {
    const host = document.createElement('div');
    host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:-2147483647!important;overflow:hidden!important;pointer-events:none!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.style.cssText = 'position:absolute;display:block';
    const mask = document.createElement('div');
    mask.style.cssText = 'position:absolute;inset:0';
    shadow.append(canvas, mask);
    return { host, canvas, mask };
  }

  const send = (data) => { if (!native) window.parent.postMessage(data, '*'); };
  const httpUrl = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch { return null; }
  };
  const mix = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  const clearColor = (color) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/;

  function colorChannels(color) {
    const match = color.match(rgb);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
    if (color === 'transparent') return [0, 0, 0, 0];
    // Modern color spaces also occur in computed page styles.
    colorContext ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!colorContext) return null;
    colorContext.globalCompositeOperation = 'copy';
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
    return [r, g, b, alpha / 255];
  }

  function brightness(color, minAlpha = 0) {
    const channels = colorChannels(color);
    if (!channels || channels[3] < minAlpha) return null;
    const [r, g, b] = channels;
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }

  function pageAppearance() {
    const html = document.documentElement;
    const root = getComputedStyle(html);
    const body = document.body ? getComputedStyle(document.body) : root;
    const supported = root.colorScheme.split(/\s+/)
      .filter((scheme) => scheme === 'light' || scheme === 'dark');
    const explicit = html.dataset.theme || document.body?.dataset.theme;
    const background = brightness(body.backgroundColor, 0.5) ?? brightness(root.backgroundColor, 0.5);
    const foreground = brightness(body.color);
    let theme;
    if (explicit === 'light' || explicit === 'dark') theme = explicit;
    else if (supported.length === 1) [theme] = supported;
    else if (background !== null) theme = background < 128 ? 'dark' : 'light';
    else if (foreground !== null) theme = foreground > 145 ? 'dark' : 'light';
    else theme = preference.matches && supported.includes('dark') ? 'dark' : 'light';

    // Some sites follow the dark media query without declaring color-scheme.
    // Match their canvas to the iframe without changing that media query.
    const declareScheme = !supported.length && theme === 'dark' && preference.matches;
    const scheme = declareScheme || supported.length > 1 ? 'light dark' : supported[0] || 'light';
    return { theme, scheme, declareScheme };
  }

  function observeScope(root) {
    if (scopes.has(root)) return scopes.get(root);
    const sheet = new CSSStyleSheet();
    const scope = { sheet, rules: new Map(), dirty: false };
    scopes.set(root, scope);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    return scope;
  }

  function insideOverlay(element) {
    for (let owner = element.parentElement || element.getRootNode().host; owner;
      owner = owner.parentElement || owner.getRootNode().host) {
      if (floatingSurfaces.has(owner) || owner.matches(overlaySelector)) return true;
    }
    return false;
  }

  function isFloatingPanel(element, style) {
    if (style.boxShadow === 'none' && (style.backdropFilter === 'none' || style.borderRadius === '0px')) return false;
    const positioned = (computed) => (computed.position === 'fixed' || computed.position === 'absolute')
      && Number(computed.zIndex) > 0;
    // Custom modals often put positioning and z-index on a full-screen wrapper
    // while the actual card carries the shadow and background.
    const parent = element.parentElement;
    if (!positioned(style) && !(parent && positioned(getComputedStyle(parent)))) return false;
    if (clearColor(style.backgroundColor) && style.backdropFilter === 'none') return false;
    const { width, height } = element.getBoundingClientRect();
    return width > 0 && height > 0 && (width < innerWidth - 2 || height < innerHeight - 2);
  }

  function opaqueOverlayColor(color, theme) {
    const channels = colorChannels(color);
    if (!channels || channels[3] === 1) return '';
    const base = theme === 'dark' ? 24 : 255;
    const alpha = channels[3];
    const opaque = channels.slice(0, 3).map((value) => Math.round(value * alpha + base * (1 - alpha)));
    return `rgb(${opaque.join(', ')})`;
  }

  function sample(element, theme, declareScheme) {
    if (!element.style || /^(SCRIPT|STYLE|LINK|META)$/.test(element.tagName)) return;
    const scope = observeScope(element.getRootNode());
    const style = getComputedStyle(element);
    const explicitOverlay = element.matches(overlaySelector);
    const inOverlay = !explicitOverlay && insideOverlay(element);
    const backdrop = element.matches(backdropSelector);
    const isOverlay = explicitOverlay || (!backdrop && !inOverlay && isFloatingPanel(element, style));
    if (isOverlay) floatingSurfaces.add(element);
    else floatingSurfaces.delete(element);
    if (backdrop || inOverlay) {
      if (scope.rules.delete(element)) {
        element.removeAttribute(marker);
        scope.dirty = true;
      }
      return;
    }
    const transition = style.transitionDuration === '0s' ? undefined
      : element.getAnimations?.().find((animation) => animation.transitionProperty === 'background-color');
    const color = transition?.effect?.getKeyframes().at(-1)?.backgroundColor || style.backgroundColor;
    const isRoot = element === document.documentElement;
    const isBody = element === document.body;
    const soften = (value) => mix(value, 38);
    const wash = native && isRoot && (!wallpaper || wallpaper.host.hidden)
      ? mix(theme === 'dark' ? '#181818' : '#fff', settings[theme]) : '';
    const paintedColor = isOverlay ? opaqueOverlayColor(color, theme)
      : wash ||
        (isRoot || isBody ? 'transparent' : clearColor(color) ? '' : soften(color));
    const image = style.backgroundImage;
    // Preserve actual images and soften the computed color stops of gradients.
    const paintedImage = !isOverlay && /gradient\(/.test(image) ? image.replace(
      /rgba?\([^)]*\)|color\([^)]*\)/g, soften,
    ) : '';
    let rule = '';
    if (paintedColor || paintedImage) {
      let id = ids.get(element);
      if (!id) { id = ++nextId; ids.set(element, id); }
      if (element.getAttribute(marker) !== String(id)) element.setAttribute(marker, id);
      const declarations = [!native && isRoot && declareScheme && 'color-scheme:light dark!important',
        paintedColor && `background-color:${paintedColor}!important`,
        paintedImage && `background-image:${paintedImage}!important`].filter(Boolean).join(';');
      // The deliberately unmatchable branch raises specificity for authored
      // !important rules without changing the matched element set.
      rule = `:is([${marker}="${id}"],#moki-preview-a#moki-preview-b#moki-preview-c){${declarations}}`;
    }
    if (rule === (scope.rules.get(element) || '')) return;
    if (rule) scope.rules.set(element, rule);
    else { scope.rules.delete(element); element.removeAttribute(marker); }
    scope.dirty = true;
  }

  function flush() {
    frame = 0;
    const work = pending.has(document) ? [[document, true]] : [...pending];
    pending.clear();
    if (!settings?.enabled || !document.documentElement) return;

    // Read the site's current styles without our previous color snapshot.
    // All reads and the final stylesheet update happen before the same paint.
    for (const { sheet } of scopes.values()) sheet.disabled = true;
    const visited = new Set();
    try {
      const { theme, scheme, declareScheme } = pageAppearance();
      updateWallpaper(theme);
      if (theme !== reportedTheme?.theme || scheme !== reportedTheme?.scheme) {
        reportedTheme = { theme, scheme };
        send({ type: 'mokidown:preview-scheme', theme, scheme });
      }
      const visit = (element) => {
        if (element === wallpaper?.host || visited.has(element) || !element.isConnected) return;
        visited.add(element);
        sample(element, theme, declareScheme);
        element.shadowRoot?.querySelectorAll('*').forEach(visit);
      };
      visit(document.documentElement);
      if (document.body) visit(document.body);
      for (const [root, deep] of work) {
        if (root.nodeType === 1) visit(root);
        if (deep) root.querySelectorAll?.('*').forEach(visit);
      }
    } finally {
      for (const [root, scope] of scopes) {
        const { sheet, rules } = scope;
        for (const element of rules.keys()) {
          if (element.isConnected && element.getRootNode() === root) continue;
          rules.delete(element);
          scope.dirty = true;
        }
        if (!root.host || root.host.isConnected) {
          if (scope.dirty) sheet.replaceSync([...rules.values()].join('\n'));
          sheet.disabled = false;
          scope.dirty = false;
          if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        } else {
          root.adoptedStyleSheets = root.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
          scopes.delete(root);
        }
      }
    }
  }

  function queue(root, deep = true) {
    if (!settings?.enabled || !root) return;
    pending.set(root, pending.get(root) || deep);
    if (!frame) frame = requestAnimationFrame(flush);
  }

  const observer = new MutationObserver((records) => {
    for (const { type, target, attributeName, addedNodes } of records) {
      if (attributeName === marker || target === wallpaper?.host) continue;
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (element?.closest('head, style, link, meta')) queue(document);
      else if (type === 'attributes') queue(element);
      else if (type === 'childList') {
        queue(target, false);
        for (const node of addedNodes) if (node.nodeType === 1) queue(node);
      }
    }
  });

  function reset() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    pending.clear();
    for (const [root, { sheet, rules }] of scopes) {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
      for (const element of rules.keys()) element.removeAttribute(marker);
    }
    scopes.clear();
  }

  // iframe context menus do not bubble into the parent view.
  document.addEventListener('contextmenu', (event) => {
    if (native) return;
    event.preventDefault();
    send({ type: 'mokidown:preview-contextmenu', x: event.clientX, y: event.clientY });
  }, true);

  function applySettings(next) {
    settings = typeof CSSStyleSheet.prototype.replaceSync === 'function' ? next : { ...next, enabled: false };
    reportedTheme = undefined;
    if (settings.enabled) {
      observeScope(document);
      queue(document);
    } else reset();
    document.querySelectorAll('iframe').forEach((iframe) => iframe.contentWindow?.postMessage(settings, '*'));
    reportPage(true);
  }
  if (native) {
    window.__mokiSetNativePreview = async (appearance, placement, image) => {
      wallpaper ||= createWallpaper();
      wallpaper.placement = placement;
      if (image === undefined && settings?.enabled === appearance.enabled && settings?.light === appearance.light
        && settings?.dark === appearance.dark) {
        updateWallpaper(reportedTheme?.theme || 'light');
        return;
      }
      applySettings({ ...appearance, type: 'mokidown:preview-theme' });
      if (image !== undefined) {
        const version = ++wallpaperVersion;
        if (image) {
          const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes]));
          try {
            if (version === wallpaperVersion) {
              wallpaper.canvas.width = bitmap.width;
              wallpaper.canvas.height = bitmap.height;
              wallpaper.canvas.getContext('2d').drawImage(bitmap, 0, 0);
            }
          } finally { bitmap.close(); }
        } else wallpaper.canvas.width = 0;
        if (version !== wallpaperVersion) return;
        queue(document);
      }
      if (frame) {
        cancelAnimationFrame(frame);
        flush();
      }
      if (!settings.enabled) wallpaper.host.remove();
    };
    window.addEventListener('resize', () => updateWallpaper(reportedTheme?.theme || 'light'));
  } else window.addEventListener('message', (event) => {
    if (event.source === window.parent && event.data?.type === 'mokidown:preview-theme') applySettings(event.data);
  });

  function reportPage(force = false) {
    if (!settings) return;
    const links = [...(document.head?.querySelectorAll('link[rel][href]') || [])];
    const icons = ['icon', 'apple-touch-icon', 'mask-icon'].flatMap((rel) => links
      .filter((link) => link.rel.toLowerCase().split(/\s+/).includes(rel)).map((link) => link.href)).slice(0, 8);
    const url = location.href;
    const next = JSON.stringify([url, icons]);
    if (force || reportedPage !== next) send({ type: 'mokidown:preview-page', url, icons });
    reportedPage = next;
  }

  function followLink(event) {
    if (!settings?.captureLinks || !event.isTrusted || event.defaultPrevented || event.button > 1) return;
    const anchor = event.composedPath().find((element) => element.matches?.('a[href]'));
    if (!anchor || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    const url = httpUrl(typeof anchor.href === 'string' ? anchor.href : href);
    if (!url) return;
    const target = (anchor.target || document.querySelector('base[target]')?.target || '_self').toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const mode = modifier && event.altKey ? 'split'
      : modifier || event.shiftKey || event.button === 1 || target !== '_self' ? 'tab' : 'current';
    if (mode === 'current' && (href.trim().startsWith('#')
      || (url.hash && url.href.split('#')[0] === location.href.split('#')[0]))) return;
    event.preventDefault();
    send({ type: 'mokidown:preview-link', url: url.href, mode, activate: !(modifier || event.button === 1) || event.shiftKey });
  }

  window.addEventListener('click', followLink);
  window.addEventListener('auxclick', followLink);
  window.addEventListener('hashchange', () => reportPage());
  window.addEventListener('popstate', () => reportPage());
  window.navigation?.addEventListener('currententrychange', () => reportPage());

  const openWindow = window.open;
  window.open = function (url, target, features) {
    const destination = typeof url === 'string' && url.trim() ? httpUrl(url) : null;
    if (settings?.captureLinks && destination && navigator.userActivation?.isActive
      && !['_self', '_parent', '_top'].includes(String(target).toLowerCase())) {
      send({ type: 'mokidown:preview-link', url: destination.href, mode: 'tab', activate: true });
      return null;
    }
    return openWindow.call(window, url, target, features);
  };

  for (const name of ['pointerover', 'pointerout', 'focusin', 'focusout']) document.addEventListener(name, (event) => {
    for (const node of event.composedPath()) if (node.nodeType === 1) queue(node, false);
  }, true);
  preference.addEventListener('change', () => queue(document));
  document.addEventListener('change', () => queue(document), true);
  document.addEventListener('load', (event) => {
    if (event.target?.tagName === 'LINK') queue(document);
    if (event.target?.tagName === 'IFRAME' && settings) event.target.contentWindow?.postMessage(settings, '*');
  }, true);

  const ready = () => send({ type: 'mokidown:preview-ready' });
  const observeIcons = () => {
    if (!document.head) return;
    new MutationObserver(() => reportPage()).observe(document.head, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel', 'sizes'],
    });
    reportPage();
  };
  window.addEventListener('DOMContentLoaded', ready, { once: true });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', observeIcons, { once: true });
  else observeIcons();
  ready();
})();
