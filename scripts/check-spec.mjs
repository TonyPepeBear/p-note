import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

async function markdownFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const files = ['README.md', ...await markdownFiles('docs'), ...await markdownFiles('openspec')];
const ids = [];
let links = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(target)) continue;
    assert(existsSync(resolve(dirname(file), target.split('#')[0])), `${file}: ${target}`);
    links++;
  }
  if (file.includes('/specs/')) {
    const found = Array.from(text.matchAll(/\*\*自動化驗證\*\*: `([^`]+)`；([^\n]+)/g));
    assert.equal(found.length, Array.from(text.matchAll(/^#### Scenario:/gm)).length, `${file}: 情境缺驗證方法`);
    for (const [, id, method] of found) {
      assert(/^(AUTH|PAGE|EDIT|SYNC|ASSET|BACKUP)-\d{2}$/.test(id), id);
      assert(method.includes('斷言') || method.includes('檢查'), `${id}: 缺機器斷言`);
      ids.push(id);
    }
  }
}
assert.equal(ids.length, 47);
assert.equal(new Set(ids).size, 47);
const scope = await readFile('docs/v1-scope.md', 'utf8');
for (const value of ['固定到期', '30×24 小時', '伺服器可讀內容', '已下載內文可離線', '10 分鐘', '60 秒', '最多 5 次', '最多 20 次', '10 MiB', '03:00', '0 19 * * *', '90×24 小時', 'Asia/Taipei', 'ZIP']) assert(scope.includes(value), `缺決策 ${value}`);
const contracts = {
  'personal-auth': ['30×24 小時', '不因使用續期', '10 分鐘', '60 秒', '最多 5 次', '最多 20 次'],
  'realtime-sync': ['已下載頁面', '新增頁面、標題／階層異動及圖片上傳必須連線'],
  'block-editing': ['段落', '標題', '待辦', '引用', '分隔線', '粗體', '斜體', '連結', '圖片', '程式碼'],
  'private-assets': ['JPEG／PNG／WebP／GIF', '10 MiB', '不壓縮', 'SVG／HEIC'],
  'pages-and-journal': ['Asia/Taipei', '先前單獨刪除', '同日期已刪除日記'],
  'backup-restore': ['每日台北 03:00', '90×24 小時', '時間窗', 'ZIP'],
};
for (const [name, values] of Object.entries(contracts)) {
  const text = await readFile(`openspec/changes/personal-notes-v1/specs/${name}/spec.md`, 'utf8');
  for (const value of values) assert(text.includes(value), `${name} 決策不一致：${value}`);
}
console.log(JSON.stringify({ 文件: files.length, 本地連結: links, 唯一情境: ids.length, 決策契約: '通過' }));
const appConfig = JSON.parse(await readFile('wrangler.app.jsonc', 'utf8'));
assert.deepEqual(appConfig.secrets.required, ['OWNER_EMAIL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'SENDER_EMAIL']);
assert.deepEqual(appConfig.send_email, [{ name: 'EMAIL' }]);
assert.deepEqual(appConfig.triggers.crons, ['0 19 * * *']);
assert(!appConfig.vars, '應用設定不得提交私有值');
assert.equal(appConfig.main, 'src/worker/app.ts');
const testConfig = JSON.parse(await readFile('wrangler.test.jsonc', 'utf8'));
assert.equal(testConfig.main, 'tests/runtime.ts');
assert.notEqual(appConfig.d1_databases[0].database_id, testConfig.d1_databases[0].database_id);
assert.notEqual(appConfig.r2_buckets[0].bucket_name, testConfig.r2_buckets[0].bucket_name);
for (const config of [appConfig, testConfig]) {
  assert.deepEqual(config.r2_buckets.map(bucket => bucket.binding).sort(), ['ASSETS', 'BACKUPS']);
  assert.notEqual(config.r2_buckets[0].bucket_name, config.r2_buckets[1].bucket_name);
}
assert.notEqual(appConfig.r2_buckets[1].bucket_name, testConfig.r2_buckets[1].bucket_name);
assert(!JSON.stringify([appConfig, testConfig]).includes('"remote":true'));
assert((await readFile('index.html', 'utf8')).includes('<meta name="referrer" content="no-referrer"'), '登入 token 不得送出為 referrer');
console.log('登入設定來源與本機測試隔離契約：通過');
