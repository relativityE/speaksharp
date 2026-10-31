import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { CANDIDATES } from '../candidateRegistry.ts';

test('cache readiness uses the selected local model rather than the baseline', async () => {
  let cachedModel = 'whisper-base.en';
  let explicitUrls = null;
  const tiny = CANDIDATES['xenova:whisper-tiny.en'];
  const context = createContext({ URL, window: { location: { origin: 'https://fixture.invalid' } },
    caches: { has: async () => true, open: async () => ({ keys: async () =>
      explicitUrls ?? tiny.execution.cacheFiles.map(file => ({ url: `https://fixture.invalid/models/${cachedModel}/${file}` })) }) },
  });
  const dependencies = {
    './candidateRegistry': { CANDIDATES },
    '@/lib/logger': { default: { info() {}, warn() {}, error() {}, debug() {} } },
    './sttConstants': { PRIV_STT_V4: {}, PRIV_STT_MODELS: {
      CANDIDATES: { 'whisper-base.en': { localId: 'whisper-base.en' } },
    } },
    './utils/privateModelFlag': { resolvePrivateModel: () => 'whisper-base.en' },
  };
  const module = new SourceTextModule(stripTypeScriptTypes(await readFile(new URL('../ModelManager.ts', import.meta.url), 'utf8')), { context });
  await module.link(specifier => {
    const values = dependencies[specifier];
    assert(values);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const api = module.namespace.ModelManager;
  assert.equal(await api.isModelDownloaded('transformers-js', tiny.execution.localModelId, tiny.execution.cacheFiles), false);
  cachedModel = 'whisper-tiny.en';
  assert.equal(await api.isModelDownloaded('transformers-js', tiny.execution.localModelId, tiny.execution.cacheFiles), true);
  assert.equal(await api.isModelDownloaded('transformers-js'), false);
  const q4 = CANDIDATES['v4:base:q4'];
  const int8 = CANDIDATES['v4:base:int8'];
  explicitUrls = q4.execution.cacheFiles.map(file => ({ url: `https://huggingface.co/${q4.model.id}/resolve/main/${file}` }));
  assert.equal(await api.isModelDownloaded('transformers-js-v4', q4.model.id, q4.execution.cacheFiles), true);
  assert.equal(await api.isModelDownloaded('transformers-js-v4', int8.model.id, int8.execution.cacheFiles), false);
  assert.equal(await api.isModelDownloaded('transformers-js-v4', 'unregistered/model'), false);
  assert.equal(await api.isModelDownloaded('transformers-js-v4', q4.model.id, []), false);
});

test('acquisition inventory and required resource groups follow the second local descriptor', async () => {
  const context = createContext({ URL, window: { location: { origin: 'https://fixture.invalid' } } });
  const dependencies = {
    './moonshineAssetPins.json': { default: JSON.parse(await readFile(new URL('../moonshineAssetPins.json', import.meta.url), 'utf8')) },
    './engines/transformersV2WasmAssets': { TRANSFORMERS_V2_WASM_ASSET_URLS: { baseline: '/runtime.wasm' } },
  };
  const module = new SourceTextModule(stripTypeScriptTypes(await readFile(new URL('../candidateAssetRequests.ts', import.meta.url), 'utf8')), { context });
  await module.link(specifier => {
    const values = dependencies[specifier];
    assert(values, specifier);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const tiny = CANDIDATES['xenova:whisper-tiny.en'];
  const result = module.namespace.assetRequestsFor(tiny);
  assert.equal(result.assets.length, 12);
  assert(result.assets.every(asset => asset.url.includes('/models/whisper-tiny.en/')));
  const groups = module.namespace.acquisitionComponentGroupsFor(tiny);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].minimumUniqueCount, 7);
  assert(groups[0].expectedResourceUrls.every(url => url.includes('/models/whisper-tiny.en/')));
  assert.equal(groups[1].minimumUniqueCount, 1);

  const pins = JSON.parse(await readFile(new URL('../engines/granite/assetPins.json', import.meta.url), 'utf8'));
  const explicit = { id: 'fixture', engine: 'fixture', model: { id: 'fixture' }, assets: {
    provenance: 'upstream_pins', files: pins.files, componentCount: pins.files.length,
  } };
  const inventory = module.namespace.assetRequestsFor(explicit);
  assert.equal(inventory.assets.length, 9);
  const exact = module.namespace.acquisitionComponentGroupsFor(explicit);
  assert.equal(exact[0].minimumUniqueCount, 9);
  assert.deepEqual(Array.from(exact[0].expectedResourceUrls), pins.files.map(file => file.url));
  explicit.assets.files = [...pins.files, pins.files[0]];
  explicit.assets.componentCount++;
  assert.throws(() => module.namespace.assetRequestsFor(explicit), /Invalid explicit asset inventory/);
  explicit.assets.files = [{ ...pins.files[0], url: undefined }];
  explicit.assets.componentCount = 1;
  assert.throws(() => module.namespace.assetRequestsFor(explicit), /Invalid explicit asset pin/);
});
