import { expect, test } from '@playwright/test';

const markdown = [
  '- [ ]\u00a0Parent',
  '  - [ ] Middle',
  '    - [x]\u00a0Done',
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
      branchEndDelta: branchLeft + parseFloat(branch.width) - childBox.left,
      trunkStartDelta: childRow.top + parseFloat(trunk.top) - center(parentBox),
      branchWidth: branch.borderTopWidth,
      trunkWidth: trunk.borderLeftWidth,
      branchColor: branch.borderTopColor,
      trunkColor: trunk.borderLeftColor,
      treeColor,
    };
  });
  const { branchWidth, trunkWidth, branchColor, trunkColor, treeColor, ...deltas } = positions;
  expect([branchWidth, trunkWidth]).toEqual(['1px', '1px']);
  expect([branchColor, trunkColor]).toEqual([treeColor, treeColor]);
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
  await expect(preview.locator('pre')).toContainText('literal');
  await setCascade(page, false);
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'false');
  await expect(boxes.nth(2)).toBeChecked();
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
