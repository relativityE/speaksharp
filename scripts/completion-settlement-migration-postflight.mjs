// SELECT-only exact pre/postflight; the workflow independently verifies the production pooler.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCompletionSettlementSnapshot, completionSettlementContract, completionSettlementSnapshotQuery } from './lib/completionSettlementMigrationPostflight.mjs';

try {
  const [mode, version, receipt, ...extra] = process.argv.slice(2);
  if (!isAbsolute(receipt || '') || extra.length) throw new Error('completion settlement absolute receipt path required');
  const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
  const contract = completionSettlementContract(root, mode, version);
  const endpoint = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'].map(key => process.env[key]);
  if (endpoint.some(value => !value) || process.env.DB_URL || process.env.PGSERVICE || process.env.PGHOSTADDR) {
    throw new Error('completion settlement expected explicit pooler connection');
  }
  const endpointSha256 = createHash('sha256').update(JSON.stringify(endpoint)).digest('hex');
  const prior = mode === 'after' ? JSON.parse(readFileSync(receipt, 'utf8')) : undefined;
  if (mode === 'after') {
    if (prior?.version !== version || prior?.targetSha256 !== contract.targetSha256 || prior?.endpointSha256 !== endpointSha256) {
      throw new Error('completion settlement before receipt missing or for another source/endpoint');
    }
    assertCompletionSettlementSnapshot({ ...contract, mode: 'before' }, prior.snapshot);
  }
  const output = execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', completionSettlementSnapshotQuery()], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c search_path=pg_catalog' },
  });
  const snapshot = JSON.parse(output);
  if (prior && prior.snapshot.major !== snapshot.major) throw new Error('completion settlement server major changed');
  const result = assertCompletionSettlementSnapshot(contract, snapshot, prior?.snapshot ?? null);
  if (mode === 'before') writeFileSync(receipt, JSON.stringify({ version, targetSha256: contract.targetSha256, endpointSha256, snapshot }),
    { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, scope: 'installed catalog only; no settlement invoked; completion OFF and unbound' }));
} catch (error) {
  const reason = /^completion settlement /.test(error.message || '') ? error.message : 'completion settlement verification could not execute';
  console.error(`${reason}; migration/release remains held`);
  process.exitCode = 1;
}
