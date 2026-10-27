import { useState } from 'react';
import { AutoComplete, Button, InputNumber, Popover, Tooltip } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { TREE_JUMP } from '@utils/mgtree';

function jumpDraft(node) {
  const match = node.jumpLanguage && node.originalText.match(TREE_JUMP);
  return { language: match?.[1] || 'javascript', mode: !match ? 'explicit' : match[2] !== undefined ? 'explicit'
    : match[3] ? 'increment' : match[4] !== undefined ? 'skip' : 'same', amount: Number(match?.[2] ?? match?.[4] ?? 1) };
}

export default function TreeJumpEditor({ node, onApply, open, onOpenChange }) {
  const { t } = useTranslation();
  const setOpen = onOpenChange;
  const [draft, setDraft] = useState(() => jumpDraft(node));
  const modes = ['explicit', 'increment', 'skip', 'same'];
  const numeric = ['explicit', 'skip'].includes(draft.mode);
  const valid = draft.mode === 'none' || (/^(?:c\+\+|[a-zA-Z][\w#-]*)$/i.test(draft.language.trim())
    && (!numeric || Number.isSafeInteger(draft.amount) && draft.amount > 0));
  const apply = (event) => {
    event.preventDefault();
    if (!valid) return;
    const language = draft.language.trim();
    const suffix = draft.mode === 'none' ? '' : `>${language}${draft.mode === 'explicit' ? `[${draft.amount}]`
      : draft.mode === 'increment' ? '++' : draft.mode === 'skip' ? `+=${draft.amount}` : ''}`;
    if (onApply(suffix) !== false) setOpen(false);
  };
  const languages = ['javascript', 'typescript', 'java', 'python', 'c', 'cpp', 'csharp', 'bash', 'sql', 'json'];
  if (!languages.includes(node.jumpLanguage) && node.jumpLanguage) languages.unshift(node.jumpLanguage);
  const content = <form className="moki-tree__jump-form" onSubmit={apply}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}
    onClick={(event) => event.stopPropagation()}>
    <fieldset className="moki-tree__jump-modes"><legend>{t('tree.jump.mode')}</legend>
      {modes.map((mode) => <label key={mode} className={`moki-tree__jump-choice ${draft.mode === mode ? 'is-selected' : ''}`}>
        <input type="radio" name={`jump-mode-${node.key}`} value={mode} checked={draft.mode === mode}
          onChange={() => setDraft((value) => ({ ...value, mode }))} />
        <span>{t(`tree.jump.${mode}`)}</span>
      </label>)}
    </fieldset>
    <div className="moki-tree__jump-fields">
    <label><span>{t('tree.jump.language')}</span><AutoComplete aria-label={t('tree.jump.language')}
      value={draft.language} options={languages.map((value) => ({ value }))} virtual={false}
      filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
      onChange={(language) => setDraft((value) => ({ ...value, language }))} /></label>
    {numeric && <label className="moki-tree__jump-amount"><span>{t(draft.mode === 'skip' ? 'tree.jump.step' : 'tree.jump.index')}</span>
      <InputNumber aria-label={t(draft.mode === 'skip' ? 'tree.jump.step' : 'tree.jump.index')} min={1} precision={0}
        value={draft.amount} onChange={(amount) => setDraft((value) => ({ ...value, amount }))} /></label>}
    </div>
    <p className="moki-tree__jump-help" aria-live="polite">{t(`tree.jump.help.${draft.mode}`)}</p>
    <div className="moki-tree__jump-form-actions">
      {node.jumpLanguage && <Button size="small" type="text" danger className="moki-tree__jump-remove"
        onClick={() => { if (onApply('') !== false) setOpen(false); }}>{t('tree.jump.remove')}</Button>}
      <Button size="small" onClick={() => setOpen(false)}>{t('tree.jump.cancel')}</Button>
      <Button size="small" type="primary" htmlType="submit" disabled={!valid}>{t('tree.jump.apply')}</Button>
    </div>
  </form>;
  return <Popover open={open} trigger="click" placement="bottomRight" title={t('tree.jump.title')} content={content}
    overlayClassName="moki-tree-jump-popup" arrow={false}
    onOpenChange={(value) => { if (value) setDraft(jumpDraft(node)); setOpen(value); }}>
    <Tooltip title={open ? '' : t(node.jumpLanguage ? 'tree.jump.edit' : 'tree.jump.add')}>
      <button type="button" aria-label={t(node.jumpLanguage ? 'tree.jump.edit' : 'tree.jump.add')}
        className={`moki-tree__reference moki-tree__reference--editable ${node.jumpLanguage ? '' : 'moki-tree__reference--empty'}`}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => event.stopPropagation()}>
        {node.jumpLanguage ? <>{node.jumpLanguage}<span>{node.jumpIndex}</span></> : <><CodeOutlined /><span>{t('tree.jump.add')}</span></>}
      </button>
    </Tooltip>
  </Popover>;
}
