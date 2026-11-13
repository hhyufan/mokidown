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
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await editor.locator('p').click();
    const colors = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { caret: style.caretColor, text: style.color };
    });
    expect(colors.caret).toBe(colors.text);
    if (theme === 'light') expect(colors.caret).not.toBe('rgb(255, 255, 255)');
  }
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
  test(`clicking rendered ${selector} inserts at the clicked character boundary`, async ({ page }) => {
    const editor = await openEditor(page, `before ${markup} after`);
    const point = await editor.locator(selector).evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 3);
      range.collapse(true);
      const { left, top, height } = range.getBoundingClientRect();
      return { x: left, y: top + height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.insertText('X');
    await expect(editor.locator(selector)).toHaveText('abcXdef');
  });
}

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
