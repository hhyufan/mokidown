import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--reuse-app')) {
  throw new Error('Reusing an old application can embed stale updater settings. Build the current app instead.');
}
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
const certificateThumbprint = process.env.MOKI_WINDOWS_CERT_THUMBPRINT?.trim();
if (certificateThumbprint && !/^[a-f\d]{40}$/i.test(certificateThumbprint)) {
  throw new Error('MOKI_WINDOWS_CERT_THUMBPRINT must be a Windows certificate SHA-1 thumbprint.');
}
const bundle = { createUpdaterArtifacts: updaterArtifacts };
if (certificateThumbprint) bundle.windows = {
  certificateThumbprint, digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com',
};
run('scripts/tauri.mjs', [
  'build',
  '--bundles',
  args.includes('--with-msi') ? 'nsis,msi' : 'nsis',
  '--config',
  JSON.stringify({ bundle }),
]);
const payload = path.join(
  root,
  `src-tauri/target/release/bundle/nsis/mokidown_${version}_x64-setup.exe`,
);
run('node_modules/vite/bin/vite.js', ['build', '--config', 'installer/vite.config.mjs']);
run(path.join(root, 'scripts/react-installer.mjs'), ['build', '--no-bundle'], {
  env: { ...process.env, MOKI_INSTALLER_PAYLOAD: payload },
});
// The branded React installer is the only release artifact. The NSIS bundle
// above is merely the payload embedded into it, so it stays where the bundler
// writes it.
const output = path.join(root, 'src-tauri/target/release/react');
await mkdir(output, { recursive: true });
const destination = path.join(output, `MokiDown_${version}_x64-setup.exe`);
// Rebuilding changes the signed bytes. Never leave an older signature/manifest
// next to the replacement executable, including when the copy fails.
await rm(`${destination}.sig`, { force: true });
await rm(path.join(output, 'latest.json'), { force: true });
const builtInstaller = path.join(root, 'src-tauri/target/react-installer/release/mokidown-installer.exe');
if (certificateThumbprint) {
  const staging = path.join(output, `MokiDown-signing-${process.pid}.exe`);
  try {
    await copyFile(builtInstaller, staging);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/sign-windows-installer.ps1'),
      '-InstallerPath', staging, '-Thumbprint', certificateThumbprint], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Authenticode signing failed for the branded installer.');
    await rename(staging, destination);
  } finally {
    await rm(staging, { force: true });
  }
} else {
  await copyFile(builtInstaller, destination);
  if (!process.env.CI) {
    console.warn('The local installer has no Windows code signature. SmartScreen may warn about this build.');
  }
}
console.log(`React installer: ${destination}`);
