import { expect, test } from '@playwright/test';

async function openEditor(page, content = '', query = '') {
  await page.goto(
    `/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}${query}`,
  );
  const editor = page.locator('.milkdown-editor');
  await expect(editor).toBeVisible();
  return editor;
}

function visibleMarkers(editor) {
  return editor
    .locator('.moki-markdown-marker:visible')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.mokiMarker));
}

// 双击公式正文是进编辑态的手势；气泡到位才算这一下落准了。
// 浏览器那份原生选词比 `dblclick` 事件更晚写进 DOM，插件要再等一拍才把光标收回正文，
// 所以还得等两个虚拟定界符出现——光标落成 collapsed，才轮到下一步按键。
async function editFormula(page, editor, index = 0) {
  const formula = editor.locator('[data-moki-math-mark]').nth(index);
  const box = await formula.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(1);
  await expect.poll(() => visibleMarkers(editor)).toEqual(['$', '$']);
  return formula;
}

test('the writing caret uses the active theme foreground in light and dark modes', async ({
  page,
}) => {
  const editor = await openEditor(page, '正文');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addStyleTag({
    content:
      '.md-preview--milkdown .milkdown .ProseMirror.milkdown-editor:not(.ProseMirror-hideselection) { caret-color: white; }',
  });
  await editor.locator('p').click();
  for (const theme of ['light', 'dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      window.trial.selectTextblock(0);
    }, theme);
    const caret = page.locator('.moki-writing-caret:not([hidden])');
    await expect(caret).toBeVisible();
    const colors = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { nativeCaret: style.caretColor, text: style.color, colorScheme: style.colorScheme };
    });
    await expect(caret).toHaveCSS('background-color', colors.text);
    expect(colors.nativeCaret).toBe('rgba(0, 0, 0, 0)');
    expect(colors.colorScheme.split(' ')).toContain(theme);
    if (theme === 'light') {
      expect(colors.colorScheme.split(' ')).toContain('only');
      expect(colors.text).toBe('rgb(44, 44, 46)');
    }
  }
  await page.keyboard.press('Home');
  const caret = page.locator('.moki-writing-caret:not([hidden])');
  await expect(caret).toBeVisible();
  const before = await caret.evaluate((element) => element.style.transform);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => caret.evaluate((element) => element.style.transform)).not.toBe(before);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(caret).toHaveCount(0);
});

test('code and virtual Markdown carets follow the application theme', async ({ page }) => {
  const editor = await openEditor(page, '```text\nhello\n```\n\n**bold**');
  const code = editor.locator('.cm-content');
  await code.click();
  await page.addStyleTag({
    content:
      '.md-preview--milkdown .milkdown .ProseMirror.milkdown-editor .cm-editor .cm-cursor { border-left-color: white; }',
  });
  const codeCaret = editor.locator('.cm-cursor-primary').first();
  for (const [theme, color] of [
    ['dark', 'rgb(82, 139, 255)'],
    ['light', 'rgb(82, 111, 255)'],
  ]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(codeCaret).toHaveCSS('border-left-color', color);
  }
  await page.evaluate(() => window.trial.selectParagraph('bold'));
  await page.keyboard.press('ArrowLeft');
  const virtual = editor.locator('.moki-markdown-marker--with-caret i');
  await expect(virtual).toHaveCount(1);
  await expect(page.locator('.moki-writing-caret:not([hidden])')).toHaveCount(0);
  expect(
    await virtual.evaluate((node) => getComputedStyle(node, '::after').borderInlineStartColor),
  ).toBe('rgb(44, 44, 46)');
});

test('draft delimiters are muted, completed formatting is solid, and clicking its left edge reveals source markers', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('markdownSmartPairs', []);
  });
  await editor.click();
  await page.keyboard.type('**bold');
  await expect(editor.locator('.moki-markdown-ghost')).toHaveText('**');
  const draft = await editor
    .locator('.moki-markdown-ghost')
    .evaluate((node) => getComputedStyle(node).color);
  await page.keyboard.type('**');
  const bold = editor.locator('strong');
  await expect(bold).toHaveText('bold');
  await expect(editor.locator('.moki-markdown-ghost, .moki-markdown-marker:visible')).toHaveCount(
    0,
  );
  expect(await bold.evaluate((node) => getComputedStyle(node).color)).not.toBe(draft);
  const box = await bold.boundingBox();
  await page.mouse.click(box.x + 0.5, box.y + box.height / 2);
  await expect.poll(() => visibleMarkers(editor)).toEqual(['**', '**']);
  expect(await page.evaluate(() => window.trial.state().selection.anchor)).toBe(1);
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**bold**');
  await page.keyboard.press('End');
  await expect(editor.locator('.moki-markdown-marker:visible')).toHaveCount(0);
});

test('block formula preview keeps the last good render while the source is unparseable', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('Trailing paragraph');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$ ');
  const source = editor.locator('.md-preview__math-source--block');
  await expect(source).toBeVisible();
  const bubble = editor.locator('.moki-math-preview--block');
  // 还没成功渲染过的中间态（`\alph`）不弹气泡，也不报格式错误。
  await page.keyboard.type('\\alph');
  await expect(bubble).toHaveCount(0);
  await page.keyboard.type('a');
  await expect(bubble.locator('.katex')).toBeVisible();
  // 气泡浮在源码输入块的正上方，不压住正在输入的正文。
  const bubbleBox = await bubble.boundingBox();
  const sourceBox = await source.boundingBox();
  expect(bubbleBox.y + bubbleBox.height).toBeLessThan(sourceBox.y);
  await page.keyboard.type('}');
  expect(await source.textContent()).toBe('\\alpha}');
  // 语法不成立时沿用上一次成功的样子，位置一动不动，避免输入过程闪成报错。
  await expect(bubble.locator('.katex')).toBeVisible();
  expect((await bubble.textContent()).trim()).not.toMatch(/公式格式识别错误|Invalid formula/);
  await page.keyboard.press('Backspace');
  // 输入态的源码正文本身也排在容器中线上，而不只是预览气泡居中。
  const typed = await source.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.firstChild);
    const rect = range.getBoundingClientRect();
    return rect.left + rect.width / 2;
  });
  const previewed = await bubble.locator('.katex').boundingBox();
  await page.keyboard.press('ArrowUp');
  // 退出源码态后居中位置必须重合，否则公式会从行左跳到行中。
  const rendered = await editor.locator('.md-preview__math--block .katex').boundingBox();
  const center = rendered.x + rendered.width / 2;
  expect(Math.abs(previewed.x + previewed.width / 2 - center)).toBeLessThan(2);
  expect(Math.abs(typed - center)).toBeLessThan(2);
  await expect(bubble).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$$\n\\alpha\n$$');
});

test('inline formula shows a preview bubble only while its source is revealed', async ({
  page,
}) => {
  // 上面留一段正文：贴着编辑区上沿时气泡会翻到下方，这里要验的是默认摆法。
  const editor = await openEditor(page, '上面一行\n\n$x^2$ Tail');
  const bubble = editor.locator('.moki-math-preview--inline');
  const formula = editor.locator('[data-moki-math-mark]');
  const cover = editor.locator('.moki-math-preview--cover .katex');
  await expect(cover).toBeVisible();
  await expect(bubble).toHaveCount(0);
  // 双击才算进编辑态；气泡浮在正文上方，覆盖层同时收走，同一处不会排两份字。
  await editFormula(page, editor);
  await expect(editor.locator('.moki-math-source')).toHaveText('x^2');
  await expect(bubble.locator('.katex')).toBeVisible();
  await expect(cover).toHaveCount(0);
  const bubbleBox = await bubble.boundingBox();
  const formulaBox = await formula.boundingBox();
  expect(bubbleBox.y + bubbleBox.height).toBeLessThan(formulaBox.y);
  await page.keyboard.press('End');
  await expect(bubble).toHaveCount(0);
  await expect(cover).toBeVisible();
});

test('double-clicking a rendered formula opens its source untouched', async ({ page }) => {
  const editor = await openEditor(page, '正文 $x^2$ 结尾\n\n$$\n\\alpha \\beta\n$$\n');
  await editor.locator('.md-preview__math--block').dblclick();
  const source = editor.locator('.md-preview__math-source--block');
  await expect(source).toBeVisible();
  expect(await source.textContent()).toBe('\\alpha \\beta');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');
  await editFormula(page, editor);
  await expect(editor.locator('.moki-math-source')).toHaveText('x^2');
  // 双击只是揭开源码，一个字符都没少。
  expect(await page.evaluate(() => window.trial.markdown())).toContain('正文 $x^2$ 结尾');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$$\n\\alpha \\beta\n$$');
});

test('leaving the formula source keeps the formula on the pixels its preview showed', async ({
  page,
}) => {
  const editor = await openEditor(page, '正文段落\n\n$$\n\\alpha\n$$\n');
  await editor.locator('.md-preview__math--block').dblclick();
  const previewed = await editor.locator('.moki-math-preview--block .katex').boundingBox();
  await page.keyboard.press('ArrowUp');
  await expect(editor.locator('.moki-math-preview--block')).toHaveCount(0);
  const rendered = await editor.locator('.md-preview__math--block .katex').boundingBox();
  // 中心对齐才比左边距可靠：气泡有左右内边距，渲染公式却占满整行。
  expect(
    Math.abs(previewed.x + previewed.width / 2 - (rendered.x + rendered.width / 2)),
  ).toBeLessThan(1);
  expect(Math.abs(previewed.y - rendered.y)).toBeLessThan(1);
  expect(Math.abs(previewed.height - rendered.height)).toBeLessThan(1);
});

