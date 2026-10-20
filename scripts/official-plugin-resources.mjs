import {readFile,writeFile,mkdir} from 'node:fs/promises';import{resolve,relative,basename}from'node:path';import{pathToFileURL}from'node:url';import{verifyPluginPackage}from'../shared/plugin-package.mjs';
const root=resolve(import.meta.dirname,'..'),catalogPath=resolve(root,'src/configs/service-plugins.json');
export async function checkOfficialPluginResources(catalog, publicDirectory=resolve(root,'public')){
 catalog ||= JSON.parse(await readFile(catalogPath,'utf8'));
 for(const entry of catalog){if(!entry.bundledUrl)continue;const file=resolve(publicDirectory,entry.bundledUrl),rel=relative(publicDirectory,file);if(rel.startsWith('..')||rel.startsWith('/')||rel.includes(':'))throw Error('Bundled plugin path escaped public directory');try{await verifyPluginPackage(await readFile(file,'utf8'),entry);}catch(error){throw new Error(`BUILTIN_PLUGIN_MISMATCH: ${entry.id}@${entry.version} — ${error.message}. Run npm run plugin:sync before building.`);}}
}
export async function syncOfficialPluginResources({file}={}){
 const original=await readFile(catalogPath,'utf8'),catalog=JSON.parse(original);
 for(const entry of catalog){const url=new URL(entry.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('Plugin download URL must be HTTPS');let text;if(file){text=await readFile(resolve(file),'utf8');}else{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(`Plugin HTTP ${response.status}`);text=await response.text();}await verifyPluginPackage(text,entry);const filename=basename(url.pathname);if(!/^[a-zA-Z0-9.-]+\.mokiplugin\.json$/.test(filename))throw Error('Invalid plugin filename');entry.bundledUrl=`builtin-plugins/${filename}`;await mkdir(resolve(root,'public/builtin-plugins'),{recursive:true});await writeFile(resolve(root,'public',entry.bundledUrl),text);}
 if(await readFile(catalogPath,'utf8')!==original)throw Error('Catalog changed during synchronisation; retry');await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');await checkOfficialPluginResources(catalog);return catalog;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.includes('--sync')){const i=process.argv.indexOf('--file');await syncOfficialPluginResources({file:i<0?undefined:process.argv[i+1]});}else await checkOfficialPluginResources();console.log('Official plugin resources verified');}
