import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { CANDIDATES } from '../candidateRegistry.ts';

async function builder() {
  const source = stripTypeScriptTypes(await readFile(new URL('../decodeOptions.ts', import.meta.url), 'utf8'));
  const module = new SourceTextModule(source);
  await module.link((name) => {
    assert.equal(name, './sttConstants');
    return new SyntheticModule(['PRIV_STT'], function () {
      this.setExport('PRIV_STT', { WHISPER_WINDOW_SECONDS: 30, WHISPER_STRIDE_SECONDS: 5 });
    });
  });
  await module.evaluate();
  return module.namespace;
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
