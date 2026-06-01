/**
 * ============================================================================
 * DEVELOPMENT HARNESS — NOT RELEASE PROOF
 * ============================================================================
 * Purpose: prove the save-path preroll hypothesis and its regression risk
 * MECHANICALLY, off-browser. Final parity belongs to browser testing.
 *
 * Why this exists: the clean Harvard WAVs do NOT reproduce the soft-onset
 * clipping that caused the live h1_6 gap (verified: 300ms-gated == full == 1000ms
 * on every clean row). So this harness SYNTHESIZES soft onsets and compares three
 * decode inputs through the same whisper-tiny.en model:
 *   1. full-audio reference        (drop-in ceiling)
 *   2. gated + live 300ms preroll  (pre-fix app saved buffer)
 *   3. gated + saved 1000ms preroll(post-fix app saved buffer)
 *
 * Guardrail (per test-agent direction): multiple onset profiles, so we do not
 * prove only an artificial case. A clean (no-synthetic-onset) row is also run as
 * the regression control.
 *
 * Dev-owned. Reuses only SHARED assets (fixtures, wer lib, public model) — it does
 * NOT import or modify any test-agent harness.
 *
 * Run: pnpm tsx scripts/dev/private-onset-preroll-harness.mts
 */
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@xenova/transformers';
import { HARVARD_SENTENCES } from '../../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.resolve(__dirname, '../../tests/fixtures/stt-isomorphic/audio');

// Authoritative constants mirrored from frontend/src/config.ts + sttConstants.ts.
const SR = 16000;
const FRAME = 1024;
const GATE_RMS = 0.01;                       // PAUSE_DETECTION.SILENCE_THRESHOLD
const SPEECH_START_MIN = Math.round(0.1 * SR);   // 100ms
const LIVE_PREROLL = Math.round(0.3 * SR);       // 300ms
const SAVE_PREROLL = Math.round(1.0 * SR);       // 1000ms (the fix)
const RESET_TOL = Math.round(0.3 * SR);          // 300ms

type OnsetProfile = 'clean' | 'mild_ramp' | 'medium_ramp' | 'low_volume_700ms';

function rms(a: Float32Array, start = 0, end = a.length): number {
  let s = 0; for (let i = start; i < end; i++) s += a[i] * a[i];
  const n = Math.max(1, end - start); return Math.sqrt(s / n);
}

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

/**
 * Synthesize a soft onset by prepending/attenuating leading audio so the first
 * speech ramps up below the gate. Uses the fixture's OWN leading speech (not noise)
 * so the model still has real phonemes to recover — this is the honest version of
 * "user started speaking softly", not an artificial silence pad.
 */
function applyOnsetProfile(audio: Float32Array, profile: OnsetProfile): Float32Array {
  if (profile === 'clean') return audio;
  const out = Float32Array.from(audio);
  if (profile === 'low_volume_700ms') {
    const n = Math.min(Math.round(0.7 * SR), out.length);
    for (let i = 0; i < n; i++) out[i] *= 0.25; // hold first 700ms quietly under the gate
    return out;
  }
  // Linear ramp: gain rises 0..1 over the ramp window so onset starts sub-gate.
  const rampMs = profile === 'mild_ramp' ? 400 : 800;
  const n = Math.min(Math.round((rampMs / 1000) * SR), out.length);
  for (let i = 0; i < n; i++) out[i] *= i / n;
  return out;
}

/** Replay the speech-start gate; return saved buffer + diagnostics. */
function gatedSaved(audio: Float32Array, prerollCap: number) {
  const out: number[] = [];
  let preroll: number[] = [], speech: number[] = [], consec = 0, quiet = 0, detected = false, nf = 0.002;
  let detectedAtSample = -1, retainedPreroll = 0;
  for (let i = 0; i < audio.length; i += FRAME) {
    const end = Math.min(i + FRAME, audio.length);
    const e = rms(audio, i, end);
    if (!detected) {
      if (e < GATE_RMS) nf = nf * 0.95 + e * 0.05;
      const thr = Math.max(0.003, Math.min(GATE_RMS, nf * 2.0));
      if (e >= thr) { for (let j = i; j < end; j++) speech.push(audio[j]); consec += end - i; quiet = 0; }
      else if (consec > 0 && quiet + (end - i) <= RESET_TOL) { for (let j = i; j < end; j++) speech.push(audio[j]); quiet += end - i; }
      else { speech = []; consec = 0; quiet = 0; for (let j = i; j < end; j++) preroll.push(audio[j]); if (preroll.length > prerollCap) preroll = preroll.slice(preroll.length - prerollCap); }
      if (consec >= SPEECH_START_MIN) { detected = true; detectedAtSample = i; retainedPreroll = preroll.length; out.push(...preroll, ...speech); preroll = []; speech = []; }
    } else { for (let j = i; j < end; j++) out.push(audio[j]); }
  }
  const buf = out.length ? Float32Array.from(out) : audio;
  return { buf, detectedAtMs: detectedAtSample < 0 ? null : Math.round((detectedAtSample / SR) * 1000), retainedPrerollSamples: retainedPreroll };
}

