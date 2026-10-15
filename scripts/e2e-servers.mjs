// 每個 Playwright worker 一組 preview＋測試 Worker，避免 /__test/reset 與時鐘控制互相干擾。
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readyPort, servicePorts, workers } from '../tests/e2e/ports.ts';

const watch = process.argv.includes('--watch');
const vite = 'node_modules/vite/bin/vite.js';
const wrangler = 'node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js';
const children = [];
let stopping = false;
const tlsDirectory = mkdtempSync(join(tmpdir(), 'p-note-e2e-tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '1', '-nodes', '-keyout', join(tlsDirectory, 'key.pem'), '-out', join(tlsDirectory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
const certificate = readFileSync(join(tlsDirectory, 'cert.pem'));

function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill();
  rmSync(tlsDirectory, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function run(args, env = {}) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, P_NOTE_TLS_DIR: tlsDirectory, WRANGLER_SEND_METRICS: 'false', ...env } });
  child.on('exit', (code) => { if (!stopping) { console.error(`測試服務異常結束：${args.join(' ')}`); stop(code || 1); } });
  children.push(child);
}

async function ready(url) {
  for (let i = 0; i < 600; i++) {
    try {
      const ok = url.startsWith('https:') ? await new Promise((resolve, reject) => {
        httpsGet(url, { ca: certificate }, response => { response.resume(); resolve(response.statusCode === 200); }).on('error', reject);
      }) : (await fetch(url)).ok;
      if (ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`測試服務逾時：${url}`);
}

if (spawnSync(process.execPath, [vite, 'build'], { stdio: 'inherit' }).status !== 0) process.exit(1);
// 不清空 dist，重建期間 preview 仍有舊檔可用。
if (watch) run([vite, 'build', '--watch', '--emptyOutDir', 'false']);
const urls = [];
for (let i = 0; i < workers; i++) {
  const { web, api, inspector } = servicePorts(i);
  run([vite, 'preview', '--host', '127.0.0.1', '--port', String(web), '--strictPort'], { P_NOTE_API: `https://127.0.0.1:${api}` });
  run([wrangler, 'dev', '--config', 'wrangler.test.jsonc', '--ip', '127.0.0.1', '--port', String(api), '--inspector-port', String(inspector), '--local', '--local-protocol', 'https', '--https-key-path', join(tlsDirectory, 'key.pem'), '--https-cert-path', join(tlsDirectory, 'cert.pem'), '--persist-to', `.wrangler/test-state-${i}`, '--var', `BETTER_AUTH_URL:https://127.0.0.1:${web}`]);
  urls.push(`https://127.0.0.1:${web}/`, `https://127.0.0.1:${api}/health`);
}
await Promise.all(urls.map(ready)).catch((error) => { console.error(error.message); stop(1); });
createServer((_, res) => res.end(String(workers))).listen(readyPort, '127.0.0.1');
console.log(`${workers} 組 E2E 服務就緒（${watch ? '監看模式' : '單次'}）`);
