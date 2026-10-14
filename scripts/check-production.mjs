import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

assert(existsSync('wrangler.production.jsonc'), 'DEPLOY-01：缺少正式部署設定');
const config = JSON.parse(readFileSync('wrangler.production.jsonc', 'utf8'));
assert.equal(config.name, 'p-note-production');
assert.equal(config.account_id, '1db38a9bdb2d1b51b647a83a8fe53fdc');
assert.equal(config.main, 'src/worker/app.ts');
assert.deepEqual(config.routes, [{ pattern: 'note.tonypepe.com', custom_domain: true }]);
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.assets.binding, 'STATIC');
assert.equal(config.assets.run_worker_first, true);
assert.equal(config.d1_databases[0].database_name, 'p-note-production');
assert.match(config.d1_databases[0].database_id, /^[\da-f-]{36}$/);
assert(!config.d1_databases[0].database_id.startsWith('00000000'));
assert.deepEqual(config.r2_buckets.map(bucket => [bucket.binding, bucket.bucket_name]), [
  ['ASSETS', 'p-note-production-assets'], ['BACKUPS', 'p-note-production-backups'],
]);
assert.deepEqual(config.secrets.required.toSorted(), ['OWNER_EMAIL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'SENDER_EMAIL', 'API_KEY_ENCRYPTION_SECRET'].toSorted());
assert.deepEqual(config.triggers.crons, ['0 19 * * *']);
const local = JSON.parse(readFileSync('wrangler.app.jsonc', 'utf8'));
assert.deepEqual(config.durable_objects, local.durable_objects);
assert.deepEqual(config.migrations, local.migrations);
assert.equal(execFileSync('git', ['ls-files', '.dev.vars*', '.env*'], { encoding: 'utf8' }).trim(), '');
console.log('DEPLOY-01：正式設定、資源隔離、網域與密鑰未追蹤斷言通過');
if (process.argv.includes('--cloud')) {
  const cloud = JSON.parse(readFileSync('docs/tdd/production-cloud.json', 'utf8'));
  assert(cloud.settings.success && cloud.secrets.success && cloud.domain.success);
  assert.equal(cloud.settings.bindings.find(binding => binding.name === 'DB').id, config.d1_databases[0].database_id);
  const secretsReport = process.argv.find(arg => arg.startsWith('--secrets-report='))?.split('=').slice(1).join('=');
  const secrets = secretsReport ? JSON.parse(readFileSync(secretsReport, 'utf8')) : cloud.secrets.result;
  assert.deepEqual(secrets.map(secret => secret.name).sort(), config.secrets.required.toSorted());
  assert(secrets.every(secret => secret.type === 'secret_text'));
  assert.equal(cloud.domain.result.length, 1);
  assert.equal(cloud.domain.result[0].hostname, config.routes[0].pattern);
  assert.equal(cloud.domain.result[0].service, config.name);
  assert.equal(cloud.domain.result[0].enabled, true);
  const r2 = JSON.parse(readFileSync('docs/tdd/production-r2.json', 'utf8'));
  assert(r2.passed);
  for (const bucket of config.r2_buckets) {
    assert.equal(r2.r2[bucket.bucket_name].managedPublicEnabled, false);
    assert.equal(r2.r2[bucket.bucket_name].customDomains, 0);
  }
  console.log('DEPLOY-01：雲端 bindings、secret 類型、私人 R2 與正式網域紀錄斷言通過');
}
