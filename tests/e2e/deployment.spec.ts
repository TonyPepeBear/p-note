import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
  for (const command of ['npm ci', 'npm run check', 'npm run check:production', 'npm run build']) expect(deploy).toContain(command);
  expect(workflow).not.toMatch(/continue-on-error|if: always\(\)|pull_request_target/);
  const commands = ['npm run check', 'npm run build', '--dry-run', 'd1 migrations apply', ' deploy --config wrangler.production.jsonc\n', 'node scripts/check-deployment.mjs'];
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

test('CICD-03：部署 smoke 拒絕舊版建置與錯誤的私人入口狀態', async () => {
  expect(existsSync('scripts/check-deployment.mjs'), '缺少部署後入口檢查').toBe(true);
  const { checkDeployment } = await import('../../scripts/check-deployment.mjs');
  let script = '/assets/index-current.js';
  let privateStatus = 401;
  let testStatus = 404;
  const server = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(`<script type="module" src="${script}"></script>`); }
    else if (req.url === '/api/pages') { res.writeHead(privateStatus); res.end(); }
    else if (req.url === '/assets/index-current.js') { res.setHeader('content-type', 'application/javascript'); res.end('export {};'); }
    else { res.writeHead(testStatus); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const html = '<script type="module" src="/assets/index-current.js"></script>';
  try {
    await checkDeployment(origin, html);
    script = '/assets/index-old.js';
    await expect(checkDeployment(origin, html)).rejects.toThrow();
    script = '/assets/index-current.js'; privateStatus = 200;
    await expect(checkDeployment(origin, html)).rejects.toThrow();
    privateStatus = 401; testStatus = 200;
    await expect(checkDeployment(origin, html)).rejects.toThrow();
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
