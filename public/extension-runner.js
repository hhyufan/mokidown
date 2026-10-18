// This generic bootstrap runs inside an opaque-origin, disposable iframe.
let started = false;
window.addEventListener('message', (event) => {
  if (started || event.source !== parent || event.data?.type !== 'mokidown:extension-bootstrap'
    || typeof event.data.script !== 'string' || event.data.script.length > 1024 * 1024) return;
  started = true;
  // Create the script URL inside this realm; an opaque iframe cannot load a
  // blob URL owned by the parent window.
  const source = URL.createObjectURL(new Blob([event.data.script], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.src = source;
  script.onload = script.onerror = () => URL.revokeObjectURL(source);
  document.head.append(script);
});
parent.postMessage({ type: 'mokidown:extension-runner-ready' }, '*');