test('the inline bubble is centred on the formula it previews', async ({ page }) => {
  const check = async (editor, sourceSelector) => {
    const bubble = editor.locator('.moki-math-preview--inline');
    await expect(bubble).toBeVisible();
    const box = await bubble.boundingBox();
    const slot = await editor.locator(sourceSelector).boundingBox();
    // 中线对齐才谈得上"气泡指着这条公式"：左对齐时正文一变宽，气泡就整体偏左。
    expect(Math.abs(box.x + box.width / 2 - (slot.x + slot.width / 2))).toBeLessThan(2);
    // 气泡贴着公式所在那一行：旧写法挂在段落起点，这里会空出一整行的高度。
    expect(slot.y - box.y - box.height).toBeGreaterThanOrEqual(0);
    expect(slot.y - box.y - box.height).toBeLessThan(20);
    // 尾巴由 ::after 画出，正对着下方的公式；描边走真实边框，几何不变。
    expect(await bubble.evaluate((node) => getComputedStyle(node, '::after').content)).not.toBe(
      'none',
    );
    expect(await bubble.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe(
      'rgb(229, 229, 231)',
    );
  };
  // 草稿：`$$` 还没闭合，气泡挂在 widget 自带的零宽锚点上，锚点摆在正文正中。
  const typing = await openEditor(page, '字'.repeat(120));
  await typing.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' $$ \\alpha');
  await check(typing, '.moki-math-draft');
  // 双击进编辑态：这一次气泡挂在 math mark 自己的盒子上，走的是另一条定位路径。
  const revealed = await openEditor(page, `Above\n\n$x^2$ 尾巴`);
  await editFormula(page, revealed);
  await check(revealed, '[data-moki-math-mark]');
});

test('double-clicking into the source keeps the bubble on its own formula', async ({ page }) => {
  // 两条正文一模一样的公式：点开第二条，气泡得跟着走，不能留在第一条上。
  const editor = await openEditor(page, '正文段落\n\n$x^2$ 中间 $x^2$ 结尾');
  const second = await editFormula(page, editor, 1);
  const bubble = await editor.locator('.moki-math-preview--inline').boundingBox();
  const formula = await second.boundingBox();
  expect(Math.abs(bubble.x + bubble.width / 2 - (formula.x + formula.width / 2))).toBeLessThan(2);
  expect(bubble.y + bubble.height).toBeLessThan(formula.y);
});

test('the inline bubble moves out of the way when it does not fit', async ({ page }) => {
  // 第一行写公式：上方就是编辑区上沿，气泡应当翻到正文下方，尾巴跟着翻到气泡上沿。
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$ x^{2}+y^{2}=z^{2}');
  const bubble = editor.locator('.moki-math-preview--inline');
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((node) => node.dataset.mokiMathPreviewSide)).toBe('below');
  const flipped = await bubble.boundingBox();
  const slot = await editor.locator('.moki-math-draft').boundingBox();
  expect(flipped.y).toBeGreaterThanOrEqual(slot.y + slot.height);
  const tail = await bubble.evaluate((node) => {
    const style = getComputedStyle(node, '::after');
    return { top: style.borderTopWidth, bottom: style.borderBottomWidth, y: style.top };
  });
  expect(tail).toEqual({ top: '1px', bottom: '0px', y: '-6px' });
  // 有地方待着就不翻：公式所在行上方还有整段正文，气泡保持浮在正文之上。
  const room = await openEditor(page, '上面一行\n\n下面一行');
  await room.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' $$ x^{2}');
  const roomBubble = room.locator('.moki-math-preview--inline');
  await expect(roomBubble).toBeVisible();
  expect(await roomBubble.evaluate((node) => node.dataset.mokiMathPreviewSide ?? '')).toBe('');
  // 上下左右都放得下，就不该有任何位移。
  expect(
    await roomBubble.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--moki-preview-shift'),
    ),
  ).toBe('0px');
  // 横向：气泡比正文宽很多又会探出右边界时，按差值平移刚好收回来的距离。
  // \rule 渲染出来比它那串源码宽得多，是少数能把气泡撑得比正文更宽的公式；
  // 段落右对齐让公式贴住正文右缘，等价于在窄分屏里写到行尾。
  const edge = await openEditor(page, '上面一行\n\n下面一行');
  await edge.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.ProseMirror p { text-align: right }';
    document.head.append(style);
  });
  await edge.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' $$ \\rule{200pt}{1pt}');
  const edgeBubble = edge.locator('.moki-math-preview--inline');
  await expect(edgeBubble).toBeVisible();
  const shifted = await edgeBubble.boundingBox();
  const pane = await page.locator('.md-preview--milkdown').boundingBox();
  const wide = await edge.locator('.moki-math-draft').boundingBox();
  expect(shifted.x + shifted.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
  expect(shifted.x).toBeGreaterThan(pane.x);
  // 气泡整块挪了位，尾巴还得正对着公式：inset 从边框内侧量起，所以补 1px。
  const tailX = await edgeBubble.evaluate(
    (node) =>
      node.getBoundingClientRect().x +
      parseFloat(getComputedStyle(node, '::after').insetInlineStart) +
      1,
  );
  expect(Math.abs(tailX - (wide.x + wide.width / 2))).toBeLessThan(2);
});

test('the block preview is the formula itself, with no box around it', async ({ page }) => {
  const editor = await openEditor(page, '正文段落\n\n$$\n\\alpha\n$$\n');
  await editor.locator('.md-preview__math--block').dblclick();
  const bubble = editor.locator('.moki-math-preview--block');
  await expect(bubble).toBeVisible();
  // 块级公式居中独立成行，预览不需要指向谁，也不需要轮廓：边框、底色、投影都会
  // 在收尾那一刻消失，留下一次位移。
  const bare = await bubble.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      tail: getComputedStyle(node, '::after').content,
      border: `${style.borderTopWidth} ${style.borderTopStyle}`,
      background: style.backgroundColor,
      shadow: style.filter,
    };
  });
  expect(bare).toEqual({
    tail: 'none',
    border: '0px none',
    background: 'rgba(0, 0, 0, 0)',
    shadow: 'none',
  });
});

test('a backslash in formula source opens the symbol completion list and typing narrows it', async ({
  page,
}) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  const rows = list.getByRole('option');
  const source = editor.locator('.md-preview__math-source--block');
  await editor.click();
  await page.keyboard.type('$$ ');
  // 折成块级源码态之后列表就收走了：块里只在半个控制序列之后出现，空正文那一档归行内草稿。
  await expect(list).toHaveCount(0);
  await page.keyboard.type('\\');
  await expect(list).toBeVisible();
  // 只打了个反斜杠时列全所有常用符号：不认得编码的人也能挑。
  const total = await rows.count();
  expect(total).toBeGreaterThan(10);
  await page.keyboard.type('sqr');
  await expect(rows).toHaveCount(1);
  await expect(list).toContainText('\\sqrt{}');
  const menuBox = await list.boundingBox();
  const token = await source.evaluate((node) => {
    const start = node.textContent.lastIndexOf('\\');
    let seen = 0;
    for (const child of node.childNodes) {
      const offset = start - seen;
      if (offset < child.textContent.length) {
        const range = document.createRange();
        range.setStart(child, offset);
        range.setEnd(child, offset + 1);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, bottom: rect.bottom };
      }
      seen += child.textContent.length;
    }
    throw new Error('backslash not found');
  });
  // 列表挂在半个控制序列的正下方，视线跟着打字的位置走。
  expect(menuBox.y).toBeGreaterThanOrEqual(token.bottom);
  expect(menuBox.y).toBeLessThanOrEqual(token.bottom + 12);
  expect(Math.abs(menuBox.x - token.left)).toBeLessThan(2);
  // 方向键选中之后 Enter 归补全；选中项只剩一个时不按方向键也算，见下面两条。
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await source.textContent()).toBe('\\sqrt{}');
  await expect(list).toHaveCount(0);
  await page.keyboard.type('2');
  expect(await source.textContent()).toBe('\\sqrt{2}');
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$$\n\\sqrt{2}\n$$');
  await expect(editor.locator('.md-preview__math--block .katex')).toBeVisible();
});

test('the completion list separates a macro from the text behind the caret', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('$$ e^2');
  const source = editor.locator('.md-preview__math-source--block');
  // 光标挪到正文最前，插入的宏与紧跟的字母之间必须留分隔空格，否则 \pi 会吞掉 e。
  // Home 在这种源码块里不会移动光标，只能用 harness 直接落下选区。
  await page.evaluate(() => window.trial.selectTextblock(0));
  const list = page.locator('.moki-math-completion');
  await expect(list).toHaveCount(0);
  await page.keyboard.type('\\');
  await list.getByRole('option', { name: /π/ }).click();
  // 选中之前的那个 `\` 算进替换范围，不会留下多余的反斜杠。
  expect(await source.textContent()).toBe('\\pi e^2');
  await page.keyboard.press('ArrowUp');
  // 报错的宏会被 KaTeX 原样印成 <mtext>，没有 mtext 才算真的解析成功。
  const block = editor.locator('.md-preview__math--block');
  expect(await block.getAttribute('data-value')).toBe('\\pi e^2');
  await expect(block.locator('mtext')).toHaveCount(0);
  await expect(block.locator('.katex')).toBeVisible();
});

test('Escape keeps the completion list away until the next control sequence', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  const source = editor.locator('.md-preview__math-source--block');
  await editor.click();
  await page.keyboard.type('$$ \\al');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  // 同一段编码接着往下打不该再把列表弹回来，否则躲不掉。
  await page.keyboard.type('pha');
  await expect(list).toHaveCount(0);
  expect(await source.textContent()).toBe('\\alpha');
  // 换到下一段控制序列，列表重新弹出来。
  await page.keyboard.type(' \\b');
  await expect(list).toBeVisible();
  // 编码打全（`\beta`）就自动收：列表开着会拦住方向键，而向上/向下是离开源码态的手势。
  await page.keyboard.type('eta');
  await expect(list).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$$\n\\alpha \\beta\n$$');
});

test('$$ away from the line start stays an inline draft, not a block', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$ ');
  // 行中写的 `$$` 不再抢块级入口：成对草稿的两枚定界符中间只摊着一个空格，
  // 还算不出式子，所以那两枚照常摆在屏幕上，等用户接着写。
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  await expect(editor.locator('.md-preview__math-source--block')).toHaveCount(0);
  await expect(editor.locator('.moki-math-draft-marker')).toHaveCount(0);
  // 只有行首的空对 + 空格才归块级输入规则管。
  const block = await openEditor(page);
  await block.click();
  await page.keyboard.type('$$ ');
  await expect(block.locator('.md-preview__math-source--block')).toBeVisible();
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');
});

test('three dollars at the line start open the block formula', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('$$');
  // 第三下不走「把光标递到定界符外面」那条路：行首一个独占整段的空对说的是「这条公式要摆在
  // 正文之外」，与 `$$ ` 那一下同一个去处——空的源码块，光标落在里面接着写。
  await page.keyboard.type('$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('$$\n$$\n');
  await expect(editor.locator('.moki-math-completion')).toHaveCount(0);
  await page.keyboard.type('x^2');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('$$\nx^2\n$$\n');
  // 行中还挂着别的字就不算块级入口：第三下仍是「这条行内公式写完了」，光标挪到定界符外面，
  // 那两枚照旧摊着等用户接着写。
  const mid = await openEditor(page);
  await mid.click();
  await page.keyboard.type('正文 $$$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 $$\n');
  // 贴着数字的 `$` 是价钱符号，连写几枚都不开公式。
  const price = await openEditor(page);
  await price.click();
  await page.keyboard.type('100$$$');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('100$$$\n');
});

