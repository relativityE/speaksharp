import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { CANDIDATES, UnknownCandidateError } from '../candidateRegistry.ts';

// Actual switch module with explicit boundary doubles. This does not test cryptographic authorization.
async function loadSwitch(internal, authorized = false) {
  let consumed = 0;
  const source = stripTypeScriptTypes(await readFile(new URL('../runtimeCandidateSwitch.ts', import.meta.url), 'utf8'));
  const module = new SourceTextModule(source, {
    initializeImportMeta(meta) { meta.env = { VITE_INTERNAL_BUILD: internal ? 'true' : '' }; },
  });
  const dependencies = {
    './candidateRegistry': { CANDIDATES, UnknownCandidateError },
    './modelComparisonAuthorization': {
      hasModelComparisonAuthorization: () => authorized,
      consumeModelComparisonTakeAuthorization: () => { consumed++; return authorized; },
      claimModelComparisonPositiveControl: () => null,
    },
    '../AnalyticsBuffer': { analyticsBuffer: { ready: false } },
  };
  await module.link((name) => {
    assert(name in dependencies, `unexpected dependency ${name}`);
    const values = dependencies[name];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  const api = module.namespace;
  const calls = [];
  api.registerSwitchExecutor({
    currentState: () => 'READY',
    teardown: async () => { calls.push('teardown'); },
    initialize: async () => { calls.push('initialize'); },
    observedCandidate: () => api.runtimeCandidateOverride(),
  });
  return { api, calls, consumed: () => consumed };
}

test('internal descriptor-only SmallStreaming selection uses the existing executor', async () => {
  const h = await loadSwitch(true);
  assert.equal((await h.api.switchCandidate('moonshine:streaming-small')).ok, true);
  assert.deepEqual(h.calls, ['teardown', 'initialize']);
  assert.equal(h.consumed(), 0);
});

test('production retains its closed slate even with an authorized boundary', async () => {
  const h = await loadSwitch(false, true);
  assert.equal((await h.api.switchCandidate('moonshine:streaming-small')).code, 'not_comparison_candidate');
  assert.equal((await h.api.switchCandidate('v4:base:q4')).code, 'not_comparison_candidate');
  assert.equal((await h.api.switchCandidate('granite:turboctc-q4f16')).code, 'not_comparison_candidate');
  assert.deepEqual(h.calls, []);
  assert.equal(h.consumed(), 0);
});

test('ordinary production remains unarmed and internal unimplemented variants remain refused', async () => {
  const production = await loadSwitch(false);
  assert.equal((await production.api.switchCandidate('v2:base.en')).code, 'not_armed');
  const internal = await loadSwitch(true);
  assert.equal((await internal.api.switchCandidate('v4:base:int8')).code, 'engine_not_integrated');
  assert.deepEqual(internal.calls, []);
});
