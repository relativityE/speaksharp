// #1643: observer for the EXISTING disposable native126 replay (and its fence127 successor), not a new runner.
// No connection creation, migration, provider call, or golden regeneration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { proofPostgresImage } from './account-closure-full-chain-diagnostics.mjs';
import { T2_VERSIONS, T2_INVENTORY, assertT2Sources, t2CatalogQuery,
  t2ExpectedCatalog, assertT2Catalog, t2DisabledQuery, assertT2Disabled,
  t2LedgerQuery, t2AdmissionQuery } from '../../scripts/lib/t2MigrationPostflight.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

export function createNativeT2CatalogProof({ sql, sources, identity, retain }) {
  assert.equal(typeof sql, 'function');
  assert.equal(typeof retain, 'function');
  // Exactly the two reviewed T2 profiles; the fence127 run is observed over the same stage0..6 and keeps its own identity.
  assert.ok(['main-t2-account-126', 'main-t2-fence-127'].includes(identity.profile), 'unreviewed native T2 observer profile');
  assert.equal(identity.environment, 'disposable');
  assert.match(identity.testedCommit, /^[a-f0-9]{40}$/);
  assert.equal(identity.testedCommit, identity.requestedHead);
  assert.equal(identity.treeClean, true, 'native proof source must be clean');
  assert.equal(identity.selectedPostgresVersion, '17.6.1.155');
  assert.match(identity.ownedContainer, /^supabase_db_closure-proof-[a-f0-9]{16}$/);
  assert.match(identity.imageDigest, /^[^\s]+@sha256:[a-f0-9]{64}$/);
  assert.equal(identity.imageDigest, proofPostgresImage(identity.selectedPostgresVersion).repositoryDigest);
  assertT2Sources(sources); // Checked-in allowlist; never accept regenerated pins.
  const sourceHashes = Object.fromEntries(T2_VERSIONS.map(v => [v, digest(sources[v])]));
  const receipt = { identity: { ...identity }, sourceHashes, status: 'INCOMPLETE',
    scope: 'disposable native stage0..6 catalog; not Production/activation/customer evidence', stages: [] };
  let failed = false;
  let finished = false;
  const report = () => structuredClone(receipt);
  const save = () => retain(report());

  return {
    record(stage) {
      assert.equal(failed, false, 'native catalog proof already failed');
      assert.equal(finished, false, 'native catalog proof already finished');
      if (stage !== receipt.stages.length || !Number.isInteger(stage) || stage < 0 || stage > 6) {
        failed = true;
        receipt.status = 'FAIL';
        receipt.reason = 'native catalog stage missing, repeated, reordered, or invalid';
        save();
        throw new Error(receipt.reason);
      }
      const mode = stage === 0 ? 'before' : 'after';
      const version = T2_VERSIONS[Math.max(0, stage - 1)];
      const completionPresent = stage === 6;
      const query = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,pg_temp;
SELECT json_build_object('version',version(),'serverVersionNum',current_setting('server_version_num'),
  'readOnly',current_setting('transaction_read_only'),'database',current_database())::text;
${t2CatalogQuery(T2_INVENTORY)}
${t2DisabledQuery(completionPresent)}
${t2LedgerQuery(mode, version)}
${t2AdmissionQuery(stage >= 4)}
COMMIT;`;
      const row = { stage, mode, version, querySha256: digest(query), status: 'FAIL' };
      receipt.stages.push(row);
      try {
        const output = sql(query);
        assert.equal(typeof output, 'string', 'native catalog output absent');
        row.output = output; // Metadata and booleans only; no customer/capability rows.
        const lines = output.trim().split('\n');
        assert.equal(lines.length, 5, 'incomplete native catalog output');
        row.native = JSON.parse(lines[0]);
        assert.match(row.native.version, /^PostgreSQL 17\./, 'native PostgreSQL17 required');
        assert.equal(Math.floor(Number(row.native.serverVersionNum) / 10000), 17);
        assert.equal(row.native.readOnly, 'on', 'native catalog snapshot must be read-only');
        assert.equal(row.native.database, 'postgres');
        row.catalog = JSON.parse(lines[1]);
        row.disabled = JSON.parse(lines[2]);
        row.ledger = lines[3];
        row.admission = lines[4];
        row.catalogCheck = assertT2Catalog(row.catalog, t2ExpectedCatalog(mode, version));
        assertT2Disabled(row.disabled, completionPresent);
        assert.equal(row.ledger, 'true', 'native T2 ledger prefix mismatch');
        assert.equal(row.admission, 'true', 'native T2 admission/ACL mismatch');
        row.status = 'PASS';
        save();
      } catch (error) {
        failed = true;
        receipt.status = 'FAIL';
        row.status = 'FAIL';
        row.reason = error.message;
        save(); // Retain failed readback before the caller tears down its database.
        throw error;
      }
    },
    finish() {
      assert.equal(failed, false, 'native catalog proof failed');
      assert.equal(finished, false, 'native catalog proof already finished');
      assert.deepEqual(receipt.stages.map(row => row.stage), [0, 1, 2, 3, 4, 5, 6],
        'all seven cumulative native catalog states are required');
      assert.ok(receipt.stages.every(row => row.status === 'PASS'));
      finished = true;
      receipt.status = 'PASS';
      save();
      return report();
    },
    report,
  };
}
