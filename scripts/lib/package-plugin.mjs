import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalPackage, PACKAGE_DIGEST_MODE, validatePluginPackage } from '../../shared/plugin-package.mjs';

export async function packagePlugin(projectDirectory, { outDirectory, minify = true } = {}) {
  const project = resolve(projectDirectory);
  const manifest = JSON.parse(await readFile(resolve(project, 'manifest.json'), 'utf8'));
  const inside = (path) => {
    const absolute = resolve(project, path);
    const rel = relative(project, absolute);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Plugin source path escaped its project');
    return absolute;
  };
  const input = !manifest.entry && manifest.styles?.length ? { stdin: { contents: "import { definePlugin } from '@mokidown/sdk'; definePlugin(() => {});", resolveDir: project, sourcefile: 'style-only.mjs' } } : { entryPoints: [inside(manifest.entry || 'src/index.mjs')] };
  const bundle = await build({ ...input, outfile: 'plugin.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, minify, legalComments: 'none', metafile: true, alias: { '@mokidown/sdk': resolve(import.meta.dirname, '../../plugins/sdk/index.mjs') } });
  if (Object.values(bundle.metafile.outputs).some((output) => output.imports.length)) throw new Error('Plugin must bundle all JavaScript dependencies');
  const stylesheet = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
  if (stylesheet) throw new Error('Declare CSS in manifest.styles instead of importing it as JavaScript');
  const styles = [];
  for (const style of manifest.styles || []) styles.push({ id: style.id, target: style.target || 'markdown', css: await readFile(inside(style.path), 'utf8') });
  const { entry: _entry, styles: _styles, ...metadata } = manifest;
  const raw = { ...metadata, format: 'mokidown-extension-v2', apiVersion: 1, fileExtensions: metadata.fileExtensions || [], assets: { script: bundle.outputFiles[0].text.replace(/\r\n/g, '\n'), styles } };
  const digest = createHash('sha256').update(canonicalPackage(raw)).digest('hex');
  raw.integrity = { mode: PACKAGE_DIGEST_MODE, sha256: digest };
  validatePluginPackage(raw);
  const text = `${JSON.stringify(raw)}\n`;
  const filename = `${raw.id}-${raw.version}-${digest.slice(0, 16)}.mokiplugin.json`;
  if (outDirectory) {
    await mkdir(outDirectory, { recursive: true });
    await writeFile(resolve(outDirectory, filename), text);
  }
  return { manifest: raw, text, digest, filename };
}
