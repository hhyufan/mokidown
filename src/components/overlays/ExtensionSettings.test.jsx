import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExtensionSettings from './ExtensionSettings';
import useExtensionStore from '@store/useExtensionStore';
globalThis.React=React;
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key})}));
afterEach(()=>{cleanup();useExtensionStore.setState({installed:[]});});
it('saves typed configuration fields independently and preserves the enabled plugin',async()=>{
 const pkg={format:'mokidown-extension-v1',id:'example.settings',name:'Settings',version:'1.0.0',script:'',permissions:[],fileExtensions:[],configuration:{fields:[{key:'label',label:'Display label',type:'text',default:'Read'},{key:'fontSize',label:'Font size',type:'number',default:16,min:12,max:28},{key:'showCount',label:'Show count',type:'boolean',default:true},{key:'density',label:'Density',type:'select',default:'compact',options:[{label:'Compact',value:'compact'},{label:'Comfortable',value:'comfortable'}]}]}};
 useExtensionStore.getState().install(pkg);useExtensionStore.getState().toggle(pkg.id,true);
 render(<ExtensionSettings entry={useExtensionStore.getState().installed[0]} act={action=>action()}/>);
 fireEvent.change(screen.getByLabelText('Display label'),{target:{value:'Custom'}});fireEvent.change(screen.getByLabelText('Font size'),{target:{value:'24'}});fireEvent.click(screen.getByRole('switch',{name:'Show count'}));
 fireEvent.click(screen.getByRole('button',{name:'extensions.saveConfiguration'}));
 await waitFor(()=>expect(useExtensionStore.getState().installed[0].settings).toEqual({label:'Custom',fontSize:24,showCount:false,density:'compact'}));
 expect(useExtensionStore.getState().installed[0].enabled).toBe(true);expect(screen.getByRole('status')).toHaveTextContent('extensions.configurationSaved');
});
