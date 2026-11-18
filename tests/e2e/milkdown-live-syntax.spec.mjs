import { expect, test } from '@playwright/test';

async function openEditor(page, content = '', query = '') {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}${query}`);
  const editor = page.locator('.milkdown-editor');
  await expect(editor).toBeVisible();
  return editor;
}

function visibleMarkers(editor) {
  return editor.locator('.moki-markdown-marker:visible').evaluateAll((nodes) => nodes.map((node) => node.dataset.mokiMarker));
}

test('the writing caret uses the active theme foreground in light and dark modes', async ({ page }) => {
  const editor = await openEditor(page, '正文');
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const theme of ['light', 'dark', 'light']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await editor.locator('p').click();
    const colors = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { caret: style.caretColor, text: style.color, colorScheme: style.colorScheme };
    });
    expect(colors.caret).toBe(colors.text);
    expect(colors.colorScheme).toBe(theme);
    if (theme === 'light') expect(colors.caret).toBe('rgb(44, 44, 46)');
  }
});

test('code and virtual Markdown carets follow the application theme', async ({ page }) => {
  const editor = await openEditor(page, '```text\nhello\n```\n\n**bold**');
  const code = editor.locator('.cm-content');
  await code.click();
  const codeCaret = editor.locator('.cm-cursor-primary').first();
  for (const [theme, color] of [['dark', 'rgb(82, 139, 255)'], ['light', 'rgb(82, 111, 255)']]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(codeCaret).toHaveCSS('border-left-color', color);
  }
  await page.evaluate(() => window.trial.selectParagraph('bold'));
  await page.keyboard.press('ArrowLeft');
  const virtual = editor.locator('.moki-markdown-marker--with-caret i');
  await expect(virtual).toHaveCount(1);
  expect(await virtual.evaluate((node) => getComputedStyle(node, '::after').borderInlineStartColor)).toBe('rgb(44, 44, 46)');
});

test('draft delimiters are muted, completed formatting is solid, and clicking its left edge reveals source markers', async ({ page }) => {
  const editor = await openEditor(page);
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('markdownSmartPairs', []);
  });
  await editor.click();
  await page.keyboard.type('**bold');
  await expect(editor.locator('.moki-markdown-ghost')).toHaveText('**');
  const draft = await editor.locator('.moki-markdown-ghost').evaluate((node) => getComputedStyle(node).color);
  await page.keyboard.type('**');
  const bold = editor.locator('strong');
  await expect(bold).toHaveText('bold');
  await expect(editor.locator('.moki-markdown-ghost, .moki-markdown-marker:visible')).toHaveCount(0);
  expect(await bold.evaluate((node) => getComputedStyle(node).color)).not.toBe(draft);
  const box = await bold.boundingBox();
  await page.mouse.click(box.x + 0.5, box.y + box.height / 2);
  await expect.poll(() => visibleMarkers(editor)).toEqual(['**', '**']);
  expect(await page.evaluate(() => window.trial.state().selection.anchor)).toBe(1);
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**bold**');
  await page.keyboard.press('End');
  await expect(editor.locator('.moki-markdown-marker:visible')).toHaveCount(0);
});

test('block formula preview keeps the last good render while the source is unparseable', async ({ page }) => {
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

test('inline formula shows a preview bubble only while its source is revealed', async ({ page }) => {
  // 上面留一段正文：贴着编辑区上沿时气泡会翻到下方，这里要验的是默认摆法。
  const editor = await openEditor(page, '上面一行\n\n$x^2$ Tail');
  const bubble = editor.locator('.moki-math-preview--inline');
  const formula = editor.locator('.md-preview__math--inline');
  await page.evaluate(() => window.trial.selectTextblock(1));
  await expect(formula).toHaveAttribute('data-moki-math-source', '$x^2$');
  await expect(formula.locator('.katex')).toBeHidden();
  await expect(bubble.locator('.katex')).toBeVisible();
  const bubbleBox = await bubble.boundingBox();
  const formulaBox = await formula.boundingBox();
  // 预览气泡浮在公式上方。
  expect(bubbleBox.y + bubbleBox.height).toBeLessThan(formulaBox.y);
  await page.keyboard.press('End');
  await expect(formula).not.toHaveAttribute('data-moki-math-source');
  await expect(bubble).toHaveCount(0);
  await expect(formula.locator('.katex')).toBeVisible();
});

test('double-clicking a rendered formula opens its source untouched', async ({ page }) => {
  const editor = await openEditor(page, '正文 $x^2$ 结尾\n\n$$\n\\alpha \\beta\n$$\n');
  await editor.locator('.md-preview__math--block').dblclick();
  const source = editor.locator('.md-preview__math-source--block');
  await expect(source).toBeVisible();
  expect(await source.textContent()).toBe('\\alpha \\beta');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');
  await editor.locator('.md-preview__math--inline').dblclick({ position: { x: 2, y: 5 } });
  const inline = editor.locator('.md-preview__math-source--inline');
  await expect(inline).toBeVisible();
  expect(await inline.textContent()).toBe('$x^2$');
  // 双击只是揭开源码，一个字符都没少。
  expect(await page.evaluate(() => window.trial.markdown())).toContain('正文 $x^2$ 结尾');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('$$\n\\alpha \\beta\n$$');
});

test('leaving the formula source keeps the formula on the pixels its preview showed', async ({ page }) => {
  const editor = await openEditor(page, '正文段落\n\n$$\n\\alpha\n$$\n');
  await editor.locator('.md-preview__math--block').dblclick();
  const previewed = await editor.locator('.moki-math-preview--block .katex').boundingBox();
  await page.keyboard.press('ArrowUp');
  await expect(editor.locator('.moki-math-preview--block')).toHaveCount(0);
  const rendered = await editor.locator('.md-preview__math--block .katex').boundingBox();
  // 中心对齐才比左边距可靠：气泡有左右内边距，渲染公式却占满整行。
  expect(Math.abs(previewed.x + previewed.width / 2 - (rendered.x + rendered.width / 2))).toBeLessThan(1);
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
    expect(await bubble.evaluate((node) => getComputedStyle(node, '::after').content)).not.toBe('none');
    expect(await bubble.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgb(229, 229, 231)');
  };
  // 正在输入的源码节点：先塞够长的正文让它换行，公式落在第二行行尾。
  const typing = await openEditor(page, '字'.repeat(120));
  await typing.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' $$ \\alpha');
  await check(typing, '.md-preview__math-source--inline');
  // 光标贴住渲染态公式时的源码显示，是另一个元素，锚点也另一个。
  const revealed = await openEditor(page, `Above\n\n$x^2$ 尾巴`);
  await page.evaluate(() => window.trial.selectTextblock(1));
  await check(revealed, '.md-preview__math--inline');
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
  const slot = await editor.locator('.md-preview__math-source--inline').boundingBox();
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
  expect(await roomBubble.evaluate((node) => getComputedStyle(node).getPropertyValue('--moki-preview-shift'))).toBe('0px');
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
  const wide = await edge.locator('.md-preview__math-source--inline').boundingBox();
  expect(shifted.x + shifted.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
  expect(shifted.x).toBeGreaterThan(pane.x);
  // 气泡整块挪了位，尾巴还得正对着公式：inset 从边框内侧量起，所以补 1px。
  const tailX = await edgeBubble.evaluate((node) => node.getBoundingClientRect().x + parseFloat(getComputedStyle(node, '::after').insetInlineStart) + 1);
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
  expect(bare).toEqual({ tail: 'none', border: '0px none', background: 'rgba(0, 0, 0, 0)', shadow: 'none' });
});

test('a backslash in formula source opens the symbol completion list and typing narrows it', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  const rows = list.getByRole('option');
  const source = editor.locator('.md-preview__math-source--block');
  await editor.click();
  await page.keyboard.type('$$ ');
  // 列表只在半个控制序列之后出现，光天打字不打扰。
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
  // 没有选中条目时 Enter 还是编辑器的 Enter；方向键选中之后才轮到补全。
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

test('the completion list follows inline source editing and closes on Escape', async ({ page }) => {
  const editor = await openEditor(page, '$x^2$ Tail');
  const list = page.locator('.moki-math-completion');
  await expect(list).toHaveCount(0);
  // 光标贴住公式时仍是原子节点，那个位置打不进文字，所以不挂列表。
  await page.evaluate(() => window.trial.selectTextblock(0));
  await expect(list).toHaveCount(0);
  // 选中公式再 Backspace 才进入可编辑的行内源码态。
  await editor.locator('.md-preview__math--inline').click({ position: { x: 2, y: 5 } });
  await page.keyboard.press('Backspace');
  const source = editor.locator('.md-preview__math-source--inline');
  await expect(source).toBeVisible();
  await page.keyboard.type('\\');
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: /α/ }).click();
  expect(await source.textContent()).toContain('\\alpha ');
  await expect(list).toHaveCount(0);
  const caret = await page.evaluate(() => window.trial.state().selection);
  expect(caret.head).toBe(caret.anchor);
});

test('$$ away from the line start opens inline source editing', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$ ');
  const source = editor.locator('.md-preview__math-source--inline');
  await expect(source).toHaveText('$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_inline');
  // 行首那一下仍归块级规则管：两条规则靠 parentOffset 互斥，谁都不抢谁。
  const block = await openEditor(page);
  await block.click();
  await page.keyboard.type('$$ ');
  await expect(block.locator('.md-preview__math-source--block')).toBeVisible();
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_block');
});

test('the completion list is available while writing a new inline formula', async ({ page }) => {
  const editor = await openEditor(page);
  const list = page.locator('.moki-math-completion');
  await editor.click();
  await page.keyboard.type('正文 $$ \\p');
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: /π/ }).click();
  await expect(editor.locator('.md-preview__math-source--inline')).toHaveText('$\\pi ');
  // 补全之后照样能收尾：列表没有把这段编辑抢走。
  await page.keyboard.type('$');
  await expect(editor.locator('.md-preview__math--inline')).toHaveAttribute('data-value', '\\pi');
});

test('typing the closing $ folds the formula and hands the sentence back', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('正文 $$ \\alpha$ 尾巴');
  await expect(editor.locator('.md-preview__math--inline')).toHaveAttribute('data-value', '\\alpha');
  // 收尾 `$` 之后再打字写的是正文，不能被吸进公式里。紧跟行内原子的空格会被浏览器
  // 存成不换行空格，与直接在正文里写 `$x^2$` 完全一致，所以这里只按空白匹配。
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/正文 \$\\alpha\$\s尾巴/);
});

test('revealing an existing formula keeps typing inside its body', async ({ page }) => {
  const editor = await openEditor(page, '$x^2$');
  await editor.locator('.md-preview__math--inline').dblclick({ position: { x: 2, y: 5 } });
  const source = editor.locator('.md-preview__math-source--inline');
  await expect(source).toHaveText('$x^2$');
  // 揭开时停在收尾 `$` 之前，所以这条打字不该触发"写完"的判断。
  await page.keyboard.type('\\beta');
  await expect(source).toHaveText('$x^2\\beta$');
  expect(await page.evaluate(() => window.trial.state().parent)).toBe('math_source_inline');
});

test('an abandoned $$ stays visible source instead of an empty formula', async ({ page }) => {
  const editor = await openEditor(page, 'tail');
  await page.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.type('z $$ $');
  const source = editor.locator('.md-preview__math-source--inline');
  await expect(source).toHaveText('$$');
  // 空正文不是公式：折成空原子会留下看不见、又吃掉分隔符的节点。
  await page.keyboard.press('Home');
  await expect(source).toHaveText('$$');
  await expect(editor.locator('.md-preview__math--inline')).toHaveCount(0);
});

test('horizontal arrows enter each visible marker character before crossing a line boundary', async ({ page }) => {
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
  test(`the blinking marker caret aligns with the adjacent text in ${content}`, async ({ page }) => {
    const editor = await openEditor(page, content);
    await page.evaluate(() => window.trial.selectTextblock(0));
    for (const key of keys) await page.keyboard.press(key);
    const caret = await editor.locator('.moki-markdown-marker--with-caret i').evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      const text = element.closest('p, h5').lastChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const bounds = range.getBoundingClientRect();
      const top = element.getBoundingClientRect().top + parseFloat(style.top);
      return { top, bottom: top + parseFloat(style.height), textTop: bounds.top, textBottom: bounds.bottom, animation: style.animationName };
    });
    expect(Math.abs(caret.top - caret.textTop)).toBeLessThan(1);
    expect(Math.abs(caret.bottom - caret.textBottom)).toBeLessThan(1);
    expect(caret.animation).toBe('ProseMirror-cursor-blink');
  });
}

test('typing Markdown task markers converts bullet items into unchecked and checked tasks', async ({ page }) => {
  const editor = await openEditor(page);
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('- [ ] first');
  await expect(editor.locator('li[data-item-type="task"]')).toHaveAttribute('data-checked', 'false');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [X]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect(editor.locator('li[data-item-type="task"]').last()).toHaveAttribute('data-checked', 'true');
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toContain('[ ] first');
  expect(markdown).toContain('[x] second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('- [ ] ');
  await page.keyboard.type('third');
  await expect(editor.locator('li[data-item-type="task"]').last()).toHaveAttribute('data-checked', 'false');
  expect(await page.evaluate(() => window.trial.markdown())).toContain('[ ] third');
});

test('moving left from prose lands after the closing code fence and inserts outside it', async ({ page }) => {
  const editor = await openEditor(page, '`321`1');
  await page.evaluate(() => window.trial.selectTextblock(0, 'end'));
  await page.keyboard.press('ArrowLeft');
  await expect(editor.locator('.moki-markdown-marker--with-caret')).toHaveAttribute('data-marker-before', '`');
  await page.keyboard.type('A');
  await expect(editor.locator('code')).toHaveText('321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321`A1');
  await page.evaluate(() => window.trial.selectTextblock(0));
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(editor.locator('.moki-markdown-marker--with-caret')).toHaveAttribute('data-marker-before', '`');
  await page.keyboard.type('B');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('`321`BA1');
});

