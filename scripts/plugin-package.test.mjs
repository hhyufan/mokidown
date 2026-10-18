import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packagePlugin } from './lib/package-plugin.mjs';
import { verifyPluginPackage } from '../shared/plugin-package.mjs';

test('v2 builds repeatably, accepts JSON formatting and rejects modified content', async () => {
  const project = resolve('plugins/examples/markdown-style');
  const first = await packagePlugin(project), second = await packagePlugin(project);
  assert.equal(first.text, second.text); assert.equal(first.filename, second.filename);
  const formatted = JSON.stringify(JSON.parse(first.text), null, 2).replace(/\n/g, '\r\n');
  const verified = await verifyPluginPackage(formatted, { sha256: first.digest });
  assert.equal(verified.pkg.bundledStyles.length, 1);
  const modified = JSON.parse(first.text); modified.assets.styles[0].css += 'h1{color:red}';
  await assert.rejects(verifyPluginPackage(JSON.stringify(modified)), /INTEGRITY_FAILED/);
  await assert.rejects(verifyPluginPackage(first.text, { sha256: '0'.repeat(64) }), /CHECKSUM_MISMATCH/);
});
test('changed source has a new immutable filename; source paths cannot escape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokidown-plugin-'));
  try {
    await mkdir(join(dir,'src'));
    const manifest = { id:'test.bundle', name:'Test',version:'1.0.0',entry:'src/index.mjs',permissions:[] };
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
    await writeFile(join(dir,'src/index.mjs'),'console.log(1)');
    const a = await packagePlugin(dir);
    await writeFile(join(dir,'src/index.mjs'),'console.log(2)');
    const b = await packagePlugin(dir); assert.notEqual(a.filename,b.filename);
    await writeFile(join(dir,'manifest.json'),JSON.stringify({...manifest,entry:'../outside.mjs'}));
    await assert.rejects(packagePlugin(dir),/escaped/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
