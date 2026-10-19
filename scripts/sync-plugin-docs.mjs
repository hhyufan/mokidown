import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await import('./build-plugin-docs.mjs');
const root=resolve(import.meta.dirname,'..');
const server=resolve(process.argv[2] || resolve(root,'../mde-server'));
for(const target of ['public/docs/plugins','src/site/docs/plugins']){await mkdir(resolve(server,target),{recursive:true});await cp(resolve(root,'public/docs/plugins'),resolve(server,target),{recursive:true});}
console.log(`Plugin documentation copied to ${server}`);
