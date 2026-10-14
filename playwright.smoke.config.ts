import { defineConfig, devices } from '@playwright/test';
import { smokePort } from './tests/e2e/ports';

export default defineConfig({
  testDir: './tests/smoke', outputDir: './test-results-smoke', workers: 1, retries: 0, timeout: 30000,
  reporter: [['list'], ['json', { outputFile: 'reports/smoke.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: `https://127.0.0.1:${smokePort}`, ignoreHTTPSErrors: true, launchOptions: { args: ['--ignore-certificate-errors'] }, trace: 'retain-on-failure' },
  webServer: {
    command: `node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js dev --config wrangler.smoke.jsonc --ip 127.0.0.1 --port ${smokePort} --local --local-protocol https --https-key-path "$P_NOTE_TLS_DIR/key.pem" --https-cert-path "$P_NOTE_TLS_DIR/cert.pem" --persist-to .wrangler/smoke-state --var BETTER_AUTH_URL:https://127.0.0.1:${smokePort}`,
    url: `https://127.0.0.1:${smokePort}/health`, ignoreHTTPSErrors: true, reuseExistingServer: false,
  },
});
