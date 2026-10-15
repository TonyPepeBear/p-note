import { defineConfig, devices } from '@playwright/test';
import { origin, readyPort, workers } from './tests/e2e/ports';

// Playwright 會在每個 worker 行程重新載入本檔，origin 因此依 TEST_PARALLEL_INDEX 對應該 worker 的服務。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 5000 },
  reporter: [['list'], ['json', { outputFile: 'reports/e2e.json' }]],
  use: { baseURL: origin, ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--ignore-certificate-errors'] } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], launchOptions: { args: ['--ignore-certificate-errors'] } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'node scripts/e2e-servers.mjs', url: `http://127.0.0.1:${readyPort}`, reuseExistingServer: !process.env.CI, timeout: 180000 },
});
