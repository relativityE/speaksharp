/**
 * #1037 production-browser-worker closure proof.
 *
 * Runs the checked-in Private v2 drop-in page through the real production
 * TransformersJSEngine and its module worker. Every pinned natural-language
 * PCM fixture is decoded in Node, passed to the page, hashed on the main thread
 * and independently hashed inside the worker that owns the model. No microphone,
 * auth, database, Cloud, Hugging Face, or application-server call is involved.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import {
  finalizeRow,
  unverifiedWorkerDiagnosticProblems,
} from '../tests/evidence/sttEvidenceSchema';
import { verifyModelAgainstManifest, type ExpectedModelManifest } from '../tests/evidence/modelProvenance';
import {
  provePrivateWorkerNaturalLanguageJourney,
  type NaturalLanguageFixtureContract,
  type PrivateWorkerNaturalLanguageObservation,
} from '../tests/evidence/privateWorkerNaturalLanguageJourney';

const MODEL_REVISION = '95bf40a508535962c6483ead40270b2e32267508';
const MODEL_NAME = 'whisper-base.en';
const MODEL_ID = 'Xenova/whisper-base.en';

interface BrowserWorkerRuntimeProof {
  runtime: {
    model: string;
    requestedThreads: number | null;
    configuredThreads: number | null;
    workerReportedThreads: number | null;
    crossOriginIsolated: boolean;
    modelLoadTimeMs: number;
  };
  input: {
    sha256: string;
    samples: number;
    bytes: number;
    audioLengthSeconds: number;
    latencyMs: number;
  };
  dropIn: {
    modelReady: boolean;
    modelReadyLatencyMs: number | null;
    adapterInputSha256: string | null;
    capturedSamples: number;
    capturedSeconds: number;
  };
  sharedArrayBufferAvailable: boolean;
  userAgent: string;
  appRelease: string | null;
}

declare global {
  interface Window {
    __APP_RELEASE__?: string;
    __PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__?: BrowserWorkerRuntimeProof['runtime'];
    __PRIVATE_V2_WORKER_INPUT_EVIDENCE__?: BrowserWorkerRuntimeProof['input'];
    __PRIVATE_DROPIN__?: BrowserWorkerRuntimeProof['dropIn'] & {
      transcribePcmBase64: (pcmBase64: string) => Promise<string>;
    };
  }
}

const require_ = createRequire(import.meta.url);
const transformersPackagePath = require_.resolve('@xenova/transformers/package.json');
const requireFromTransformers = createRequire(transformersPackagePath);
const transformersPackage = require_(transformersPackagePath) as {
  version: string;
  dependencies?: Record<string, string>;
};
const TRANSFORMERS_VERSION = transformersPackage.version;

function resolvedPackageVersion(
  resolver: NodeRequire,
  specifier: string,
  packageName: string,
): string {
  let cursor = dirname(resolver.resolve(specifier));
  for (;;) {
    const packagePath = join(cursor, 'package.json');
    try {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string; version?: string };
      if (parsed.name === packageName && parsed.version) return parsed.version;
    } catch {
      // Keep walking to the owning package root.
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`could not resolve version for ${packageName}`);
    cursor = parent;
  }
}

// Resolve from Transformers.js v2 itself. The repository also carries a newer
// top-level ORT for dormant v4; reporting that package would misidentify this run.
const ONNXRUNTIME_WEB_VERSION = resolvedPackageVersion(
  requireFromTransformers,
  'onnxruntime-web',
  'onnxruntime-web',
);
const DECLARED_ONNXRUNTIME_WEB_VERSION = transformersPackage.dependencies?.['onnxruntime-web'];
if (!DECLARED_ONNXRUNTIME_WEB_VERSION || ONNXRUNTIME_WEB_VERSION !== DECLARED_ONNXRUNTIME_WEB_VERSION) {
  throw new Error(
    `Transformers.js v2 declares ORT '${DECLARED_ONNXRUNTIME_WEB_VERSION ?? 'missing'}' but resolves '${ONNXRUNTIME_WEB_VERSION}'`,
  );
}

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const sha256 = (value: Buffer | Uint8Array): string => createHash('sha256').update(value).digest('hex');

function decodeWav16kMono(bytes: Buffer): Float32Array {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('fixture is not RIFF/WAVE');
  }
  let offset = 12;
  let format: { audioFormat: number; channels: number; rate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        audioFormat: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        rate: bytes.readUInt32LE(offset + 12),
        bits: bytes.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || format.audioFormat !== 1 || format.channels !== 1 || format.rate !== 16_000 || format.bits !== 16) {
    throw new Error(`fixture must be PCM16 mono 16kHz; got ${JSON.stringify(format)}`);
  }
  if (dataOffset < 0) throw new Error('fixture has no data chunk');
  const audio = new Float32Array(Math.floor(dataSize / 2));
  for (let index = 0; index < audio.length; index += 1) {
    audio[index] = bytes.readInt16LE(dataOffset + index * 2) / 32768;
  }
  return audio;
}

async function main(): Promise<void> {
  const baseUrl = arg('base-url', 'http://127.0.0.1:5173');
  const releaseSha = arg('release-sha', process.env.GITHUB_SHA ?? '');
  const outPath = resolve(arg('out', 'test-results/stt-evidence/1037-private-v2-worker.json'));
  const manifestPath = resolve(arg('manifest', 'tests/evidence/fixtures/corpus/manifest.json'));
  const modelManifestPath = resolve(arg(
    'model-manifest',
    `tests/evidence/fixtures/model-provenance/${MODEL_NAME}-${MODEL_REVISION}.json`,
  ));
  const productionModelDir = resolve(arg('model-dir', `frontend/dist/models/${MODEL_NAME}`));
  const modelManifest = JSON.parse(readFileSync(modelManifestPath, 'utf8')) as ExpectedModelManifest;
  if (modelManifest.schemaVersion !== 1 || modelManifest.modelId !== MODEL_ID ||
      modelManifest.modelRevision !== MODEL_REVISION) {
    throw new Error('model provenance manifest identity does not match the fixed Private-v2 target');
  }
  const modelProvenance = verifyModelAgainstManifest(productionModelDir, modelManifest);
  if (modelProvenance.verdict !== 'identical') {
    throw new Error(`production model provenance is '${modelProvenance.verdict}', not byte-identical`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    groundTruthVersion: string;
    fixtures: Array<NaturalLanguageFixtureContract & { path: string }>;
  };
  const preparedFixtures = manifest.fixtures.map(fixture => {
    const wavPath = resolve(dirname(manifestPath), fixture.path);
    const wavBytes = readFileSync(wavPath);
    if (sha256(wavBytes) !== fixture.fixtureSha256) {
      throw new Error(`fixture '${fixture.fixtureId}' hash does not match manifest`);
    }
    const audio = decodeWav16kMono(wavBytes);
    const pcmBytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    return {
      fixture,
      audio,
      pcmBytes,
      mainInputSha256: sha256(pcmBytes),
      pcmBase64: pcmBytes.toString('base64'),
    };
  });
  const externalRequests: string[] = [];
  const writeRequests: string[] = [];
  const consoleEvents: string[] = [];
  const localRequests: string[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', message => consoleEvents.push(`${message.type()}: ${message.text()}`));
    await page.route('**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname);
      if (!isLocal) {
        externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
        await route.abort('blockedbyclient');
        return;
      }
      localRequests.push(`${request.method()} ${url.pathname}`);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writeRequests.push(`${request.method()} ${url.pathname}`);
      }
      await route.continue();
    });

    await page.goto(
      `${baseUrl}/private-dropin.html?privateModel=${encodeURIComponent(MODEL_NAME)}&privateWorkerEvidence=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(() => Boolean(window.__PRIVATE_DROPIN__), null, { timeout: 30_000 });
    const startedAt = performance.now();
    const observations: PrivateWorkerNaturalLanguageObservation[] = [];
    const runtimeProofs: Array<{
      prepared: typeof preparedFixtures[number];
      proof: BrowserWorkerRuntimeProof;
    }> = [];

    for (const prepared of preparedFixtures) {
      let transcript: string;
      try {
        transcript = await page.evaluate(
          async payload => window.__PRIVATE_DROPIN__!.transcribePcmBase64(payload),
          prepared.pcmBase64,
        );
      } catch (error) {
        console.error(consoleEvents.filter(event => /error|failed|model|onnx/i.test(event)).join('\n'));
        console.error(`blocked external requests: ${JSON.stringify(externalRequests, null, 2)}`);
        throw error;
      }

      const rawProof = await page.evaluate(() => ({
        runtime: window.__PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__ ?? null,
        input: window.__PRIVATE_V2_WORKER_INPUT_EVIDENCE__ ?? null,
        dropIn: window.__PRIVATE_DROPIN__ ? {
          modelReady: window.__PRIVATE_DROPIN__.modelReady,
          modelReadyLatencyMs: window.__PRIVATE_DROPIN__.modelReadyLatencyMs,
          adapterInputSha256: window.__PRIVATE_DROPIN__.adapterInputSha256,
          capturedSamples: window.__PRIVATE_DROPIN__.capturedSamples,
          capturedSeconds: window.__PRIVATE_DROPIN__.capturedSeconds,
        } : null,
        sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
        userAgent: navigator.userAgent,
        appRelease: window.__APP_RELEASE__ ?? null,
      }));
      if (!rawProof.runtime || !rawProof.input || !rawProof.dropIn) {
        throw new Error(`fixture '${prepared.fixture.fixtureId}' did not publish production worker runtime/input proof`);
      }
      const proof: BrowserWorkerRuntimeProof = {
        ...rawProof,
        runtime: rawProof.runtime,
        input: rawProof.input,
        dropIn: rawProof.dropIn,
      };
      if (proof.appRelease !== releaseSha) {
        throw new Error(`loaded release '${proof.appRelease ?? 'missing'}' does not match requested exact SHA '${releaseSha}'`);
      }
      if (proof.runtime.model !== MODEL_NAME) {
        throw new Error(`production worker loaded '${proof.runtime.model}', expected fixed model '${MODEL_NAME}'`);
      }

      const mainInputSamples = prepared.audio.length;
      const mainInputBytes = prepared.pcmBytes.byteLength;
      const mainInputDurationSeconds = mainInputSamples / 16_000;
      if (proof.dropIn.adapterInputSha256 !== prepared.mainInputSha256) {
        throw new Error(`fixture '${prepared.fixture.fixtureId}' Node and page adapter PCM hashes differ`);
      }
      if (proof.dropIn.capturedSamples !== mainInputSamples ||
          proof.dropIn.capturedSeconds !== mainInputDurationSeconds) {
        throw new Error(`fixture '${prepared.fixture.fixtureId}' Node and page adapter PCM sample/duration tuples differ`);
      }

      observations.push({
        fixtureId: prepared.fixture.fixtureId,
        transcript,
        mainThreadInput: {
          sha256: prepared.mainInputSha256,
          samples: mainInputSamples,
          bytes: mainInputBytes,
          durationSeconds: mainInputDurationSeconds,
        },
        workerInput: {
          sha256: proof.input.sha256,
          samples: proof.input.samples,
          bytes: proof.input.bytes,
          durationSeconds: proof.input.audioLengthSeconds,
        },
      });
      runtimeProofs.push({ prepared, proof });
    }

    const naturalLanguageJourney = provePrivateWorkerNaturalLanguageJourney(manifest.fixtures, observations);
    const totalLatencyMs = Math.round(performance.now() - startedAt);
    const firstProof = runtimeProofs[0]?.proof;
    if (!firstProof) throw new Error('natural-language worker journey produced no runtime proof');
    const requiredModelRequests = [
      '/models/whisper-base.en/onnx/encoder_model_quantized.onnx',
      '/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx',
    ];
    for (const requiredPath of requiredModelRequests) {
      if (!localRequests.some(request => request === `GET ${requiredPath}`)) {
        throw new Error(`production worker did not request required self-hosted model asset '${requiredPath}'`);
      }
    }
    if (localRequests.some(request => request.includes('/@fs/'))) {
      throw new Error('runtime served a Vite development /@fs path instead of production build assets');
    }
    const rawWorkerAssetRequests = localRequests.filter(request => /\s\/assets\/transformers-js\.worker-.*\.js$/.test(request));
    if (rawWorkerAssetRequests.length === 0) {
      throw new Error('runtime did not request the emitted production Transformers.js worker asset');
    }
    const workerAssetFiles = [...new Set(rawWorkerAssetRequests.map(request => basename(request.slice(4))))].sort();
    const rawWasmAssetRequests = localRequests.filter(request => /\s\/assets\/.*\.wasm$/.test(request));
    if (rawWasmAssetRequests.length === 0) {
      throw new Error('production worker did not request a built same-origin /assets/*.wasm file');
    }
    const wasmAssetFiles = [...new Set(rawWasmAssetRequests.map(request => basename(request.slice(4))))].sort();
    const browserVersion = /Chrome\/(\S+)/.exec(firstProof.userAgent)?.[1] ?? 'unknown';
    const rows = runtimeProofs.map(({ prepared, proof }, index) => {
      const observation = observations[index];
      const measured = naturalLanguageJourney.results[index];
      if (!observation || !measured || measured.fixtureId !== prepared.fixture.fixtureId) {
        throw new Error(`fixture '${prepared.fixture.fixtureId}' lost its ordered runtime measurement`);
      }
      const row = finalizeRow({
        comparability_class: 'corpus_fixture',
        engine: 'private-v2-browser-worker',
        engine_version: `private_v2:${MODEL_NAME}`,
        model_name: MODEL_NAME,
        attribution_status: 'unverified',
        browser: 'Chromium',
        browser_version: browserVersion,
        os: process.platform,
        device: process.arch,
        network_condition: 'local-self-hosted-assets; external requests blocked',
        fixture_id: prepared.fixture.fixtureId,
        wer: null,
        first_partial_latency_ms: null,
        finalization_latency_ms: proof.input.latencyMs,
        failure_class: 'none',
        release_sha: releaseSha,
        audio_route_evidence: {
          fixtureSha256: prepared.fixture.fixtureSha256,
          adapterInputPayloadSha256: observation.mainThreadInput.sha256,
          adapterInputBytes: observation.mainThreadInput.bytes,
          decodedSampleCount: observation.mainThreadInput.samples,
          decodedDurationSeconds: observation.mainThreadInput.durationSeconds,
        },
        runtime_capability: {
          requestedThreads: proof.runtime.requestedThreads,
          configuredThreads: proof.runtime.configuredThreads,
          workerReportedThreads: proof.runtime.workerReportedThreads,
          runtimePath: proof.runtime.configuredThreads === 1 ? 'wasm' : 'wasm-multithread',
          crossOriginIsolated: proof.runtime.crossOriginIsolated,
          sharedArrayBufferAvailable: proof.sharedArrayBufferAvailable,
          fallbackReason: proof.runtime.configuredThreads === 1
            ? 'crossOriginIsolated=false; production worker requested and configured one ORT thread; effective worker thread count is unreported'
            : null,
        },
        comparability_inputs: {
          fixtureHash: prepared.fixture.fixtureSha256,
          groundTruthVersion: manifest.groundTruthVersion,
          normalizationVersion: measured.normalizationVersion,
          track: null,
          decodeConfiguration: `${MODEL_NAME}/q8/pcm16k-mono/production-worker`,
          modelRevision: MODEL_REVISION,
          runtimeVersions: {
            '@xenova/transformers': TRANSFORMERS_VERSION,
            'onnxruntime-web': ONNXRUNTIME_WEB_VERSION,
          },
        },
        private_worker_evidence: {
          workerUsed: true,
          modelSource: 'self-hosted',
          modelLoaded: proof.runtime.model,
          modelProvenance,
          mainThreadInputSha256: observation.mainThreadInput.sha256,
          mainThreadInputSamples: observation.mainThreadInput.samples,
          mainThreadInputBytes: observation.mainThreadInput.bytes,
          mainThreadInputDurationSeconds: observation.mainThreadInput.durationSeconds,
          workerInputSha256: observation.workerInput.sha256,
          workerInputSamples: observation.workerInput.samples,
          workerInputBytes: observation.workerInput.bytes,
          workerInputDurationSeconds: observation.workerInput.durationSeconds,
          inputHashesMatch: observation.mainThreadInput.sha256 === observation.workerInput.sha256,
          cloudProviderCalls: externalRequests.length,
        },
      });
      const diagnosticProblems = unverifiedWorkerDiagnosticProblems(row);
      if (diagnosticProblems.length > 0) {
        throw new Error(
          `fixture '${prepared.fixture.fixtureId}' unverified worker diagnostic failed validation: ${diagnosticProblems.join('; ')}`,
        );
      }
      return row;
    });

    const artifact = {
      generatedFor: '#1037 production Private-v2 browser-worker: one thread requested/configured; effective worker threads unreported',
      releaseSha,
      classification: 'unverified-worker-diagnostic-non-rankable',
      persistedAttributionProven: false,
      limitations: [
        'No persisted session attribution is exercised; each schema row is intentionally unverified, invalid, WER-free, and non-rankable.',
        'Per-fixture WER is only an executable acceptance bound for this diagnostic and is not published in the rankable schema rows.',
        'Batch worker emits no partial transcript; first_partial_latency_ms is honestly null.',
      ],
      totalJourneyLatencyMs: totalLatencyMs,
      timingMs: {
        modelLoad: firstProof.runtime.modelLoadTimeMs,
        modelReadyIncludingWarmup: firstProof.dropIn.modelReadyLatencyMs,
        perFixtureDecode: runtimeProofs.map(({ prepared, proof }) => ({
          fixtureId: prepared.fixture.fixtureId,
          milliseconds: proof.input.latencyMs,
        })),
        totalJourney: totalLatencyMs,
      },
      loadedReleaseSha: firstProof.appRelease,
      runtimeIdentity: {
        transformers: TRANSFORMERS_VERSION,
        onnxruntimeWeb: ONNXRUNTIME_WEB_VERSION,
      },
      modelProvenance,
      requiredModelRequests,
      workerAssetFiles,
      wasmAssetFiles,
      naturalLanguageJourney,
      transcriptProduced: naturalLanguageJourney.fixtureCount === manifest.fixtures.length,
      writeRequests,
      externalRequests,
      localRequestCount: localRequests.length,
      rows,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    if (writeRequests.length > 0) throw new Error(`unexpected local write requests: ${writeRequests.join(', ')}`);
    console.log(`[private-v2-worker] validated unverified diagnostic artifact: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[private-v2-worker] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
