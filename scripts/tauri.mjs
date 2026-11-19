import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeMsvc } from './windows-msvc.mjs';

// 有些开发机只装了 rustup toolchain，没有把 cargo 放进 PATH；
// tauri CLI 内部 spawn('cargo') 时会报 program not found。这里补一次探测。
function ensureCargoOnPath() {
  if (process.platform !== 'win32') return;
  const pathValue = process.env.PATH || '';
  if (pathValue.split(';').some((dir) => dir && existsSync(join(dir, 'cargo.exe')))) return;
  const candidates = [
    process.env.RUSTUP_HOME && join(process.env.RUSTUP_HOME, 'toolchains', 'stable-x86_64-pc-windows-msvc', 'bin'),
    join(homedir(), '.rustup', 'toolchains', 'stable-x86_64-pc-windows-msvc', 'bin'),
    'C:\\Env\\rustup\\toolchains\\stable-x86_64-pc-windows-msvc\\bin',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, 'cargo.exe'))) {
      process.env.PATH = `${dir};${pathValue}`;
      return;
    }
  }
}

const args = process.argv.slice(2);

// `npm run tauri build` is the release command: branded React installer plus
// the refreshed website demo. Use `--app` (or `--bundles`) for a raw Tauri
// build.
if (args[0] === 'build' && !args.includes('--app') && !args.includes('--bundles')) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-release.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

try {
  initializeMsvc(args);
  ensureCargoOnPath();
  if (!process.env.CARGO_TARGET_DIR) {
    process.env.CARGO_TARGET_DIR = fileURLToPath(new URL('../src-tauri/target', import.meta.url));
  }
  // Load the native CLI after initializing its inherited compiler environment.
  const require = createRequire(import.meta.url);
  const cli = require('@tauri-apps/cli');
  await cli.run(args, 'npm run tauri');
} catch (error) {
  console.error(`[mokidown] ${error.message}`);
  process.exitCode = 1;
}