test('the formula row gates the dollar pair gesture along with its deletion', async ({ page }) => {
  const setFormula = (enabled) =>
    page.evaluate(async (enabled) => {
      const { default: config } = await import('/src/store/useConfigStore.js');
      const { normalizeMarkdownPairs } = await import('/src/utils/markdownPairs.js');
      const pairs = normalizeMarkdownPairs();
      config.getState().setConfig(
        'markdownSmartPairs',
        enabled ? pairs : pairs.filter((symbol) => symbol !== '$'),
      );
    }, enabled);
  const caret = () => page.evaluate(() => window.trial.state().selection.anchor);

  // 开着才有成对手势：两下 `$` 把光标放进中间（那一格是段落里第 2 个位置），第三下升成块级。
  const on = await openEditor(page);
  await setFormula(true);
  await on.click();
  await page.keyboard.type('$$');
  expect(await caret()).toBe(2);
  await expect(on.locator('.moki-math-draft-marker')).toHaveCount(2);
  await page.keyboard.type('$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');

  // 关掉之后 `$` 只是普通字符：光标不跳、第三下不开块级，空格也凑不出空对，`$$ ` 那条
  // 输入规则要的「收尾那枚在光标右边」就不成立了。
  const off = await openEditor(page);
  await setFormula(false);
  await off.click();
  await page.keyboard.type('$$');
  expect(await caret()).toBe(3);
  await expect(off.locator('.moki-math-draft-marker')).toHaveCount(0);
  await page.keyboard.type('$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('$$$\n');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
  // 收尾即折不归这项管：`$x^2$` 敲完照样是公式，那是预览判定，不是配对补全。
  const typed = await openEditor(page);
  await setFormula(false);
  await typed.click();
  await page.keyboard.type('$x^2$');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('$x^2$\n');
  await expect(typed.locator('[data-moki-math-mark]')).toHaveCount(1);
});

test('a fresh $$ pair opens the whole symbol table before any control sequence', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  const rows = list.getByRole('option');
  await editor.click();
  await page.keyboard.type('正文 $$');
  // 开界符刚落下就把整张表摊开：不认得 LaTeX 编码的人这时候最需要它。
  await expect(list).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(10);
  // `$$` 中间还空着不预览：一只空框只会让人以为式子已经排出来了。
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(0);
  // 那两枚 `$` 由手势替用户补上，摆法与双击进入编辑态的那对定界符一致（淡色可见）。
  const markers = editor.locator('.moki-math-draft-marker');
  await expect(markers).toHaveCount(2);
  await expect(markers.first()).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  const box = await list.boundingBox();
  const opening = await markers.first().boundingBox();
  const bottom = await editor.locator('p').first().evaluate((node) => {
    // Chromium 会把行尾的空 Range 报成整行开头，所以量已有文字的真实矩形，取最后一行的下沿。
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].at(-1).bottom;
  });
  // 列表跟着光标走：光标停在开界符右边那一格，而不是钉在段落头上。
  expect(Math.abs(box.x - (opening.x + opening.width))).toBeLessThan(2);
  expect(box.y).toBeGreaterThanOrEqual(bottom);
  expect(box.y).toBeLessThanOrEqual(bottom + 12);
  const item = await rows.filter({ hasText: '\\alpha' }).boundingBox();
  await page.mouse.click(item.x + item.width / 2, item.y + item.height / 2);
  // 选中的宏落在草稿正文里，草稿从这一刻起才有正文可预览。
  expect(await page.evaluate(() => window.trial.markdown())).toContain('正文 $\\alpha $');
  await expect(list).toHaveCount(0);
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(1);
  // 老手感里收尾的那对 `$` 一齐，第一下跳过定界符、当场折成公式，第二下被右边界吃掉。
  await page.keyboard.type('$$');
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(1);
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/正文 \$\\alpha\$/);
});

// 初次编辑与双击进入编辑态得看着是同一件事：定界符的淡色、正文的源码配色与等宽字形，
// 两边逐项对上。折成 mark 的那一下只少掉两枚 `$`，字色字体一跳不停。
function mathLook(page, selector) {
  return page.locator(selector).first().evaluate((node) => {
    const { color, backgroundColor, fontFamily, fontStyle, fontWeight } = getComputedStyle(node);
    return { color, background: backgroundColor, font: `${fontFamily} ${fontStyle} ${fontWeight}` };
  });
}

test('the first draft is drawn exactly like the double-click edit state', async ({ page }) => {
  const edit = await openEditor(page, '正文 $x^2$ 结尾');
  await editFormula(page, edit);
  const [editMarker, editBody] = [
    await mathLook(edit, '.moki-markdown-marker'),
    await mathLook(edit, '.moki-math-source'),
  ];
  expect(editBody.color).not.toBe(editMarker.color);

  const typing = await openEditor(page);
  await typing.click();
  await page.keyboard.type('正文 $$\\alpha');
  await expect(typing.locator('.moki-math-draft-marker')).toHaveCount(2);
  expect(await mathLook(typing, '.moki-math-draft-marker')).toEqual(editMarker);
  expect(await mathLook(typing, '.moki-math-source')).toEqual(editBody);
});

test('a pair with nothing typed inside stays two plain dollar signs', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$');
  await expect(editor.locator('.moki-math-draft-marker')).toHaveCount(2);
  // 折叠之前得先看这对 `$` 里有没有输入：空的没什么可折，光标一走，那两枚就照常
  // 以普通文字摆在句子里，跟用户自己打的 `$$` 一模一样。
  await page.keyboard.press('End');
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(0);
  await expect(editor.locator('.moki-math-draft-marker')).toHaveCount(0);
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 $$\n');
  // 两枚之间只摊着一个空格的也一样：那连草稿都算不上。
  const spaced = await openEditor(page);
  await spaced.click();
  await page.keyboard.type('正文 $$ ');
  await page.keyboard.press('End');
  await expect(spaced.locator('[data-moki-math-mark]')).toHaveCount(0);
  // 浏览器在文本节点边界上打出来的空格是不换行空格（U+00A0），跟成对手势无关，
  // 只在断言前把它当普通空格看。
  expect(
    (await page.evaluate(() => window.trial.markdown())).replace(/\u00a0/g, ' '),
  ).toBe('正文 $ $\n');
});

test('the draft is measured as the whole expression, not up to the caret', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$\\int');
  const bubble = editor.locator('.moki-math-preview--inline');
  // `<annotation>` 里就是预览真正拿到的那串源码，比看排出来的字形更好判。
  await expect(bubble.locator('annotation')).toHaveText('\\int');
  // 按左键退到宏名中间：屏幕上的式子一个字没变，预览就不该改口成「属于」。
  await page.keyboard.press('ArrowLeft');
  await expect(bubble.locator('annotation')).toHaveText('\\int');
  await expect(bubble.locator('.katex-html')).toHaveText('∫');
  await page.keyboard.press('ArrowLeft');
  await expect(bubble.locator('annotation')).toHaveText('\\int');
});

test('a template picked from the list keeps its braces inside the measured draft', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('正文 $$');
  await list.getByRole('option').filter({ hasText: '\\int_{}' }).click();
  const bubble = editor.locator('.moki-math-preview--inline');
  // 挑完模板光标落在第一对花括号里，右边那半个 `}` 还算同一个式子，预览不该退回上一个宏。
  await expect(bubble.locator('annotation')).toHaveText('\\int_{}');
  await expect(bubble.locator('.katex-error')).toHaveCount(0);
  await page.keyboard.type('2');
  await expect(bubble.locator('annotation')).toHaveText('\\int_{2}');
  await expect(bubble.locator('.katex-html')).toContainText('∫');
});

test('Enter takes the only candidate without another key press', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('正文 $$\\sqr');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  // 只剩一个候选时不存在替用户做选择，方向键那一步是多余的。
  const bubble = editor.locator('.moki-math-preview--inline');
  await expect(bubble.locator('annotation')).toHaveText('\\sqrt{}');
  await expect(list).toHaveCount(0);
  // Enter 没漏给编辑器：段落还是那一段，草稿也没被断行打断。
  expect((await page.evaluate(() => window.trial.state())).doc.content).toHaveLength(1);
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/^正文 \$\\sqrt\{\}\$\n$/);
});

test('Enter with several candidates left stays the editor’s own', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('正文 $$\\in');
  await expect(list.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Enter');
  // 还没写完的编码该由接着打字的人自己决定，列表不许抢走 Enter。
  expect((await page.evaluate(() => window.trial.state())).doc.content).toHaveLength(2);
  // 列表没接走这一下，也没有替用户挑 `\infty`；Enter 交给编辑器，按行内公式的规矩抬成块级。
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 \n\n$$\n\\in\n$$\n');
  expect(await page.evaluate(() => window.trial.state().doc.content[1].content[0].text)).toBe(
    '\\in',
  );
  await expect(list.getByRole('option')).toHaveCount(2);
  // 光标还贴在 `\in` 后面，列表就照旧跟着抬进块级的式子——块级源码态认的是同一张符号表。
  await expect(list).toBeVisible();
});

test('a macro still being typed is not handed to KaTeX', async ({ page }) => {
  const editor = await openEditor(page);
  const bubbles = editor.locator('.moki-math-preview--inline');
  await editor.click();
  await page.keyboard.type('正文 $$\\in');
  // `\in` 既是表里 `\infty`、`\int_{}` 的前缀，也是 KaTeX 认得的「属于」：
  // 打字路上的半成品不喂进去，否则看着就像补全挑错了符号。
  await expect(bubbles).toHaveCount(0);
  await page.keyboard.type('fty');
  await expect(bubbles.locator('annotation')).toHaveText('\\infty');
  await expect(bubbles.locator('.katex-html')).toHaveText('∞');
});

