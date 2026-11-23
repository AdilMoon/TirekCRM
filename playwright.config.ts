import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testIgnore: ['lab10.spec.ts', ...(process.env.TEST_MONITORING==='true'?[]:['monitoring.spec.ts'])], fullyParallel: false, workers: 1, retries: 0,
  use: { baseURL: process.env.TEST_WEB_URL || 'http://localhost:3000', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list']],
});
