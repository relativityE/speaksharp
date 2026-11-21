// SELECT-only exact pre/postflight; the workflow independently verifies the production pooler.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSaveJournalCleanupSnapshot, saveJournalCleanupContract, saveJournalCleanupSnapshotQuery } from './lib/saveJournalCleanupMigrationPostflight.mjs';

try {
  const [mode, version, receipt, ...extra] = process.argv.slice(2);
  if (!isAbsolute(receipt || '') || extra.length) throw new Error('save journal cleanup absolute receipt path required');
  const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
  const contract = saveJournalCleanupContract(root, mode, version);
  const endpoint = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'].map(key => process.env[key]);
  if (endpoint.some(value => !value) || process.env.DB_URL || process.env.PGSERVICE || process.env.PGHOSTADDR) {
    throw new Error('save journal cleanup expected explicit pooler connection');
  }
  const endpointSha256 = createHash('sha256').update(JSON.stringify(endpoint)).digest('hex');
  const prior = mode === 'after' ? JSON.parse(readFileSync(receipt, 'utf8')) : undefined;
  if (mode === 'after') {
    if (prior?.version !== version || prior?.targetSha256 !== contract.targetSha256 || prior?.endpointSha256 !== endpointSha256) {
      throw new Error('save journal cleanup before receipt missing or for another source/endpoint');
    }
    assertSaveJournalCleanupSnapshot({ ...contract, mode: 'before' }, prior.snapshot);
  }
  const output = execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', saveJournalCleanupSnapshotQuery()], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c search_path=pg_catalog' },
  });
  const snapshot = JSON.parse(output);
  if (prior && prior.snapshot.major !== snapshot.major) throw new Error('save journal cleanup server major changed');
  const result = assertSaveJournalCleanupSnapshot(contract, snapshot);
  if (mode === 'before') writeFileSync(receipt, JSON.stringify({ version, targetSha256: contract.targetSha256, endpointSha256, snapshot }),
    { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, scope: 'installed catalog only; no cleanup invoked' }));
} catch (error) {
  const reason = /^save journal cleanup /.test(error.message || '') ? error.message : 'save journal cleanup verification could not execute';
  console.error(`${reason}; migration/release remains held`);
  process.exitCode = 1;
}
