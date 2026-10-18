import * as React from 'react';
import { afterEach,expect,it,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import HistoryDiffView from './HistoryDiffView';

globalThis.React=React;
const mock=vi.hoisted(()=>({execute:vi.fn(),save:vi.fn()}));
vi.mock('@utils/pluginBus',()=>({executePluginCommand:mock.execute,sendToPlugin:vi.fn(),broadcastToPlugins:vi.fn()}));
vi.mock('@hooks/useFileManager',()=>({useFileManager:()=>({saveTab:mock.save})}));
vi.mock('monaco-editor',()=>({editor:{}}));
vi.mock('@utils/monacoShiki',()=>({initMonacoShiki:()=>new Promise(()=>{}),getMonacoThemeName:()=>''}));
vi.mock('@utils/tauriApi',()=>({historyCapture:vi.fn()}));
vi.mock('@components/moki/MokiStatusEmpty',()=>({default:()=>null}));
vi.mock('react-i18next',async(importOriginal)=>({...await importOriginal(),useTranslation:()=>({t:key=>key})}));
const actions=[['local','使用本地'],['remote','使用云端'],['merged','应用修改']].map(([choice,title])=>({id:choice,title,command:'example.resolve',args:{choice}}));
afterEach(()=>{cleanup();useHistoryStore.getState().clearDiff();useEditorStore.setState({tabs:[],tabRenderList:[],activeTabId:null});vi.unstubAllGlobals();vi.clearAllMocks();});
function prepare(){
 vi.stubGlobal('crypto',webcrypto);
 useEditorStore.setState({tabs:[{id:'doc',path:'/notes/a.md',name:'a.md',content:'local',modified:false}],tabRenderList:[],activeTabId:'doc'});
 useHistoryStore.getState().setDiff({pluginId:'example.provider',tabId:'doc',timestamp:1,content:'reference',label:'Comparison',actions});
 return render(<HistoryDiffView/>);
}
for(const action of actions)it(`waits for plugin acknowledgement before closing ${action.title}`,async()=>{
 let finish;mock.execute.mockImplementation(()=>new Promise(resolve=>finish=resolve));prepare();
 expect(screen.getAllByRole('button').map(node=>node.textContent).filter(Boolean)).toEqual(['使用本地','使用云端','应用修改']);
 fireEvent.click(screen.getByRole('button',{name:action.title}));
 await waitFor(()=>expect(mock.execute).toHaveBeenCalled());
 expect(mock.execute).toHaveBeenCalledWith('example.provider','example.resolve',expect.objectContaining({choice:action.args.choice,document:expect.objectContaining({id:'doc',content:'local'})}));
 expect(useHistoryStore.getState().diff).not.toBeNull();
 finish({resolved:true});await waitFor(()=>expect(useHistoryStore.getState().diff).toBeNull());
});
it('keeps the comparison open and surfaces a failed plugin command',async()=>{
 mock.execute.mockRejectedValue(new Error('Database offline'));prepare();fireEvent.click(screen.getByRole('button',{name:'使用本地'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Database offline');expect(useHistoryStore.getState().diff).not.toBeNull();
});
