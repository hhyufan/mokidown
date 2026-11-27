import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { markdownFenceLanguages } from '@utils/markdownCodeFence';
import {
  clearEditorPopupRoom,
  editorPopupBounds,
  editorPopupRoomBelow,
  makeEditorPopupRoom,
  placeEditorPopup,
} from './editorPopupPlacement';

export default function MarkdownCodeLanguageMenu({ request, onClose }) {
  const { t } = useTranslation();
  const anchorRef = useRef(null);
  const [placement, setPlacement] = useState('bottomLeft');
  const query = request?.query.toLowerCase() || '';
  const languages = markdownFenceLanguages.filter((names) => names.some((name) => name.toLowerCase().startsWith(query)));
  const visible = Boolean(request && (languages.length || !query));
  const { scroller, releaseRoom } = request ?? {};
  const estimatedHeight = (languages.length + Number(!query)) * 32 + 8;

  useLayoutEffect(() => {
    if (!visible || !scroller) return undefined;
    return releaseRoom ?? (() => clearEditorPopupRoom(scroller));
  }, [visible, scroller, releaseRoom]);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const anchor = anchorRef.current;
    const position = (reveal = false) => {
      let point = request.getAnchor();
      const bounds = editorPopupBounds(window, scroller?.getBoundingClientRect());
      if (!point || point.bottom <= bounds.top || point.top >= bounds.bottom) {
        anchor.style.visibility = 'hidden';
        return;
      }
      const menuHeight = anchor.querySelector('.ant-dropdown-menu')?.scrollHeight || estimatedHeight;
      const targetHeight = Math.min(300, (bounds.bottom - bounds.top) * 0.55, menuHeight);
      const needed = targetHeight - editorPopupRoomBelow(bounds, point);
      if (reveal && needed > 1 && scroller) {
        if (request.makeRoom) request.makeRoom(needed);
        else makeEditorPopupRoom(scroller, needed);
        point = request.getAnchor() ?? point;
      }
      const { left, maxWidth, maxHeight, placement: side } = placeEditorPopup(bounds, point, 160, targetHeight);
      setPlacement(side === 'above' ? 'topLeft' : 'bottomLeft');
      anchor.style.visibility = maxHeight >= 28 && maxWidth > 0 ? 'visible' : 'hidden';
      anchor.style.left = `${left}px`;
      anchor.style.top = `${side === 'above' ? point.top : point.bottom}px`;
      anchor.style.setProperty('--code-language-width', `${Math.min(160, maxWidth)}px`);
      anchor.style.setProperty('--code-language-height', `${Math.min(targetHeight, maxHeight)}px`);
    };
    let frame = 0;
    const resize = () => position(true);
    const track = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    };
    resize();
    const measureFrame = window.requestAnimationFrame(resize);
    const scroll = request.onScroll?.(track);
    window.addEventListener('scroll', track, true);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', track);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(measureFrame);
      if (frame) window.cancelAnimationFrame(frame);
      scroll?.dispose();
      window.removeEventListener('scroll', track, true);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', track);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [request, scroller, visible, estimatedHeight]);
  useEffect(() => {
    if (!visible) return undefined;
    const keyDown = (event) => {
      if (event.isComposing) return;
      if (!anchorRef.current?.contains(event.target) && !request.containsTarget(event.target)) {
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
        && !event.target.closest?.('.moki-code-language-dropdown')) {
        const first = anchorRef.current?.style.visibility === 'visible'
          && anchorRef.current.querySelector('.moki-code-language-dropdown:not(.ant-dropdown-hidden) [role="menuitem"]');
        if (first) {
          event.preventDefault();
          event.stopPropagation();
          first.focus();
        }
        return;
      }
      const undo = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
      if (event.key !== 'Escape' && !undo) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      if (undo) request.undo();
      request.focus();
    };
    const outside = (event) => {
      if (!event.target.closest?.('.moki-code-language-dropdown')) onClose();
    };
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [request, onClose, visible]);
  if (!visible) return null;
  return createPortal(
    <div ref={anchorRef} style={{ position: 'fixed', zIndex: 1050, visibility: 'hidden' }}>
      <Dropdown
        open trigger={[]} placement={placement} autoAdjustOverflow={false}
        getPopupContainer={(trigger) => trigger.parentElement}
        overlayClassName="moki-code-language-dropdown"
        onOpenChange={(open) => { if (!open) onClose(); }}
        menu={{
          'aria-label': t('editor.codeLanguageMenu'),
          items: [
            ...(!query ? [{ key: 'plain', label: t('editor.codeLanguagePlainText') }] : []),
            ...languages.map(([key, label]) => ({ key, label })),
          ],
          style: { width: 'var(--code-language-width)', maxHeight: 'var(--code-language-height)', overflowY: 'auto' },
          onClick: ({ key, domEvent }) => {
            if (domEvent.type === 'keydown') {
              domEvent.preventDefault();
              domEvent.stopPropagation();
            }
            onClose();
            request.select(key === 'plain' ? '' : key);
            request.focus();
          },
        }}
      >
        <span aria-hidden="true" style={{ display: 'block', width: 1, height: 1, pointerEvents: 'none' }} />
      </Dropdown>
    </div>,
    document.body,
  );
}
