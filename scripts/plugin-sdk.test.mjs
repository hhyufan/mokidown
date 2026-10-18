import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { createPluginClient } from '../plugins/sdk/index.mjs';

test('SDK routes replies, commands and events and releases pending calls', async () => {
  const {port1,port2}=new MessageChannel();
  const sdk=createPluginClient(port1,{timeoutMs:100});
  port2.on('message',data=>port2.postMessage({id:data.id,value:true}));
  let called;const command=new Promise(resolve=>called=resolve);
  await sdk.commands.register('test.run','Test',()=>called('command'));
  port2.postMessage({type:'command',id:'test.run'});assert.equal(await command,'command');
  let saved;const event=new Promise(resolve=>saved=resolve);sdk.editor.onDidSave(saved);
  port2.postMessage({type:'event',name:'didSave',payload:{path:'a.md'}});assert.deepEqual(await event,{path:'a.md'});
  port2.removeAllListeners('message');
  await assert.rejects(sdk.context(),error=>error.code==='RPC_TIMEOUT');
  const pending=sdk.context();sdk.dispose();
  await assert.rejects(pending,error=>error.code==='PLUGIN_STOPPED');assert.equal(sdk.signal.aborted,true);port2.close();
});
