import { expect, test } from '@playwright/test';
import { openPrivate, saved, blocks } from './helpers';
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });

test('SYNC-RECONNECT-01：瀏覽器在線而 API 503，已下載頁面仍可啟動／保存，恢復後重試同步', async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(() => { const editor=window.probe!.editor;editor.updateBlock(editor.document[0],{content:'本機啟動內容'}); }); await saved(page);
  await page.addInitScript(() => {
    const original=window.fetch;
    window.fetch=(input, init)=>String(input).startsWith('/api/') ? Promise.resolve(Response.json({message:'測試服務暫時不可用'},{status:503})) : original(input,init);
    addEventListener('fixture-backend-ready',()=>{window.fetch=original;dispatchEvent(new Event('online'));},{once:true});
  });
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(JSON.stringify(await blocks(page))).toContain('本機啟動內容');
  await expect(page.getByTestId('cloud-status')).toHaveText('連線失敗，可重試');
  await page.evaluate(()=>{const editor=window.probe!.editor;editor.updateBlock(editor.document[0],{content:'故障期間仍保留'});});
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await page.evaluate(()=>dispatchEvent(new Event('fixture-backend-ready'))); await saved(page);
  expect(JSON.stringify(await blocks(page))).toContain('故障期間仍保留');
});

test('SYNC-RECONNECT-02：每次重連先重驗權限；重驗故障期間只保存本機，重試後持久確認', async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(()=>{
    const original=window.fetch; document.documentElement.dataset.revalidations='0';
    window.fetch=(input,init)=>{
      if(String(input).startsWith('/api/pages/')){document.documentElement.dataset.revalidations=String(Number(document.documentElement.dataset.revalidations)+1);return Promise.resolve(Response.json({message:'測試重驗故障'},{status:503}));}
      return original(input,init);
    };
    addEventListener('fixture-backend-ready',()=>{window.fetch=original;},{once:true});
  });
  const room = await page.evaluate(() => window.probe!.room);
  expect((await page.request.post('/__test/drop-connections', { data: { room } })).status()).toBe(200);
  await expect.poll(()=>page.evaluate(()=>Number(document.documentElement.dataset.revalidations))).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.probe!.provider.wsconnected)).toBe(false);
  await expect(page.getByTestId('cloud-status')).toHaveText('連線失敗，可重試');
  await page.evaluate(()=>{const editor=window.probe!.editor;editor.updateBlock(editor.document[0],{content:'等待重驗的本機草稿'});});
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await page.evaluate(()=>dispatchEvent(new Event('fixture-backend-ready')));
  await page.getByRole('button',{name:'重試儲存',exact:true}).click(); await saved(page);
  expect(JSON.stringify(await blocks(page))).toContain('等待重驗的本機草稿');
});

test('SYNC-RECONNECT-03：API 明確拒絕登入時不以本機快取繞過，保留草稿供重新登入', async ({ page }) => {
  await openPrivate(page); await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=(input,init)=>String(input).startsWith('/api/pages/') ? Promise.resolve(Response.json({message:'登入已失效'},{status:401})) : original(input,init);
  });
  await page.reload(); await expect(page.getByLabel('Email',{exact:true})).toBeVisible(); await expect(page.getByTestId('ready')).toHaveCount(0);
});

test('SYNC-CACHE-01：啟動資源快取拒絕私人 API／登入連結，索引損毀時保留正文且明確拒絕開啟', async ({ page }) => {
  const id=await openPrivate(page);
  const result=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready; const channel=new MessageChannel();
    const completed=new Promise<void>(resolve=>{channel.port1.onmessage=()=>{channel.port1.close();resolve();};});
    registration.active!.postMessage({type:'cache-resources',urls:[location.origin+'/api/session',location.origin+'/login/confirm?token=test-only-token','blob:'+location.origin+'/revoked-fixture']},[channel.port2]); await completed;
    const urls=[]; for(const key of await caches.keys()) for(const request of await (await caches.open(key)).keys()) urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(result.some(path=>path.startsWith('/api/')||path.startsWith('/login/'))).toBe(false);
  await page.evaluate(id=>{const owner=localStorage.getItem('p-note:owner');localStorage.setItem(`p-note:page:${owner}:${id}`,'{');},id);
  await page.context().setOffline(true); await page.reload(); await expect(page.getByRole('alert')).toContainText('尚未下載'); await expect(page.getByTestId('ready')).toHaveCount(0);
});
