import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown } from '@milkdown/kit/utils';
import shell from './live-shell.html?raw';
import '../../src/components/editor/markdown-preview.scss';

const MD_ICON =
  '<svg viewBox="0 0 32 32"><path fill="#42a5f5" d="m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z"/></svg>';
const FOLDER_ICON =
  '<svg viewBox="0 0 32 32"><path fill="#8d6e63" d="m13.844 7.536-1.288-1.072A2 2 0 0 0 11.276 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H15.124a2 2 0 0 1-1.28-.464"/><rect width="18" height="6" x="14" y="22" fill="#d7ccc8" rx="1"/></svg>';
const DOCS = {
  welcome: {
    name: '欢迎.md',
    path: 'mokidown-workspace',
    content: `# 欢迎使用 MokiDown

这是一个可以真正编辑的 **Markdown** 工作台。左侧是文件，中间是内容，右侧是排版结果。

## 写作，从专注开始

- [x] 直接在排版后的内容里写作
- [x] 所见即所得与源码模式随时切换
- [ ] 写下你的下一个想法

> 好的想法，值得被认真记录。

\`\`\`js
const idea = '保持简单，持续写作';
console.log(idea);
\`\`\`
`,
  },
  notes: {
    name: '灵感笔记.md',
    path: 'mokidown-workspace > notes',
    content: `# 今天的灵感

把零散的想法先记下来，再慢慢整理成体系。

## 三个方向

1. 写作体验：减少打断，让输入更自然
2. 知识连接：文档之间可以互相引用
3. 本地优先：文件始终在自己的磁盘上

\`\`\`rust
fn main() {
    println!("write every day");
}
\`\`\`
`,
  },
  lab: {
    name: 'code-lab.md',
    path: 'mokidown-workspace > lab',
    content: `# 代码实验

MokiDown 里的代码块可以直接运行。

\`\`\`js
const nums = [1, 2, 3, 4];
const doubled = nums.map((n) => n * 2);
console.log(doubled);
\`\`\`

> 运行结果会出现在编辑器底部的控制台里。
`,
  },
};
const ORDER = ['welcome', 'notes', 'lab'];
const MODES = ['wysiwyg', 'source', 'split'];
const MODE_LABEL = { wysiwyg: '所见即所得', source: '源码', split: '分屏' };

