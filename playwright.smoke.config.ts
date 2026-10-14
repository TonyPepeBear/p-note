import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke', outputDir: './test-results-smoke', workers: 1, retries: 0, timeout: 30000,
  reporter: [['list'], ['json', { outputFile: 'reports/smoke.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'https://127.0.0.1:5184', ignoreHTTPSErrors: true, launchOptions: { args: ['--ignore-certificate-errors'] }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js dev --config wrangler.smoke.jsonc --ip 127.0.0.1 --port 5184 --local --local-protocol https --https-key-path "$P_NOTE_TLS_DIR/key.pem" --https-cert-path "$P_NOTE_TLS_DIR/cert.pem" --persist-to .wrangler/smoke-state',
    url: 'https://127.0.0.1:5184/health', ignoreHTTPSErrors: true, reuseExistingServer: false,
  },
});
