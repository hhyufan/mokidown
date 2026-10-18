import { afterEach,expect,it,vi } from 'vitest';
import {webcrypto} from 'node:crypto';
import {registerPluginSender,unregisterPluginSender,executePluginCommand,finishPluginCommand} from './pluginBus';
afterEach(()=>{unregisterPluginSender('example.owner');vi.unstubAllGlobals();});
it('waits for the owning plugin result and rejects stopped commands',async()=>{
 vi.stubGlobal('crypto',webcrypto);let sent;registerPluginSender('example.owner',message=>sent=message);
 const promise=executePluginCommand('example.owner','resolve',{choice:'current'});
 finishPluginCommand('other.owner',{requestId:sent.requestId,value:'wrong'});
 finishPluginCommand('example.owner',{requestId:sent.requestId,value:'done'});await expect(promise).resolves.toBe('done');
 const pending=executePluginCommand('example.owner','resolve',{});unregisterPluginSender('example.owner');await expect(pending).rejects.toThrow('Plugin stopped');
});
