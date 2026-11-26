import { expect, test } from '@playwright/test';

const markdown = [
  '-\u00a0[\u00a0]\u00a0Parent',
  '  - [ ] Middle',
  '    -\u00a0[x]\u00a0Done',
  '    - [ ] Todo',
  '  - [x] Sibling',
  '',
  '- \\[x]\\ Plain marker',
  '',
  '```text',
  '- [x]\u00a0literal',
  '```',
].join('\n');

async function setCascade(page, enabled) {
  await page.evaluate(async (enabled) => {
    (await import('/src/store/useConfigStore.js')).default.getState().setConfig('markdownTaskCascade', enabled);
  }, enabled);
}

async function expectAlignedTaskTree(root) {
  const positions = await root.locator('li[data-task-state]').first().evaluate((parent) => {
    const child = parent.querySelector('ul > li[data-task-state]');
    const box = (row) => row.querySelector('.md-preview__task-checkbox').getBoundingClientRect();
    const center = (rect) => rect.top + rect.height / 2;
    const parentBox = box(parent);
    const childBox = box(child);
    const childRow = child.getBoundingClientRect();
    const branch = getComputedStyle(child, '::before');
    const branchLeft = childRow.left + parseFloat(branch.left);
    const trunk = getComputedStyle(child, '::after');
    const fold = child.querySelector(':scope > .md-preview__fold, :scope > p > .md-preview__fold')?.getBoundingClientRect();
    const probe = document.createElement('span');
    probe.style.color = 'var(--border)';
    probe.hidden = true;
    child.append(probe);
    const treeColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      parentCenterDelta: center(parentBox) - parent.getBoundingClientRect().top - parseFloat(getComputedStyle(parent).lineHeight) / 2,
      branchXDelta: branchLeft - (parentBox.left + parentBox.width / 2),
      branchYDelta: childRow.top + parseFloat(branch.top) - center(childBox),
      branchGap: childBox.left - (branchLeft + parseFloat(branch.width)),
      trunkStartDelta: childRow.top + parseFloat(trunk.top) - center(parentBox),
      trunkJoinDelta: childRow.top + parseFloat(trunk.top) + parseFloat(trunk.height)
        - child.nextElementSibling.getBoundingClientRect().top,
      ...(fold && { foldXDelta: fold.left + fold.width / 2 - (branchLeft + 0.5), foldYDelta: center(fold) - center(childBox) }),
      branchWidth: branch.borderTopWidth,
      trunkWidth: trunk.borderLeftWidth,
      branchColor: branch.borderTopColor,
      trunkColor: trunk.borderLeftColor,
      treeColor,
    };
  });
  const { branchWidth, trunkWidth, branchColor, trunkColor, treeColor, branchGap, ...deltas } = positions;
  expect([branchWidth, trunkWidth]).toEqual(['1px', '1px']);
  expect([branchColor, trunkColor]).toEqual([treeColor, treeColor]);
  expect(branchGap).toBeCloseTo(0, 0);
  for (const delta of Object.values(deltas)) expect(Math.abs(delta)).toBeLessThan(1);
}

