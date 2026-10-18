/**
 * Build the marketing site bundle for mde-server.
 *
 * Two outputs end up in `mde-server/src/site`:
 *   - moki-site.js / moki-site.css  — the five feature sections (installer components)
 *   - app/                          — the real app built with `--mode demo`, embedded
 *                                     by the homepage in an iframe
 *
 * Set MDE_SERVER_DIR when the server checkout is not a sibling of this repo.
 */
import { spawnSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverRoot = process.env.MDE_SERVER_DIR || path.join(root, '..', 'mde-server');
const siteDir = path.join(serverRoot, 'src', 'site');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(path.join(serverRoot, 'package.json'))) {
  throw new Error(`mde-server not found at ${serverRoot}; set MDE_SERVER_DIR.`);
}

function run(args) {
  const result = spawnSync(process.execPath, [vite, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. Feature sections (React components reused from the installer).
run(['build', '--config', 'site/vite.config.mjs']);
await cp(path.join(root, 'site', 'dist', 'moki-site.js'), path.join(siteDir, 'moki-site.js'));
await cp(path.join(root, 'site', 'dist', 'moki-site.css'), path.join(siteDir, 'moki-site.css'));

// 2. The real application, built for the browser demo (/app).
run(['build', '--mode', 'demo', '--base', '/app/', '--outDir', 'dist-app']);
await rm(path.join(siteDir, 'app'), { recursive: true, force: true });
await cp(path.join(root, 'dist-app'), path.join(siteDir, 'app'), { recursive: true });

console.log(`Web demo bundle written to ${siteDir}`);
