import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';

test('self-hosted descriptor digest verifies exact file content, count and bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ss-asset-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('pinned fixture');
  const fileDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  const pinDigest = crypto.createHash('sha256').update(`weights.bin:${fileDigest}\n`).digest('hex');
  await fs.mkdir(path.join(root, 'model'));
  await fs.writeFile(path.join(root, 'model/weights.bin'), bytes);
  const candidate = { model: { id: 'fixture' }, assets: {
    pinSource: 'model', provenance: 'self_hosted', componentCount: 1,
    totalBytes: bytes.length, pinDigest,
  } };
  const dependencies = {
    playwright: { chromium: {} },
    'node:crypto': crypto, 'node:fs/promises': fs, 'node:path': path,
    '../asset-transfer': { AssetTransferRecorder: class {} },
    '../source-binding': { assertServedRelease() {}, servedSourceFiles() {}, sha256() {}, viteRawSource() {} },
    '../../../frontend/src/services/transcription/candidateRegistry': { CANDIDATES: { fixture: candidate } },
  };
  const source = stripTypeScriptTypes(await fs.readFile(new URL('./candidate-browser.ts', import.meta.url), 'utf8'));
  const module = new SourceTextModule(source);
  await module.link((specifier) => {
    const values = dependencies[specifier];
    assert(values, `Unexpected runtime dependency ${specifier}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  const digest = () => module.namespace.configuredAssetDigest(root, 'fixture', 'fixture');
  assert.equal(await digest(), pinDigest);
  await fs.writeFile(path.join(root, 'model/weights.bin'), Buffer.from('tamper fixture'));
  await assert.rejects(digest(), /bytes differ/);
  await fs.writeFile(path.join(root, 'model/weights.bin'), bytes);
  await fs.writeFile(path.join(root, 'model/extra.bin'), bytes);
  await assert.rejects(digest(), /count differs/);
  await fs.rm(path.join(root, 'model/extra.bin'));
  candidate.assets.totalBytes += 1;
  await assert.rejects(digest(), /bytes differ/);

  // The same evaluator entry verifies a descriptor's explicit upstream inventory.
  const file = { path: 'weights.bin', bytes: bytes.length, sha256: fileDigest,
    url: 'https://fixture.invalid/pinned/weights.bin' };
  candidate.assets = { pinSource: 'pins.json', provenance: 'upstream_pins', files: [file],
    componentCount: 1, totalBytes: bytes.length, pinDigest };
  const writePins = async (files) => fs.writeFile(path.join(root, 'pins.json'), JSON.stringify({ files }));
  await writePins([file]);
  assert.equal(await digest(), pinDigest);
  await writePins([{ ...file, url: 'https://fixture.invalid/other/weights.bin' }]);
  await assert.rejects(digest(), /pin differs/);
  await writePins([{ ...file, bytes: bytes.length + 1 }]);
  await assert.rejects(digest(), /pin differs/);
  await writePins([file, file]);
  await assert.rejects(digest(), /inventory differs/);
  await writePins([file, { ...file, path: 'extra.bin', url: 'https://fixture.invalid/pinned/extra.bin' }]);
  await assert.rejects(digest(), /inventory differs/);
  await writePins([file]);
  candidate.assets.totalBytes++;
  await assert.rejects(digest(), /digest\/bytes differ/);
});
