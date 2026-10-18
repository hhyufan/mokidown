import { resolve } from 'node:path';
import { packagePlugin } from './lib/package-plugin.mjs';
const project = process.argv[2];
if (!project) throw new Error('Usage: node scripts/package-plugin.mjs <plugin-project> [output-directory]');
const outDirectory = resolve(process.argv[3] || 'releases/plugins');
const result = await packagePlugin(project, { outDirectory });
console.log(resolve(outDirectory, result.filename));
console.log(`SHA-256 (${result.manifest.integrity.mode}): ${result.digest}`);
