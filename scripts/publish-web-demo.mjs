/**
 * One-command publish for the marketing demo.
 *
 * Builds the browser demo, copies it into mde-server/public/app, then commits
 * and pushes that repository. GitHub Actions publishes public/app to the
 * gh-pages branch (demo app), and Vercel redeploys the site on push.
 *
 * Usage: npm run web:deploy
 * Set MDE_SERVER_DIR if the server checkout is not a sibling directory.
 */
import { spawnSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverRoot = process.env.MDE_SERVER_DIR || path.join(root, '..', 'mde-server');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const target = path.join(serverRoot, 'public', 'app');
const git = 'git';

if (!existsSync(path.join(serverRoot, 'package.json'))) {
  throw new Error(`mde-server not found at ${serverRoot}; set MDE_SERVER_DIR.`);
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. Build the demo with a relative base (works under /app/ and /mde-server/app/).
run(process.execPath, [vite, 'build', '--mode', 'demo', '--base', './', '--outDir', 'dist-app']);

// 2. Replace public/app in the server repo.
await rm(target, { recursive: true, force: true });
await cp(path.join(root, 'dist-app'), target, { recursive: true });

// 3. Commit and push; Actions + Vercel take it from there.
run(git, ['add', 'public/app'], serverRoot);
const message = `chore(site): rebuild demo app (${new Date().toISOString().slice(0, 10)})`;
const commit = spawnSync(git, ['commit', '-m', message], { cwd: serverRoot, stdio: 'inherit' });
if (commit.status !== 0) {
  console.log('Nothing to commit — demo app is already up to date.');
  process.exit(0);
}
run(git, ['push', 'origin', 'main'], serverRoot);
console.log('Pushed. GitHub Actions will publish gh-pages; Vercel will redeploy the site.');
