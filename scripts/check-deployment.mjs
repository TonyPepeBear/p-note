import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function checkDeployment(origin, expectedHtml) {
  const scripts = html => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  const expectedScripts = scripts(expectedHtml);
  assert(expectedScripts.length > 0, 'CICD-03：本機建置缺少 script');
  const get = path => fetch(new URL(path, origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const response = await get('/');
  assert.equal(response.status, 200, 'CICD-03：正式首頁狀態錯誤');
  assert.match(response.headers.get('content-type') ?? '', /text\/html/, 'CICD-03：首頁不是 HTML');
  assert.deepEqual(scripts(await response.text()), expectedScripts, 'CICD-03：正式建置不符');
  for (const script of expectedScripts) {
    assert(script.startsWith('/assets/'), 'CICD-03：建置 script 必須來自本站 assets');
    const asset = await get(script);
    assert.equal(asset.status, 200, 'CICD-03：建置 script 不可用');
    assert.match(asset.headers.get('content-type') ?? '', /javascript/, 'CICD-03：script 類型錯誤');
    await asset.arrayBuffer();
  }
  assert.equal((await get('/api/pages')).status, 401, 'CICD-03：私人 API 未拒絕未登入請求');
  for (const path of ['/__test/reset', '/probe', '/parties/rooms/test']) {
    assert.equal((await get(path)).status, 404, 'CICD-03：測試入口未封鎖');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync('wrangler.production.jsonc', 'utf8'));
  const origin = new URL(`https://${config.routes[0].pattern}`).origin;
  await checkDeployment(origin, readFileSync('dist/index.html', 'utf8'));
  console.log('CICD-03：正式 HTTPS、建置資源與私人入口檢查通過');
}
