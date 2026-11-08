import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRuntimeLogStore } from '@/services/runtimeLogs';
import RuntimeErrorBoundary from './RuntimeErrorBoundary';

globalThis.React = React;

it('keeps the surrounding UI available and exposes the React error in the log', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = () => { throw new Error('render fixture failed'); };
  try {
    render(<>
      <span>Outside the boundary</span>
      <RuntimeErrorBoundary><Broken /></RuntimeErrorBoundary>
    </>);
    expect(screen.getByText('Outside the boundary')).toBeInTheDocument();
    expect(useRuntimeLogStore.getState().entries[0]).toMatchObject({
      source: 'React', level: 'error', message: 'render fixture failed',
    });
    expect(useRuntimeLogStore.getState().entries[0].detail).toContain('Broken');
    fireEvent.click(screen.getByRole('button', { name: /View error log|查看错误日志/ }));
    expect(useRuntimeLogStore.getState().open).toBe(true);
  } finally {
    consoleError.mockRestore();
    useRuntimeLogStore.setState({ entries: [], open: false });
  }
});
