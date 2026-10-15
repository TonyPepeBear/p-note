import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/deploy-production.yml';

test('CICD-01：master 才發布，建置失敗阻擋且發布不並行', () => {
  expect(existsSync(workflowPath), '缺少正式部署 workflow').toBe(true);
  const workflow = readFileSync(workflowPath, 'utf8');
  expect(workflow).toMatch(/push:\s*\n\s+branches: \[master\]/);
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain("if: github.ref == 'refs/heads/master'");
  expect(workflow).toContain('group: cloudflare-production');
  expect(workflow).toContain('cancel-in-progress: false');
  const deploy = workflow.split('\n  deploy:')[1];
  expect(deploy).toContain('npm install --global npm@11.21.0');
  expect(deploy.indexOf('npm install --global npm@11.21.0')).toBeLessThan(deploy.indexOf('npm ci'));
  for (const command of ['npm ci', 'npm run check', 'npm run check:production', 'npm run build']) expect(deploy).toContain(command);
  expect(workflow).not.toMatch(/continue-on-error|if: always\(\)|pull_request_target/);
  const commands = ['npm run check', 'npm run build', '--dry-run', 'd1 migrations apply', ' deploy --config wrangler.production.jsonc\n'];
  let previous = -1;
  for (const command of commands) {
    const index = deploy.indexOf(command);
    expect(index, command).toBeGreaterThan(previous);
    previous = index;
  }
});

test('CICD-02：僅發布工作讀取 GitHub secret，不使用本機秘密檔', () => {
  expect(existsSync(workflowPath), '缺少正式部署 workflow').toBe(true);
  const workflow = readFileSync(workflowPath, 'utf8');
  const [beforeRelease, deploy] = workflow.split('      - name: 遷移資料庫並發布');
  expect(beforeRelease).not.toContain('secrets.');
  expect(deploy).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
  expect(deploy).toContain('test -n "$CLOUDFLARE_API_TOKEN"');
  expect(deploy.indexOf('test -n')).toBeLessThan(deploy.indexOf('d1 migrations apply'));
  expect(workflow).toContain('contents: read');
  expect(workflow).not.toMatch(/\.dev\.vars|\.env\.release|--secrets-file|secret bulk|secret put|--keep-vars/);
});

test('CICD-03：發布成功後結束，不執行網站與入口檢查', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const steps = workflow.split(/\n {6}- /).slice(1);
  expect(steps.at(-1)).toMatch(/^name: 遷移資料庫並發布/);
  expect(steps.at(-1)).toContain('d1 migrations apply');
  expect(steps.at(-1)?.trimEnd()).toMatch(/deploy --config wrangler\.production\.jsonc$/);
  expect(workflow).not.toMatch(/check-deployment|確認正式建置與私人入口|curl |wget |test:production/);
});
