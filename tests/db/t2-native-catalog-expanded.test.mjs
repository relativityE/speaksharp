// Protocol/negative controls for the expanded-catalog diagnostic. Fake SQL is NOT native database evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t2ExpandedCatalogQuery, withExpandedCatalogDiagnostic } from './account-closure-full-chain.mjs';
import { T2_INVENTORY, t2CatalogQuery } from '../../scripts/lib/t2MigrationPostflight.mjs';

const KEY = 'table:public.ai_suggestion_authority_receipts';
const OBJECT = { acl: [['service_role', 'DELETE', false]], kind: 'r', rls: true };
const mismatch = () => new Error(`T2 catalog mismatch: ${KEY}`);
const expandedOutput = JSON.stringify({ [KEY]: JSON.stringify(OBJECT), 'table:public.other': '{}' });

function harness({ record, sql = () => expandedOutput, write, warn } = {}) {
  const writes = [];
  const warnings = [];
  const queries = [];
  const wrapped = withExpandedCatalogDiagnostic(record, {
    inventory: T2_INVENTORY,
    sql: query => { queries.push(query); return sql(query); },
    write: write ?? (diagnostic => writes.push(diagnostic)),
    warn: warn ?? (message => warnings.push(message)),
  });
  return { wrapped, writes, warnings, queries };
}

test('the expanded query is the attested query with exactly its three md5 wrappers removed', () => {
  const hashed = t2CatalogQuery(T2_INVENTORY);
  const expanded = t2ExpandedCatalogQuery(T2_INVENTORY);
  assert.equal(hashed.split('md5(').length - 1, 3);
  assert.equal(expanded.split('md5(').length - 1, 0);
  assert.equal(expanded, hashed.replaceAll('md5(', '('));
});

test('a passing stage returns its value and runs no diagnostic', () => {
  const { wrapped, writes, queries } = harness({ record: stage => `ok-${stage}` });
  assert.equal(wrapped(2), 'ok-2');
  assert.deepEqual(writes, []);
  assert.deepEqual(queries, []);
});

test('a pin mismatch retains the un-hashed object for that key, read-only, then rethrows the ORIGINAL error', () => {
  const original = mismatch();
  const { wrapped, writes, queries } = harness({ record: () => { throw original; } });
  assert.throws(() => wrapped(0), error => error === original);
  assert.deepEqual(writes, [{ stage: 0, key: KEY, object: OBJECT }]);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.ok(queries[0].includes(t2ExpandedCatalogQuery(T2_INVENTORY)));
});

test('a failing diagnostic query is recorded and never masks the mismatch', () => {
  const original = mismatch();
  const { wrapped, writes } = harness({ record: () => { throw original; }, sql: () => { throw new Error('relation does not exist'); } });
  assert.throws(() => wrapped(0), error => error === original);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].object, null);
  assert.match(writes[0].diagnosticError, /relation does not exist/);
});

test('Sam RETURN on 40dfd6b7: a failing diagnostic WRITE never masks the mismatch', () => {
  const original = mismatch();
  const { wrapped, warnings } = harness({ record: () => { throw original; }, write: () => { throw new Error('ENOSPC: no space left'); } });
  assert.throws(() => wrapped(0), error => error === original);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not retained: ENOSPC/);
});

test('even a failing warning after a failing write never masks the mismatch', () => {
  const original = mismatch();
  const { wrapped } = harness({ record: () => { throw original; },
    write: () => { throw new Error('ENOSPC'); }, warn: () => { throw new Error('stderr closed'); } });
  assert.throws(() => wrapped(0), error => error === original);
});

test('an error that is not a pin mismatch is rethrown untouched, with no diagnostic', () => {
  const original = new Error('native catalog stage missing, repeated, reordered, or invalid');
  const { wrapped, writes, queries } = harness({ record: () => { throw original; } });
  assert.throws(() => wrapped(3), error => error === original);
  assert.deepEqual(writes, []);
  assert.deepEqual(queries, []);
});

const workflow = readFileSync(new URL('../../.github/workflows/account-closure-full-chain-proof.yml', import.meta.url), 'utf8');
const trigger = workflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1] ?? '';
// Codex P2 4363567722: the offline tests echo the pins back, so only the native replay can catch a wrong pin; a change
// to the attested query or pins must trigger it.
for (const file of ['scripts/lib/t2MigrationPostflight.mjs', 'scripts/t2-migration-postflight.mjs',
  'scripts/lib/exactMigrationGate.mjs', 'tests/db/t2-native-catalog-expanded.test.mjs']) {
  test(`proof workflow triggers on independently changed ${file}`, () => {
    assert.ok(trigger.split('\n').some(line => line.trim() === `- '${file}'`), `missing explicit proof trigger: ${file}`);
  });
}
test('the offline proof command collects this diagnostic test', () => {
  const commands = [...workflow.matchAll(/^\s*run: node --test ([^\n]+)$/gm)].map(match => match[1].trim().split(/\s+/));
  assert.ok(commands.some(files => files.includes('tests/db/t2-native-catalog-expanded.test.mjs')), 'diagnostic test is not collected');
});
