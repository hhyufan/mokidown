import useEditorStore from '@store/useEditorStore';
import { getBuffer, flushEditorBuffer } from '@utils/editorBuffer';
import { sha256 } from '../../shared/plugin-package.mjs';

const handlers = new Set();
export function registerPluginEditor(getDocumentId, applyEdits) {
  const handler = { getDocumentId, applyEdits }; handlers.add(handler);
  return () => handlers.delete(handler);
}
export async function getPluginDocument() {
  const state = useEditorStore.getState();
  const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!tab) return null;
  flushEditorBuffer(tab.id);
  const content = getBuffer(tab.id, tab.content);
  return { id: tab.id, path: tab.path || null, name: tab.name, content, checksum: await sha256(content), language: tab.ext || '' };
}
export async function applyPluginEdits({ documentId, expectedChecksum, edits }) {
  const tab = useEditorStore.getState().tabs.find((tab) => tab.id === documentId);
  if (!tab) throw new Error('DOCUMENT_CLOSED: 文档已经关闭');
  flushEditorBuffer(documentId);
  const content = getBuffer(documentId, tab.content);
  const checksum = await sha256(content);
  const current = useEditorStore.getState().tabs.find((item) => item.id === documentId);
  if (!current || checksum !== expectedChecksum || getBuffer(documentId, current.content) !== content) throw new Error('DOCUMENT_CHANGED: 文档已经改变，请重新读取后再编辑');
  if (!Array.isArray(edits) || !edits.length || edits.length > 1000) throw new Error('Invalid editor edits');
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let end = -1;
  for (const edit of sorted) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > content.length || edit.from < end || typeof edit.text !== 'string') throw new Error('Edits must contain non-overlapping UTF-16 ranges');
    end = edit.to;
  }
  const handler = [...handlers].reverse().find((handler) => handler.getDocumentId() === documentId);
  if (!handler) throw new Error('SOURCE_EDITOR_REQUIRED: 请在源码编辑器中应用文本编辑；富文本模式仍支持样式插件');
  const result = sorted.reduceRight((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), content);
  if (result.length > 32 * 1024 * 1024) throw new Error('Editor edit exceeds the document size limit');
  handler.applyEdits(sorted);
  return { documentId, checksum: await sha256(result) };
}