test('a completion picked with the caret inside the macro replaces the whole macro', async ({ page }) => {
  const editor = await openEditor(page, '正文 $\\in$');
  const list = page.locator('.moki-math-completion');
  const rows = list.getByRole('option');
  await editor.locator('[data-moki-math-mark]').dblclick();
  // 双击交回来的原本是 `\` 这一个「词」的选区，列表只在光标落进控制序列里之后才出现；
  // 这一下由预览插件收进正文，光标直接停在 `\in` 中间，列表按整段 `\in` 过滤，
  // 而不是只认光标左边那截、把整张 18 行的表摊开。
  await expect(rows).toHaveText(['∞\\infty', '∫\\int_{}']);
  await rows.filter({ hasText: '\\infty' }).click();
  // 替换掉的是整个 `\in`，宏名尾巴不会留下游离的 `in`（那样排出来是「∞in」）。
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/^正文 \$\\infty \$\n$/);
  await expect(editor.locator('.moki-math-preview').locator('annotation')).toHaveText('\\infty');
});

// 双击交回来的原本是浏览器那份选词，公式刚被第一下重新排过，Chromium 找不回词、退化成
// 整行选中：两头都在公式外面，方向键与打字全都跑偏（`正文 $x^2$ 结尾` 打一个字整段没了），
// 定界符和补全列表也因为选区非空一起收走。所以这一下由预览插件接管，光标落在指针底下。
const caretUnderPointer = async (page, fraction, content = '正文 $x^2$ 结尾') => {
  const editor = await openEditor(page, content);
  const box = await editor.locator('[data-moki-math-mark]').boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2, { clickCount: 2 });
  // 空光标才画虚拟定界符：量到两个 `$` 就说明这一下落成了光标，而不是选区。
  await expect.poll(() => visibleMarkers(editor)).toEqual(['$', '$']);
  await page.keyboard.type('Q');
  return page.evaluate(() => window.trial.markdown());
};

test('double-clicking a formula leaves the caret under the pointer, inside its source', async ({ page }) => {
  // 指针在左半边和右半边各落一次，都停在指针底下，而不是整段被换掉。
  expect(await caretUnderPointer(page, 0.05)).toContain('正文 $xQ^2$ 结尾');
  expect(await caretUnderPointer(page, 0.95)).toContain('正文 $x^Q2$ 结尾');
});

test('double-clicking a one-character formula keeps the next letter inside it', async ({ page }) => {
  // 只有一个字符的正文没有严格向内的光标位：停在左边界还得把 mark 记成待插入的 marks，
  // 否则这一笔字算公式外面的普通文字，`$` 跟着一起散掉。
  expect(await caretUnderPointer(page, 0.5, '正文 $x$ 结尾')).toContain('正文 $Qx$ 结尾');
});

// 键盘事件排进浏览器输入队列就算送达，渲染进程却还没处理完：连着按完再读光标会读到慢一拍的位置。
// 所以每一按都 poll 一次期望位置，既等它落定，也顺手把走位钉死。
const pressTo = async (page, key, head) => {
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => window.trial.state().selection.head)).toBe(head);
};

// 进编辑态只认两下手势：双击（上面两条）和贴在公式边上的退格/删除（下面两条）。
// 光标怎么走到边界上用真实手势：点在公式一侧的白话文字里，Home/End 对齐行首行尾（7 与 16），
// 再走三格——夹具里公式两头正好各是三个字符（`正文 ` 与 ` 结尾`），落点即 10 与 13。
const walkToMathEdge = async (page, editor, side) => {
  const box = await editor.locator('[data-moki-math-mark]').boundingBox();
  await page.mouse.click(side === 'right' ? box.x + box.width + 30 : box.x - 30, box.y + box.height / 2);
  await pressTo(page, side === 'right' ? 'End' : 'Home', side === 'right' ? 16 : 7);
  for (let step = 1; step <= 3; step++) {
    await pressTo(page, side === 'right' ? 'ArrowLeft' : 'ArrowRight', side === 'right' ? 16 - step : 7 + step);
  }
};

test('backspace at a rendered formula edge opens its source and keeps the character', async ({ page }) => {
  const editor = await openEditor(page, '上面一行\n\n正文 $x^2$ 结尾');
  await walkToMathEdge(page, editor, 'right');
  await page.keyboard.press('Backspace');
  // 原本这一下吃掉正文最后一个字符（`$x^2$` → `$x^$`）。现在它算「我要改这个公式」：
  // 源码翻出来、光标留在尾巴上，一个字符都不动。想删整段就再按一下，或先选中再删。
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 $x^2$ 结尾\n');
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(1);
  await page.keyboard.type('\\alpha');
  // 贴在边界打字本该顺着 inclusive:false 跑到公式外面，编辑档把 mark 重新按住，这一笔才落进正文尾巴。
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 $x^2\\alpha$ 结尾\n');
});

test('delete at the other side opens the same formula instead of taking its delimiter apart', async ({ page }) => {
  const editor = await openEditor(page, '上面一行\n\n正文 $x^2$ 结尾');
  await walkToMathEdge(page, editor, 'left');
  await page.keyboard.press('Delete');
  // 行内公式的两个 `$` 不在文档里，是画出来的：把它当一对标记拆掉，交回 remark 的是裸 LaTeX，
  // 屏幕上反而凭空多出两个 `$`。这一下与右边界那侧同规矩——掀源码，不删字。
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 $x^2$ 结尾\n');
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(1);
  await page.keyboard.type('\\alpha ');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 $\\alpha x^2$ 结尾\n');
});

// `$` 左边那一格是白话文字的地盘：在这儿打字，每一笔都该留在公式外面。
// 从前这里只有第一笔守规矩——落完之后光标正好停在新排出来的左边界，插件把 mark 按回去，
// 第二笔起全灌进正文头上（`正文 AB$x^2$` 变成 `正文 A$ABx^2$` 那种）。
test('typing at the left edge keeps every stroke in the prose', async ({ page }) => {
  const editor = await openEditor(page, '上面一行\n\n正文 $x^2$ 结尾');
  await walkToMathEdge(page, editor, 'left');
  await page.keyboard.type('A');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 A$x^2$ 结尾\n');
  await page.keyboard.type('B');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 AB$x^2$ 结尾\n');
  // 正文里连着打字，不该被公式吃掉一笔。
  await page.keyboard.type('CD');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 ABCD$x^2$ 结尾\n');
  // 在正文这侧打字不该顺手把公式摊开：两枚定界符都还没画出来。
  await expect.poll(() => visibleMarkers(editor)).toEqual([]);
});

// 贴着尾巴打字现在写正文：右边界改规矩后，两边打字都落在公式外面，不续写公式。
test('typing at the right edge now writes in the prose', async ({ page }) => {
  const editor = await openEditor(page, '上面一行\n\n正文 $x^2$ 结尾');
  await walkToMathEdge(page, editor, 'right');
  await page.keyboard.type('A');
  expect(await page.evaluate(() => window.trial.markdown())).toBe(
    '上面一行\n\n正文 $x^2$A 结尾\n',
  );
});

