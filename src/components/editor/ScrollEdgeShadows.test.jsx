import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import ScrollEdgeShadows from './ScrollEdgeShadows';

globalThis.React = React;

it('shows each edge only while the document can scroll in that direction', async () => {
  const { container, getByTestId } = render(
    <div>
      <div data-testid="scroller"><p>Document</p></div>
      <ScrollEdgeShadows selector="[data-testid=scroller]" />
    </div>,
  );
  const scroller = getByTestId('scroller');
  const overlay = container.querySelector('.editor-scroll-edges');
  Object.defineProperties(scroller, { clientHeight: { value: 100 }, scrollHeight: { value: 240 } });
  fireEvent.scroll(scroller);
  await waitFor(() => expect(overlay).toHaveAttribute('data-bottom'));
  expect(overlay).not.toHaveAttribute('data-top');
  scroller.scrollTop = 50;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(overlay).toHaveAttribute('data-top'));
  expect(overlay).toHaveAttribute('data-bottom');
  scroller.scrollTop = 140;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(overlay).not.toHaveAttribute('data-bottom'));
  expect(overlay).toHaveAttribute('data-top');
});
