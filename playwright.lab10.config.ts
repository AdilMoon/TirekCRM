import { defineConfig } from '@playwright/test';

// Dedicated educational suite for the requested Microsoft Edge scope.
export default defineConfig({
  testDir: './tests/browser', testMatch: 'lab10.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: '.local/lab10/run',
  reporter: [['list'], ['json', { outputFile: '.local/lab10/run/results.json' }],
    ['html', { outputFolder: 'playwright-report/lab10', open: 'never' }]],
  use: { baseURL: process.env.TEST_WEB_URL || 'https://localhost:8443',
    headless: true, viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
  ],
});
