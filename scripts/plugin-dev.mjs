import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagePlugin } from './lib/package-plugin.mjs';

export async function createPluginDevServer(directory, { port = 3141, watchFiles = true } = {}) {
  const project = resolve(directory);
  let current, error, building = false, again = false, stopped = false, timer;
  const rebuild = async () => {
    if (stopped) return;
    if (building) { again = true; return; }
    building = true;
    try { current = await packagePlugin(project); error = null; }
    catch (failure) { error = failure.message; }
    finally { building = false; if (again && !stopped) { again = false; await rebuild(); } }
  };
  await rebuild();
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.headers.origin) {
      try { const origin = new URL(req.headers.origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && !['tauri:', 'asset:'].includes(origin.protocol) && origin.hostname !== 'tauri.localhost') throw Error(); }
      catch { res.writeHead(403); res.end('{}'); return; }
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health' || path === '/') { res.end(JSON.stringify({ sdk: '1.3.0', version: current?.manifest.version, digest: current?.digest, building, error, packagePath: '/package' })); return; }
    if (path !== '/package') { res.writeHead(404); res.end('{}'); return; }
    if (!current || error) { res.writeHead(503); res.end(JSON.stringify({ error: error || 'Building' })); return; }
    res.end(current.text);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  let watcher;
  try {
    if (watchFiles) watcher = watch(project, { recursive: true }, (_event, name) => {
      if (!name || /(^|[\\/])(node_modules|\.git|releases)([\\/]|$)/.test(name)) return;
      clearTimeout(timer); timer = setTimeout(() => void rebuild(), 150);
    });
  } catch (failure) { server.close(); throw failure; }
  return { url: `http://127.0.0.1:${server.address().port}/package`, rebuild,
    close: async () => { stopped = true; clearTimeout(timer); watcher?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: npm run plugin:dev -- <plugin-directory> [--port 3141]');
  const index = process.argv.indexOf('--port');
  const service = await createPluginDevServer(process.argv[2], { port: index < 0 ? 3141 : Number(process.argv[index + 1]) });
  console.log(`MokiDown plugin development: ${service.url}\n在语言服务 → 插件开发中连接此地址。保存代码自动重载；Ctrl+C 退出。`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await service.close(); });
}
