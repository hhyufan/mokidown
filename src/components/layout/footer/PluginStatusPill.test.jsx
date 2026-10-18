import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PluginStatusPill from './PluginStatusPill';
globalThis.React=React;afterEach(cleanup);
it('runs the document contribution command without a separate page or menu',()=>{
 const run=vi.fn();render(<PluginStatusPill item={{text:'当前文件待处理',command:'example.compare',documentId:'doc'}} onActivate={run}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前文件待处理'}));expect(run).toHaveBeenCalledWith();expect(screen.queryByRole('dialog')).toBeNull();
});