test('links and formulas render immediately after typing and reveal their syntax at the leading boundary', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.click();
  await page.keyboard.type('[site](https://example.com');
  await expect(editor.locator('.moki-markdown-ghost')).toHaveText(['[', '](']);
  await page.keyboard.type(')');
  await expect(editor.locator('a')).toHaveText('site');
  await page.evaluate(() => window.trial.selectTextblock(0));
  await expect.poll(() => visibleMarkers(editor)).toEqual(['[', '](https://example.com)']);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('$x^2$');
  const formula = editor.locator('.md-preview__math--inline');
  await expect(formula.locator('.katex')).toBeVisible();
  await page.evaluate(() => window.trial.selectTextblock(1));
  await expect(formula).toHaveAttribute('data-moki-math-source', '$x^2$');
  await expect(formula.locator('.katex')).toBeHidden();
  await page.keyboard.press('End');
  await expect(formula.locator('.katex')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('[***styled**](https://styled.example) plain');
  await expect(editor.locator('a[href="https://styled.example"][href]')).toHaveText('styled');
  await expect(editor.locator('a[href="https://styled.example"] strong, strong a[href="https://styled.example"]')).toHaveCount(1);
});

test('moving across syntax boundaries does not dirty the file and read-only preview has no editing decorations', async ({ page }) => {
  const content = '## Title\n\n*italic* ~~removed~~ `code`\n';
  const editor = await openEditor(page, content);
  const original = await page.evaluate(() => window.trial.markdown());
  const heading = editor.locator('h2');
  const properties = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'marginInlineEnd'];
  const rendered = await heading.evaluate((node, props) => props.map((prop) => getComputedStyle(node, '::before')[prop]), properties);
  await page.evaluate(() => window.trial.selectTextblock(0));
  const source = heading.locator('.moki-markdown-heading-marker:visible');
  await expect(source).toHaveAttribute('data-moki-marker', '##');
  expect(await source.evaluate((node, props) => props.map((prop) => getComputedStyle(node)[prop]), properties)).toEqual(rendered);
  await page.evaluate(() => window.trial.selectTextblock(1));
  await expect(editor.locator('p .moki-markdown-marker:visible')).toHaveCount(2);
  await page.mouse.click(1, 1);
  await expect(editor.locator('.moki-markdown-marker:visible')).toHaveCount(0);
  expect(await page.evaluate(() => window.trial.markdown())).toBe(original);
  expect(await page.evaluate(() => window.trial.dirty())).toBe(false);
  await openEditor(page, content, '&readonly');
  await expect(editor.locator('.moki-markdown-marker, .moki-markdown-ghost')).toHaveCount(0);
});