// 点在画出来的左 `$` 上，光标该停在源码这一行。气泡就挂在公式开头同一个位置，
// 兜底量坐标时按「位置之后」读 DOM，读到的其实是气泡的盒子，光标于是跳到气泡那一行：
// 第一行的公式气泡朝下（看着像跑到下一行），第二行的气泡朝上（看着像跑到上一行）。
const clickLeftDelimiter = async (page, content) => {
  const editor = await openEditor(page, content);
  const box = await editor.locator('[data-moki-math-mark]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => visibleMarkers(editor)).toEqual(['$', '$']);
  const dollar = await editor.locator('.moki-markdown-marker').first().boundingBox();
  const caret = page.locator('.moki-writing-caret');
  // 画光标排在 requestAnimationFrame 上：先等它从「点正文那一下」的位置挪开再量，不然量到旧位置。
  const before = await caret.evaluate((element) => element.style.transform);
  await page.mouse.click(dollar.x + dollar.width / 2, dollar.y + dollar.height / 2);
  await expect.poll(() => caret.evaluate((element) => element.style.transform)).not.toBe(before);
  const drawn = page.locator('.moki-writing-caret:not([hidden])');
  await expect(drawn).toBeVisible();
  return {
    head: await page.evaluate(() => window.trial.state().selection.head),
    caret: await drawn.boundingBox(),
    source: await editor.locator('[data-moki-math-mark]').boundingBox(),
    bubble: await editor.locator('.moki-math-preview--inline').boundingBox(),
  };
};

test('clicking the left delimiter draws the caret on the source line, not on the bubble', async ({
  page,
}) => {
  for (const content of ['正文 $\\alpha^2$ 结尾', '上面一行\n\n正文 $\\alpha^2$ 结尾']) {
    const { caret, source, bubble, head } = await clickLeftDelimiter(page, content);
    const measured = JSON.stringify({ head, caret, source, bubble });
    // 这一行摆得下就朝上、摆不下就朝下：两种翻法都得让光标留在源码那一行。
    expect(bubble.y > source.y, measured).toBe(content.startsWith('正文'));
    expect(Math.abs(caret.x - source.x), measured).toBeLessThanOrEqual(2);
    expect(caret.y, measured).toBeGreaterThanOrEqual(source.y - 2);
    expect(caret.y + caret.height, measured).toBeLessThanOrEqual(source.y + source.height + 2);
  }
});

test('a formula clicked open shows its source with the bubble, and keeps editing inside', async ({ page }) => {
  const editor = await openEditor(page, '上面一行\n\n正文 $x^2$ 结尾');
  const bubbles = editor.locator('.moki-math-preview--inline');
  const box = await editor.locator('[data-moki-math-mark]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => visibleMarkers(editor)).toEqual(['$', '$']);
  // 气泡跟着源码走：点开那一下就摆着，方向键在源码里挪位也甩不掉。
  await expect(bubbles).toHaveCount(1);
  // 点正文正中落成的光标在 `x` 之后（11），方向键只在源码里挪位。
  await pressTo(page, 'ArrowLeft', 10);
  await expect(bubbles).toHaveCount(1);
  await pressTo(page, 'ArrowRight', 11);
  await expect(bubbles).toHaveCount(1);
  // 接着打字只改这一段的源码：贴在边界那一笔照样落进正文里。
  await page.keyboard.type('Q');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('正文 $xQ^2$ 结尾');
  await expect(bubbles).toHaveCount(1);
  // 退格删掉的还是刚打进去的那个字符，公式本身不动。
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n正文 $x^2$ 结尾\n');
});

// 单击那一下不该有中间态。从前按下还没抬起的那一段里，预览插件按实时选区把源码摊开，
// 实时语法却把定界符冻在点击前的选区上（原生选词与拖动选中期间不许正文在指针底下重排），
// 于是按住的一拍屏幕上只有 `\alpha^2`、两头缺 `$`，抬起才补齐。逐帧钉住：源码一摊开，两枚就得同时在。
const watchFlipFrames = (page) =>
  page.evaluate(() => {
    window.__frames = [];
    const sample = () => [
      document.querySelector('.moki-math-source') ? 1 : 0,
      [...document.querySelectorAll('.moki-markdown-marker[data-moki-marker="$"]')].filter(
        (node) => node.getBoundingClientRect().width > 0,
      ).length,
    ];
    let frames = 0;
    const loop = () => {
      window.__frames.push(sample());
      if (++frames < 200) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

test('a held single click never paints the source without its delimiters', async ({ page }) => {
  const editor = await openEditor(page, '正文 $\\alpha^2$ 结尾');
  const box = await editor.locator('[data-moki-math-mark]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await watchFlipFrames(page);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect.poll(() => visibleMarkers(editor)).toEqual(['$', '$']);
  const frames = await page.evaluate(() => window.__frames);
  const revealed = frames.findIndex(([source]) => source);
  expect(revealed).toBeGreaterThan(-1);
  expect(frames.slice(revealed).every(([, markers]) => markers === 2)).toBe(true);
});

// 行内公式的正文是一个 mark 区间，mark 跨不了段落：默认的 Enter 会把 `$a + b$` 从中间
// 劈成 `$a$` 与 `$ + b$` 两条公式，写回文件就是一段坏语法（实测过）。所以这一下改成
// 「这条式子要独立成块」：整条抬成块级源码态、原句被隔成前后两段，式子本身还是那一行，
// 一个换行符都不插——想分行就再按一次，块级源码态里的 Enter 本来就是插换行。
function docBlocks(page) {
  return page.evaluate(() => {
    const text = (node) => node.text || (node.content || []).map(text).join('');
    return window.trial.state().doc.content.map((block) => ({ type: block.type, text: text(block) }));
  });
}
// 光标是不是正踩在公式收尾那格上（抬不动的地方 Enter 只做这一件事）。公式的收尾坐标从 doc
// 的 JSON 里算：文本节点占自身长度，容器占「开 + 内容 + 闭」，与 PM 的 nodeSize 同一套；
// 用的三个夹具在公式之前既没有空段落也没有原子块，这套算法不会歧义。
function caretAtFormulaTail(page) {
  return page.evaluate(() => {
    const size = (node) =>
      node.text !== undefined
        ? node.text.length
        : node.content
          ? 2 + node.content.reduce((sum, child) => sum + size(child), 0)
          : 1;
    const tail = (node, start) => {
      if (node.text !== undefined)
        return node.marks?.some((mark) => mark.type === 'math') ? start + node.text.length : null;
      let pos = start + 1;
      for (const child of node.content || []) {
        const found = tail(child, pos);
        if (found !== null) return found;
        pos += size(child);
      }
      return null;
    };
    const doc = window.trial.state().doc;
    const head = window.trial.state().selection.head;
    let pos = 0;
    for (const child of doc.content) {
      const to = tail(child, pos);
      if (to !== null) return { to, head };
      pos += size(child);
    }
    return { to: null, head };
  });
}
test('Enter inside an inline formula lifts it onto its own line as a block formula', async ({
  page,
}) => {
  const editor = await openEditor(page, '正文 $a + b$ 结尾');
  await editFormula(page, editor);
  await page.keyboard.press('Enter');
  expect(await docBlocks(page)).toEqual([
    { type: 'paragraph', text: '正文 ' },
    { type: 'math_source_block', text: 'a + b' },
    { type: 'paragraph', text: ' 结尾' },
  ]);
  expect(await page.evaluate(() => window.trial.markdown())).toBe(
    '正文 \n\n$$\na + b\n$$\n\n 结尾\n',
  );
  // 块级源码态一到位，预览就排在源码块上方；光标还停在按 Enter 前那个字符后面（`a` 之后）。
  await expect(editor.locator('.moki-math-preview--block')).toHaveCount(1);
  await page.keyboard.type('\\gamma ');
  expect(await page.evaluate(() => window.trial.markdown())).toBe(
    '正文 \n\n$$\na\\gamma  + b\n$$\n\n 结尾\n',
  );
});

test('Shift+Enter inside an inline formula lifts it the same way instead of a hard break', async ({
  page,
}) => {
  const editor = await openEditor(page, '正文 $a + b$ 结尾');
  await editFormula(page, editor);
  await page.keyboard.press('Shift+Enter');
  expect(await page.evaluate(() => window.trial.markdown())).toBe(
    '正文 \n\n$$\na + b\n$$\n\n 结尾\n',
  );
  expect(await docBlocks(page).then((blocks) => blocks.map(({ type }) => type))).toEqual([
    'paragraph',
    'math_source_block',
    'paragraph',
  ]);
});

test('Enter in an unfinished $$ pair lifts it into a block formula, stranding no delimiter', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$\\alpha + \\beta');
  await page.keyboard.press('Enter');
  // 草稿那两枚字面 `$` 连同裁掉的空白一起退场，文档里不该留下落单的定界符，也不该多一个空行。
  expect(await page.evaluate(() => window.trial.markdown())).toBe(
    '正文 \n\n$$\n\\alpha + \\beta\n$$\n',
  );
  expect(await docBlocks(page)).toEqual([
    { type: 'paragraph', text: '正文 ' },
    { type: 'math_source_block', text: '\\alpha + \\beta' },
  ]);
});

test('Enter in an empty $$ pair opens an empty block editor instead of a stray dollar', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$');
  await expect(editor.locator('.moki-math-draft-marker')).toHaveCount(2);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 \n\n$$\n$$\n');
  expect(await docBlocks(page)).toEqual([
    { type: 'paragraph', text: '正文 ' },
    { type: 'math_source_block', text: '' },
  ]);
});

test('Enter just outside an inline formula still splits the paragraph and keeps the formula', async ({
  page,
}) => {
  await openEditor(page, '正文 $a + b$ 结尾');
  // 光标停在句尾，离公式差一格。这里不用「点段落再按 End」：单击之后 live-syntax 会延一拍把
  // 光标按点击落点重新按上去，End 有时被盖回段首（实测过，跟公式无关，纯文本段落一样中），
  // 这一下就变成了在段首断行。selectTextblock 直接把光标钉在段末。
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 $a + b$ 结尾\n\n');
  // docBlocks 量的是节点文字，不含画出来的定界符；公式完整与否由上面那条 markdown 盯。
  expect(await docBlocks(page)).toEqual([
    { type: 'paragraph', text: '正文 a + b 结尾' },
    { type: 'paragraph', text: '' },
  ]);
});

// 列表项的内容表达式是「paragraph block*」，块级式子塞得进去，但塞进去就是缩进在项里的一行。
// 按 Enter 要的「这条式子独立成块」是跟这条列表同级，所以列表照式子劈成前后两段：前半截留着
// 式子前面的话，后半截从「尾巴」开始接着数（有序列表续原编号），式子夹在中间顶格排。
function topBlocks(page) {
  return page.evaluate(() => {
    const text = (node) => {
      if (node.type === 'math_block') return node.attrs?.value || '';
      return node.text || (node.content || []).map(text).join('');
    };
    return window.trial.state().doc.content.map((block) => ({
      type: block.type,
      value: block.attrs?.value ?? '',
      order: block.attrs?.order,
      kids: block.content?.length ?? 0,
      text: text(block),
    }));
  });
}

for (const [name, opener, type, order] of [
  ['bulleted', '- ', 'bullet_list', undefined],
  ['ordered', '1. ', 'ordered_list', 1],
]) {
  test(`Enter inside a formula in a ${name} list item keeps the block inside the list`, async ({
    page,
  }) => {
    const editor = await openEditor(page, `${opener}正文 $a + b$ 尾巴\n${opener}第二项`);
    await editFormula(page, editor);
    await page.keyboard.press('Enter');
    const markdown = await page.evaluate(() => window.trial.markdown());
    // 式子没被劈开，列表保持完整，公式在当前项内部，尾巴另起一项。
    expect(markdown).not.toMatch(/\$a\$|\$ \+ b\$/);
    expect(await topBlocks(page)).toEqual([
      { type, value: '', order, kids: 3, text: '正文 a + b 尾巴第二项' },
    ]);
    // 读回来还是这个形状：列表完整，公式在项里面（序列化会裁掉段落首尾空白）。
    await openEditor(page, markdown);
    expect(await topBlocks(page)).toEqual([
      { type, value: '', order, kids: 3, text: '正文a + b尾巴第二项' },
    ]);
  });
}

// 任务列表（- [ ]）也是 bullet_list，只是 list_item 多了 checked 属性。
// 公式抬升后 checked 属性要保留，尾巴那项继承原项的 checked。
test('Enter inside a formula in a task list item keeps the block inside and preserves checked', async ({
  page,
}) => {
  const editor = await openEditor(page, '- [ ] 正文 $a + b$ 尾巴\n- [ ] 第二项');
  await editFormula(page, editor);
  await page.keyboard.press('Enter');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).not.toMatch(/\$a\$|\$ \+ b\$/);
  // 任务列表的容器仍是 bullet_list，公式在项内部。
  expect(await topBlocks(page)).toEqual([
    { type: 'bullet_list', value: '', order: undefined, kids: 3, text: '正文 a + b 尾巴第二项' },
  ]);
});

// 式子正好在列表项开头（前面没话）：公式仍然在列表项里面，前面补一个空段落，尾巴另起一项。
test('Enter inside a formula at the start of a list item keeps the block inside the list', async ({
  page,
}) => {
  const editor = await openEditor(page, '- $a + b$ 尾巴\n- 第二项');
  await editFormula(page, editor);
  await page.keyboard.press('Enter');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).not.toMatch(/\$a\$|\$ \+ b\$/);
  expect(await topBlocks(page)).toEqual([
    { type: 'bullet_list', value: '', order: undefined, kids: 3, text: 'a + b 尾巴第二项' },
  ]);
});

// 表格里：格子只收一个段落，块级式子中插不进去，所以抽走式子后格子里首尾接回一句，式子作为
// 表格的兄弟节点排在整张表之后。表格的行与其余格子一个字都不动。
test('Enter inside a formula in a table cell puts the block after the table', async ({ page }) => {
  const editor = await openEditor(
    page,
    '| 甲 | 乙 |\n| --- | --- |\n| 正文 $a + b$ 尾巴 | 丁 |\n| 戊 | 己 |',
  );
  await editFormula(page, editor);
  await page.keyboard.press('Enter');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).not.toMatch(/\$a\$|\$ \+ b\$/);
  expect(await topBlocks(page)).toEqual([
    { type: 'table', value: '', order: undefined, kids: 3, text: '甲乙正文 尾巴丁戊己' },
    { type: 'math_source_block', value: '', order: undefined, kids: 1, text: 'a + b' },
  ]);
  await openEditor(page, markdown);
  expect(await topBlocks(page)).toEqual([
    { type: 'table', value: '', order: undefined, kids: 3, text: '甲乙正文 尾巴丁戊己' },
    { type: 'math_block', value: 'a + b', order: undefined, kids: 0, text: 'a + b' },
  ]);
});

// 引用块走的是同一条路：式子抬进引用里面，写回文件再读回来还是这一份，式子整条一行。
test('Enter inside a formula in a blockquote lifts it into a block inside the quote', async ({
  page,
}) => {
  const editor = await openEditor(page, '> 引用 $a + b$ 尾巴');
  await editFormula(page, editor);
  await page.keyboard.press('Enter');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).not.toMatch(/\$a\$|\$ \+ b\$/);
  expect(markdown).toContain('> $$\n> a + b\n> $$');
  // 读回来还是那一条式子、还在同一个引用里。序列化会抹掉段落首尾的空白，所以比的是式子那几行，
  // 不是整份字节；块级公式是原子节点，docBlocks 那种「把文字串起来」的量法看不见它的 value。
  await openEditor(page, markdown);
  const again = await page.evaluate(() => window.trial.markdown());
  expect(again).toContain('$$\n> a + b\n> $$');
  expect(again).not.toMatch(/\$a\$|\$ \+ b\$/);
});