test('WYSIWYG task states cascade through three levels and the setting takes effect without a reload', async ({ page }) => {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(markdown)}`);
  const editor = page.locator('.milkdown-editor');
  const boxes = editor.getByRole('checkbox');
  await expect(boxes).toHaveCount(5);
  const states = () => boxes.evaluateAll((elements) => elements.map((box) => box.getAttribute('aria-checked')));
  await expect.poll(states).toEqual(['mixed', 'mixed', 'true', 'false', 'true']);
  await expectAlignedTaskTree(editor);

  const parent = editor.locator('li[data-task-state]').first();
  const fold = parent.locator(':scope > p > .md-preview__fold');
  await fold.click();
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'mixed');
  await expect(parent.locator(':scope > p > .md-preview__fold-ellipsis')).toBeVisible();
  await boxes.first().click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'false');
  await fold.click();
  await expect.poll(states).toEqual(['false', 'false', 'false', 'false', 'false']);
  await page.keyboard.press('Control+z');
  await expect.poll(states).toEqual(['mixed', 'mixed', 'true', 'false', 'true']);

  await boxes.nth(3).click();
  await expect.poll(states).toEqual(['true', 'true', 'true', 'true', 'true']);
  expect(await page.evaluate(() => window.trial.markdown())).toMatch(/\[x\] Parent/);
  await page.keyboard.press('Control+z');
  await expect.poll(states).toEqual(['mixed', 'mixed', 'true', 'false', 'true']);
  await boxes.first().click();
  await expect.poll(states).toEqual(['false', 'false', 'false', 'false', 'false']);
  await boxes.first().focus();
  await page.keyboard.press('Space');
  await expect.poll(states).toEqual(['true', 'true', 'true', 'true', 'true']);
  await boxes.first().click();
  await expect.poll(states).toEqual(['false', 'false', 'false', 'false', 'false']);
  await setCascade(page, false);
  await boxes.nth(2).click();
  await expect.poll(states).toEqual(['false', 'false', 'true', 'false', 'false']);
  await setCascade(page, true);
  await expect.poll(states).toEqual(['mixed', 'mixed', 'true', 'false', 'false']);
});

test('WYSIWYG draws only changed task states and preserves the task rows', async ({ page }) => {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(markdown)}`);
  const editor = page.locator('.milkdown-editor');
  const boxes = editor.getByRole('checkbox');
  await expect(boxes).toHaveCount(5);
  const toggle = (index) => editor.evaluate((root, index) => {
    const rows = [...root.querySelectorAll('li[data-task-state]')];
    const labels = rows.map((row) => row.querySelector('p'));
    const buttons = rows.map((row) => row.querySelector('button[role="checkbox"]'));
    const states = buttons.map((button) => button.getAttribute('aria-checked'));
    // Resolve the starting styles before toggling, so this also checks the transitions.
    root.getBoundingClientRect();
    buttons[index].click();
    const updated = [...root.querySelectorAll('li[data-task-state]')];
    return updated.map((row, i) => {
      const button = row.querySelector('button[role="checkbox"]');
      const label = row.querySelector('p');
      const state = button.getAttribute('aria-checked');
      const line = state === 'mixed' ? '::after' : '::before';
      const clip = getComputedStyle(button, line).clipPath;
      return { state, changed: state !== states[i], same: row === rows[i] && label === labels[i] && button === buttons[i], clip };
    });
  }, index);

  const completed = await toggle(3);
  expect(completed.map((row) => row.state)).toEqual(Array(5).fill('true'));
  expect(completed.every((row) => row.same)).toBe(true);
  expect(completed.filter((row) => row.changed)).toHaveLength(3);
  expect(completed[3].clip).not.toBe('inset(0px)');
  await expect.poll(() => boxes.nth(3).evaluate((box) => getComputedStyle(box, '::before').clipPath)).toBe('inset(0px)');

  const partial = await toggle(2);
  expect(partial.map((row) => row.state)).toEqual(['mixed', 'mixed', 'false', 'true', 'true']);
  expect(partial.every((row) => row.same)).toBe(true);
  expect(partial[0].clip).not.toBe('inset(0px)');
  await expect.poll(() => boxes.first().evaluate((box) => getComputedStyle(box, '::after').clipPath)).toBe('inset(0px)');

  // The outer parent stays mixed when its already-mixed branch loses the last check.
  const cleared = await toggle(3);
  expect(cleared.map((row) => row.state)).toEqual(['mixed', 'false', 'false', 'false', 'true']);
  expect(cleared.map((row) => row.changed)).toEqual([false, true, false, true, false]);
  expect(cleared.every((row) => row.same)).toBe(true);
});

