import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeMsvc } from './windows-msvc.mjs';

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
