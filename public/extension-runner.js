// This generic bootstrap runs inside an opaque-origin, disposable iframe.
let started = false;
const report = (message) => parent.postMessage({ type: 'mokidown:extension-error', message: String(message).slice(0, 500) }, '*');
window.addEventListener('error', (event) => { if (started) report(event.message || '插件脚本加载失败'); });
window.addEventListener('unhandledrejection', (event) => { if (started) report(event.reason?.message || event.reason || '插件异步执行失败'); });
window.addEventListener('message', (event) => {
  if (started || event.source !== parent || event.data?.type !== 'mokidown:extension-bootstrap'
    || typeof event.data.script !== 'string' || event.data.script.length > 1024 * 1024) return;
  started = true;
  // Create the script URL inside this realm; an opaque iframe cannot load a
  // blob URL owned by the parent window.
  const source = URL.createObjectURL(new Blob([event.data.script], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.src = source;
  script.onload = () => URL.revokeObjectURL(source);
  script.onerror = () => { URL.revokeObjectURL(source); report('插件脚本加载失败'); };
  document.head.append(script);
});
parent.postMessage({ type: 'mokidown:extension-runner-ready' }, '*');
