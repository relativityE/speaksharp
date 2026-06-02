/**
 * DEV-OWNED benchmark — v2 vs v4 apples-to-apples on the SAME Node CPU full-WAV
 * methodology. NOT the prior browser/fake-audio route. Reuses only shared assets
 * (Harvard fixtures, wer.ts). Does NOT write STT_BENCHMARKS.json.
 *
 * Methodology (identical for both engines so the comparison is fair):
 *   - decode each Harvard fixture h1_1..h1_10 from its full PCM16 WAV (no app gate,
 *     no chunk/window, no mic DSP) — the model ceiling on identical input
 *   - same decode options as the app workers: chunk_length_s=30, stride per worker
 *   - v2: @xenova/transformers, 'Xenova/whisper-tiny.en' (quantized)
 *   - v4: @huggingface/transformers, 'onnx-community/whisper-tiny.en',
 *         dtype { encoder_model:'fp32', decoder_model_merged:'q4' } (matches PRIV_STT_V4)
 *
 * Why valid: both engines see byte-identical audio and equivalent decode params, so
 * any WER delta is the model/runtime difference, not the input route. This isolates
 * "v2 model vs v4 model" — exactly the v2-vs-v4 question — without browser variance.
 *
 * Run: node scripts/dev/private-v2-v4-node-compare.mjs
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HARVARD_SENTENCES } from '../../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(__dirname, '../../tests/fixtures/stt-isomorphic/audio');
const SR = 16000;

async function decodePcmWav(filePath) {
  const buf = await fs.readFile(filePath);
  let off = 12, dataStart = -1, dataSize = 0, ch = 1, bits = 16, fmt = 1, sr = SR;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4); const size = buf.readUInt32LE(off + 4); const start = off + 8;
    if (id === 'fmt ') { fmt = buf.readUInt16LE(start); ch = buf.readUInt16LE(start + 2); sr = buf.readUInt32LE(start + 4); bits = buf.readUInt16LE(start + 14); }
    else if (id === 'data') { dataStart = start; dataSize = size; break; }
    off = start + size + (size % 2);
  }
  if (fmt !== 1 || bits !== 16 || sr !== SR) throw new Error(`bad wav ${filePath}`);
  const frames = Math.floor(dataSize / (ch * 2)); const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) out[f] = buf.readInt16LE(dataStart + f * ch * 2) / 32768;
  return out;
}

const acc = (w) => Number(((1 - w) * 100).toFixed(2));

async function runEngine(label, loader, opts) {
  const transcriber = await loader();
  const rows = [];
  for (const s of HARVARD_SENTENCES) {
    const audio = await decodePcmWav(path.join(AUDIO_DIR, `${s.id}.wav`));
    const t0 = performance.now();
    const r = await transcriber(audio, opts);
    const decodeMs = Math.round(performance.now() - t0);
    const text = (typeof r === 'string' ? r : r.text ?? '').trim();
    const wer = calculateWordErrorRate(s.transcript, text);
    rows.push({ id: s.id, wer, acc: acc(wer), decodeMs, text });
    console.log(`  ${label} ${s.id}: ${acc(wer)}%  (${decodeMs}ms)  ${JSON.stringify(text).slice(0, 70)}`);
  }
  const avgWer = rows.reduce((a, r) => a + r.wer, 0) / rows.length;
  return { rows, avgWer, avgAcc: acc(avgWer) };
}

async function main() {
  console.log('DEV v2-vs-v4 Node CPU full-WAV compare (NOT release proof)\n');

  console.log('== v2: @xenova Xenova/whisper-tiny.en ==');
  const xenova = await import('@xenova/transformers');
  xenova.env.allowLocalModels = false; xenova.env.useBrowserCache = false;
  const v2 = await runEngine('v2',
    () => xenova.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true }),
    { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });

  console.log('\n== v4: @huggingface onnx-community/whisper-tiny.en (dtype enc=fp32, dec=q4) ==');
  const hf = await import('@huggingface/transformers');
  hf.env.allowLocalModels = false;
  const v4 = await runEngine('v4',
    () => hf.pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    }),
    { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });

  console.log('\n=== RESULT (same Node full-WAV methodology, all 10 rows) ===');
  console.log(`v2 avg accuracy: ${v2.avgAcc}%  (WER ${v2.avgWer.toFixed(4)})`);
  console.log(`v4 avg accuracy: ${v4.avgAcc}%  (WER ${v4.avgWer.toFixed(4)})`);
  console.log('\nper-row (acc% / decodeMs):');
  for (const s of HARVARD_SENTENCES) {
    const a = v2.rows.find((r) => r.id === s.id); const b = v4.rows.find((r) => r.id === s.id);
    console.log(`  ${s.id}: v2 ${a.acc}%/${a.decodeMs}ms | v4 ${b.acc}%/${b.decodeMs}ms`);
  }
  const out = '/private/tmp/private-v2-v4-node-compare.json';
  await fs.writeFile(out, JSON.stringify({ note: 'DEV node full-WAV; not release proof', v2, v4 }, null, 2));
  console.log(`\nartifact: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
