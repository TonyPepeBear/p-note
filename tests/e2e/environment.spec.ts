import { expect, test } from '@playwright/test';
import { api } from './ports';

test('ENV-04：React／Vite 與本機 Worker 可啟動', async ({ page, request }) => {
  await page.goto('/probe');
  await expect(page.getByRole('heading', { name: 'p-note 技術驗證' })).toBeVisible();
  expect((await request.get(`${api}/health`)).status()).toBe(200);
});