// 抬不动的地方只剩标题：heading 只收行内，式子抬走就把标题本身弄没了。Enter 这一下只把光标
// 送出式子，文档一个字都不动。mark 跨不了段落，从中间断行就是两段坏语法；光标已经在公式外面，
// 下一次 Enter 走的就是普通正文的断行，式子整条留在前面那一行。
test('Enter inside a formula in a heading only steps the caret out and keeps the mark whole', async ({
  page,
}) => {
  const editor = await openEditor(page, '# 标题 $a + b$ 尾巴');
  await editFormula(page, editor);
  const before = await page.evaluate(() => window.trial.markdown());
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.trial.markdown())).toBe(before);
  const { to, head } = await caretAtFormulaTail(page);
  expect({ head, to }).toEqual({ head: to, to });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$a + b$');
});

test('a completion narrows to the closest code when several macros share the prefix', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('正文 $$\\in');
  const rows = list.getByRole('option');
  await expect(rows).toHaveText(['∞\\infty', '∫\\int_{}']);
  // 按左键退进宏名，查询仍是那整段 `\in`，挑 `\infty` 换掉的也是整段。
  await page.keyboard.press('ArrowLeft');
  await rows.filter({ hasText: '\\infty' }).click();
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/^正文 \$\\infty \$\n$/);
  await expect(editor.locator('.moki-math-preview--inline .katex-html')).toHaveText('∞');
});

test('the table written by $$ goes away as soon as the body stops being a macro', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('价格 $$');
  await expect(list).toBeVisible();
  // 接着打的是普通内容，列表当场收走，不该赖在句子里。
  await page.keyboard.type('100');
  await expect(list).toHaveCount(0);
  // 手势补出的那枚收尾 `$` 跟着正文一起留在句子里：写进文件就是 `$100$`，
  // 与 remark 认它是一条公式是同一回事，两边不会各说各话。
  expect(await page.evaluate(() => window.trial.markdown())).toContain('价格 $100$');
});

test('a $$ that is not a delimiter keeps the symbol table closed', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  // 贴着数字的 `$` 是正文里的价钱符号，连写两个也不该当定界符。
  await page.keyboard.type('1$$');
  await expect(list).toHaveCount(0);
  // 代码里的 `$` 是字面字符：同一张表在代码片段里不打扰。
  const code = await openEditor(page, '代码 `x`');
  // 点在 `<code>` 盒子的中心会落在虚拟反引号上，正文里的 `x` 才真的在代码里。
  const spot = await code.locator('code').evaluate((node) => {
    const text = [...node.childNodes].find((child) => child.textContent === 'x');
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('$$');
  await expect(list).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toContain('`x$$`');
});

test('typing the closing $ folds the formula and hands the sentence back', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  // 草稿是 `$$` 开的，收尾也得凑齐第二个 `$` 才折：只打一个 `$` 时正文还是字面文本。
  await page.keyboard.type('正文 $$ \\alpha$$ 尾巴');
  // 收尾那一下把正文折成 math mark：草稿气泡收走，覆盖层接管排版。
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(1);
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(0);
  await expect(editor.locator('.moki-math-preview--cover .katex')).toHaveCount(1);
  // 收尾 `$` 之后再打字写的是正文，不能被吸进公式里。紧跟行内公式的空格会被浏览器
  // 存成不换行空格，与直接在正文里写 `$x^2$` 完全一致，所以这里只按空白匹配。
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/正文 \$\\alpha\$\s尾巴/);
});

test('revealing an existing formula keeps typing inside its body', async ({ page }) => {
  const editor = await openEditor(page, '$x^2$');
  await editFormula(page, editor);
  const source = editor.locator('.moki-math-source');
  await expect(source).toHaveText('x^2');
  // 走到正文尾巴接着打：mark 是 inclusive:false，这一笔本该落到公式外面，
  // 编辑档把它按回正文里，也就当场触发不了"写完"的折叠判断。
  await pressTo(page, 'End', 4);
  await page.keyboard.type('\\beta');
  await expect(source).toHaveText('x^2\\beta');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('$x^2\\beta$\n');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('paragraph');
});

test('an abandoned $$ stays visible source instead of an empty formula', async ({ page }) => {
  const editor = await openEditor(page, 'tail');
  await page.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.type('z $$ $');
  // 空正文不是公式：折过去会留下看不见、又吃掉分隔符的 mark，所以它一直是普通文字。
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(0);
  await expect(editor.locator('.moki-math-preview--inline')).toHaveCount(0);
  await page.keyboard.press('Home');
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toContain('z $$ $tail');
});

test('an abandoned block formula stays source instead of an empty render', async ({ page }) => {
  const editor = await openEditor(page, '上面一行');
  // 光标钉在段末，别再走「点段落 + Control+End」：单击之后延一拍重放的落点有时把 Control+End
  // 盖回段首（实测过，与公式无关），那一下 `$$ ` 就打到了正文左边。
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$ ');
  // 源码块空着走开，折过去只剩一只空框，写回文件还平白留下 `$$\n\n$$` 这段没写完的语法。
  // 与上面那条行内空对同一条规矩：没什么可折的就摊着，等用户回来接着写。
  await page.evaluate(() => window.trial.selectTextblock(0));
  const source = editor.locator('.md-preview__math-source--block');
  await expect(source).toBeVisible();
  await expect(editor.locator('.md-preview__math--block')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n$$\n$$\n');
  // 只摊着一串空白的也不算写完。
  await page.evaluate(() => window.trial.selectTextblock(1));
  await page.keyboard.type('   ');
  await page.evaluate(() => window.trial.selectTextblock(0));
  await expect(source).toBeVisible();
  await expect(editor.locator('.md-preview__math--block')).toHaveCount(0);
  // 写上正文再走开，才轮到折成渲染态。
  await page.evaluate(() => window.trial.selectTextblock(1));
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await page.keyboard.type('x^2');
  await page.evaluate(() => window.trial.selectTextblock(0));
  await expect(editor.locator('.md-preview__math--block')).toBeVisible();
  expect(await page.evaluate(() => window.trial.markdown())).toBe('上面一行\n\n$$\nx^2\n$$\n');
});

test('horizontal arrows enter each visible marker character before crossing a line boundary', async ({
  page,
}) => {
  const editor = await openEditor(page, 'Above\n\n**bold**');
  await page.evaluate(() => window.trial.selectTextblock(1));
  const position = () => page.evaluate(() => window.trial.state().selection.anchor);
  const start = await position();
  const marker = editor.locator('.moki-markdown-marker--with-caret');
  for (const before of ['*', '']) {
    await page.keyboard.press('ArrowLeft');
    await expect(marker).toHaveAttribute('data-marker-before', before);
    expect(await position()).toBe(start);
  }
  await page.keyboard.press('ArrowLeft');
  expect(await position()).toBe(start - 2);
  for (const before of ['', '*', '**']) {
    await page.keyboard.press('ArrowRight');
    await expect(marker).toHaveAttribute('data-marker-before', before);
    expect(await position()).toBe(start);
  }
  await page.keyboard.press('ArrowRight');
  expect(await position()).toBe(start + 1);
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('Above\n\n**bold**');
  expect(await page.evaluate(() => window.trial.dirty())).toBe(false);
});

for (const [content, keys] of [
  ['##### 1. LINQ 概述', ['ArrowLeft']],
  ['**注意**：查询', ['ArrowRight', 'ArrowRight', 'ArrowRight']],
]) {
  test(`the blinking marker caret aligns with the adjacent text in ${content}`, async ({
    page,
  }) => {
    const editor = await openEditor(page, content);
    await page.evaluate(() => window.trial.selectTextblock(0));
    for (const key of keys) await page.keyboard.press(key);
    const caret = await editor
      .locator('.moki-markdown-marker--with-caret i')
      .evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        const text = element.closest('p, h5').lastChild;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const bounds = range.getBoundingClientRect();
        const top = element.getBoundingClientRect().top + parseFloat(style.top);
        return {
          top,
          bottom: top + parseFloat(style.height),
          textTop: bounds.top,
          textBottom: bounds.bottom,
          animation: style.animationName,
        };
      });
    expect(Math.abs(caret.top - caret.textTop)).toBeLessThan(1);
    expect(Math.abs(caret.bottom - caret.textBottom)).toBeLessThan(1);
    expect(caret.animation).toBe('ProseMirror-cursor-blink');
  });
}

