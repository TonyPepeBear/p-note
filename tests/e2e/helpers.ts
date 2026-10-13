import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function open(page: Page, room = randomUUID(), owner = 'owner', generation = 'g1') {
  await page.goto(`/probe?page=${room}&owner=${owner}&generation=${generation}`);
  await expect(page.locator('.tiptap[contenteditable="true"]'), '須建立真正 BlockNote 編輯器').toHaveCount(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  return room;
}

export async function saved(page: Page) {
  await expect(page.getByTestId('cloud-status')).toHaveText('雲端已儲存');
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
}

export async function blocks(page: Page) {
  return page.evaluate(() => window.probe!.editor.document);
}
