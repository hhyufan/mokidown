import { expect, test } from '@playwright/test';

test('the source console sends terminal keystrokes, resizes, and keeps the session when hidden', async ({ page }) => {
  await page.goto('/tests/terminal-harness.html');
  const terminal = page.locator('.integrated-terminal');
  const input = terminal.locator('.xterm-helper-textarea');
  const requests = (command) => page.evaluate((command) =>
    window.terminalTrial?.commands.filter((entry) => entry.command === command) ?? [], command);

  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  expect(await requests('terminal_start')).toEqual([expect.objectContaining({ cwd: 'C:\\work' })]);
  await expect(terminal.locator('.xterm-rows')).toContainText('ready>');
  await input.press('a');
  await input.press('ArrowUp');
  await input.press('Control+c');
  await expect.poll(async () => (await requests('terminal_write')).map(({ data }) => data).join('')).toBe('\x1b[1;1Ra\x1b[A\x03');

  const resize = page.getByRole('separator');
  await resize.press('ArrowUp');
  await resize.press('ArrowUp');
  await expect.poll(async () => (await requests('terminal_resize')).length).toBeGreaterThan(0);

  await input.press('Control+j');
  await expect(terminal).toBeHidden();
  await page.evaluate(() => window.terminalTrial.emit('while hidden'));
  await page.keyboard.press('Control+j');
  await expect(terminal.locator('.xterm-rows')).toContainText('while hidden');
  expect(await requests('terminal_start')).toHaveLength(1);
  expect(await requests('terminal_close')).toHaveLength(0);

  await terminal.getByRole('button', { name: 'Terminate terminal' }).click();
  await expect(terminal.getByRole('status')).toHaveText('Terminal exited (0)');
  await terminal.getByRole('button', { name: 'New terminal' }).click();
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  expect(await requests('terminal_start')).toHaveLength(2);
});

test('the terminal follows the open folder and preserves each session without a source tab', async ({ page }) => {
  await page.goto('/tests/terminal-harness.html');
  const terminal = page.locator('#terminal-panel');
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  const first = await page.evaluate(() => window.terminalTrial.commands.find((row) => row.command === 'terminal_start').id);
  await page.evaluate(() => {
    window.terminalTrial.openFolder('C:\\another');
    window.terminalTrial.closeFiles();
  });
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  await expect.poll(() => page.evaluate(() => window.terminalTrial.commands.filter((row) => row.command === 'terminal_start').map((row) => row.cwd)))
    .toEqual(['C:\\work', 'C:\\another']);
  await page.evaluate((id) => {
    window.terminalTrial.emit('original shell still running', id);
    window.terminalTrial.openFolder('C:\\work');
  }, first);
  await expect(terminal.locator('.xterm-rows')).toContainText('original shell still running');
  expect(await page.evaluate(() => window.terminalTrial.commands.filter((row) => row.command === 'terminal_close').length)).toBe(0);
});

test('terminal lets the wallpaper through and follows the editor cursor colors', async ({ page }) => {
  await page.goto('/tests/terminal-harness.html');
  const terminal = page.locator('.integrated-terminal');
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  for (const [theme, foreground, cursor, command, args] of [
    ['light', 'rgb(44, 44, 46)', 'rgb(82, 111, 255)', 'rgb(138, 89, 0)', 'rgb(75, 82, 96)'],
    ['dark', 'rgb(245, 245, 247)', 'rgb(82, 139, 255)', 'rgb(255, 215, 135)', 'rgb(212, 216, 223)'],
  ]) {
    await page.evaluate((theme) => window.terminalTrial.theme(theme), theme);
    await expect(terminal.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(terminal.locator('.xterm-rows').getByText('ready>', { exact: false }).first()).toHaveCSS('color', foreground);
    await expect(terminal.locator('.xterm-rows').getByText('npm', { exact: true })).toHaveCSS('color', command);
    await expect.poll(() => terminal.locator('.xterm-rows .xterm-fg-7').evaluateAll((cells) => ({
      text: cells.map((cell) => cell.textContent).join('').trim().replace(/\s+/g, ' '),
      colors: [...new Set(cells.map((cell) => getComputedStyle(cell).color))],
    }))).toEqual({ text: 'run dev', colors: [args] });
    await expect.poll(() => terminal.locator('.xterm-cursor-bar').evaluate((element) =>
      getComputedStyle(element).boxShadow)).toContain(cursor);
  }
});
