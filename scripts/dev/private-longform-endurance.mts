/**
 * DEV-OWNED long-form endurance benchmark — v2 vs v4, ACCURACY first, SPEED second.
 * NOT release proof. Node CPU full-WAV (model ceiling), no browser/app path.
 *
 * Why: our corpus is ~3s clips (single 30s Whisper window — no stitching). Real
 * product use is ½-to-full-page speeches (~60-120s = multiple 30s windows that the
 * Whisper algorithm must STITCH). Stitching is the documented long-form accuracy
 * risk. This builds escalating-length audio by concatenating the 10 Harvard WAVs
 * 1x/3x/4x (~30s/~90s/~120s) and measures, per engine per length:
 *   - ACCURACY: stitched WER vs the (repeated) truth  <-- primary barometer
 *   - SPEED: total decode time + real-time factor      <-- secondary barometer
 *
 * Truth for Nx = HARVARD_FULL repeated N times (same concatenation order as audio).
 * Same decode options as the app workers (chunk_length_s:30, stride:5). Only the
 * engine varies, so deltas are genuinely v2-vs-v4 at length.
 *
 * Run: npx tsx scripts/dev/private-longform-endurance.mts
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HARVARD_SENTENCES } from '../../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(__dirname, '../../tests/fixtures/stt-isomorphic/audio');
const SR = 16000;
const ORDER = HARVARD_SENTENCES.map((s) => s.id); // fixed order for audio + truth
const TRUTH_ONCE = HARVARD_SENTENCES.map((s) => s.transcript).join(' ');
const REPEATS = [1, 2, 3, 4, 6]; // ~30s, ~59s, ~89s, ~118s, ~178s — degradation curve

async function decodePcmWav(filePath: string): Promise<Float32Array> {
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

function concat(arrs: Float32Array[]): Float32Array {
  const n = arrs.reduce((a, x) => a + x.length, 0); const out = new Float32Array(n);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out;
}

const acc = (w: number) => Number(((1 - w) * 100).toFixed(2));

async function main() {
  console.log('DEV long-form endurance — v2 vs v4 (ACCURACY first, SPEED second). NOT release proof.\n');

  // Build base concatenation (all 10, in fixed order) once.
  const clips: Float32Array[] = [];
  for (const id of ORDER) clips.push(await decodePcmWav(path.join(AUDIO_DIR, `${id}.wav`)));
  const base = concat(clips);
  const baseSec = base.length / SR;

  const engines = [
    {
      label: 'v2',
      load: async () => {
        const m = await import('@xenova/transformers');
        m.env.allowLocalModels = false; m.env.useBrowserCache = false;
        return m.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true });
      },
    },
    {
      label: 'v4',
      load: async () => {
        const m = await import('@huggingface/transformers');
        m.env.allowLocalModels = false;
        return m.pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        });
      },
    },
  ];
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false } as Record<string, unknown>;

  const results: Record<string, Array<Record<string, unknown>>> = {};
  for (const eng of engines) {
    console.log(`== ${eng.label} ==`);
    const transcriber = await eng.load();
    results[eng.label] = [];
    for (const n of REPEATS) {
      const audio = concat(Array.from({ length: n }, () => base));
      const truth = Array.from({ length: n }, () => TRUTH_ONCE).join(' ');
      const durSec = audio.length / SR;
      const windows = Math.ceil(durSec / 30);
      const t0 = performance.now();
      const r = await transcriber(audio, opts);
      const decodeMs = Math.round(performance.now() - t0);
      const text = (typeof r === 'string' ? r : (r as { text?: string }).text ?? '').trim();
      const wer = calculateWordErrorRate(truth, text);
      const rtf = decodeMs / (durSec * 1000);
      // Loop-vs-drift diagnostic: expected word count vs produced; ratio >>1 or <<1
      // signals hallucination/looping or truncation rather than honest stitching drift.
      const expectedWords = truth.split(/\s+/).filter(Boolean).length;
      const producedWords = text.split(/\s+/).filter(Boolean).length;
      results[eng.label].push({
        n, durSec: +durSec.toFixed(1), windows, accuracy: acc(wer), wer: +wer.toFixed(4),
        decodeMs, rtf: +rtf.toFixed(3), expectedWords, producedWords,
        wordRatio: +(producedWords / expectedWords).toFixed(2),
        head: text.slice(0, 120), tail: text.slice(-120),
      });
      console.log(`  ${eng.label} ${n}x (~${durSec.toFixed(0)}s, ~${windows} win): ACC ${acc(wer)}%  WER ${wer.toFixed(4)}  decode ${decodeMs}ms  RTF ${rtf.toFixed(3)}  words ${producedWords}/${expectedWords} (${(producedWords/expectedWords).toFixed(2)}x)`);
    }
  }

  console.log('\n=== ACCURACY vs length (primary barometer) ===');
  console.log('length | v2 acc | v4 acc | delta');
  for (let i = 0; i < REPEATS.length; i++) {
    const a = results.v2[i], b = results.v4[i];
    const d = ((b.accuracy as number) - (a.accuracy as number)).toFixed(2);
    console.log(`  ~${a.durSec}s (${a.windows}w) | ${a.accuracy}% | ${b.accuracy}% | ${d}pp`);
  }
  console.log('\n=== SPEED vs length (secondary barometer) ===');
  console.log('length | v2 decode | v4 decode | v2 RTF | v4 RTF');
  for (let i = 0; i < REPEATS.length; i++) {
    const a = results.v2[i], b = results.v4[i];
    console.log(`  ~${a.durSec}s | ${a.decodeMs}ms | ${b.decodeMs}ms | ${a.rtf} | ${b.rtf}`);
  }
  console.log('\n=== ACCURACY DRIFT (1x short-clip baseline vs longest) ===');
  for (const lbl of ['v2', 'v4']) {
    const first = results[lbl][0], last = results[lbl][results[lbl].length - 1];
    console.log(`  ${lbl}: ${first.accuracy}% @${first.durSec}s -> ${last.accuracy}% @${last.durSec}s  (drift ${((last.accuracy as number)-(first.accuracy as number)).toFixed(2)}pp)`);
  }

  const out = '/private/tmp/private-longform-endurance.json';
  await fs.writeFile(out, JSON.stringify({ note: 'DEV long-form endurance; Node full-WAV; NOT release proof', baseSec, results }, null, 2));
  console.log(`\nartifact: ${out}`);
}

main().catch((e) => { console.error('LONGFORM_ERROR', e); process.exit(1); });