test('typing Markdown task markers converts bullet items into unchecked and checked tasks', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('- [ ] first');
  await expect(editor.locator('li[data-item-type="task"]')).toHaveAttribute(
    'data-checked',
    'false',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [X]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect(editor.locator('li[data-item-type="task"]').last()).toHaveAttribute(
    'data-checked',
    'true',
  );
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toContain('[ ] first');
  expect(markdown).toContain('[x] second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('- [ ] ');
  await page.keyboard.type('third');
  await expect(editor.locator('li[data-item-type="task"]').last()).toHaveAttribute(
    'data-checked',
    'false',
  );
  expect(await page.evaluate(() => window.trial.markdown())).toContain('[ ] third');
});

test('moving left from prose lands after the closing code fence and inserts outside it', async ({
  page,
}) => {
  const editor = await openEditor(page, '`321`1');
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('ArrowLeft');
  await expect(editor.locator('.moki-markdown-marker--with-caret')).toHaveAttribute(
    'data-marker-before',
    '`',
  );
  await page.keyboard.type('A');
  await expect(editor.locator('code')).toHaveText('321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321`A1');
  await page.evaluate(() => window.trial.selectTextblock(0));
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(editor.locator('.moki-markdown-marker--with-caret')).toHaveAttribute(
    'data-marker-before',
    '`',
  );
  await page.keyboard.type('B');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321`BA1');
});

test('links and formulas render immediately after typing and reveal their syntax at the leading boundary', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('[site](https://example.com');
  await expect(editor.locator('.moki-markdown-ghost')).toHaveText(['[', '](']);
  await page.keyboard.type(')');
  await expect(editor.locator('a')).toHaveText('site');
  await page.evaluate(() => window.trial.selectTextblock(0));
  await expect.poll(() => visibleMarkers(editor)).toEqual(['[', '](https://example.com)']);
  // 挪光标走插件，不走按键：程序化选区之后，定界符还要一拍才落到 DOM 上，那一拍的重新
  // 渲染会把浏览器刚摆好的光标抹掉，紧接着的回车就切到段落开头去了。
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('$x^2$');
  await expect(editor.locator('[data-moki-math-mark]')).toHaveCount(1);
  await expect(editor.locator('.moki-math-preview--cover .katex')).toBeVisible();
  // 公式与链接在这一点上故意不同：mark 是 inclusive:false，光标贴在左边界读起来是
  // 「在旁边打字」，所以定界符不掀开——进编辑态只认双击与贴边退格。
  await page.evaluate(() => window.trial.selectTextblock(1));
  await expect(editor.locator('.moki-math-source')).toHaveCount(0);
  await expect(editor.locator('.moki-math-preview--cover .katex')).toBeVisible();
  await page.evaluate(() => window.trial.selectTextblock(1, 'end'));
  await expect(editor.locator('.moki-math-preview--cover .katex')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('[***styled**](https://styled.example) plain');
  await expect(editor.locator('a[href="https://styled.example"][href]')).toHaveText('styled');
  await expect(
    editor.locator(
      'a[href="https://styled.example"] strong, strong a[href="https://styled.example"]',
    ),
  ).toHaveCount(1);
});

test('moving across syntax boundaries does not dirty the file and read-only preview has no editing decorations', async ({
  page,
}) => {
  const content = '## Title\n\n*italic* ~~removed~~ `code`\n';
  const editor = await openEditor(page, content);
  const original = await page.evaluate(() => window.trial.markdown());
  const heading = editor.locator('h2');
  const properties = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'marginInlineEnd'];
  const rendered = await heading.evaluate(
    (node, props) => props.map((prop) => getComputedStyle(node, '::before')[prop]),
    properties,
  );
  await page.evaluate(() => window.trial.selectTextblock(0));
  const source = heading.locator('.moki-markdown-heading-marker:visible');
  await expect(source).toHaveAttribute('data-moki-marker', '##');
  expect(
    await source.evaluate(
      (node, props) => props.map((prop) => getComputedStyle(node)[prop]),
      properties,
    ),
  ).toEqual(rendered);
  await page.evaluate(() => window.trial.selectTextblock(1));
  await expect(editor.locator('p .moki-markdown-marker:visible')).toHaveCount(2);
  await page.mouse.click(1, 1);
  await expect(editor.locator('.moki-markdown-marker:visible')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe(original);
  expect(await page.evaluate(() => window.trial.dirty())).toBe(false);
  await openEditor(page, content, '&readonly');
  await expect(editor.locator('.moki-markdown-marker, .moki-markdown-ghost')).toHaveCount(0);
});

test('asterisk completion pairs two strokes and upgrades the third stroke to bold', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  const position = () => page.evaluate(() => window.trial.state().selection.anchor);
  await page.keyboard.type('**');
  await expect(editor.locator('p')).toHaveText('**');
  expect(await position()).toBe(2);
  await page.keyboard.type('*');
  await expect(editor.locator('p')).toHaveText('****');
  expect(await position()).toBe(3);
  await page.keyboard.press('Backspace');
  await expect(editor.locator('p')).toHaveText('**');
  expect(await position()).toBe(2);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p')).toHaveText('****');
  expect(await position()).toBe(3);
  await page.keyboard.type('dasdas');
  await expect(editor.locator('strong')).toHaveText('dasdas');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**dasdas**');
  await page.keyboard.type('** plain');
  await expect(editor.locator('strong')).toHaveText('dasdas');
  await expect(editor.locator('p')).toHaveText('dasdas plain');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**italic');
  await expect(editor.locator('em')).toHaveText('italic');
  await page.keyboard.press('Enter');
  await page.keyboard.type('*** ');
  await expect(editor.locator('hr')).toHaveCount(1);
});

for (const order of ['left first', 'right first']) {
  test(`adding stars around existing text (${order}) renders bold immediately`, async ({
    page,
  }) => {
    const editor = await openEditor(page, '前面 已有文字 后面');
    const select = (offset) =>
      page.evaluate((offset) => {
        window.trial.selectTextblock(0);
        window.trial.dispatch((state) =>
          state.tr.setSelection(state.selection.constructor.create(state.doc, offset + 1)),
        );
      }, offset);
    await select(order === 'left first' ? 3 : 7);
    await page.keyboard.type('**');
    await expect(editor.locator('p')).toHaveText(
      order === 'left first' ? '前面 **已有文字 后面' : '前面 已有文字** 后面',
    );
    await select(order === 'left first' ? 9 : 3);
    await page.keyboard.type('**');
    await expect(editor.locator('strong')).toHaveText('已有文字');
    expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe(
      '前面 **已有文字** 后面',
    );
  });
}

for (const [source, offset, selector, expected] of [
  ['Before **** after', 9, 'strong', 'Before **中文** after'],
  ['Before __ after', 8, 'em', 'Before _中文_ after'],
  ['Before ~~~~ after', 9, 'del', 'Before ~~中文~~ after'],
  ['Before `` after', 8, 'code', 'Before `中文` after'],
]) {
  test(`committing IME text between the markers in ${source} renders immediately`, async ({
    page,
  }) => {
    const editor = await openEditor(page, source);
    await page.evaluate((offset) => {
      window.trial.selectTextblock(0);
      window.trial.dispatch((state) =>
        state.tr.setSelection(state.selection.constructor.create(state.doc, offset + 1)),
      );
    }, offset);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.imeSetComposition', {
        text: 'zhong',
        selectionStart: 5,
        selectionEnd: 5,
      });
      await page.keyboard.insertText('中文');
      await expect(editor.locator(selector)).toHaveText('中文');
      expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe(expected);
    } finally {
      await cdp.detach();
    }
  });
}

test('undo restores the empty bold markers after committing a long-lived IME candidate', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('***');
  await page.waitForTimeout(550);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    await expect(editor.locator('p')).toHaveText('**中文**');
    // An unchanged candidate can be confirmed after the editor history delay.
    await page.waitForTimeout(650);
    await page.keyboard.insertText('中文');
    await expect(editor.locator('strong')).toHaveText('中文');
    await page.keyboard.press('Control+z');
    await expect(editor.locator('p')).toHaveText('****');
    await expect(editor.locator('strong')).toHaveCount(0);
  } finally {
    await cdp.detach();
  }
});

test('paired deletion removes one emphasis layer, keeps code text and supports undo and redo', async ({
  page,
}) => {
  const editor = await openEditor(page, '**213**\n\n`Task.Run`\n\n(outer [inside])');
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.press('Backspace');
  await expect(editor.locator('em')).toHaveText('213');
  await page.keyboard.press('Control+z');
  await expect(editor.locator('strong')).toHaveText('213');
  await page.keyboard.press('Control+y');
  await expect(editor.locator('em')).toHaveText('213');
  await page.keyboard.press('Backspace');
  await expect(editor.locator('em')).toHaveCount(0);
  await expect(editor.locator('p').first()).toHaveText('213');
  await page.evaluate(() => window.trial.selectTextblock(1));
  await page.keyboard.press('Delete');
  await expect(editor.locator('p').nth(1)).toHaveText('Task.Run');
  await expect(editor.locator('code')).toHaveCount(0);
  await page.evaluate(() => window.trial.selectTextblock(2));
  await page.keyboard.press('Delete');
  await expect(editor.locator('p').nth(2)).toHaveText('outer [inside]');
});

// 草稿的两枚 `$` 是真字符（折叠之前摊在文档里的那对），所以它与星号那类标记同一条规矩：
// 删掉一枚，另一枚跟着一起走，中间的 LaTeX 正文留在句子里。两边都算，与光标从哪边贴上
// 去无关。「公式」这一项关掉之后退回一枚一枚删。
test('deleting one dollar sign of a formula draft takes the pair and keeps the body', async ({
  page,
}) => {
  const draft = async () => {
    const editor = await openEditor(page);
    await editor.click();
    await page.keyboard.type('正文 $$x^2');
    // 手势补出的收尾那枚此刻还贴在光标右边：整对 `$` 摊在文档里，等着删。
    expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 $x^2$\n');
    return editor;
  };
  const caret = (offset) =>
    page.evaluate((position) => {
      window.trial.dispatch((state) =>
        state.tr.setSelection(state.selection.constructor.create(state.doc, position)),
      );
    }, offset);

  await draft();
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 x^2\n');

  await draft();
  await caret(5);
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 x^2\n');

  // 这一项关掉之后成对删除没了。草稿还是趁开着的时候用手势摊出来，紧接着才关掉这一项：
  // 光标没挪，那对字面 `$` 就还摊在句子里，等这一下删除。
  await draft();
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    const { normalizeMarkdownPairs } = await import('/src/utils/markdownPairs.js');
    config.getState().setConfig(
      'markdownSmartPairs',
      normalizeMarkdownPairs().filter((symbol) => symbol !== '$'),
    );
  });
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.trial.markdown())).toBe('正文 $x^2\n');
});

for (const [markup, selector] of [
  ['**abcdef**', 'strong'],
  ['`abcdef`', 'code'],
]) {
  test(`clicking rendered ${selector} draws no interim caret and inserts at the clicked character boundary`, async ({
    page,
  }) => {
    const editor = await openEditor(page, `before ${markup} after`);
    const point = await editor.locator(selector).evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 3);
      range.collapse(true);
      const { left, top, height } = range.getBoundingClientRect();
      return { x: left, y: top + height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(editor).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    await expect(editor.locator('.moki-markdown-marker:visible')).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.insertText('X');
    await expect(editor.locator(selector)).toHaveText('abcXdef');
  });
}

test('dragging from rendered bold text keeps the native text selection', async ({ page }) => {
  const editor = await openEditor(page, 'Before **abcdef** after');
  const [start, end] = await editor.locator('strong').evaluate((element) =>
    [1, 5].map((offset) => {
      const range = document.createRange();
      range.setStart(element.firstChild, offset);
      range.collapse(true);
      const { left, top, height } = range.getBoundingClientRect();
      return { x: left, y: top + height / 2 };
    }),
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('bcde');
  await editor.locator('strong').dblclick();
  await expect
    .poll(() => page.evaluate(() => window.getSelection().toString().trim()))
    .toBe('abcdef');
});

test('clicking the closing backtick or following prose keeps the intended insertion point', async ({
  page,
}) => {
  const editor = await openEditor(page, '`321321`3333');
  await editor.locator('code').click();
  const lastMarker = editor.locator('.moki-markdown-marker:visible').last();
  const tick = await lastMarker.boundingBox();
  await page.mouse.click(tick.x + tick.width * 0.8, tick.y + tick.height / 2);
  await expect(editor.locator('.moki-markdown-marker--with-caret')).toHaveAttribute(
    'data-marker-before',
    '`',
  );
  await page.keyboard.insertText('A');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321321`A3333');

  await editor.locator('code').click();
  const point = await editor.locator('p').evaluate((paragraph) => {
    const text = paragraph.lastChild;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    const { left, top, height } = range.getBoundingClientRect();
    return { x: left, y: top + height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('B');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321321`A33B33');
});

