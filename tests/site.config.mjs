import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './site',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:1461',
    browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npx vite --config site/vite.config.mjs --port 1461',
    url: 'http://127.0.0.1:1461',
    reuseExistingServer: !process.env.CI,
  },
});
