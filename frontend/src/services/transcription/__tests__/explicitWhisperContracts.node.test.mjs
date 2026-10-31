import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext, SourceTextModule, SyntheticModule } from 'node:vm';

test('actual worker message handler refuses absent model/dtype before invoking loader', async () => {
  const source = await readFile(new URL('../engines/transformers-js-v4.worker.ts', import.meta.url), 'utf8');
  const messages = [], loads = [];
  const self = {};
  runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('self.onmessage ='))), {
    self, Error, post: message => messages.push(message), init: async (...args) => loads.push(args),
  });
  for (const request of [{}, { model: 'fixture' }, { model: 'fixture', dtype: {} },
    { model: 'fixture', dtype: { encoder_model: null } }]) {
    self.onmessage({ data: { id: 1, type: 'init', isE2E: false, ...request } });
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads.length, 0);
  assert.equal(messages.length, 4);
  assert(messages.every(message => message.type === 'error' && /MODEL_DESCRIPTOR_REQUIRED/.test(message.errorMessage)));
  const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  self.onmessage({ data: { id: 2, type: 'init', isE2E: false, model: 'exact/export', dtype } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads.length, 1);
  assert.equal(loads[0][2], 'exact/export');
  assert.equal(loads[0][3], dtype);
});

test('runtime resolver requires explicit variant and never infers a tier from a flag', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../utils/privateRuntimePath.ts', import.meta.url), 'utf8'));
  const module = new SourceTextModule(source);
  const dependencies = {
    './webgpuSupport': { detectWebGPUSupport: async () => ({ supported: true }) },
    './wasmThreads': { computeWasmThreadCount: () => 1, getHardwareThreads: () => 1, isCrossOriginIsolated: () => false },
  };
  await module.link(name => {
    assert(name in dependencies, name);
    const values = dependencies[name];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  const resolve = module.namespace.resolvePrivateRuntimePath;
  const options = { webgpuPromotionAllowed: false, turboModelCached: false,
    capabilities: { webgpuAvailable: true } };
  await assert.rejects(resolve({ ...options, v4: { enabled: true, distilEnabled: true } }), /Explicit Whisper variant/);
  for (const variant of ['base_q4', 'distil_q4']) {
    const result = await resolve({ ...options, v4: { enabled: true, variant } });
    assert.equal(result.v4Variant, variant);
    assert.equal(result.provider, 'transformers-js-v4');
  }
  assert.equal((await resolve(options)).provider, 'transformers-js');
});
