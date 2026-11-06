import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { markdownFenceLanguages } from '@utils/markdownCodeFence';

export default function MarkdownCodeLanguageMenu({ request, onClose }) {
  const { t } = useTranslation();
  const anchorRef = useRef(null);
  const query = request?.query.toLowerCase() || '';
  const languages = markdownFenceLanguages.filter((names) => names.some((name) => name.toLowerCase().startsWith(query)));
  const visible = Boolean(request && (languages.length || !query));
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const anchor = anchorRef.current;
    const position = () => {
      const point = request.getAnchor();
      const available = point ? window.innerHeight - point.y - 12 : 0;
      anchor.style.visibility = available >= 28 && point.y >= 0 ? 'visible' : 'hidden';
      if (!point) return;
      const width = Math.min(160, window.innerWidth - 16);
      anchor.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - width - 8))}px`;
      anchor.style.top = `${point.y}px`;
      anchor.style.setProperty('--code-language-width', `${width}px`);
      anchor.style.setProperty('--code-language-height', `${Math.min(300, window.innerHeight * 0.55, available)}px`);
    };
    position();
    const scroll = request.onScroll?.(position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      scroll?.dispose();
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [request, visible]);
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
        open trigger={[]} placement="bottomLeft" autoAdjustOverflow={false}
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
          onClick: ({ key }) => {
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
