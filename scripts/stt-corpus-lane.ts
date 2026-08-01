/**
 * #1037 Lane A corpus runner — executes the REAL Private-v2 recognizer (Xenova/whisper-base.en, the same
 * model the product's Private engine uses) against the immutable controlled fixture corpus, proves the
 * audio reached the recognizer, scores WER against the pinned ground truth, and emits an artifact the
 * merged validator accepts. Zero paid Cloud; Cloud/v4 are out of scope.
 *
 *   node_modules/.bin/tsx scripts/stt-corpus-lane.ts \
 *     --manifest tests/evidence/fixtures/corpus/manifest.json \
 *     --out /private/tmp/stt-evidence/corpus.json --runs 3 --release-sha <40-char>
 *
 * The artifact is written OUTSIDE the repo (never committed); CI uploads it. The fixtures + manifest are
 * the only committed inputs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pipeline, env } from '@xenova/transformers';
import { buildCorpusRow, summarizeLatency, type CorpusRow } from '../tests/evidence/corpusLane';
import { rankableCohorts, type RuntimeCapability, type ComparabilityInputs } from '../tests/evidence/sttEvidenceSchema';
import { verifyModelProvenance } from '../tests/evidence/modelProvenance';

// The product's Private v2 model, pinned to an IMMUTABLE commit (never 'main'/'latest').
const MODEL_ID = 'Xenova/whisper-base.en';
const MODEL_REVISION = '95bf40a508535962c6483ead40270b2e32267508';
const MODEL_FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const DECODE_CONFIGURATION = 'whisper-base.en/q8/pcm16k-mono/greedy';

// Runtime versions are DERIVED from the installed packages — never hard-coded (they drift silently).
const require_ = createRequire(import.meta.url);
const TRANSFORMERS_VERSION: string = require_('@xenova/transformers/package.json').version;
const ONNXRUNTIME_NODE_VERSION: string = require_('onnxruntime-node/package.json').version;

const sha256 = (buf: Buffer | Uint8Array): string => createHash('sha256').update(buf).digest('hex');
const fmt = (v: number | null): string => (v === null ? 'n/a' : v.toFixed(2));

/** Parse a canonical PCM16 mono 16 kHz WAV by walking chunks (tolerates JUNK/FLLR padding). */
function decodeWav16kMono(bytes: Buffer): Float32Array {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('not a RIFF/WAVE file');
    }
    let o = 12;
    let fmt: { audioFormat: number; channels: number; rate: number; bits: number } | null = null;
    let dataOffset = -1;
    let dataSize = 0;
    while (o + 8 <= bytes.length) {
        const id = bytes.toString('ascii', o, o + 4);
        const size = bytes.readUInt32LE(o + 4);
        if (id === 'fmt ') {
            fmt = { audioFormat: bytes.readUInt16LE(o + 8), channels: bytes.readUInt16LE(o + 10), rate: bytes.readUInt32LE(o + 12), bits: bytes.readUInt16LE(o + 22) };
        } else if (id === 'data') {
            dataOffset = o + 8;
            dataSize = size;
        }
        o += 8 + size + (size % 2);
    }
    if (!fmt) throw new Error('no fmt chunk');
    if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) {
        throw new Error(`fixture must be PCM16 mono 16kHz, got ${JSON.stringify(fmt)}`);
    }
    if (dataOffset < 0) throw new Error('no data chunk');
    const n = Math.floor(dataSize / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = bytes.readInt16LE(dataOffset + i * 2) / 32768;
    return out;
}

function arg(name: string, fallback?: string): string {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
}