test('checkbox retracts the current mark before drawing the next one on the same translucent fill', async ({ page }) => {
  const tasks = '- [x] Parent\n  - [x] Child one\n  - [x] Child two';
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(tasks)}`);
  const boxes = page.locator('.milkdown-editor').getByRole('checkbox');
  const parent = boxes.first();
  await expect(parent).toHaveAttribute('data-task-symbol', 'true');
  const colors = await parent.evaluate(async (button) => {
    const child = button.closest('li').querySelector(':scope > ul > li button[role=checkbox]');
    const fill = () => getComputedStyle(button).boxShadow;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const transition = () => button.getAnimations({ subtree: true }).find((animation) =>
      animation.transitionProperty === 'clip-path');
    const observeChange = async (target) => {
      target.click();
      await frame();
      const outgoing = transition();
      const duringRetraction = fill();
      const outgoingPseudo = outgoing?.effect.pseudoElement;
      const endClip = outgoing?.effect.getKeyframes().at(-1).clipPath;
      await outgoing?.finished;
      await frame();
      const incoming = transition();
      const incomingPseudo = incoming?.effect.pseudoElement;
      await incoming?.finished;
      return { outgoingPseudo, endClip, incomingPseudo, duringRetraction, after: fill() };
    };
    const initial = fill();
    return { initial, dash: await observeChange(child), check: await observeChange(child), clear: await observeChange(button) };
  });
  expect(colors.dash).toEqual({ outgoingPseudo: '::before', endClip: 'inset(0px 100% 0px 0px)',
    incomingPseudo: '::after', duringRetraction: colors.initial, after: colors.initial });
  expect(colors.check).toMatchObject({ outgoingPseudo: '::after', incomingPseudo: '::before',
    duringRetraction: colors.initial, after: colors.initial });
  expect(colors.clear).toMatchObject({ outgoingPseudo: '::before', incomingPseudo: undefined, duringRetraction: colors.initial });
  expect(colors.initial).toContain('/ 0.56)');
  expect(colors.clear.after).toContain('/ 0.58)');
});

test('checkboxes and fold tooltip redraw the wallpaper above an opaque base', async ({ page }) => {
  await page.goto(`/tests/milkdown-flow-harness.html?wallpaper&content=${encodeURIComponent('- [ ] Parent\n  - [x] Child\n  - [ ] Child two')}`);
  const fold = page.locator('.milkdown-editor .md-preview__fold').first();
  const surfaces = () => page.locator('.md-preview__task-checkbox, .ant-tooltip-inner').evaluateAll((elements) =>
    elements.map((element) => {
      const css = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { base: css.backgroundColor, wallpaper: css.backgroundImage.includes('data:image/svg+xml'),
        aligned: ['x', 'y'].every((axis) => Math.abs(parseFloat(element.style.getPropertyValue(`--moki-popup-${axis}`)) - rect[axis]) < 1) };
    }));
  for (const [theme, color] of [['light', 'rgb(255, 255, 255)'], ['dark', 'rgb(24, 24, 24)']]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await fold.hover();
    await expect(page.locator('.ant-tooltip-inner')).toHaveCSS('background-color', color);
    await expect.poll(surfaces).toEqual(Array(4).fill({ base: color, wallpaper: true, aligned: true }));
    await expect.poll(() => page.locator('.ant-tooltip-arrow').evaluate((arrow) =>
      getComputedStyle(arrow, '::before').backgroundColor)).toBe(color);
  }
});

for (const harness of ['milkdown-flow', 'preview']) {
  test(`${harness} strikes through an inline code chip on a wrapped task`, async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 500 });
    const task = '- [x] ' + '普通文字 `$$` 后面的文字 '.repeat(8);
    await page.goto(`/tests/${harness}-harness.html?content=${encodeURIComponent(task)}`);
    await page.addStyleTag({ content: '.md-preview__task-strike { stroke: #ff00ff !important; stroke-width: 2px; }' });
    const strike = page.locator('.md-preview__task-strike');
    await expect(strike.locator('path').nth(1)).toBeAttached();
    const clip = await strike.evaluate((svg) => {
      const code = svg.closest('li').querySelector('code').getBoundingClientRect();
      return { x: Math.floor(code.left) - 6, y: Math.floor(code.top),
        width: Math.ceil(code.width) + 12, height: Math.ceil(code.height) };
    });
    const screenshot = await page.screenshot({ clip, scale: 'css' });
    const continuous = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
      canvas.drawImage(bitmap, 0, 0);
      const { data } = canvas.getImageData(0, 0, bitmap.width, bitmap.height);
      return Array.from({ length: bitmap.height }, (_, y) => y).some((y) =>
        Array.from({ length: bitmap.width }, (_, x) => (y * bitmap.width + x) * 4).every((i) =>
          data[i] > 240 && data[i + 1] < 80 && data[i + 2] > 240));
    }, screenshot.toString('base64'));
    expect(continuous).toBe(true);
  });
}

test('WYSIWYG draws and retracts the task strike through the same path', async ({ page }) => {
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent('- [ ] before `code` after')}`);
  const strike = page.locator('.md-preview__task-strike');
  await expect(strike).toHaveAttribute('data-drawn', 'false');
  const result = await strike.evaluate(async (svg) => {
    const box = svg.parentElement;
    const text = svg.closest('p');
    const color = () => getComputedStyle(text).color;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const play = async () => {
      box.click();
      await frame();
      await frame();
      const motion = svg.getAnimations()[0];
      const steps = motion?.effect.getKeyframes().map((keyframe) => keyframe.strokeDashoffset);
      const during = color();
      await motion?.finished;
      return { steps, during, after: color() };
    };
    const normal = color();
    const forward = await play();
    const path = svg.firstElementChild;
    const reverse = await play();
    return { normal, forward, reverse, samePath: svg.firstElementChild === path };
  });
  expect(result.forward.steps).toEqual(['1px', '0px']);
  expect(result.reverse.steps).toEqual(['0px', '1px']);
  expect(result.samePath).toBe(true);
  expect(result.forward.after).not.toBe(result.normal);
  expect(result.reverse.during).toBe(result.forward.after);
  expect(result.reverse.after).toBe(result.normal);
});

