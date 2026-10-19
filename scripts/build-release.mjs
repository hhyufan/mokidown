/**
 * Unified release build: one command produces the branded React installer and
 * refreshes the website demo bundle (dist-app + site assets).
 *
 *   npm run tauri build            → React installer + dist-app
 *   npm run tauri build -- --app   → raw Tauri build (debugging only)
 *
 * NSIS is only the silent payload embedded inside the branded installer; the
 * MSI target is no longer built.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

function run(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
}

run('scripts/sync-version.mjs');
const appConfig = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = appConfig.version;
const updaterArtifacts = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);

// 1) Application build. NSIS stays as the silent payload only.
run('scripts/tauri.mjs', [
  'build',
  '--bundles',
  'nsis',
  '--config',
  JSON.stringify({ bundle: { createUpdaterArtifacts: updaterArtifacts } }),
]);

const payload = path.join(
  root,
  `src-tauri/target/release/bundle/nsis/mokidown_${version}_x64-setup.exe`,
);

// 2) Branded installer (React) with the payload embedded.
run('node_modules/vite/bin/vite.js', ['build', '--config', 'installer/vite.config.mjs']);
run(path.join(root, 'scripts/react-installer.mjs'), ['build', '--no-bundle'], {
  env: { ...process.env, MOKI_INSTALLER_PAYLOAD: payload },
});

const output = path.join(root, 'src-tauri/target/release/react');
await mkdir(output, { recursive: true });
const destination = path.join(output, `MokiDown_${version}_x64-setup.exe`);
await rm(`${destination}.sig`, { force: true });
await rm(path.join(output, 'latest.json'), { force: true });
await copyFile(
  path.join(root, 'src-tauri/target/react-installer/release/mokidown-installer.exe'),
  destination,
);
console.log(`React installer: ${destination}`);

// 3) Website demo (dist-app + mde-server site assets).
run(path.join(root, 'scripts/build-web-demo.mjs'));
