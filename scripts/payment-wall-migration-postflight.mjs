// SELECT-only exact pre/postflight for the payment wall migration. No migration, repair, activation or application RPC.
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { paymentWallContract, paymentWallSnapshotQuery, assertPaymentWallSnapshot } from './lib/paymentWallMigrationPostflight.mjs';

try {
  const [mode, version, receipt] = process.argv.slice(2);
  if (!isAbsolute(receipt || '')) throw new Error('payment wall absolute receipt path required');
  const contract = paymentWallContract(resolve(dirname(fileURLToPath(import.meta.url)), '..'), mode, version);
  const prior = mode === 'after' ? JSON.parse(readFileSync(receipt, 'utf8')) : undefined;
  const args = process.env.DB_URL ? [process.env.DB_URL] : [];
  const rows = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', paymentWallSnapshotQuery()], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
  }).trim().split('\n');
  const result = assertPaymentWallSnapshot(contract, rows, prior);
  if (mode === 'before') writeFileSync(receipt, JSON.stringify({ version, targetSha256: contract.targetSha256, rows }), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, scope: 'exact installed catalog only; no activation or customer-flow proof' }));
} catch (error) {
  const reason = /^payment wall /.test(error.message || '') ? error.message : 'payment wall catalog verification could not execute';
  console.error(`${reason}; migration/release remains held`);
  process.exitCode = 1;
}
