import { expect, it } from 'vitest';
import { checkCoverage, reportCases } from '../../scripts/spec-coverage.mjs';

it('ENV-05：未執行、缺漏、重複、skip／todo／失敗不能算覆蓋', () => {
  expect(checkCoverage(['SYNC-02'], [])).toEqual(['缺漏 SYNC-02']);
  for (const status of ['skipped', 'pending', 'todo', 'failed']) {
    expect(checkCoverage(['SYNC-02'], [{ id: 'SYNC-02', status }])).toEqual([`SYNC-02 ${status}`]);
  }
  expect(checkCoverage(['SYNC-02'], [
    { id: 'SYNC-02', status: 'passed' }, { id: 'SYNC-02', status: 'passed' },
  ])).toEqual(['重複 SYNC-02']);
  expect(checkCoverage(['SYNC-02', 'SYNC-03'], [
    { id: 'SYNC-02', status: 'passed' }, { id: 'SYNC-03', status: 'passed' },
  ])).toEqual([]);
});

it('ENV-06：實際報告解析保留環境、失敗及未執行狀態', () => {
  expect(reportCases({ testResults: [{ assertionResults: [{ title: 'PROBE-SYNC-02：重送', status: 'failed' }] }] }, 'integration'))
    .toEqual([{ id: 'PROBE-SYNC-02@integration', status: 'failed' }]);
  expect(reportCases({ suites: [{ specs: [{ title: 'PROBE-EDIT-01：編輯', tests: [{ projectName: 'webkit-mobile', results: [{ status: 'skipped' }] }] }] }] }, 'e2e'))
    .toEqual([{ id: 'PROBE-EDIT-01@webkit-mobile', status: 'skipped' }]);
  expect(() => reportCases({}, 'integration')).toThrow('報告格式');
  expect(reportCases({ suites: [{ specs: [{ title: 'UI-03：搜尋', tests: [{ projectName: 'webkit-mobile', results: [{ status: 'failed' }] }] }] }] }, 'e2e'))
    .toEqual([{ id: 'UI-03@webkit-mobile', status: 'failed' }]);
});
