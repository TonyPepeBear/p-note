// 僅在專用 worktree 執行；暫時改用獨立埠，結束後還原原檔，避免碰到其他 agent 的測試服務。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const smoke = process.argv[2] === '--smoke';
const files = smoke ? ['playwright.smoke.config.ts', 'wrangler.smoke.jsonc'] : ['src/client/editor.tsx', 'vite.config.ts', 'playwright.config.ts', 'playwright.smoke.config.ts', 'wrangler.test.jsonc', 'wrangler.smoke.jsonc', 'package.json', ...readdirSync('tests/e2e').filter(f => f.endsWith('.ts')).map(f => 'tests/e2e/' + f)];
const originals = new Map(files.map(p => [p, readFileSync(p, 'utf8')]));
let status = 1;
try {
  for (const [p, text] of originals) writeFileSync(p, text.replaceAll('5173', '5273').replaceAll('8787', '8887').replaceAll('5184', '5284'));
  const args = process.argv.slice(2);
  if (smoke) { const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' }); if (build.status !== 0) throw new Error('正式建置失敗'); }
  status = spawnSync(process.execPath, args[0] === '--smoke' ? ['scripts/test-build.mjs'] : ['node_modules/@playwright/test/cli.js', 'test', ...args], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }).status ?? 1;
} finally { for (const [p, text] of originals) writeFileSync(p, text); }
process.exitCode = status;