test('two backticks place the caret between them and the next text renders as inline code', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('``');
  await expect(editor.locator('p')).toHaveText('``');
  expect(await page.evaluate(() => window.trial.state().selection.anchor)).toBe(2);
  await page.keyboard.type('Task.Run');
  await expect(editor.locator('code')).toHaveText('Task.Run');
  await page.keyboard.type('` outside');
  await expect(editor.locator('code')).toHaveText('Task.Run');
  await expect(editor.locator('p')).toHaveText('Task.Run outside');
});

test('the language menu floats under the unfinished fence without shifting the next heading', async ({
  page,
}) => {
  const editor = await openEditor(page, `Before\n\n## Next\n\n${'After\n\n'.repeat(30)}`);
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('Enter');
  const fence = editor.locator('p').nth(1);
  const heading = editor.getByRole('heading', { name: 'Next' });
  const headingBefore = await heading.boundingBox();
  await page.keyboard.type('```');
  const menu = page.locator('.moki-code-language-dropdown');
  await expect(menu).toBeVisible();
  await expect(fence).toHaveText('```');
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(
    await menu.evaluate(
      (element) => !document.querySelector('.md-preview--milkdown').contains(element),
    ),
  ).toBe(true);
  const alignedWithFence = async () => {
    const marker = await fence.locator('.moki-markdown-ghost').boundingBox();
    const box = await menu.boundingBox();
    return (
      Math.abs(box.x - marker.x) <= 2 &&
      box.y >= marker.y + marker.height - 2 &&
      box.y <= marker.y + marker.height + 8
    );
  };
  await expect.poll(alignedWithFence).toBe(true);
  expect((await heading.boundingBox()).y).toBe(headingBefore.y);
  await page.locator('.md-preview--milkdown').evaluate((pane) => {
    pane.scrollTop = 24;
  });
  await expect.poll(async () => (await heading.boundingBox()).y).toBeLessThan(headingBefore.y);
  await expect.poll(alignedWithFence).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(menu.getByRole('menuitem').first()).toHaveCSS('outline-width', '1px');
  await page.keyboard.press('Control+z');
  await expect(menu).toBeHidden();
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await expect(fence).toHaveText('``');
  await page.keyboard.type('`');
  await menu.getByText('Python', { exact: true }).click();
  await expect(editor.locator('.language-button')).toContainText(/python/i);
  await expect(editor.locator('.cm-content')).toBeFocused();
});

test('Enter or a complete language confirms the fence, and a space leaves it pending', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('``` ');
  await expect(editor.locator('p')).toHaveText('```');
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(editor.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await page.keyboard.type('java');
  await expect(editor.locator('p')).toHaveText(/^```\s*java$/);
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await page.keyboard.type('script');
  await expect(editor.locator('.language-button')).toContainText(/javascript/i);
  await expect(editor.locator('.cm-content')).toBeFocused();
});

test('Enter after auto-opening a Rust fence confirms it without inserting a blank first line', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('```rust');
  const code = editor.locator('.cm-content');
  await expect(code).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('let x = 1;');
  const source = () => page.evaluate(() => window.trial.markdown().trimEnd());
  await expect.poll(source).toBe('```rust\nlet x = 1;\n```');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('let y = 2;');
  await expect.poll(source).toBe('```rust\nlet x = 1;\nlet y = 2;\n```');
});

test('Enter inside an existing Rust block can still insert an intentional blank line', async ({
  page,
}) => {
  const editor = await openEditor(page, '```rust\nlet x = 1;\n```');
  await page.evaluate(() => window.trial.selectCode('start'));
  await expect(editor.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.trial.markdown().trimEnd()))
    .toBe('```rust\n\nlet x = 1;\n```');
});

test('individual pair preferences disable backticks and square brackets while leaving round brackets enabled', async ({
  page,
}) => {
  const editor = await openEditor(page);
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('markdownSmartPairs', ['(']);
    window.trial.selectTextblock(0);
  });
  await page.keyboard.type('``` ');
  await expect(editor.locator('.cm-editor')).toHaveCount(0);
  await page.keyboard.type('([');
  await expect(editor.locator('p')).toHaveText('``` ([)');
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('markdownSmartPairsEnabled', false);
    window.trial.selectTextblock(0, 'end');
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('(');
  await expect(editor.locator('p').last()).toHaveText('(');
});

for (const renderer of ['preview', 'milkdown']) {
  test(`${renderer} marks complete quote and code blocks in a document selection`, async ({
    page,
  }) => {
    const markdown = 'Before\n\n> Quote text\n\n```js\nconst answer = 42;\n```\n\nAfter';
    const query = renderer === 'milkdown' ? '&renderer=milkdown' : '';
    await page.goto(`/tests/preview-harness.html?content=${encodeURIComponent(markdown)}${query}`);
    const editor = page.locator(renderer === 'milkdown' ? '.milkdown-editor' : '.md-preview');
    const quote = editor.locator('blockquote');
    const code = editor.locator(
      renderer === 'milkdown' ? '.milkdown-code-block' : '.md-runnable-code',
    );
    await expect(code).toBeVisible();
    if (renderer === 'milkdown') {
      await editor.locator('p').first().click();
      await page.keyboard.press('Control+a');
    } else {
      await editor.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(range);
      });
    }
    await expect(quote).toHaveClass(/moki-block-selected/);
    await expect(code).toHaveClass(/moki-block-selected/);
    await expect(code).not.toHaveCSS('box-shadow', 'none');
    await editor.locator('p').last().click();
    await expect(quote).not.toHaveClass(/moki-block-selected/);
    await expect(code).not.toHaveClass(/moki-block-selected/);
  });
}

for (const list of ['ul', 'ol']) {
  test(`Enter at the start of a ${list} continuation lifts the paragraph and keeps item order`, async ({
    page,
  }) => {
    const ordered = list === 'ol';
    const marker = ordered ? ['5.', '6.', '7.'] : ['-', '-', '-'];
    const indent = ordered ? '   ' : '  ';
    const editor = await openEditor(
      page,
      `${marker[0]} First\n${marker[1]} Second\n\n${indent}Continuation\n\n${marker[2]} After`,
    );
    await page.evaluate(() => window.trial.selectParagraph('Continuation'));
    await page.keyboard.press('Enter');
    await expect(editor.locator(`:scope > ${list}`)).toHaveCount(2);
    await expect(editor.locator(':scope > p')).toHaveText('Continuation');
    await expect(editor.locator(`:scope > ${list} > li`)).toHaveText(['First', 'Second', 'After']);
    if (ordered) await expect(editor.locator('ol').last()).toHaveAttribute('start', '7');
    await page.keyboard.press('Control+z');
    await expect(editor.locator(`:scope > ${list}`)).toHaveCount(1);
    await expect(editor.locator('li p').filter({ hasText: 'Continuation' })).toHaveCount(1);
  });
}

test('Enter at a nested list item start outdents one level', async ({ page }) => {
  const editor = await openEditor(page, '- Parent\n  - Child');
  await page.evaluate(() => window.trial.selectParagraph('Child'));
  await page.keyboard.press('Enter');
  await expect(editor.locator(':scope > ul > li')).toHaveText(['Parent', 'Child']);
});

test('four stars then content renders strong instead of plain text', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('****');
  await page.keyboard.type('321321');
  await expect(editor.locator('strong')).toHaveText('321321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**321321**');
});

test('pasting plain **bold** renders strong instead of text', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.locator('p').first().click();
  await page.evaluate(() => {
    const root = document.querySelector('.milkdown-editor');
    const target =
      root.querySelector('.ProseMirror') || root.querySelector('[contenteditable="true"]') || root;
    const data = new DataTransfer();
    data.setData('text/plain', '**321321**');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(editor.locator('strong')).toHaveText('321321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**321321**');
});

test('pasting into an empty bold pair renders strong', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('****');
  await page.evaluate(() => {
    const root = document.querySelector('.milkdown-editor');
    const target =
      root.querySelector('.ProseMirror') || root.querySelector('[contenteditable="true"]') || root;
    const data = new DataTransfer();
    data.setData('text/plain', '321321');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(editor.locator('strong')).toHaveText('321321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**321321**');
});
