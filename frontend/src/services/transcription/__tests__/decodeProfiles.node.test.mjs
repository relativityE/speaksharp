import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { CANDIDATES } from '../candidateRegistry.ts';

// The shipping decode builder with its one dependency stubbed, loaded by an ordinary import() from a private temporary directory: no
// vm.SourceTextModule, so no --experimental-vm-modules flag is needed under any runner (full-evidence runs node tests without it).
async function builder() {
  const source = stripTypeScriptTypes(await readFile(new URL('../decodeOptions.ts', import.meta.url), 'utf8'));
  const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(specifiers, ['./sttConstants'], 'the builder depends on ./sttConstants alone');
  const dir = await mkdtemp(join(tmpdir(), 'decode-profiles-'));
  try {
    await writeFile(join(dir, 'sttConstants.mjs'), 'export const PRIV_STT = { WHISPER_WINDOW_SECONDS: 30, WHISPER_STRIDE_SECONDS: 5 };\n');
    await writeFile(join(dir, 'decodeOptions.mjs'), source.replace(/(\bfrom\s+['"])\.\/sttConstants(['"])/, '$1./sttConstants.mjs$2'));
    return await import(pathToFileURL(join(dir, 'decodeOptions.mjs')).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('shipping Whisper profile preserves short and long decode branches without language guessing', async () => {
  const api = await builder();
  const profile = CANDIDATES['v2:base.en'].execution.decode;
  assert.deepEqual(api.buildWhisperDecodeOptions(profile, 5), {
    chunk_length_s: 30, stride_length_s: 0, return_timestamps: true,
  });
  assert.deepEqual(api.buildWhisperDecodeOptions(profile, 30), {
    chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
  });
});

test('descriptor generation and language parameters reach the shared builder, with explicit proof overrides', async () => {
  const api = await builder();
  const profile = CANDIDATES['v4:distil:q4'].execution.decode;
  const actual = api.buildWhisperDecodeOptions({ ...profile, language: 'en', task: 'transcribe' }, 31,
    { no_repeat_ngram_size: 4 });
  assert.equal(actual.condition_on_previous_text, false);
  assert.equal(actual.no_repeat_ngram_size, 4);
  assert.equal(actual.language, 'en');
  assert.equal(actual.task, 'transcribe');
  assert.equal(actual.stride_length_s, 5);
});

test('invalid profile dimensions fail before inference', async () => {
  const api = await builder();
  const profile = CANDIDATES['v2:base.en'].execution.decode;
  assert.throws(() => api.buildWhisperDecodeOptions({ ...profile, windowSeconds: 0 }, 1));
  assert.throws(() => api.buildWhisperDecodeOptions({ ...profile, strideSeconds: 15 }, 1));
  assert.throws(() => api.buildWhisperDecodeOptions(profile, NaN));
});
