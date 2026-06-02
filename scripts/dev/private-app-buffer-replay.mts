/**
 * Dev-owned Private STT app-buffer replay harness.
 *
 * Purpose:
 *   - Re-decode the exact Float32->PCM16 WAV buffer captured by PrivateWhisper
 *     instrumentation when a trace/artifact contains `wavDataUrl`.
 *   - Compare app saved/live text, app-buffer offline decode, and browser drop-in
 *     rows for problematic Harvard fixtures such as h1_6 and h1_8.
 *
 * This is not browser release proof and does not patch thresholds or product code.
 *
 * Examples:
 *   pnpm exec tsx scripts/dev/private-app-buffer-replay.mts \
 *     --fixtures h1_6,h1_8 \
 *     --app-artifact /private/tmp/speaksharp-private-h1_6-default-debug-20260601203248.json \
 *     --dropin-artifact /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json
 *
 * If an app artifact only contains `wavDataUrlBytes`, exact replay is reported as
 * unavailable. Add `--allow-fixture-fallback` to decode the canonical fixture WAV
 * as a control, clearly classified as artifact/config mismatch.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARVARD_SENTENCES } from '../../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer.js';

type JsonRecord = Record<string, unknown>;

type AudioSource = {
  kind: 'app-buffer' | 'fixture-fallback';
  fixture: string;
  audio: Float32Array;
  sampleRate: number;
  durationSec: number;
  source: string;
};

type Row = {
  fixture: string;
  truth: string;
  appSavedLiveResult: string;
  appBufferOfflineDecode: string;
  browserDropInResult: string;
  wer: number | null;
  accuracyPct: number | null;
  firstBadBoundary: string | null;
  classification: string;
  notes: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const audioDir = path.join(repoRoot, 'tests/fixtures/stt-isomorphic/audio');

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function firstBadBoundary(reference: string, hypothesis: string): string | null {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  const max = Math.max(ref.length, hyp.length);
  for (let i = 0; i < max; i += 1) {
    if (ref[i] !== hyp[i]) {
      return `word ${i + 1}: expected "${ref[i] ?? '<end>'}", got "${hyp[i] ?? '<end>'}"`;
    }
  }
  return null;
}

function accuracyFromWer(wer: number): number {
  return Number(((1 - wer) * 100).toFixed(2));
}

async function readJson(filePath?: string): Promise<JsonRecord | null> {
  if (!filePath) return null;
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as JsonRecord;
}

function rowsFromArtifact(artifact: JsonRecord | null): JsonRecord[] {
  const rows = artifact?.results;
  return Array.isArray(rows) ? rows.filter((row): row is JsonRecord => Boolean(row) && typeof row === 'object') : [];
}

function findRow(rows: JsonRecord[], fixture: string): JsonRecord | null {
  return rows.find((row) => row.fixture === fixture) ?? null;
}

function extractBestAppText(row: JsonRecord | null): string {
  if (!row) return '';
  return [
    row.selectedForSaveTranscript,
    row.detailTranscript,
    row.postStopTranscript,
    row.transcript,
    row.visibleAtStopTranscript,
  ].map(asString).find((text) => text.trim()) ?? '';
}

function extractWavDataUrl(row: JsonRecord | null): { dataUrl: string; source: string } | null {
  if (!row) return null;

  const utteranceChunks = row.privateUtteranceAudioChunks;
  if (Array.isArray(utteranceChunks) && utteranceChunks.length > 0) {
    const last = utteranceChunks[utteranceChunks.length - 1] as JsonRecord;
    const dataUrl = asString(last.wavDataUrl);
    if (dataUrl) return { dataUrl, source: 'privateUtteranceAudioChunks[last].wavDataUrl' };
  }

  const inferenceChunks = row.privateAudioChunks;
  if (Array.isArray(inferenceChunks) && inferenceChunks.length > 0) {
    const wholeCommit = inferenceChunks
      .map((chunk) => chunk as JsonRecord)
      .find((chunk) => asString(chunk.kind) === 'whole-utterance' || asString(chunk.captureKind) === 'whole-utterance');
    const chosen = wholeCommit ?? (inferenceChunks[inferenceChunks.length - 1] as JsonRecord);
    const dataUrl = asString(chosen.wavDataUrl);
    if (dataUrl) return { dataUrl, source: wholeCommit ? 'privateAudioChunks[whole-utterance].wavDataUrl' : 'privateAudioChunks[last].wavDataUrl' };
  }

  return null;
}

function decodePcm16Wav(buffer: Buffer): { audio: Float32Array; sampleRate: number; durationSec: number } {
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  let channels = 1;
  let bits = 16;
  let format = 1;
  let sampleRate = 16000;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bits = buffer.readUInt16LE(start + 14);
    } else if (id === 'data') {
      dataStart = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }

  if (format !== 1 || bits !== 16 || dataStart < 0) {
    throw new Error(`Only PCM16 WAV is supported; got format=${format}, bits=${bits}, dataStart=${dataStart}`);
  }

  const frames = Math.floor(dataSize / (channels * 2));
  const audio = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += buffer.readInt16LE(dataStart + (frame * channels + channel) * 2) / 32768;
    }
    audio[frame] = sum / channels;
  }
  return { audio, sampleRate, durationSec: frames / sampleRate };
}

function decodeDataUrl(dataUrl: string): { audio: Float32Array; sampleRate: number; durationSec: number } {
  const match = /^data:audio\/wav;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected data:audio/wav;base64 data URL');
  return decodePcm16Wav(Buffer.from(match[1], 'base64'));
}

async function loadAudioSource(fixture: string, row: JsonRecord | null, allowFixtureFallback: boolean): Promise<AudioSource | null> {
  const captured = extractWavDataUrl(row);
  if (captured) {
    const decoded = decodeDataUrl(captured.dataUrl);
    return { kind: 'app-buffer', fixture, source: captured.source, ...decoded };
  }

  if (!allowFixtureFallback) return null;

  const filePath = path.join(audioDir, `${fixture}.wav`);
  const decoded = decodePcm16Wav(await fs.readFile(filePath));
  return { kind: 'fixture-fallback', fixture, source: filePath, ...decoded };
}

async function loadTranscriber(): Promise<(audio: Float32Array) => Promise<string>> {
  const xenova = await import('@xenova/transformers');
  xenova.env.allowLocalModels = false;
  xenova.env.useBrowserCache = false;
  const transcriber = await xenova.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true });
  return async (audio: Float32Array) => {
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: audio.length / 16000 > 30 ? 5 : 0,
      return_timestamps: false,
    });
    return (typeof result === 'string' ? result : result.text ?? '').trim();
  };
}

function classify(source: AudioSource | null, appText: string, offlineText: string, dropInText: string): { classification: string; notes: string } {
  if (!source) {
    return {
      classification: 'artifact/config mismatch',
      notes: 'App artifact did not include wavDataUrl; only byte counts or text were available, so exact app-buffer replay was not possible.',
    };
  }
  if (source.kind === 'fixture-fallback') {
    return {
      classification: 'artifact/config mismatch',
      notes: 'Decoded canonical fixture WAV as a control because exact app buffer was absent from artifact.',
    };
  }
  if (offlineText.trim() && dropInText.trim() && offlineText.trim().toLowerCase() === dropInText.trim().toLowerCase()) {
    return {
      classification: appText.trim().toLowerCase() === offlineText.trim().toLowerCase() ? 'runtime nondeterminism' : 'candidate selection',
      notes: 'Exact buffer decode matches browser drop-in text; mismatch is after decode if app saved/live differs.',
    };
  }
  if (offlineText.trim() && appText.trim().toLowerCase() === offlineText.trim().toLowerCase()) {
    return {
      classification: 'audio prep/windowing',
      notes: 'Offline decode of captured app buffer matches app result but differs from browser drop-in/control.',
    };
  }
  return {
    classification: 'cleanup/sanitization',
    notes: 'Captured-buffer decode differs from both app text and browser drop-in; inspect raw-vs-sanitized candidate trace.',
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const fixtures = String(args.fixtures || 'h1_6,h1_8').split(',').map((item) => item.trim()).filter(Boolean);
  const appArtifact = await readJson(typeof args['app-artifact'] === 'string' ? args['app-artifact'] : undefined);
  const dropinArtifact = await readJson(typeof args['dropin-artifact'] === 'string' ? args['dropin-artifact'] : undefined);
  const appRows = rowsFromArtifact(appArtifact);
  const dropinRows = rowsFromArtifact(dropinArtifact);
  const allowFixtureFallback = Boolean(args['allow-fixture-fallback']);
  let transcribe: ((audio: Float32Array) => Promise<string>) | null = null;
  const rows: Row[] = [];

  for (const fixture of fixtures) {
    const truth = HARVARD_SENTENCES.find((item) => item.id === fixture)?.transcript ?? '';
    if (!truth) throw new Error(`Unknown fixture ${fixture}`);

    const appRow = findRow(appRows, fixture);
    const dropinRow = findRow(dropinRows, fixture);
    const appText = extractBestAppText(appRow);
    const dropinText = asString(dropinRow?.transcript);
    const source = await loadAudioSource(fixture, appRow, allowFixtureFallback);
    if (source && !transcribe) {
      transcribe = await loadTranscriber();
    }
    const offlineText = source && transcribe ? await transcribe(source.audio) : '';
    const wer = offlineText ? calculateWordErrorRate(truth, offlineText) : null;
    const classified = classify(source, appText, offlineText, dropinText);

    rows.push({
      fixture,
      truth,
      appSavedLiveResult: appText || '<missing>',
      appBufferOfflineDecode: offlineText || '<unavailable>',
      browserDropInResult: dropinText || '<missing>',
      wer,
      accuracyPct: wer == null ? null : accuracyFromWer(wer),
      firstBadBoundary: offlineText ? firstBadBoundary(truth, offlineText) : null,
      classification: classified.classification,
      notes: `${classified.notes}${source ? ` Source=${source.source}; duration=${source.durationSec.toFixed(3)}s; sampleRate=${source.sampleRate}.` : ''}`,
    });
  }

  console.table(rows.map((row) => ({
    Fixture: row.fixture,
    Truth: row.truth,
    'App saved/live result': row.appSavedLiveResult,
    'App-buffer offline decode': row.appBufferOfflineDecode,
    'Browser drop-in result': row.browserDropInResult,
    'WER/accuracy': row.wer == null ? 'n/a' : `${row.wer.toFixed(4)} / ${row.accuracyPct}%`,
    'first bad boundary': row.firstBadBoundary ?? 'none',
    Classification: row.classification,
  })));

  const out = typeof args.out === 'string' ? args.out : `/private/tmp/speaksharp-private-app-buffer-replay-${Date.now()}.json`;
  await fs.writeFile(out, JSON.stringify({
    note: 'Dev diagnostic only; not browser release proof and not STT green evidence.',
    appArtifact: typeof args['app-artifact'] === 'string' ? args['app-artifact'] : null,
    dropinArtifact: typeof args['dropin-artifact'] === 'string' ? args['dropin-artifact'] : null,
    allowFixtureFallback,
    rows,
  }, null, 2));
  console.log(`artifact: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
