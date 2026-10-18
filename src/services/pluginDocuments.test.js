import { expect,it } from 'vitest';import {getPluginDocuments} from './pluginDocuments';
it('reports only exact workspace-relative paths without suffix matching',()=>{
 const docs=getPluginDocuments({activeTabId:'one',tabs:[{id:'one',path:'C:/Notes/a.md',name:'a.md'},{id:'two',path:'C:/Other/Notes/a.md',name:'a.md'}]},'c:/notes');
 expect(docs[0]).toMatchObject({active:true,relativePath:'a.md'});expect(docs[1].relativePath).toBeNull();
});
