import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3000', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list']],
});
