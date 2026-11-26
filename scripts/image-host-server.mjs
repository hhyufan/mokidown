/**
 * 本地调试用图床：接收 multipart 图片，保存到 image-host-uploads/，
 * 返回 { data: { url } }，并通过 /images/<name> 提供静态访问。
 *
 * 运行：node scripts/image-host-server.mjs
 * 端口：默认 3000，可用 PORT 环境变量覆盖。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const UPLOAD_DIR = join(process.cwd(), 'image-host-uploads');
const MAX_BYTES = 20 * 1024 * 1024;

const MIME = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

await mkdir(UPLOAD_DIR, { recursive: true });

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('Image is larger than 20 MB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** 从 multipart body 里取出文件字段（足够本地调试使用）。 */
function parseMultipartFile(body, contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!match) throw new Error('Missing multipart boundary');
  const boundary = `--${match[1]}`;
  const parts = body.toString('latin1').split(boundary);
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    if (!/name="file"/i.test(headers) || !/filename="/i.test(headers)) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const dataStart = headerEnd + 4;
    const dataEnd = part.lastIndexOf('\r\n');
    const data = Buffer.from(part.slice(dataStart, dataEnd > dataStart ? dataEnd : undefined), 'latin1');
    return {
      filename: filenameMatch?.[1] || 'image.png',
      contentType: typeMatch?.[1]?.trim() || 'application/octet-stream',
      data,
    };
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      sendJson(response, 200, {
        ok: true,
        upload: `http://${HOST}:${PORT}/upload`,
        note: 'POST multipart/form-data with a "file" field.',
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/upload') {
      const body = await readBody(request);
      const file = parseMultipartFile(body, request.headers['content-type']);
      if (!file || !file.data.length) {
        sendJson(response, 400, { message: 'Missing file field' });
        return;
      }
      const extension = extname(file.filename).toLowerCase() || '.png';
      const name = `${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
      await writeFile(join(UPLOAD_DIR, name), file.data);
      const url = `http://${HOST}:${PORT}/images/${encodeURIComponent(name)}`;
      console.log(`[image-host] saved ${name} (${file.data.length} bytes)`);
      sendJson(response, 200, { data: { url } });
      return;
    }

    if (request.method === 'GET' && request.url.startsWith('/images/')) {
      const name = decodeURIComponent(request.url.slice('/images/'.length));
      const target = normalize(join(UPLOAD_DIR, name));
      if (!target.startsWith(UPLOAD_DIR)) {
        sendJson(response, 403, { message: 'Forbidden' });
        return;
      }
      try {
        await stat(target);
      } catch {
        sendJson(response, 404, { message: 'Not found' });
        return;
      }
      const data = await readFile(target);
      response.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': data.length,
        'access-control-allow-origin': '*',
      });
      response.end(data);
      return;
    }

    sendJson(response, 404, { message: 'Not found' });
  } catch (error) {
    console.error('[image-host]', error);
    sendJson(response, 500, { message: String(error?.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[image-host] http://${HOST}:${PORT}/upload -> ${UPLOAD_DIR}`);
});
