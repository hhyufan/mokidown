import assert from 'node:assert/strict';

// Author through the application's normal UI. Do not preload or replace the
// document: the recording must show the same input rules a user experiences.
export async function authorHeroNote(page, { click, doubleClick, typeText, hold, chapter, snapshot }) {
  await chapter('新建灵感笔记');
  await click(page.locator('.moki-action--primary'));
  const preview = page.getByRole('button', { name: /预览 \(Ctrl/ });
  if (await preview.isVisible()) await click(preview);
  const editor = page.locator('.milkdown-editor');
  await editor.waitFor();
  assert.equal((await editor.innerText()).trim(), '');
  await doubleClick(page.locator('.tabbar__tab--active .tabbar__tab-name'));
  await page.locator('.tabbar__tab-rename').waitFor();
  await page.keyboard.press('Control+a');
  await typeText('灵感笔记.md');
  await page.keyboard.press('Enter');
  await hold(450);
  await snapshot('00-new-note');
  await click(editor.locator('p').first());

  const prefix = text => page.keyboard.type(text, { delay: 65 });
  const enter = () => page.keyboard.press('Enter');
  const heading = async text => { await prefix('## '); await typeText(text); await enter(); };
  const codeBlock = async lines => {
    await prefix('```javascript ');
    const input = editor.locator('.cm-content').last();
    await input.waitFor();
    await click(input);
    for (let index = 0; index < lines.length; index++) {
      if (index) await enter();
      await typeText(lines[index], { pace: 'code' });
    }
    await page.keyboard.press('Control+Enter');
  };

  await chapter('从零书写 · 标题、强调与引用');
  await prefix('# '); await typeText('灵感笔记'); await enter();
  await typeText('让 '); await prefix('**'); await typeText('灵感'); await prefix('** ');
  await typeText('自然成形。'); await enter();
  await prefix('> '); await typeText('写文档，跑代码，连接知识。');
  await enter(); await enter();

  await chapter('Markdown 基础 · 任务列表');
  await heading('今天的灵感');
  await prefix('- [ ] '); await typeText('记录灵感'); await enter();
  const next = editor.locator('li').last();
  if (await next.getAttribute('data-item-type') !== 'task') await prefix('[ ] ');
  await typeText('验证想法'); await enter(); await enter();
  assert.equal(await editor.locator('li[data-item-type="task"]').count(), 2);
  await click(editor.locator('li[data-item-type="task"]').first(), { position: { x: 9, y: 12 } });
  assert.equal(await editor.locator('li[data-item-type="task"]').first().getAttribute('data-checked'), 'true');
  // Resume at the trailing paragraph after the task checkbox gained focus.
  await click(editor.locator(':scope > p').last());
  await hold(500); await snapshot('01-tasks');

  await chapter('Markdown 基础 · 代码块');
  await heading('在笔记里验证想法');
  await codeBlock([
    'const ideas = ["记录", "尝试", "连接"];',
    'console.log(ideas.join(" → "));',
  ]);
  assert.equal(await editor.locator('.milkdown-code-block').count(), 1);
  await hold(600); await snapshot('02-authored-code');

  await chapter('Markdown 基础 · 表格');
  await heading('从想法到作品');
  await typeText('| 步骤 | 行动 |'); await enter();
  const table = editor.locator('table');
  await table.waitFor();
  await click(table.locator('td').first());
  for (const [index, value] of ['记录', '写下灵感', '实践', '运行代码'].entries()) {
    if (index) await page.keyboard.press('Tab');
    await typeText(value);
  }
  assert.equal(await table.locator('td').count(), 4);
  assert.match(await table.innerText(), /写下灵感/);
  await page.keyboard.press('Control+Enter');
  await hold(600); await snapshot('03-authored-table');

  await heading('连接自己的知识');
  await codeBlock(['const notebook = "我的知识工作台";', 'console.log(notebook);']);
  await prefix('**'); await typeText('本地优先'); await prefix('**');
  await typeText('，每一页笔记都属于你。');
  await hold(700); await snapshot('04-authored-note');
  assert.equal(await editor.locator('.milkdown-code-block').count(), 2);
  assert.equal(await editor.locator('table').count(), 1);
}
