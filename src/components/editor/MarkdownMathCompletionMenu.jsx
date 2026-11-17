import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { mathSymbolSnippets } from './milkdownMathCompletion';

// 列表最多占这么高，超出视口下沿再往里收，剩下的靠自身滚动。
const MAX_HEIGHT = 240;

/**
 * 公式源码态的符号补全列表。
 *
 * 与代码块语言菜单一样渲染在 `document.body` 上：正文里不留节点，输入与光标
 * 行为完全不受影响，位置靠 `request.getAnchor()` 跟着控制序列与滚动容器算。
 * 焦点始终留在编辑器里，所以 Enter / 方向键要在捕获阶段自己判断，不靠 DOM 焦点。
 */
export default function MarkdownMathCompletionMenu({ request, onClose }) {
  const { t } = useTranslation();
  const anchorRef = useRef(null);
  const listRef = useRef(null);
  const [active, setActive] = useState(-1);
  const query = request?.query.toLowerCase() || '';
  const items = useMemo(() => mathSymbolSnippets
    .filter(([, snippet]) => snippet.toLowerCase().startsWith(query)), [query]);
  const visible = Boolean(request) && items.length > 0;
  // 焦点全程留在编辑器里，所以插入只能靠 request，不能让列表抢焦点。
  const choose = useCallback((index) => {
    const item = items[index];
    if (item) request.select(item[1]);
  }, [items, request]);
  // 过滤条件一变就回到「没有选中项」：Enter 该继续是编辑器自己的 Enter。
  useEffect(() => setActive(-1), [query]);
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const anchor = anchorRef.current;
    const list = anchor.firstElementChild;
    const position = () => {
      const point = request.getAnchor();
      anchor.style.visibility = point && window.innerHeight - point.y >= 40 ? 'visible' : 'hidden';
      if (!point) return;
      // 先按内容量出宽度，好让整块列表留在视口里。
      anchor.style.left = '0px';
      anchor.style.top = `${point.y + 2}px`;
      const { offsetWidth } = list;
      anchor.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - offsetWidth - 8))}px`;
      list.style.maxHeight = `${Math.min(MAX_HEIGHT, window.innerHeight - point.y - 12)}px`;
    };
    position();
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [request, visible]);
  useLayoutEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    if (!visible) return undefined;
    const keyDown = (event) => {
      if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        request.dismiss();
        onClose();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!step) {
        // 没有选中项时不拦 Enter / Tab：正在敲完整编码的人不该被列表改掉按键。
        if ((event.key !== 'Enter' && event.key !== 'Tab') || active < 0) return;
        event.preventDefault();
        event.stopPropagation();
        choose(active);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setActive((index) => (index < 0
        ? step > 0 ? 0 : items.length - 1
        : (index + step + items.length) % items.length));
    };
    const outside = (event) => {
      if (!event.target.closest?.('.moki-math-completion')) onClose();
    };
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [active, choose, items, onClose, request, visible]);
  if (!visible) return null;
  return createPortal(
    <div ref={anchorRef} style={{ position: 'fixed', zIndex: 1050, visibility: 'hidden' }}>
      <div className="moki-math-completion" role="listbox" aria-label={t('editor.mathCompletionMenu')} ref={listRef}>
        {items.map(([symbol, snippet], index) => (
          <div
            key={snippet}
            role="option"
            aria-selected={index === active}
            className={`moki-math-completion__item${index === active ? ' moki-math-completion__item--active' : ''}`}
            title={t('editor.mathSymbolInsert', { symbol: snippet })}
            // 默认行为会把焦点从编辑器拿走，控制序列的起点也就丢了。
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span className="moki-math-completion__symbol">{symbol}</span>
            <span className="moki-math-completion__code">{snippet}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
