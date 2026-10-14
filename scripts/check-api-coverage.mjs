import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workers = JSON.parse(readFileSync('reports/integration.json', 'utf8'));
const e2e = JSON.parse(readFileSync('reports/e2e.json', 'utf8'));
assert(workers.success && !e2e.stats.unexpected && !e2e.stats.flaky, '測試報告有失敗');
const actual = [];
for (const f of workers.testResults) for (const t of f.assertionResults) for (const id of t.title.match(/KEY-\d{2}/g) ?? []) actual.push({ id: id + '@workers', passed: t.status === 'passed' });
function visit(s) { for (const spec of s.specs ?? []) for (const t of spec.tests) for (const id of spec.title.match(/KEY-\d{2}/g) ?? []) actual.push({ id: id + '@' + t.projectName, passed: t.results.length === 1 && t.results[0].status === 'passed' }); for (const child of s.suites ?? []) visit(child); }
for (const suite of e2e.suites) visit(suite);
const required = Array.from({ length: 6 }, (_, i) => `KEY-0${i + 1}@workers`);
for (const project of ['chromium-desktop', 'chromium-mobile', 'webkit-mobile']) for (const n of [1, 2, 4]) required.push(`KEY-0${n}@${project}`);
for (const id of required) { const cases = actual.filter(c => c.id === id); assert(cases.length && cases.every(c => c.passed), `${id} 未完整通過`); }
console.log(JSON.stringify({ 自動化情境環境: required.length, 全部通過: true }));
