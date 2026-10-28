// Sync only the five marketing feature scenes, without rebuilding the app demo.
import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = path.resolve(process.env.MDE_SERVER_DIR || path.join(root, '..', 'mde-server'));
await access(path.join(server, 'package.json'));
const targets = [path.join(server, 'src', 'site'), path.join(server, 'public')];
for (const target of targets) await access(target);
for (const name of ['moki-site.js', 'moki-site.css']) {
  const source = path.join(root, 'site', 'dist', name);
  await access(source);
  for (const target of targets) await cp(source, path.join(target, name));
}
console.log(`Synced five feature scenes to ${server} (src/site and public).`);
