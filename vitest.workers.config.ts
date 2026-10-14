import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
  test: {
    fileParallelism: false,
    include: ['tests/workers/**/*.test.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/integration.json' },
    testTimeout: 10000,
  },
});