test('asterisk completion pairs two strokes and upgrades the third stroke to bold', async ({ page }) => {
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
  test(`adding stars around existing text (${order}) renders bold immediately`, async ({ page }) => {
    const editor = await openEditor(page, '前面 已有文字 后面');
    const select = (offset) => page.evaluate((offset) => {
      window.trial.selectTextblock(0);
      window.trial.dispatch((state) => state.tr.setSelection(state.selection.constructor.create(state.doc, offset + 1)));
    }, offset);
    await select(order === 'left first' ? 3 : 7);
    await page.keyboard.type('**');
    await expect(editor.locator('p')).toHaveText(order === 'left first' ? '前面 **已有文字 后面' : '前面 已有文字** 后面');
    await select(order === 'left first' ? 9 : 3);
    await page.keyboard.type('**');
    await expect(editor.locator('strong')).toHaveText('已有文字');
    expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('前面 **已有文字** 后面');
  });
}

for (const [source, offset, selector, expected] of [
  ['Before **** after', 9, 'strong', 'Before **中文** after'],
  ['Before __ after', 8, 'em', 'Before _中文_ after'],
  ['Before ~~~~ after', 9, 'del', 'Before ~~中文~~ after'],
  ['Before `` after', 8, 'code', 'Before `中文` after'],
]) {
  test(`committing IME text between the markers in ${source} renders immediately`, async ({ page }) => {
    const editor = await openEditor(page, source);
    await page.evaluate((offset) => {
      window.trial.selectTextblock(0);
      window.trial.dispatch((state) => state.tr.setSelection(state.selection.constructor.create(state.doc, offset + 1)));
    }, offset);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
      await page.keyboard.insertText('中文');
      await expect(editor.locator(selector)).toHaveText('中文');
      expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe(expected);
    } finally {
      await cdp.detach();
    }
  });
}

