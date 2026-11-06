import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RecoveryModal from './RecoveryModal';

globalThis.React = React;
vi.mock('@/i18n', () => ({ default: { t: (key, options) => options?.name || key } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('./MonacoConflictDiff', () => ({ default: ({ original, modified, localLabel, remoteLabel }) => <div data-testid="monaco-diff"><span>{localLabel}</span><span>{remoteLabel}</span><div data-testid="disk">{original}</div><div data-testid="draft">{modified}</div></div> }));
vi.mock('./AppDialog', () => ({ default: ({ children, footer, open }) => open ? <div>{children}{footer}</div> : null }));
const drafts = [
  { recoveryId: 'one', name: 'first.md', path: '/docs/first.md', diskContent: 'disk version', content: `${'draft line\n'.repeat(70)}draft ending`, diskState: 'changed' },
  { recoveryId: 'two', name: 'new.md', path: '', content: 'unsaved new file' },
];
afterEach(cleanup);

it('compares complete versions and switches preview independently from the restore checkboxes', async () => {
  const restore = vi.fn(), discard = vi.fn();
  render(<RecoveryModal open drafts={drafts} onRestore={restore} onDiscard={discard} />);
  await screen.findByTestId('monaco-diff');
  expect(screen.getByTestId('disk')).toHaveTextContent('disk version');
  expect(screen.getByTestId('draft')).toHaveTextContent('draft ending');
  fireEvent.click(screen.getByRole('button', { name: /new.md/ }));
  expect(screen.getByTestId('disk')).toBeEmptyDOMElement();
  expect(screen.getByTestId('draft')).toHaveTextContent('unsaved new file');
  expect(screen.getByText('unsaved.noDiskContent')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'first.md' }));
  fireEvent.click(screen.getByRole('button', { name: 'unsaved.restoreSelected' }));
  expect(restore).toHaveBeenCalledWith([drafts[1]]);
  fireEvent.click(screen.getByRole('button', { name: 'unsaved.discardAll' }));
  expect(discard).toHaveBeenCalledOnce();
});
