import { expect, test } from '@playwright/test';

test('ENV-04：React／Vite 與本機 Worker 可啟動', async ({ page, request }) => {
  await page.goto('/probe');
  await expect(page.getByRole('heading', { name: 'p-note 技術驗證' })).toBeVisible();
  expect((await request.get('http://127.0.0.1:8787/health')).status()).toBe(200);
});