test('undo restores the empty bold markers after committing a long-lived IME candidate', async ({ page }) => {
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

test('paired deletion removes one emphasis layer, keeps code text and supports undo and redo', async ({ page }) => {
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

for (const [markup, selector] of [['**abcdef**', 'strong'], ['`abcdef`', 'code']]) {
  test(`clicking rendered ${selector} draws no interim caret and inserts at the clicked character boundary`, async ({ page }) => {
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
  const [start, end] = await editor.locator('strong').evaluate((element) => [1, 5].map((offset) => {
    const range = document.createRange();
    range.setStart(element.firstChild, offset);
    range.collapse(true);
    const { left, top, height } = range.getBoundingClientRect();
    return { x: left, y: top + height / 2 };
  }));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('bcde');
  await editor.locator('strong').dblclick();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString().trim())).toBe('abcdef');
});

test('two backticks place the caret between them and the next text renders as inline code', async ({ page }) => {
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

test('the language menu floats under the unfinished fence without shifting the next heading', async ({ page }) => {
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
  expect(await menu.evaluate((element) => !document.querySelector('.md-preview--milkdown').contains(element))).toBe(true);
  const alignedWithFence = async () => {
    const marker = await fence.locator('.moki-markdown-ghost').boundingBox();
    const box = await menu.boundingBox();
    return Math.abs(box.x - marker.x) <= 2 && box.y >= marker.y + marker.height - 2 && box.y <= marker.y + marker.height + 8;
  };
  await expect.poll(alignedWithFence).toBe(true);
  expect((await heading.boundingBox()).y).toBe(headingBefore.y);
  await page.locator('.md-preview--milkdown').evaluate((pane) => { pane.scrollTop = 24; });
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

test('Enter or a complete language confirms the fence, and a space leaves it pending', async ({ page }) => {
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

test('Enter after auto-opening a Rust fence confirms it without inserting a blank first line', async ({ page }) => {
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

test('Enter inside an existing Rust block can still insert an intentional blank line', async ({ page }) => {
  const editor = await openEditor(page, '```rust\nlet x = 1;\n```');
  await page.evaluate(() => window.trial.selectCode('start'));
  await expect(editor.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.trial.markdown().trimEnd()))
    .toBe('```rust\n\nlet x = 1;\n```');
});

test('individual pair preferences disable backticks and square brackets while leaving round brackets enabled', async ({ page }) => {
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
  test(`${renderer} marks complete quote and code blocks in a document selection`, async ({ page }) => {
    const markdown = 'Before\n\n> Quote text\n\n```js\nconst answer = 42;\n```\n\nAfter';
    const query = renderer === 'milkdown' ? '&renderer=milkdown' : '';
    await page.goto(`/tests/preview-harness.html?content=${encodeURIComponent(markdown)}${query}`);
    const editor = page.locator(renderer === 'milkdown' ? '.milkdown-editor' : '.md-preview');
    const quote = editor.locator('blockquote');
    const code = editor.locator(renderer === 'milkdown' ? '.milkdown-code-block' : '.md-runnable-code');
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
  test(`Enter at the start of a ${list} continuation lifts the paragraph and keeps item order`, async ({ page }) => {
    const ordered = list === 'ol';
    const marker = ordered ? ['5.', '6.', '7.'] : ['-', '-', '-'];
    const indent = ordered ? '   ' : '  ';
    const editor = await openEditor(page, `${marker[0]} First\n${marker[1]} Second\n\n${indent}Continuation\n\n${marker[2]} After`);
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
    const target = root.querySelector('.ProseMirror') || root.querySelector('[contenteditable="true"]') || root;
    const data = new DataTransfer();
    data.setData('text/plain', '**321321**');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
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
    const target = root.querySelector('.ProseMirror') || root.querySelector('[contenteditable="true"]') || root;
    const data = new DataTransfer();
    data.setData('text/plain', '321321');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('strong')).toHaveText('321321');
  expect(await page.evaluate(() => window.trial.markdown().trimEnd())).toBe('**321321**');
});
