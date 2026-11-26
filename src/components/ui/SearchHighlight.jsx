import { textSearchRange } from '@utils/searchMatching';

/**
 * 高亮文本里与搜索词匹配的那一段，效果与文件列表搜索一致。
 *
 * @param {object} props 组件属性。
 * @param {string} props.text 原始文本。
 * @param {string} [props.query] 搜索词。
 * @returns {JSX.Element|string} 带高亮的文本。
 */
export default function SearchHighlight({ text, query }) {
  const value = String(text ?? '');
  const range = textSearchRange(value, String(query || '').trim());
  if (!range) return value;
  return (
    <>
      {value.slice(0, range.start)}
      <mark className="search-highlight">
        {value.slice(range.start, range.start + range.length)}
      </mark>
      {value.slice(range.start + range.length)}
    </>
  );
}