async function main() {
  console.log('============================================================');
  console.log('DEVELOPMENT HARNESS — NOT RELEASE PROOF');
  console.log('Purpose: prove the preroll hypothesis + regression risk mechanically.');
  console.log('Final parity belongs to browser testing.');
  console.log('============================================================\n');

  env.allowLocalModels = false; env.useBrowserCache = false;
  const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
  const opts = { chunk_length_s: 30, stride_length_s: 5 } as Record<string, unknown>;
  const decode = async (a: Float32Array) => {
    const r = await (transcriber as unknown as (x: Float32Array, o: typeof opts) => Promise<{ text?: string } | string>)(a, opts);
    return (typeof r === 'string' ? r : r.text ?? '').trim();
  };
  const acc = (truth: string, hyp: string) => Math.max(0, 1 - calculateWordErrorRate(truth, hyp));

  const profiles: OnsetProfile[] = ['clean', 'mild_ramp', 'medium_ramp', 'low_volume_700ms'];
  const rows: Array<Record<string, unknown>> = [];

  for (const s of HARVARD_SENTENCES) {
    const base = await decodePcmWav(path.join(AUDIO_DIR, `${s.id}.wav`));
    for (const profile of profiles) {
      const audio = applyOnsetProfile(base, profile);
      const full = await decode(audio);
      const live = gatedSaved(audio, LIVE_PREROLL);
      const save = gatedSaved(audio, SAVE_PREROLL);
      const liveTxt = await decode(live.buf);
      const saveTxt = await decode(save.buf);
      const accFull = acc(s.transcript, full), accLive = acc(s.transcript, liveTxt), accSave = acc(s.transcript, saveTxt);
      rows.push({
        fixture: s.id, softOnsetProfile: profile,
        speechStartDetectedAtMs: save.detectedAtMs,
        rollingPrerollMs: 300, savedPrerollMs: 1000,
        retainedPrerollSamples: save.retainedPrerollSamples,
        decodeInputDurationMs: Math.round((save.buf.length / SR) * 1000),
        transcript: saveTxt,
        accuracyFull: +(accFull * 100).toFixed(1),
        accuracyLive: +(accLive * 100).toFixed(1),
        accuracySave: +(accSave * 100).toFixed(1),
        deltaVsFullDecode: +((accSave - accFull) * 100).toFixed(1),
        saved1000Better: accSave > accLive + 1e-9,
        regression: accSave < accLive - 1e-9,
      });
    }
  }

  console.log('| Fixture | Profile | Full | 300ms | 1000ms | 1000ms Better? | Regression? |');
  console.log('|---|---|---:|---:|---:|---|---|');
  for (const r of rows) {
    console.log(`| ${r.fixture} | ${r.softOnsetProfile} | ${r.accuracyFull}% | ${r.accuracyLive}% | ${r.accuracySave}% | ${r.saved1000Better ? 'YES' : '-'} | ${r.regression ? '⚠️ YES' : 'no'} |`);
  }

  const soft = rows.filter((r) => r.softOnsetProfile !== 'clean');
  const clean = rows.filter((r) => r.softOnsetProfile === 'clean');
  const improvedSoft = soft.filter((r) => r.saved1000Better).length;
  const regressions = rows.filter((r) => r.regression);
  console.log('\n=== SUMMARY (dev diagnostic, not release proof) ===');
  console.log(`soft-onset rows improved by 1000ms: ${improvedSoft}/${soft.length}`);
  console.log(`clean rows regressed: ${clean.filter((r) => r.regression).length}/${clean.length}`);
  console.log(`total regressions: ${regressions.length}${regressions.length ? ' -> ' + regressions.map((r) => `${r.fixture}/${r.softOnsetProfile}`).join(', ') : ''}`);
  console.log('\nPASS SIGNAL:');
  console.log(`  1000ms improves soft-onset vs 300ms : ${improvedSoft > 0 ? 'YES' : 'NO (preroll not the lever)'}`);
  console.log(`  1000ms does NOT regress any row      : ${regressions.length === 0 ? 'YES' : 'NO'}`);

  const outPath = '/private/tmp/private-onset-preroll-dev-harness.json';
  await fs.writeFile(outPath, JSON.stringify({ note: 'DEV HARNESS — NOT RELEASE PROOF', rows }, null, 2));
  console.log(`\nartifact: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