export default function LiveEditor() {
  const host = useRef(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return undefined;
    root.innerHTML = shell;
    const $ = (selector) => root.querySelector(selector);
    const $$ = (selector) => [...root.querySelectorAll(selector)];
    const docs = Object.fromEntries(Object.entries(DOCS).map(([id, doc]) => [id, doc.content]));
    let current = 'welcome';
    let mode = 'wysiwyg';
    let editor = null;
    let previewRoot = null;

    const workspace = $('#workspace');
    const pane = $('[data-live-pane]');

    // The static demo markup only ships one tab; build the real document list.
    const strip = $('#tab-strip');
    const tabClose =
      '<button class="tab-close" type="button" title="关闭标签"><svg viewBox="0 0 24 24"><path d="m18 6-12 12M6 6l12 12"/></svg></button>';
    strip.innerHTML =
      ORDER.map(
        (id, index) =>
          `<div class="demo-tab${index === 0 ? ' active' : ''}" data-tab-document="${id}"><span class="file-icon">${MD_ICON}</span><span class="tab-name">${DOCS[id].name}</span>${tabClose}</div>`,
      ).join('') +
      '<button class="tabbar-new" type="button" title="新建文件"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>';

    const tree = $('#file-tree');
    tree.innerHTML =
      `<button class="file-item file-item--folder" type="button"><span class="file-icon">${FOLDER_ICON}</span><span>mokidown-workspace</span></button>` +
      ORDER.map(
        (id, index) =>
          `<button class="file-item${index === 0 ? ' active' : ''}" type="button" data-document="${id}"><span class="file-icon">${MD_ICON}</span><span>${DOCS[id].name}</span><i class="file-delete">×</i></button>`,
      ).join('');
    $('#file-breadcrumb-path').innerHTML =
      '<span class="file-breadcrumb__item"><span class="file-breadcrumb__part">mokidown-workspace</span></span>';

    const recent = $('.recent-list');
    recent.innerHTML = ORDER.map(
      (id) =>
        `<button class="recent-item" type="button" data-document="${id}"><span class="recent-icon">${MD_ICON}</span><span><strong>${DOCS[id].name}</strong><small>${DOCS[id].path}</small></span></button>`,
    ).join('');

    const escapeHtml = (value) =>
      String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

    const segmentButtons = $$('.segment button');
    const viewNames = ['explorer', 'outline', 'recent'];
    const showView = (name) => {
      const index = viewNames.indexOf(name);
      if (index < 0) return;
      segmentButtons.forEach((button, position) => button.classList.toggle('active', position === index));
      const slider = $('.segment__slider');
      if (slider) slider.style.transform = `translateX(${index * 100}%)`;
      $$('[data-sidebar-view]').forEach((view) =>
        view.classList.toggle('active', view.dataset.sidebarView === name),
      );
    };

    const renderOutline = () => {
      const outline = $('#outline-list');
      if (!outline) return;
      const items = docs[current]
        .split('\n')
        .map((line, index) => {
          const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
          return heading
            ? { level: heading[1].length, label: heading[2].replace(/[*_`~]/g, ''), line: index + 1 }
            : null;
        })
        .filter(Boolean);
      outline.innerHTML = items.length
        ? items
            .map(
              (item) =>
                `<button class="outline-item" type="button" data-outline-line="${item.line}" style="padding-left:${12 + (item.level - 1) * 12}px"><span class="outline-toggle"></span><span class="outline-item__badge">H${item.level}</span><span class="outline-item__text">${escapeHtml(item.label)}</span></button>`,
            )
            .join('')
        : '<div class="outline-empty">未找到标题。</div>';
    };

    const updateStatus = () => {
      const source = docs[current];
      const chars = source.replace(/\s/g, '').length;
      $('#word-status').textContent = `${chars} 字符`;
      $('#footer-file-name').innerHTML = `<span class="demo-footer__breadcrumb-part">${DOCS[current].path}</span> <span class="demo-footer__breadcrumb-sep">›</span> <span class="demo-footer__breadcrumb-part">${DOCS[current].name}</span>`;
      const modeButton = $('#mode-toggle');
      if (modeButton) modeButton.title = `${MODE_LABEL[mode]}（点击切换）`;
    };

    const select = (id) => {
      if (!id || id === current) return;
      saveDraft();
      current = id;
      $$('.demo-tab').forEach((tab) =>
        tab.classList.toggle('active', tab.dataset.tabDocument === id),
      );
      $$('.file-item[data-document]').forEach((item) =>
        item.classList.toggle('active', item.dataset.document === id),
      );
      updateStatus();
      renderOutline();
      renderMode();
    };

    const saveDraft = () => {
      if (editor) {
        try {
          docs[mountedDoc] = editor.action(getMarkdown());
        } catch {
          /* editor already disposed */
        }
      }
    };

    const destroyEditor = () => {
      if (editor) {
        void editor.destroy();
        editor = null;
      }
      if (previewRoot) {
        previewRoot.unmount();
        previewRoot = null;
      }
    };

    const renderMode = () => {
      saveDraft();
      destroyEditor();
      workspace.className = `workspace mode-${mode}`;
      pane.innerHTML = '';
      if (mode === 'split') {
        pane.innerHTML =
          '<div class="moki-split"><div class="moki-split__editor md-preview md-preview--milkdown" data-milkdown></div><article class="preview-pane md-preview" data-preview></article></div>';
        mountMilkdown(pane.querySelector('[data-milkdown]'));
        const preview = pane.querySelector('[data-preview]');
        previewRoot = createRoot(preview);
        previewRoot.render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{docs[current]}</ReactMarkdown>);
        return;
      }
      if (mode === 'source') {
        const textarea = document.createElement('textarea');
        textarea.className = 'moki-source';
        textarea.value = docs[current];
        textarea.spellcheck = false;
        textarea.setAttribute('aria-label', 'Markdown 源码');
        textarea.addEventListener('input', () => {
          docs[current] = textarea.value;
          updateStatus();
        });
        pane.appendChild(textarea);
        return;
      }
      const target = document.createElement('div');
      target.className = 'md-preview md-preview--milkdown';
      pane.appendChild(target);
      mountMilkdown(target);
    };

    const mountMilkdown = (target) => {
      target.innerHTML = '';
      const instance = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, target);
          ctx.set(defaultValueCtx, docs[current]);
        })
        .use(commonmark)
        .use(gfm);
      instance
        .create()
        .then(() => {
          editor = instance;
        })
        .catch(() => {
          /* keep the shell usable */
        });
    };

    root.addEventListener('click', (event) => {
      const segment = event.target.closest('.segment button');
      if (segment) {
        showView(viewNames[segmentButtons.indexOf(segment)]);
        return;
      }
      const tab = event.target.closest('[data-tab-document]');
      if (tab) {
        select(tab.dataset.tabDocument);
        return;
      }
      const item = event.target.closest('[data-document]');
      if (item) {
        select(item.dataset.document);
        return;
      }
      if (event.target.closest('#mode-toggle') || event.target.closest('#split-toggle')) {
        const index = MODES.indexOf(mode);
        mode = MODES[(index + 1) % MODES.length];
        updateStatus();
        renderMode();
      }
    });

    updateStatus();
    renderOutline();
    renderMode();

    return () => {
      destroyEditor();
      root.innerHTML = '';
    };
  }, []);

  return <div className="moki-live-editor" ref={host} />;
}
