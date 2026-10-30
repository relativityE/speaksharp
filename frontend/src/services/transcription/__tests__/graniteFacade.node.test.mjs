import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { CANDIDATES } from '../candidateRegistry.ts';

test('compatibility Whisper defaults derive from descriptor and preserve shipping settings', async () => {
  const source = await readFile(new URL('../sttConstants.ts', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('const DEFAULT_HF_WHISPER ='),
    source.indexOf('/**\n * v4 model TIERS'));
  const context = createContext({ CANDIDATES });
  const module = new SourceTextModule(stripTypeScriptTypes(section), { context });
  await module.link(() => { throw new Error('Unexpected import'); });
  await module.evaluate();
  const defaults = module.namespace.PRIV_STT_V4;
  const candidate = CANDIDATES['v4:base:q4'];
  assert.equal(defaults.MODEL_ID, candidate.model.id);
  assert.equal(defaults.DTYPE, candidate.model.dtype);
  assert.equal(defaults.EXPECTED_Q4_SPLIT_DOWNLOAD_MB, 142);
  assert.equal(defaults.DEVICE, null);
  assert.equal(defaults.WORKER_REQUEST_TIMEOUT_MS, 90_000);
});

test('shared facade passes exact Granite pins and immutable decode profile to adapter', async () => {
  const source = await readFile(new URL('../engines/PrivateSTT.ts', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function constructPrivateEngine('),
    source.indexOf('const getPrivateProviderIds'));
  let received;
  const context = createContext({ getEngine: () => null, validateEngine: () => {} });
  const adapter = new SyntheticModule(['GraniteCtcEngine'], function () {
    this.setExport('GraniteCtcEngine', class { constructor(options) { received = options; } });
  }, { context });
  await adapter.link(() => { throw new Error('Unexpected adapter import'); });
  await adapter.evaluate();
  const module = new SourceTextModule(stripTypeScriptTypes(`export ${helper}`), { context,
    importModuleDynamically: async specifier => {
      assert.equal(specifier, './GraniteCtcEngine');
      return adapter;
    },
  });
  await module.link(() => { throw new Error('Unexpected helper dependency'); });
  await module.evaluate();
  const candidate = CANDIDATES['granite:turboctc-q4f16'];
  const construct = module.namespace.constructPrivateEngine;
  await construct(candidate.engine, candidate, {});
  assert.equal(received.backend, 'webgpu');
  assert.equal(received.modelFile, 'ctc_conformer_q4f16.onnx');
  assert.equal(received.applyAgc, true);
  assert.equal(received.assets.length, 9);
  assert(received.assets.some(asset => asset.file === 'ort.all.min.js'));
  for (const asset of received.assets) {
    const pin = candidate.assets.files.find(file => file.url === asset.url);
    assert.equal(asset.sha256, pin.sha256);
    assert.equal(asset.bytes, pin.bytes);
  }
  await construct(candidate.engine, candidate, { evaluatorBackend: 'wasm' });
  assert.equal(received.backend, 'wasm');
  await assert.rejects(construct(candidate.engine, { ...candidate,
    execution: { ...candidate.execution, decode: { kind: 'whisper' } },
  }, {}), /Invalid Granite execution profile/);
  assert.equal(candidate.activationReady, false);
  assert.equal(candidate.comparisonReady, false);
  assert.equal(candidate.model.revision, null);
  assert.match(candidate.model.export.revision, /^[a-f0-9]{40}$/);
});
