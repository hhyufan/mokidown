import http from 'node:http';
import crypto from 'node:crypto';

// Minimal sync server matching the API the incremental-sync plugin calls:
//   GET    /capabilities
//   PUT    /sync/file/:fileId
//   GET    /sync/file/:fileId
//   GET    /sync/changes?cursor=&limit=
//   DELETE /sync/file/:fileId
const store = new Map();
let rev = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : null;
    if (url.pathname === '/capabilities') {
      return send(200, { name: 'mock-sync', version: '1.0.0', capabilities: ['incremental-sync'] });
    }
    const fileMatch = url.pathname.match(/^\/sync\/file\/(.+)$/);
    if (fileMatch) {
      const fileId = decodeURIComponent(fileMatch[1]);
      if (req.method === 'PUT') {
        rev += 1;
        store.set(fileId, { ...body, fileId, rev, updatedAt: Date.now() });
        return send(200, { fileId, rev });
      }
      if (req.method === 'GET') {
        const entry = store.get(fileId);
        return entry ? send(200, entry) : send(404, { message: 'Not found' });
      }
      if (req.method === 'DELETE') {
        store.delete(fileId);
        return send(200, { ok: true });
      }
    }
    if (url.pathname === '/sync/changes') {
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const limit = Number(url.searchParams.get('limit') || 25);
      const changes = [...store.values()]
        .filter((entry) => entry.rev > cursor)
        .slice(0, limit)
        .map((entry) => ({ fileId: entry.fileId, path: entry.originalPath, rev: entry.rev, deleted: false }));
      return send(200, { changes, cursor: rev });
    }
    send(404, { message: 'Not found' });
  });
});

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const content = '# 插件同步测试\n\n由 mock 服务器承接上传与下载。\n';
  const checksum = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const fileId = 'plugin-test-1';

  const put = await fetch(`${base}/sync/file/${fileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'plugin-test.md', originalPath: 'notes/plugin-test.md', source: 'test',
      content, compressed: false, size: Buffer.byteLength(content), checksum, baseRev: 0,
      mutationId: crypto.randomUUID(),
    }),
  }).then((r) => r.json());

  const changes = await fetch(`${base}/sync/changes?cursor=0&limit=25`).then((r) => r.json());
  const pulled = await fetch(`${base}/sync/file/${fileId}`).then((r) => r.json());
  const caps = await fetch(`${base}/capabilities`).then((r) => r.json());

  console.log(JSON.stringify({
    base,
    capabilities: caps,
    put,
    changes,
    roundTrip: pulled.content === content,
    pulledPreview: pulled.content?.slice(0, 40),
  }, null, 2));
  server.close();
});
