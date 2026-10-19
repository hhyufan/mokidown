import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createPluginProject } from './create-plugin.mjs';
import { createPluginDevServer } from './plugin-dev.mjs';
import { verifyPluginPackage } from '../shared/plugin-package.mjs';
const execute=promisify(execFile);
test('scaffold builds independently and development serves verified changes without publishing a broken build',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'moki-plugin-tools-'));const project=join(parent,'reading');let server;
 try{
  await createPluginProject(project,'example.reading');await assert.rejects(createPluginProject(project,'example.reading'),/already exists/);
  await execute(process.execPath,['.moki.mjs','pack',join(parent,'artifacts')],{cwd:project});
  server=await createPluginDevServer(project,{port:0,watchFiles:false});
  const first=await verifyPluginPackage(await fetch(server.url).then(res=>res.text()));assert.equal(first.pkg.id,'example.reading');
  const path=join(project,'src/index.mjs'),source=await readFile(path,'utf8');await writeFile(path,source+'\n// changed\nconsole.log("development edit");');await server.rebuild();
  const second=await verifyPluginPackage(await fetch(server.url).then(res=>res.text()));assert.notEqual(first.digest,second.digest);
  await writeFile(path,'const = broken');await server.rebuild();assert.equal((await fetch(server.url)).status,503);
  await writeFile(path,source);await server.rebuild();assert.equal((await verifyPluginPackage(await fetch(server.url).then(res=>res.text()))).digest,first.digest);
  assert.equal((await fetch(server.url+'/../unknown')).status,404);
 }finally{await server?.close();await rm(parent,{recursive:true,force:true});}
});
