import crypto from 'node:crypto';

const base = 'https://www.miaogu.xyz';
const email = `sync-test-${Date.now()}@example.com`;
const password = 'TestPass12345';
const username = 'Sync Tester';
const fileId = `test-${Date.now()}`;
const content = '# 同步测试\n\n这是一次上传/下载往返测试。\n';
const checksum = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

async function req(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const out = {};
out.register = await req('POST', '/auth/register', { email, username, password });
let token = out.register.data?.access_token || out.register.data?.accessToken || out.register.data?.token;
out.login = await req('POST', '/auth/login', { email, password });
token = token || out.login.data?.access_token || out.login.data?.accessToken || out.login.data?.token;
if (!token) {
  console.log(JSON.stringify({ register: out.register, login: out.login }, null, 2));
  process.exit(1);
}
out.put = await req('PUT', `/sync/file/${fileId}`, {
  fileName: 'sync-test.md', originalPath: 'C:/tmp/sync-test.md', source: 'test',
  content, compressed: false, size: content.length, encoding: 'utf8', lineEnding: 'LF',
  checksum, baseRev: 0, mutationId: crypto.randomUUID(),
}, token);
out.manifest = await req('GET', '/sync/manifest', null, token);
out.pull = await req('GET', `/sync/file/${fileId}`, null, token);
const pulled = out.pull.data?.content ?? out.pull.data?.file?.content ?? null;
console.log(JSON.stringify({
  registerStatus: out.register.status,
  loginStatus: out.login.status,
  putStatus: out.put.status,
  putBody: out.put.status >= 400 ? out.put.data : undefined,
  manifestStatus: out.manifest.status,
  manifestCount: Array.isArray(out.manifest.data) ? out.manifest.data.length : out.manifest.data?.length,
  pullStatus: out.pull.status,
  roundTrip: pulled === content,
  pulledPreview: typeof pulled === 'string' ? pulled.slice(0, 48) : out.pull.data,
}, null, 2));
