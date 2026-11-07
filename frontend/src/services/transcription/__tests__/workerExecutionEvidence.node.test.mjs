import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { CANDIDATES } from '../candidateRegistry.ts';
import { importIsolated } from '../../../../../scripts/lib/importIsolated.mjs';

// Execute the real handlers with dependency doubles; no worker/model/browser qualification claim.
async function engineFor(name) {
  const source = stripTypeScriptTypes(await readFile(new URL(`../engines/${name}.ts`, import.meta.url), 'utf8'));
  const imports = new Map();
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = match[1];
    const names = clause.startsWith('{')
      ? clause.slice(1, clause.lastIndexOf('}')).split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      : ['default'];
    imports.set(match[2], [...new Set([...(imports.get(match[2]) ?? []), ...names])]);
  }
  const noop = () => {};
  const values = {
    STTEngine: class {},
    default: { info: noop, warn: noop, error: noop, debug: noop },
    receiptMatches: (receipt, attempt) => Boolean(receipt && attempt && receipt.token === attempt.token),
    resolvePrivateModel: () => 'whisper-base.en',
    publishPrivateModelTelemetry: noop,
    PRIV_STT_MODELS: { DEFAULT: 'whisper-base.en', CANDIDATES: { 'whisper-base.en': { approxMB: 80 } } },
  };
  const namespace = await importIsolated(source, { globals: { window: {} }, imports: Object.fromEntries([...imports]
    .map(([specifier, names]) => [specifier, Object.fromEntries(names.map(key => [key, values[key] ?? noop]))])) });
  const engine = Object.create(namespace[name].prototype);
  Object.assign(engine, {
    options: { resolvedCandidate: CANDIDATES['v2:base.en'] },
    worker: null, transcriber: null, runtimeEvidence: null, acquisitionReceipt: null,
    activeAttempt: { token: 'current' }, activeLoadRequestId: 2,
    pendingWorkerRequests: new Map([[2, { resolve: noop, reject: noop, timeoutId: undefined }]]),
  });
  const deliver = (response) => engine.handleWorkerMessage(response, { MODEL_ID: 'model', DTYPE: {} });
  const loaded = (id, device = 'wasm') => ({ id, type: 'loaded', model: 'model', device, loadTimeMs: 1 });
  return { engine, deliver, loaded };
}

for (const family of ['TransformersJSEngine', 'TransformersJSV4Engine']) {
  test(`${family}: stale/duplicate load cannot replace evidence, cached load needs no receipt`, async () => {
    const { engine, deliver, loaded } = await engineFor(family);
    deliver(loaded(1, 'webgpu'));
    assert.equal(engine.getRuntimeEvidence(), null);
    deliver(loaded(2)); // No acquisition receipt: legitimate cached initialization.
    const accepted = engine.getRuntimeEvidence();
    assert.equal(accepted.backend, 'wasm');
    deliver(loaded(2, 'webgpu'));
    assert.equal(engine.getRuntimeEvidence(), accepted);
    deliver({ id: 2, type: 'ready' });
    deliver(loaded(1, 'webgpu'));
    deliver(loaded(2, 'webgpu'));
    assert.equal(engine.getRuntimeEvidence(), accepted);
    await engine.onDestroy();
    deliver(loaded(2));
    assert.equal(engine.getRuntimeEvidence(), null);
  });
  test(`${family}: failed init retires load evidence`, async () => {
    const { engine, deliver, loaded } = await engineFor(family);
    deliver(loaded(2));
    assert(engine.getRuntimeEvidence());
    deliver({ id: 2, type: 'error', errorMessage: 'init failed after load' });
    assert.equal(engine.getRuntimeEvidence(), null);
    deliver(loaded(2));
    assert.equal(engine.getRuntimeEvidence(), null);
  });
}
