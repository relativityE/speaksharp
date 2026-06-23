// Automated Private model-pipeline smoke (B2).
//
// PURPOSE: prove the pinned Private STT model dependency (v4 base_q4 floor) can be fetched,
// initialized, cached, and produce deterministic inference in automation. This is a DEPENDENCY +
// INFERENCE regression guard.
//
// IT DOES NOT PROVE: browser UX, microphone capture, WebGPU, the setup/consent UI, or the
// no-audio-egress privacy claim. Those belong to the manual real-device WebGPU proof (Option A)
// and, for the browser WASM path, the B1 Playwright smoke. See product_release docs / PR body.
//
// Pins (must mirror frontend/src/services/transcription/sttConstants.ts → PRIV_STT_V4_VARIANTS.base_q4):
//   model  = onnx-community/whisper-base.en
//   dtype  = { encoder_model: 'fp32', decoder_model_merged: 'q4' }
//   pkg    = @huggingface/transformers (same version as the app's v4 engine)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---- Pinned production config (overridable only for explicit, logged experiments) ----
const MODEL_ID = process.env.MODEL_ID || 'onnx-community/whisper-base.en';
const MODEL_REVISION = process.env.MODEL_REVISION || 'main'; // app uses default 'main'; pin a hash here to harden
const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
const DEVICE = 'cpu'; // Node/onnxruntime CPU EP. NOT WebGPU — recorded honestly in the artifact.
// v4 engine anti-loop decode defaults (whisperDecodeOptions.V4_ANTI_LOOP_DECODE_DEFAULTS) + greedy.
const DECODE_OPTIONS = {
  return_timestamps: false,
  condition_on_previous_text: false,
  no_repeat_ngram_size: 6,
  num_beams: 1,
  do_sample: false,
};

const AUDIO_FIXTURE = process.env.AUDIO_FIXTURE || path.join(REPO_ROOT, 'tests/fixtures/jfk_16k.wav');
// Canonical JFK clip ground truth (the standard Whisper demo utterance).
const EXPECTED_TEXT = process.env.EXPECTED_TEXT ||
  'and so my fellow americans ask not what your country can do for you ask what you can do for your country';
const OVERLAP_THRESHOLD = Number(process.env.OVERLAP_THRESHOLD || '0.6');
const OUT_JSON = process.env.OUT_JSON || path.join(REPO_ROOT, 'private-model-smoke.json');

const CAVEAT =
  'Does not prove browser UX, microphone capture, WebGPU, setup/consent UI, or no-audio-egress. ' +
  'CPU/Node (onnxruntime) runtime only — NOT the WebGPU real-device user path.';

// ---- Minimal PCM s16le mono WAV decoder (no extra deps) ----
function decodeWavPcm16Mono(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataLen = size;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt) throw new Error('missing fmt chunk');
  if (dataOffset < 0) throw new Error('missing data chunk');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`expected PCM s16le, got format=${fmt.audioFormat} bits=${fmt.bitsPerSample}`);
  }
  if (fmt.channels !== 1) throw new Error(`expected mono, got ${fmt.channels} channels`);
  if (fmt.sampleRate !== 16000) throw new Error(`expected 16000 Hz, got ${fmt.sampleRate}`);

  const sampleCount = Math.floor(dataLen / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { audio: out, durationSec: sampleCount / fmt.sampleRate, sampleRate: fmt.sampleRate };
}

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Multiset token overlap: fraction of expected words matched by the hypothesis (order-insensitive).
function tokenOverlap(expected, hyp) {
  const e = normalize(expected).split(' ').filter(Boolean);
  const h = normalize(hyp).split(' ').filter(Boolean);
  if (e.length === 0) return 0;
  const counts = new Map();
  for (const w of h) counts.set(w, (counts.get(w) || 0) + 1);
  let matched = 0;
  for (const w of e) {
    const c = counts.get(w) || 0;
    if (c > 0) { matched++; counts.set(w, c - 1); }
  }
  return matched / e.length;
}

function dirSizeBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else { try { total += fs.statSync(p).size; } catch { /* race */ } }
  }
  return total;
}

