/** @param {string[]} required @param {{id:string,status:string}[]} actual */
export function checkCoverage(required, actual) {
  return required.flatMap(id => {
    const matches = actual.filter(item => item.id === id);
    if (!matches.length) return [`缺漏 ${id}`];
    if (matches.length > 1) return [`重複 ${id}`];
    return matches[0].status === 'passed' ? [] : [`${id} ${matches[0].status}`];
  });
}

export function reportCases(report, environment) {
  const cases = [];
  const add = (title, status, context) => {
    const id = title.match(/^((?:PROBE-)?(?:EDIT|SYNC|ORDER|BOUNDARY|LOAD|CHECKPOINT|AUTH|PAGE|ASSET|BACKUP|UI)-\d{2})[：:]/)?.[1];
    if (id) cases.push({ id: `${id}@${context}`, status });
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
  const probe = process.argv.includes('--probe');
  const auth = process.argv.includes('--auth');
  const pages = process.argv.includes('--pages');
  const assets = process.argv.includes('--assets');
  const editor = process.argv.includes('--editor');
  const ui = process.argv.includes('--ui');
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
    const dir = ui ? 'openspec/changes/redesign-mantine-workspace/specs' : 'openspec/changes/personal-notes-v1/specs';
    for (const name of await readdir(dir)) {
      const text = await readFile(`${dir}/${name}/spec.md`, 'utf8');
      for (const match of text.matchAll(/\*\*自動化驗證\*\*: `([^`]+)`；([^\n]+)/g)) {
        const [, id, method] = match;
        if (pages && !id.startsWith('PAGE-')) continue;
        if (editor && !id.startsWith('EDIT-')) continue;
        if (assets && !['ASSET-01','ASSET-02','ASSET-03','ASSET-04','EDIT-03'].includes(id)) continue;
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
  console.log(JSON.stringify({ 範圍: ui ? 'Mantine 介面' : auth ? '登入' : probe ? '技術原型' : pages ? '頁面與日記' : assets ? '私有圖片（ASSET-05 留待備份）' : editor ? '正式編輯器' : '完整產品', 必需結果: required.length, 已通過: required.length - failures.length, 未通過: failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
