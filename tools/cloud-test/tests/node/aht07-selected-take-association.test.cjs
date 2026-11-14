'use strict';
// (finding 1): AHT-07's one-take smoke path skipped the association check, so a report stored once but bound to NO session
// or to ANOTHER session still passed feedback-stored-once. The one take is now bound: the persisted sessionSha256 (from the server projection
// already read for feedback-stored-once) must equal sha(selected take). No second take, read or request is added.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..', '..');
const DA = path.join(ROOT, 'harness', 'draft-adapters');
const { selectedTakeAssociation, sha } = require(path.join(DA, 'oracles', 'feedback-association.cjs'));

const selected = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const other = '16fd2706-8baf-433b-82eb-8c7fada847da';
const hex = s => crypto.createHash('sha256').update(s).digest('hex');

test('the persisted association of the selected take passes', () => {
  assert.equal(sha(selected), hex(selected));
  const r = selectedTakeAssociation({ sessionSha256: hex(selected) }, selected);
  assert.deepEqual(r, { pass: true, detail: { matchesSelected: true, persistedAssociation: 'session' } });
});

test('negative controls: another session, null, malformed, missing report or missing selection all fail', () => {
  const cases = [
    [{ sessionSha256: hex(other) }, selected, 'session'],
    [{ sessionSha256: null }, selected, 'null'],
    [{ sessionSha256: 'not-a-hash' }, selected, 'malformed'],
    [{ sessionSha256: hex(selected).toUpperCase() }, selected, 'malformed'],
    [{}, selected, 'malformed'],
    [null, selected, 'malformed'],
    [{ sessionSha256: hex(selected) }, '', 'session'],
    [{ sessionSha256: hex(selected) }, null, 'session'],
  ];
  for (const [report, id, kind] of cases) {
    const r = selectedTakeAssociation(report, id);
    assert.equal(r.pass, false, JSON.stringify({ report, id }));
    assert.equal(r.detail.matchesSelected, false);
    assert.equal(r.detail.persistedAssociation, kind);
  }
});

test('the one-take smoke branch asserts older-take-association through the oracle, and the smoke denominator and catalog carry it', () => {
  const src = fs.readFileSync(path.join(DA, 'source-adapters.cjs'), 'utf8');
  const branch = src.slice(src.indexOf('if(older&&minimal){'), src.indexOf('}else if(older){'));
  assert.match(branch, /selectedTakeAssociation\(report,older\)/);
  assert.match(branch, /check\('older-take-association',bound\.pass,bound\.detail\)/);
  assert.doesNotMatch(branch, /older-coaching-association/);      // the older-vs-newer coaching row still needs the second take
  assert.match(src, /'AHT-07':\['feedback-readback-preflight','fresh-acknowledgment','feedback-stored-once','older-take-association','received-feedback-proof'\]/);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'smoke-assertion-catalog.json'), 'utf8'));
  assert.ok(catalog.cases['AHT-07'].requiredAssertions.includes('older-take-association'));
  assert.equal(catalog.cases['AHT-07'].minimumTakes, 1);                // no second take added
  assert.equal(catalog.totalAssertions, Object.values(catalog.cases).reduce((n, c) => n + c.requiredAssertions.length, 0));
});
