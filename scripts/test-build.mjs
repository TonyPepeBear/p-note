import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'p-note-smoke-'));
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '1', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost'], { stdio: 'ignore' });
  execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.smoke.config.ts'], { stdio: 'inherit', env: { ...process.env, P_NOTE_TLS_DIR: directory } });
} finally { rmSync(directory, { recursive: true, force: true }); }
