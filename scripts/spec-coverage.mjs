/** @param {string[]} required @param {{id:string,status:string,title?:string}[]} actual */
export function checkCoverage(required, actual) {
  return required.flatMap(id => {
    const matches = actual.filter(item => item.id === id);
    if (!matches.length) return [`缺漏 ${id}`];
    // 同 ID 不同標題是同一情境的參數化案例，須全部通過；標題相同才是重複計算。
    if (matches.length > 1 && new Set(matches.map(item => item.title)).size < matches.length) return [`重複 ${id}`];
    return matches.filter(item => item.status !== 'passed').map(item => `${id} ${item.status}`);
  });
}

export function reportCases(report, environment) {
  const cases = [];
  const add = (title, status, context) => {
    const prefix = title.split(/[：:]/, 1)[0];
    const ids = prefix.split(/\s+/);
    if (ids.every(id => /^(?:PROBE-)?(?:EDIT|SYNC|ORDER|BOUNDARY|LOAD|CHECKPOINT|AUTH|PAGE|ASSET|BACKUP|UI|UX|LFN|DB|LINK|PWA|HIST|ICON)-\d{2}$/.test(id))) {
      for (const id of ids) cases.push({ id: `${id}@${context}`, status, title });
    }
  };
  if (Array.isArray(report.testResults)) {
    for (const file of report.testResults) for (const test of file.assertionResults) add(test.title, test.status, environment);
  } else if (Array.isArray(report.suites)) {
    const visit = suite => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        if (!test.results.length) add(spec.title, 'not-run', test.projectName);
        for (const result of test.results) add(spec.title, result.status, test.projectName);
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites) visit(suite);
  } else throw new Error('報告格式錯誤');
  return cases;
}

async function main() {
  const { readFile, readdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const probe = process.argv.includes('--probe');
  const auth = process.argv.includes('--auth');
  const pages = process.argv.includes('--pages');
  const assets = process.argv.includes('--assets');
  const editor = process.argv.includes('--editor');
  const ui = process.argv.includes('--ui');
  const ux = process.argv.includes('--ux');
  const databases = process.argv.includes('--databases');
  const links = process.argv.includes('--links');
  const pwa = process.argv.includes('--pwa');
  const history = process.argv.includes('--history');
  const icons = process.argv.includes('--icons');
  const projects = ['chromium-desktop', 'chromium-mobile', 'webkit-mobile'];
  let required = [];
  if (auth) {
    required = Array.from({ length: 8 }, (_, n) => `AUTH-0${n + 1}@integration`);
    for (const n of [1, 3, 4, 5, 6]) required.push(...projects.map(project => `AUTH-0${n}@${project}`));
  } else if (probe) {
    required = [2, 3, 4, 5, 6, 7].map(n => `PROBE-SYNC-${String(n).padStart(2, '0')}@integration`);
    required.push(...['ORDER', 'BOUNDARY', 'LOAD', 'CHECKPOINT'].map(name => `PROBE-${name}-01@integration`));
    for (const id of [...[1, 2, 3, 4, 5].map(n => `PROBE-EDIT-0${n}`), ...[1, 4, 8, 9, 12].map(n => `PROBE-SYNC-${String(n).padStart(2, '0')}`)]) {
      required.push(...projects.map(project => `${id}@${project}`));
    }
  } else {
    const capabilities = icons ? ['page-icons'] : history ? ['page-history'] : pwa ? ['progressive-web-app'] : links ? ['note-links'] : databases ? ['note-databases', 'backup-restore'] : ux ? ['workspace-usability'] : ui ? ['workspace-experience']
      : ['personal-auth', 'pages-and-journal', 'block-editing', 'realtime-sync', 'private-assets', 'backup-restore'];
    const active = (await readdir('openspec/changes')).filter(name => name !== 'archive');
    for (const name of capabilities) {
      const deltas = active.map(change => `openspec/changes/${change}/specs/${name}/spec.md`).filter(path => existsSync(path));
      const text = (await Promise.all([`openspec/specs/${name}/spec.md`, ...deltas].filter(path => existsSync(path)).map(path => readFile(path, 'utf8')))).join('\n');
      for (const match of text.matchAll(/\*\*自動化驗證\*\*: `([^`]+)`；([^\n]+)/g)) {
        const [, id, method] = match;
        if (databases && !id.startsWith('DB-')) continue;
        if (pages && !id.startsWith('PAGE-')) continue;
        if (editor && !id.startsWith('EDIT-')) continue;
        if (assets && !['ASSET-01','ASSET-02','ASSET-03','ASSET-04','ASSET-06','ASSET-07','ASSET-08','ASSET-09','EDIT-03'].includes(id)) continue;
        if (method.includes('Workers')) required.push(`${id}@integration`);
        else if (method.includes('Vitest')) required.push(`${id}@unit`);
        if (method.includes('Playwright')) required.push(...projects.map(project => `${id}@${project}`));
      }
    }
  }
  const actual = [];
  for (const environment of ['unit', 'integration', 'e2e']) {
    const report = JSON.parse(await readFile(`reports/${environment}.json`, 'utf8'));
    if (report.success === false || report.errors?.length || report.stats?.unexpected || report.stats?.flaky) throw new Error(`${environment} 報告仍有失敗`);
    actual.push(...reportCases(report, environment));
  }
  const failures = checkCoverage(required, actual);
  console.log(JSON.stringify({ 範圍: icons ? '頁面圖示' : history ? '頁面版本歷史' : pwa ? 'PWA' : links ? '筆記連結' : databases ? '筆記資料庫' : ux ? '工作區可用性' : ui ? 'Mantine 介面' : auth ? '登入' : probe ? '技術原型' : pages ? '頁面與日記' : assets ? '私有圖片（ASSET-05 留待備份）' : editor ? '正式編輯器' : '完整產品', 必需結果: required.length, 已通過: required.length - failures.length, 未通過: failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
