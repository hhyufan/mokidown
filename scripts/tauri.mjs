import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeMsvc, ensureCargoOnPath } from './windows-msvc.mjs';

const args = process.argv.slice(2);

// `npm run tauri build` is the release command: branded React installer plus
// the refreshed website demo. A standalone build uses the same signing step.
const standaloneBuild = args.length === 2 && ['--app', '--no-bundle'].includes(args[1]);
if (args[0] === 'build' && (args.length === 1 || standaloneBuild)) {
  const { spawnSync } = await import('node:child_process');
  const [entry, ...options] = standaloneBuild
    ? ['./build-react-installer.mjs', '--app-only']
    : ['./build-release.mjs'];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(entry, import.meta.url)), ...options], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
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
