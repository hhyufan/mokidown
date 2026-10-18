import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../src');
const violations = [];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await check(path); continue; }
    if (!/\.(js|jsx|json|scss)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    if (entry.name === 'service-plugins.json' && directory === resolve(root, 'configs')) {
      const descriptors = JSON.parse(text);
      if (!Array.isArray(descriptors) || descriptors.some((entry) => 'script' in entry || 'content' in entry)) violations.push(path);
      continue;
    }
    // Architectural boundary: core cannot contain or import a specific service.
    if (/syncEngine|useSyncStore|useAuthStore|useExternalDocsStore|cloud:\/\/|syncEnabled|settings\.cloud|cloud-sync|incremental-sync|["'](?:[^"']*\/)?(?:archive|plugins)\/cloud-sync/.test(text)) violations.push(path);
  }
}
await check(root);
if (violations.length) throw new Error(`Optional-service code found in the core:\n${violations.join('\n')}`);
console.log('Core contains only official plugin descriptors; implementations remain independent resources with no core imports or routes.');
