import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES, candidateForRuntime } from '../candidateRegistry.ts';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));

test('every descriptor has an unambiguous frozen execution identity', () => {
  for (const c of Object.values(CANDIDATES)) {
    assert.equal(candidateForRuntime({ engineType: c.engine, variant: c.execution.variant,
      decoderDtype: c.model.dtype?.decoder_model_merged }), c.id);
    assert(Object.isFrozen(c.execution));
  }
  assert.throws(() => candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'base_q4', decoderDtype: 'int8' }));
  assert.throws(() => candidateForRuntime({ engineType: 'moonshine-streaming', variant: null }));
});

test('all self-hosted descriptor inventories match actual local bytes, including Tiny', async () => {
  for (const candidate of Object.values(CANDIDATES).filter(c => c.assets.provenance === 'self_hosted')) {
    const assets = candidate.assets;
    const directory = resolve(root, assets.pinSource);
    const files = [];
    const walk = async (relative = '') => {
      for (const entry of await readdir(resolve(directory, relative), { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(name);
        else files.push(name);
      }
    };
    await walk();
    assert.equal(files.length, assets.componentCount);
    assert.deepEqual(files.sort(), assets.files.map(f => f.path).sort());
    const hash = createHash('sha256');
    let total = 0;
    for (const name of files) {
      const bytes = await readFile(resolve(directory, name));
      const digest = createHash('sha256').update(bytes).digest('hex');
      const pin = assets.files.find(f => f.path === name);
      assert.equal(digest, pin.sha256);
      assert.equal(bytes.length, pin.bytes);
      total += bytes.length;
      hash.update(`${name}:${digest}\n`);
    }
    assert.equal(hash.digest('hex'), assets.pinDigest);
    assert.equal(total, assets.totalBytes);
  }
});

test('descriptor inventories reproduce committed pin digests and model/revision separation', async () => {
  for (const c of Object.values(CANDIDATES).filter((c) => c.assets.provenance === 'upstream_pins')) {
    const source = JSON.parse(await readFile(resolve(root, c.assets.pinSource), 'utf8'));
    const pins = source.assets ?? Object.fromEntries(source.files.map(file => [file.path, file]));
    if (c.assets.files) assert.deepEqual(c.assets.files, source.files);
    const keys = c.assets.files?.map(file => file.path) ?? c.assets.pinKeys ?? Object.keys(pins).filter((key) => key.startsWith(c.assets.pinKeyPrefix));
    assert.equal(keys.length, c.assets.componentCount, c.id);
    assert.equal(new Set(keys).size, keys.length);
    const hash = createHash('sha256');
    for (const key of [...keys].sort()) {
      const digest = typeof pins[key] === 'string' ? pins[key] : pins[key].sha256;
      assert.match(digest, /^[a-f0-9]{64}$/);
      hash.update(`${key}:${digest}\n`);
    }
    assert.equal(hash.digest('hex'), c.assets.pinDigest, c.id);
    if (c.assets.totalBytes) assert.equal(keys.reduce((sum, key) => sum + pins[key].bytes, 0), c.assets.totalBytes);
  }
  const medium = CANDIDATES['moonshine:streaming-medium'];
  const small = CANDIDATES['moonshine:streaming-small'];
  assert.equal(small.engine, medium.engine);
  assert.equal(small.runtime.version, medium.runtime.version);
  assert.notEqual(small.assets.pinDigest, medium.assets.pinDigest);
  assert.equal(small.activationReady, false);
  assert.equal(small.comparisonReady, false);
});