test('split preview recognizes no-break task markers and reflects the cascade setting', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async (content) => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/tasks.md', name: 'tasks.md', content });
    store.getState().setViewMode('split');
  }, markdown);
  const preview = page.locator('.md-preview');
  const boxes = preview.getByRole('checkbox');
  await expect(boxes).toHaveCount(5);
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'mixed');
  await expect(boxes.nth(2)).toBeChecked();
  await expectAlignedTaskTree(preview);
  const parent = preview.locator('li[data-task-state]').first();
  const fold = parent.locator(':scope > .md-preview__fold');
  await fold.click();
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'mixed');
  await expect(parent.locator(':scope > :is(p, .md-preview__task-label) > .md-preview__fold-ellipsis')).toBeVisible();
  await fold.click();
  await expect(boxes).toHaveCount(5);
  await expect(preview.locator('pre')).toContainText('literal');
  await setCascade(page, false);
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'false');
  await expect(boxes.nth(2)).toBeChecked();
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/empty-task.md', name: 'empty-task.md', content: '-\u00a0[\u00a0]\u00a0' });
  });
  await expect(boxes).toHaveCount(1);
  await expect(boxes.first()).not.toBeChecked();
});

test('Enter continues a task list and Tab can nest the new task', async ({ page }) => {
  await page.goto('/tests/milkdown-flow-harness.html?content=-%20%5Bx%5D%20Parent');
  const editor = page.locator('.milkdown-editor');
  await expect(editor.locator('p')).toHaveText('Parent');
  await page.evaluate(() => window.trial.selectParagraph('Parent'));
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Child');
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await expect(editor.getByRole('checkbox').nth(1)).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Tab');
  const child = editor.locator('li[data-item-type="task"] > ul > li[data-item-type="task"]');
  await expect(child).toContainText('Child');
  await expect(editor.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'false');
});

test('blank markers with no-break spaces remain tasks after input and serialization', async ({ page }) => {
  await page.goto('/tests/milkdown-flow-harness.html?content=');
  const editor = page.locator('.milkdown-editor');
  await expect(editor).toBeVisible();
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.insertText('-\u00a0[\u00a0]\u00a0');
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
  const source = await page.evaluate(() => window.trial.markdown());
  expect(source).toMatch(/^[-*] +\[ \]/);
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(source)}`);
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
});

test('Enter lifts an empty nested task one level while retaining its checkbox and branch', async ({ page }) => {
  const markdown = '- [ ] Parent\n  - [ ] Middle\n    - [ ]\n  - [x] Sibling';
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(markdown)}`);
  const editor = page.locator('.milkdown-editor');
  const boxes = editor.getByRole('checkbox');
  await expect(boxes).toHaveCount(4);
  const parent = editor.locator(':scope > ul > li').first();
  const children = parent.locator(':scope > ul > li');
  await expect(children).toHaveCount(2);
  await page.evaluate(() => window.trial.selectParagraph(''));
  await page.keyboard.press('Enter');
  await expect(boxes).toHaveCount(4);
  await expect(children).toHaveCount(3);
  await expect(children.nth(1).locator(':scope > p > [role="checkbox"]')).toHaveAttribute('aria-checked', 'false');
  await expect(children.last().locator(':scope > p')).toHaveText('Sibling');
  await expectAlignedTaskTree(editor);
  await page.keyboard.press('Control+z');
  await expect(children).toHaveCount(2);
  await expect(boxes).toHaveCount(4);
});

