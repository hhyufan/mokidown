import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import PluginStatusPill from './PluginStatusPill';
globalThis.React = React;
afterEach(cleanup);
it('runs a plugin action with its arguments inside the editor status menu',async()=>{
 const run=vi.fn();const action={id:'resolve.local',title:'保留本地',group:'note.md',command:'resolve',args:{fileId:'note',choice:'local'}};
 render(<PluginStatusPill item={{text:'插件冲突 1 项',tone:'warning',actions:[action]}} onActivate={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'插件冲突 1 项'}));
 await waitFor(()=>expect(screen.getByText('note.md')).toBeVisible());
 fireEvent.click(screen.getByText('保留本地'));
 expect(run).toHaveBeenCalledWith(action);
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('preserves simple status commands for plugins without menu actions',()=>{
 const run=vi.fn();render(<PluginStatusPill item={{text:'Run action',command:'test.run'}} onActivate={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'Run action'}));expect(run).toHaveBeenCalledWith();
});
