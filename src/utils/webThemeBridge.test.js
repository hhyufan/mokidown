import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installWebThemeBridge } from './webThemeBridge';
import useThemeStore from '@store/useThemeStore';
let stop, originalParent;
const parent={postMessage:vi.fn()};
beforeEach(()=>{originalParent=Object.getOwnPropertyDescriptor(window,'parent');Object.defineProperty(window,'parent',{configurable:true,value:parent});parent.postMessage.mockClear();useThemeStore.setState({theme:'light'});});
afterEach(()=>{stop?.();Object.defineProperty(window,'parent',originalParent);vi.restoreAllMocks();});
it('sets explicit host themes once and acknowledges the latest request without toggling',()=>{stop=installWebThemeBridge(true);expect(parent.postMessage).toHaveBeenCalledWith({type:'moki:theme-ready'},'*');const send=()=>window.dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'moki:theme',theme:'dark',requestId:2}}));send();send();expect(useThemeStore.getState().theme).toBe('dark');expect(parent.postMessage).toHaveBeenLastCalledWith({type:'moki:theme-changed',theme:'dark',requestId:2},'*');});
it('notifies parent for editor theme changes and ignores unrelated frames',()=>{stop=installWebThemeBridge(true);window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'moki:theme',theme:'dark'}}));expect(useThemeStore.getState().theme).toBe('light');useThemeStore.getState().setTheme('dark');expect(parent.postMessage).toHaveBeenLastCalledWith({type:'moki:theme-changed',theme:'dark'},'*');stop();parent.postMessage.mockClear();useThemeStore.getState().setTheme('light');expect(parent.postMessage).not.toHaveBeenCalled();});
