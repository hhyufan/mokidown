import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'https://fallen-arts-hammer-murray.trycloudflare.com';
const token = readFileSync(process.argv[3] || 'C:/Code/React/mokidown-plugin-incremental-sync/.tools/token.txt', 'utf8').trim();
const content = '# 公网同步测试\n\n经 Cloudflare 隧道上传，再从服务器下载。\n';
const checksum = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
const fileId = `public-${Date.now()}`;

async function req(method, path, body, auth = token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const capabilities = await req('GET', '/capabilities');
const unauthorized = await req('GET', '/sync/manifest', null, null);
const put = await req('PUT', `/sync/file/${fileId}`, {
  fileName: 'public-test.md', originalPath: 'notes/public-test.md', source: 'public-test',
  content, compressed: false, size: Buffer.byteLength(content, 'utf8'), encoding: 'utf8', lineEnding: 'LF',
  checksum, baseRev: 0, mutationId: crypto.randomUUID(),
});
const changes = await req('GET', '/sync/changes?cursor=0&limit=50');
const pulled = await req('GET', `/sync/file/${fileId}`);
const blocked = await req('GET', '/api/secrets');

console.log(JSON.stringify({
  base,
  capabilities: capabilities.status,
  unauthorized: unauthorized.status,
  put: put.status,
  changes: changes.status,
  download: pulled.status,
  roundTrip: pulled.data?.content === content,
  preview: typeof pulled.data?.content === 'string' ? pulled.data.content.slice(0, 32) : pulled.data,
  blockedPath: blocked.status,
}, null, 2));
