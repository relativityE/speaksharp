/**
 * Dev/test benchmark: v2 vs v3 vs v4 on a novel 1-2 minute public-domain speech.
 *
 * This isolates engine/model-package behavior on byte-identical audio. It is not
 * browser release proof and does not write STT_BENCHMARKS.json.
 *
 * v2: @xenova/transformers@2.x from repo deps
 * v3: @huggingface/transformers@3.8.1 from /private/tmp/speaksharp-transformers-v3
 * v4: @huggingface/transformers@4.2.0 from repo deps
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WASHINGTON_01 } from '../../tests/fixtures/stt-isomorphic/washington-speeches';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const TMP_DIR = '/private/tmp';
const V3_NODE_MODULES = '/private/tmp/speaksharp-transformers-v3/node_modules';
const OUT = process.env.OUT || `${TMP_DIR}/private-v2-v3-v4-washington-longform.json`;
const AIFF = `${TMP_DIR}/washington-first-inaugural-longform.aiff`;
const WAV = path.resolve(process.cwd(), 'tests/fixtures/stt-isomorphic/audio', WASHINGTON_01.audio);
const SR = 16000;
const SELF = fileURLToPath(import.meta.url);
const WASHINGTON_EXCERPT = WASHINGTON_01.transcript;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return compact(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function calculateWordErrorRate(reference: string, hypothesis: string): number {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  const dp = Array.from({ length: ref.length + 1 }, () => Array(hyp.length + 1).fill(0));
  for (let i = 0; i <= ref.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= hyp.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[ref.length][hyp.length] / ref.length;
}

async function synthesizeAudio(): Promise<void> {
  await execFileAsync('/usr/bin/say', ['-v', 'Samantha', '-r', '150', '-o', AIFF, WASHINGTON_EXCERPT], { timeout: 90_000 });
  await fs.mkdir(path.dirname(WAV), { recursive: true });
  await execFileAsync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEI16@${SR}`, AIFF, WAV], { timeout: 30_000 });
}

async function ensureAudio(): Promise<void> {
  try {
    await fs.access(WAV);
  } catch {
    await synthesizeAudio();
  }
}

async function decodePcmWav(filePath: string): Promise<{ audio: Float32Array; durationSec: number; rms: number; peak: number }> {
  const buf = await fs.readFile(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Unsupported WAV: ${filePath}`);
  }
  let off = 12;
  let dataStart = -1;
  let dataSize = 0;
  let channels = 1;
  let bits = 16;
  let format = 1;
  let sampleRate = SR;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(start);
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === 'data') {
      dataStart = start;
      dataSize = size;
      break;
    }
    off = start + size + (size % 2);
  }
  if (format !== 1 || bits !== 16 || sampleRate !== SR || dataStart < 0) {
    throw new Error(`Expected PCM16 ${SR}Hz WAV; got format=${format}, bits=${bits}, sr=${sampleRate}`);
  }
  const frames = Math.floor(dataSize / (channels * 2));
  const audio = new Float32Array(frames);
  let sumSq = 0;
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += buf.readInt16LE(dataStart + (frame * channels + channel) * 2) / 32768;
    }
    const sample = sum / channels;
    audio[frame] = sample;
    sumSq += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { audio, durationSec: frames / sampleRate, rms: Math.sqrt(sumSq / Math.max(frames, 1)), peak };
}

function packageVersion(packageName: string, base?: string): string | null {
  const packagePath = base
    ? path.join(base, packageName, 'package.json')
    : path.join(process.cwd(), 'node_modules', packageName, 'package.json');
  try {
    return JSON.parse(require('node:fs').readFileSync(packagePath, 'utf8')).version ?? null;
  } catch {
    // Fall through to package export resolution for packages that expose it.
  }
  try {
    const resolver = base
      ? createRequire(path.join(base, 'package.json'))
      : require;
    return resolver(`${packageName}/package.json`).version ?? null;
  } catch {
    return null;
  }
}

async function loadV3() {
  const entry = path.join(V3_NODE_MODULES, '@huggingface/transformers/dist/transformers.node.mjs');
  return import(entry);
}

async function runEngine(label: string, version: string | null, loader: () => Promise<unknown>, options: Record<string, unknown>, audio: Float32Array, durationSec: number) {
  const module = await loader() as {
    env: Record<string, unknown>;
    pipeline: (...args: unknown[]) => Promise<(input: Float32Array, options: Record<string, unknown>) => Promise<unknown>>;
  };
  module.env.allowLocalModels = false;
  module.env.useBrowserCache = false;
  const loadStart = performance.now();
  const transcriber = label === 'v2'
    ? await module.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true })
    : await module.pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    });
  const loadMs = Math.round(performance.now() - loadStart);
  const decodeStart = performance.now();
  const result = await transcriber(audio, options);
  const decodeMs = Math.round(performance.now() - decodeStart);
  const text = compact(typeof result === 'string'
    ? result
    : ((result as { text?: string }).text ?? ''));
  const wer = calculateWordErrorRate(WASHINGTON_EXCERPT, text);
  return {
    label,
    packageVersion: version,
    options,
    loadMs,
    decodeMs,
    rtf: Number((decodeMs / (durationSec * 1000)).toFixed(4)),
    transcript: text,
    transcriptWordCount: words(text).length,
    wer,
    accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
  };
}

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function runOne(engine: string, childOut: string): Promise<void> {
  await ensureAudio();
  const audio = await decodePcmWav(WAV);
  const options = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  let row;
  if (engine === 'v2') {
    row = await runEngine('v2', packageVersion('@xenova/transformers'), () => import('@xenova/transformers'), options, audio.audio, audio.durationSec);
  } else if (engine === 'v3') {
    row = await runEngine('v3', packageVersion('@huggingface/transformers', V3_NODE_MODULES), loadV3, options, audio.audio, audio.durationSec);
  } else if (engine === 'v4') {
    row = await runEngine('v4', packageVersion('@huggingface/transformers'), () => import('@huggingface/transformers'), options, audio.audio, audio.durationSec);
  } else {
    throw new Error(`Unknown engine ${engine}`);
  }
  await fs.writeFile(childOut, JSON.stringify({ row, audio: {
    aiffPath: AIFF,
    wavPath: WAV,
    durationSec: Number(audio.durationSec.toFixed(3)),
    sampleRate: SR,
    rms: Number(audio.rms.toFixed(6)),
    peak: Number(audio.peak.toFixed(6)),
  } }, null, 2));
}

async function main() {
  const args = parseArgs();
  if (typeof args.engine === 'string') {
    await runOne(args.engine, typeof args.childOut === 'string' ? args.childOut : `${TMP_DIR}/private-${args.engine}-washington-child.json`);
    return;
  }

  await synthesizeAudio();
  const childOutputs = ['v2', 'v3', 'v4'].map((engine) => ({
    engine,
    out: `${TMP_DIR}/private-${engine}-washington-longform-child.json`,
  }));
  for (const child of childOutputs) {
    await execFileAsync('pnpm', ['exec', 'tsx', SELF, '--engine', child.engine, '--childOut', child.out], {
      cwd: process.cwd(),
      timeout: 240_000,
      env: { ...process.env },
    });
  }
  const children = await Promise.all(childOutputs.map(async (child) => ({
    engine: child.engine,
    ...(JSON.parse(await fs.readFile(child.out, 'utf8'))),
  })));
  const rows = children.map((child) => child.row);
  const audio = children[0].audio;

  const artifact = {
    note: 'Dev/test Node full-WAV comparison; not browser release proof.',
    source: {
      fixtureId: WASHINGTON_01.id,
      title: `${WASHINGTON_01.source.speaker} ${WASHINGTON_01.source.title} excerpt`,
      url: WASHINGTON_01.source.url,
      excerptWordCount: words(WASHINGTON_EXCERPT).length,
      text: WASHINGTON_EXCERPT,
    },
    audio: {
      aiffPath: AIFF,
      wavPath: WAV,
      durationSec: audio.durationSec,
      sampleRate: SR,
      rms: audio.rms,
      peak: audio.peak,
    },
    latestStable: {
      '@huggingface/transformers': packageVersion('@huggingface/transformers'),
      npmCheckedLatest: '4.2.0',
    },
    rows,
  };
  await fs.writeFile(OUT, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    out: OUT,
    audio: artifact.audio,
    rows: rows.map((row) => ({
      label: row.label,
      packageVersion: row.packageVersion,
      accuracyPct: row.accuracyPct,
      wer: Number(row.wer.toFixed(4)),
      decodeMs: row.decodeMs,
      rtf: row.rtf,
      transcriptWordCount: row.transcriptWordCount,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
