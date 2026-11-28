import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const appOnly = args.includes('--app-only');
const localOutput = process.env.MOKI_WINDOWS_OUTPUT_DIR?.trim();
if (localOutput && !path.isAbsolute(localOutput)) {
  throw new Error('MOKI_WINDOWS_OUTPUT_DIR must be an absolute Windows directory.');
}
if (args.includes('--reuse-app')) {
  throw new Error(
    'Reusing an old application can embed stale updater settings. Build the current app instead.',
  );
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
if (certificateThumbprint)
  bundle.windows = {
    certificateThumbprint,
    digestAlgorithm: 'sha256',
    timestampUrl: 'http://timestamp.digicert.com',
    tsp: true,
  };
const targetDirectory = path.resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target');
const appOutput = path.join(targetDirectory, 'release');
const appExecutable = path.join(appOutput, 'mokidown.exe');

function checkExecutable(file, { verifyOnly = false } = {}) {
  const signingArgs = certificateThumbprint ? ['-Thumbprint', certificateThumbprint] : [];
  const commandArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    path.join(root, 'scripts/windows-executable.ps1'),
    '-ExecutablePath',
    file,
    ...signingArgs,
    ...(verifyOnly ? ['-VerifyOnly'] : []),
  ];
  const commandOptions = { stdio: 'inherit', windowsHide: true };
  let result = spawnSync('pwsh.exe', commandArgs, commandOptions);
  if (result.error?.code === 'ENOENT') {
    result = spawnSync('powershell.exe', commandArgs, commandOptions);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not validate Windows executable: ${file}`);
}

async function writeExecutable(source, destination, options) {
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = path.join(path.dirname(destination), `MokiDown-staging-${randomUUID()}.exe`);
  // Create a new file so it receives the destination directory's integrity label.
  const handle = await open(staging, 'wx');
  try {
    try {
      await handle.writeFile(await readFile(source));
    } finally {
      await handle.close();
    }
    checkExecutable(staging, options);
    await rename(staging, destination);
  } finally {
    await rm(staging, { force: true });
  }
}

run(
  'scripts/tauri.mjs',
  [
    'build',
    ...(appOnly ? ['--no-bundle'] : ['--bundles', args.includes('--with-msi') ? 'nsis,msi' : 'nsis']),
    '--config',
    JSON.stringify({ bundle }),
  ],
  { env: { ...process.env, CARGO_TARGET_DIR: targetDirectory } },
);
// Tauri signs the copy placed in NSIS, then restores the raw executable.
checkExecutable(appExecutable);
const standaloneOutput = localOutput ? path.join(localOutput, 'mokidown.exe') : appExecutable;
if (path.relative(appExecutable, standaloneOutput)) {
  await writeExecutable(appExecutable, standaloneOutput, { verifyOnly: true });
}
if (!certificateThumbprint) {
  console.warn(
    'No Windows code-signing certificate configured. SmartScreen may warn about these local builds.',
  );
}
if (appOnly) {
  console.log(`MokiDown executable: ${standaloneOutput}`);
  process.exit(0);
}
const payload = path.join(appOutput, `bundle/nsis/mokidown_${version}_x64-setup.exe`);
checkExecutable(payload, { verifyOnly: true });
run('node_modules/vite/bin/vite.js', ['build', '--config', 'installer/vite.config.mjs']);
run(path.join(root, 'scripts/react-installer.mjs'), ['build', '--no-bundle'], {
  env: { ...process.env, MOKI_INSTALLER_PAYLOAD: payload },
});
// The branded React installer is the only release artifact. The NSIS bundle
// above is merely the payload embedded into it, so it stays where the bundler
// writes it.
const releaseOutput = path.join(root, 'src-tauri/target/release/react');
const output = localOutput || releaseOutput;
const destination = path.join(output, `MokiDown_${version}_x64-setup.exe`);
// Rebuilding changes the signed bytes. Never leave an older signature/manifest
// next to the replacement executable, including when the copy fails.
if (!path.relative(output, releaseOutput)) {
  await rm(`${destination}.sig`, { force: true });
  await rm(path.join(output, 'latest.json'), { force: true });
}
const builtInstaller = path.join(
  root,
  'src-tauri/target/react-installer/release/mokidown-installer.exe',
);
await writeExecutable(builtInstaller, destination);
if (localOutput) console.log(`MokiDown executable: ${standaloneOutput}`);
console.log(`React installer: ${destination}`);
