import {test} from 'node:test';import assert from 'node:assert/strict';import {validatePluginConfiguration}from'../shared/plugin-package.mjs';
test('configuration schemas validate typed fields, duplicate keys and service-relative test paths',()=>{
 validatePluginConfiguration({fields:[{key:'fontSize',type:'number',label:'Size',min:12,max:28},{key:'enabled',type:'boolean',label:'Enabled'},{key:'mode',type:'select',label:'Mode',options:[{label:'Compact',value:'compact'}]}],test:{path:'/capabilities'}});
 for(const configuration of [{fields:[{key:'a',type:'text',label:'A'},{key:'a',type:'text',label:'Again'}]},{fields:[{key:'token',type:'secret',label:'Token'}]},{fields:[{key:'number',type:'number',label:'Number',min:28,max:12}]},{test:{path:'@evil.example/'}},{test:{path:'//evil.example/'}}])assert.throws(()=>validatePluginConfiguration(configuration));
});