async function main(): Promise<void> {
    const manifestPath = resolve(arg('manifest', 'tests/evidence/fixtures/corpus/manifest.json'));
    const outPath = resolve(arg('out', '/private/tmp/stt-evidence/corpus.json'));
    const runs = Math.max(1, parseInt(arg('runs', '3'), 10));
    const releaseSha = arg('release-sha', (process.env.GITHUB_SHA ?? '').trim());

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const manifestDir = dirname(manifestPath);

    // Writable on every host (ubuntu CI /tmp, macOS /var/folders). The model files MUST land on disk here
    // so the provenance check can hash them — a hardcoded '/private/tmp' is not writable on CI runners.
    const hfCacheDir = process.env.HF_CACHE_DIR ?? join(tmpdir(), 'ss-hf-cache');
    env.allowLocalModels = false;               // fetch the pinned revision from HF (no Cloud STT call)
    env.cacheDir = hfCacheDir;

    // Node corpus harness runtime — model-EQUIVALENT to, but NOT, the production browser worker. Thread
    // counts are neither requested, configured, nor observed here, so they are honestly null.
    const runtime: RuntimeCapability = {
        requestedThreads: null, configuredThreads: null, workerReportedThreads: null,
        runtimePath: 'node-onnxruntime', crossOriginIsolated: false, sharedArrayBufferAvailable: false,
        fallbackReason: 'node corpus harness (onnxruntime-node); not the production browser worker (wasm/webgpu)',
    };

    const asr = await pipeline('automatic-speech-recognition', MODEL_ID, { revision: MODEL_REVISION, quantized: true });

    // Prove the pinned model files == the product's self-hosted assets. FAIL CLOSED unless identical:
    // a differing/unverifiable model must never emit admissible evidence under the production model's name.
    const modelProvenance = verifyModelProvenance(
        resolve(hfCacheDir, MODEL_ID, MODEL_REVISION),
        resolve(process.cwd(), 'frontend/public/models/whisper-base.en'),
        MODEL_FILES,
    );
    console.log(`[corpus] model provenance vs production self-hosted assets: ${modelProvenance.verdict}`);
    if (modelProvenance.verdict !== 'identical') {
        console.error(`[corpus] FAILED: model provenance is '${modelProvenance.verdict}', not 'identical' — refusing to emit corpus evidence under the production model's name.`);
        console.error(JSON.stringify(modelProvenance.files, null, 2));
        process.exit(1);
    }

    const rows: CorpusRow[] = [];
    for (const fx of manifest.fixtures) {
        const wavBytes = readFileSync(resolve(manifestDir, fx.path));
        // Immutability checks — a changed fixture or reference text FAILS the run closed.
        if (sha256(wavBytes) !== fx.fixtureSha256) throw new Error(`fixture ${fx.fixtureId}: sha mismatch (corpus is immutable)`);
        if (sha256(Buffer.from(fx.referenceText, 'utf8')) !== fx.referenceTextSha256) throw new Error(`fixture ${fx.fixtureId}: reference-text sha mismatch`);

        const audio = decodeWav16kMono(wavBytes);
        const payload = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
        const route = {
            fixtureSha256: fx.fixtureSha256,
            adapterInputPayloadSha256: sha256(payload), // THE route-entry proof: the exact PCM handed to the model
            adapterInputBytes: payload.byteLength,
            decodedSampleCount: audio.length,
            decodedDurationSeconds: audio.length / 16000,
        };
        const ci: ComparabilityInputs = {
            fixtureHash: fx.fixtureSha256,
            groundTruthVersion: manifest.groundTruthVersion,
            normalizationVersion: 'set-by-buildCorpusRow',
            decodeConfiguration: DECODE_CONFIGURATION,
            modelRevision: MODEL_REVISION,
            runtimeVersions: { '@xenova/transformers': TRANSFORMERS_VERSION, 'onnxruntime-node': ONNXRUNTIME_NODE_VERSION },
        };

        for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            const result = (await asr(audio)) as { text: string };
            const finalizationLatencyMs = Math.round(performance.now() - t0);
            rows.push(buildCorpusRow({
                engine: 'private', engineVersion: `private_v2:${'whisper-base.en'}`, modelName: 'whisper-base.en',
                attributionStatus: 'verified',
                environment: { browser: 'node-corpus-harness', browserVersion: process.versions.node, os: process.platform, device: 'ci-runner', networkCondition: 'model-cached-local' },
                fixtureId: fx.fixtureId, releaseSha, audioRoute: route, runtime, comparabilityInputs: ci,
                firstPartialLatencyMs: null,              // batch ASR emits no partial — honestly null
                finalizationLatencyMs, failureClass: 'none',
                groundTruth: fx.referenceText, recognizerTranscript: (result.text ?? '').trim(),
                thermalState: i === 0 ? 'cold' : 'warm',
            }));
        }
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({
        generatedFor: '#1037 Lane A corpus (Node model-equivalent harness — NOT the production browser worker)',
        releaseSha,
        runtimeVersions: { '@xenova/transformers': TRANSFORMERS_VERSION, 'onnxruntime-node': ONNXRUNTIME_NODE_VERSION },
        modelProvenance,
        rows,
    }, null, 2));

    // Group with the merged helper — comparison happens only within a cohort.
    const cohorts = rankableCohorts(rows);
    console.log(`[corpus] ${rows.length} rows, ${[...cohorts.keys()].length} admissible cohort(s)`);
    for (const [key, cohortRows] of cohorts) {
        const fin = summarizeLatency(cohortRows, 'finalization_latency_ms');
        for (const r of cohortRows) {
            const f = r.filler_metric, p = r.punctuation_metric;
            console.log(`  ${r.fixture_id}  WER=${r.wer?.toFixed(3) ?? 'null'}  filler(P/R/F1)=${f ? `${fmt(f.precision)}/${fmt(f.recall)}/${fmt(f.f1)}` : 'null'}  punct(P/R/F1)=${p ? `${fmt(p.precision)}/${fmt(p.recall)}/${fmt(p.f1)}` : 'null'}`);
        }
        console.log(`  cohort ${key.slice(0, 48)}…  admissible=${cohortRows.length}  cold.p95=${fin.cold.p95} warm.p95=${fin.warm.p95}`);
    }

    // Fail closed through the merged validator.
    execFileSync('node', ['scripts/validate-stt-evidence.mjs', outPath], { stdio: 'inherit' });
    console.log(`[corpus] artifact written to ${outPath} and accepted by the merged validator`);
}

main().catch((err) => { console.error('[corpus] FAILED:', err.message); process.exit(1); });