for (const harness of ['milkdown-flow', 'preview']) {
  test(`${harness} aligns task lists, sibling lists and nested code blocks on one left axis without shifting task boxes`, async ({ page }) => {
    const content = [
      '- [ ] Task body',
      '  ```js',
      '  const a = 1;',
      '  ```',
      '',
      '* Bullet body',
      '  ```js',
      '  const b = 2;',
      '  ```',
      '',
      '1. Ordered body',
    ].join('\n');
    await page.goto(`/tests/${harness}-harness.html?content=${encodeURIComponent(content)}`);
    const root = page.locator('.md-preview');
    await expect(root.getByRole('checkbox')).toHaveCount(1);
    const metrics = await root.evaluate((el) => {
      const box = el.querySelector('.md-preview__task-checkbox').getBoundingClientRect();
      const [taskItem, bulletItem, orderedItem] = [...el.querySelectorAll('li')];
      const textLeft = (li) => (li.querySelector(':scope > p, :scope > .md-preview__task-label') || li).getBoundingClientRect().left;
      const codeLeft = (li) => li.querySelector('.milkdown-code-block, .md-runnable-code, pre').getBoundingClientRect().left;
      const rootLeft = el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
      const em = parseFloat(getComputedStyle(el).fontSize);
      return {
        boxOffset: box.left - rootLeft,
        expectedBoxOffset: 1.2 * em,
        taskTextLeft: textLeft(taskItem),
        taskCodeLeft: codeLeft(taskItem),
        bulletTextLeft: textLeft(bulletItem),
        bulletCodeLeft: codeLeft(bulletItem),
        orderedTextLeft: textLeft(orderedItem),
      };
    });
    expect(Math.abs(metrics.boxOffset - metrics.expectedBoxOffset)).toBeLessThan(1);
    expect(Math.abs(metrics.taskCodeLeft - metrics.taskTextLeft)).toBeLessThan(1);
    expect(Math.abs(metrics.bulletTextLeft - metrics.taskTextLeft)).toBeLessThan(1);
    expect(Math.abs(metrics.bulletCodeLeft - metrics.taskTextLeft)).toBeLessThan(1);
    expect(Math.abs(metrics.orderedTextLeft - metrics.taskTextLeft)).toBeLessThan(1);
  });
}

test('completing a task list marker immediately places the writing caret at text start instead of on the checkbox', async ({ page }) => {
  await page.goto('/tests/milkdown-flow-harness.html?content=');
  const editor = page.locator('.milkdown-editor');
  await expect(editor).toBeVisible();
  await page.evaluate(() => window.trial.selectTextblock(0));
  await page.keyboard.type('- [ ] ', { delay: 20 });
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
  const caret = page.locator('.moki-writing-caret:not([hidden])');
  await expect(caret).toBeVisible();
  const geometry = await editor.evaluate((root) => {
    const box = root.querySelector('.md-preview__task-checkbox').getBoundingClientRect();
    const paragraph = root.querySelector('li p').getBoundingClientRect();
    const drawn = document.querySelector('.moki-writing-caret').getBoundingClientRect();
    return { boxRight: box.right, boxHeight: box.height, pLeft: paragraph.left, caretLeft: drawn.left, caretHeight: drawn.height };
  });
  expect(Math.abs(geometry.caretLeft - geometry.pLeft)).toBeLessThan(1);
  expect(geometry.caretLeft).toBeGreaterThan(geometry.boxRight + 4);
  expect(geometry.caretHeight).toBeGreaterThan(geometry.boxHeight + 2);
});