function pkgVersion() {
  try {
    const p = path.join(REPO_ROOT, 'node_modules/@huggingface/transformers/package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch { return 'unknown'; }
}

async function main() {
  const result = {
    model: MODEL_ID,
    revision: MODEL_REVISION,
    dtype: DTYPE,
    device: DEVICE,
    transformers_js_package: '@huggingface/transformers',
    transformers_js_version: pkgVersion(),
    fixture: path.relative(REPO_ROOT, AUDIO_FIXTURE),
    expected: EXPECTED_TEXT,
    threshold: OVERLAP_THRESHOLD,
    caveats: CAVEAT,
  };

  try {
    // Fresh cache dir → guaranteed cold start, so we can measure download bytes + a miss→hit cycle.
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-stt-cache-'));
    env.allowLocalModels = false; // force CDN resolution (do not silently pass on a local copy)
    env.useBrowserCache = false;
    env.cacheDir = cacheDir;

    const fixtureBuf = fs.readFileSync(AUDIO_FIXTURE);
    const { audio, durationSec } = decodeWavPcm16Mono(fixtureBuf);
    result.fixture_duration_s = Number(durationSec.toFixed(2));

    // --- Cold init (download) ---
    const t0 = Date.now();
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: DTYPE,
      device: DEVICE,
      revision: MODEL_REVISION,
    });
    result.init_ms = Date.now() - t0;
    result.model_bytes = dirSizeBytes(cacheDir);
    result.backend = `cpu (onnxruntime-node), @huggingface/transformers ${result.transformers_js_version}`;

    // --- Warm init (cache hit, no network) ---
    const bytesBefore = result.model_bytes;
    const t1 = Date.now();
    await pipeline('automatic-speech-recognition', MODEL_ID, { dtype: DTYPE, device: DEVICE, revision: MODEL_REVISION });
    result.init_cached_ms = Date.now() - t1;
    const bytesAfter = dirSizeBytes(cacheDir);
    result.cache_status = bytesAfter === bytesBefore ? 'miss_then_hit' : 'miss_then_partial';

    // --- Deterministic inference ---
    const t2 = Date.now();
    const out = await transcriber(audio, DECODE_OPTIONS);
    result.inference_ms = Date.now() - t2;
    result.transcript = String(out?.text ?? '').trim();
    result.token_overlap = Number(tokenOverlap(EXPECTED_TEXT, result.transcript).toFixed(3));

    const nonEmpty = result.transcript.length > 0;
    const overlapOk = result.token_overlap >= OVERLAP_THRESHOLD;
    result.result = nonEmpty && overlapOk ? 'PASS' : 'FAIL';
    if (!nonEmpty) result.fail_reason = 'empty transcript';
    else if (!overlapOk) result.fail_reason = `token_overlap ${result.token_overlap} < threshold ${OVERLAP_THRESHOLD}`;

    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch (err) {
    result.result = 'FAIL';
    result.fail_reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

  // Human-readable console block
  console.log('--- Automated Private model-pipeline smoke (B2) ---');
  console.log(JSON.stringify(result, null, 2));
  console.log(`CAVEAT: ${CAVEAT}`);

  // GitHub job summary (when running in Actions)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `## 🔊 Automated Private model-pipeline smoke — **${result.result}**`,
      '',
      '> Dependency + deterministic-inference guard for the v4 base_q4 Private model.',
      `> **${CAVEAT}**`,
      '',
      '| Field | Value |',
      '|---|---|',
      `| model | \`${result.model}\` @ \`${result.revision}\` |`,
      `| dtype | \`${JSON.stringify(result.dtype)}\` |`,
      `| pkg | \`${result.transformers_js_package}@${result.transformers_js_version}\` |`,
      `| backend | ${result.backend ?? '—'} |`,
      `| model_bytes | ${result.model_bytes ?? '—'} |`,
      `| cache_status | ${result.cache_status ?? '—'} |`,
      `| init_ms / cached | ${result.init_ms ?? '—'} / ${result.init_cached_ms ?? '—'} |`,
      `| inference_ms | ${result.inference_ms ?? '—'} |`,
      `| fixture | \`${result.fixture}\` (${result.fixture_duration_s ?? '?'}s) |`,
      `| token_overlap | ${result.token_overlap ?? '—'} (threshold ${result.threshold}) |`,
      `| transcript | ${result.transcript ? '`' + result.transcript.replace(/\|/g, ' ') + '`' : '—'} |`,
      result.fail_reason ? `| fail_reason | ${result.fail_reason} |` : '',
    ].filter(Boolean).join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }

  process.exit(result.result === 'PASS' ? 0 : 1);
}

main();
