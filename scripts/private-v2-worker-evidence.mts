/**
 * #1037 production-browser-worker closure proof.
 *
 * Runs the checked-in Private v2 drop-in page through the real production
 * TransformersJSEngine and its module worker. The PCM fixture is decoded in
 * Node, passed to the page, hashed on the main thread and independently hashed
 * inside the worker that owns the model. No microphone, auth, database, Cloud,
 * Hugging Face, or application-server call is involved.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { finalizeRow } from '../tests/evidence/sttEvidenceSchema';
import { wordErrorRate, NORMALIZATION_VERSION } from '../tests/evidence/werMetric';

const MODEL_REVISION = '95bf40a508535962c6483ead40270b2e32267508';
const MODEL_NAME = 'whisper-base.en';
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
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    groundTruthVersion: string;
    fixtures: Array<{ fixtureId: string; path: string; fixtureSha256: string; referenceText: string }>;
  };
  const fixture = manifest.fixtures[0];
  if (!fixture) throw new Error('corpus manifest contains no fixture');
  const wavPath = resolve(dirname(manifestPath), fixture.path);
  const wavBytes = readFileSync(wavPath);
  if (sha256(wavBytes) !== fixture.fixtureSha256) throw new Error('fixture hash does not match manifest');
  const audio = decodeWav16kMono(wavBytes);
  const pcmBytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  const mainInputSha256 = sha256(pcmBytes);
  const pcmBase64 = pcmBytes.toString('base64');
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
    let transcript: string;
    try {
      transcript = await page.evaluate(async payload => window.__PRIVATE_DROPIN__!.transcribePcmBase64(payload), pcmBase64);
    } catch (error) {
      console.error(consoleEvents.filter(event => /error|failed|model|onnx/i.test(event)).join('\n'));
      console.error(`blocked external requests: ${JSON.stringify(externalRequests, null, 2)}`);
      throw error;
    }
    const totalLatencyMs = Math.round(performance.now() - startedAt);
    const proof = await page.evaluate(() => ({
      runtime: window.__PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__ ?? null,
      input: window.__PRIVATE_V2_WORKER_INPUT_EVIDENCE__ ?? null,
      dropIn: window.__PRIVATE_DROPIN__ ? {
        modelReady: window.__PRIVATE_DROPIN__.modelReady,
        modelReadyLatencyMs: window.__PRIVATE_DROPIN__.modelReadyLatencyMs,
        adapterInputSha256: window.__PRIVATE_DROPIN__.adapterInputSha256,
      } : null,
      crossOriginIsolated,
      sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
      userAgent: navigator.userAgent,
      appRelease: window.__APP_RELEASE__ ?? null,
    }));

    if (!proof.runtime || !proof.input || !proof.dropIn) throw new Error('production worker did not publish runtime/input proof');
    if (proof.appRelease !== releaseSha) {
      throw new Error(`loaded release '${proof.appRelease ?? 'missing'}' does not match requested exact SHA '${releaseSha}'`);
    }
    if (proof.runtime.model !== MODEL_NAME) {
      throw new Error(`production worker loaded '${proof.runtime.model}', expected fixed model '${MODEL_NAME}'`);
    }
    const requiredModelRequests = [
      '/models/whisper-base.en/onnx/encoder_model_quantized.onnx',
      '/models/whisper-base.en/onnx/decoder_model_merged_quantized.onnx',
    ];
    for (const requiredPath of requiredModelRequests) {
      if (!localRequests.some(request => request === `GET ${requiredPath}`)) {
        throw new Error(`production worker did not request required self-hosted model asset '${requiredPath}'`);
      }
    }
    // Production builds emit /assets/*.wasm; Vite's exact-head test server uses a
    // different same-origin path. The route interceptor already rejects every
    // non-local request, so any observed .wasm request here is self-hosted.
    const rawWasmAssetRequests = localRequests.filter(request => /\s\/.*\.wasm$/.test(request));
    if (rawWasmAssetRequests.length === 0) {
      throw new Error('production worker did not request a same-origin ORT WASM asset');
    }
    // Vite development URLs may contain /@fs/<absolute-machine-path>. Evidence
    // retains only portable asset filenames; raw local request paths never leave
    // this process or enter Actions artifacts/review reports.
    const wasmAssetFiles = [...new Set(rawWasmAssetRequests.map(request => basename(request.slice(4))))].sort();
    if (proof.dropIn.adapterInputSha256 !== mainInputSha256) throw new Error('Node and page adapter PCM hashes differ');
    const hashesMatch = proof.input.sha256 === mainInputSha256;
    const metric = wordErrorRate(fixture.referenceText, transcript);
    const browserVersion = /Chrome\/(\S+)/.exec(proof.userAgent)?.[1] ?? 'unknown';
    const row = finalizeRow({
      comparability_class: 'corpus_fixture',
      engine: 'private-v2-browser-worker',
      engine_version: `private_v2:${MODEL_NAME}`,
      model_name: MODEL_NAME,
      attribution_status: 'verified',
      browser: 'Chromium',
      browser_version: browserVersion,
      os: process.platform,
      device: process.arch,
      network_condition: 'local-self-hosted-assets; external requests blocked',
      fixture_id: fixture.fixtureId,
      wer: metric.wer,
      first_partial_latency_ms: null,
      finalization_latency_ms: proof.input.latencyMs,
      failure_class: 'none',
      release_sha: releaseSha,
      audio_route_evidence: {
        fixtureSha256: fixture.fixtureSha256,
        adapterInputPayloadSha256: mainInputSha256,
        adapterInputBytes: pcmBytes.byteLength,
        decodedSampleCount: proof.input.samples,
        decodedDurationSeconds: proof.input.audioLengthSeconds,
      },
      runtime_capability: {
        requestedThreads: proof.runtime.requestedThreads,
        configuredThreads: proof.runtime.configuredThreads,
        workerReportedThreads: proof.runtime.workerReportedThreads,
        runtimePath: proof.runtime.configuredThreads === 1 ? 'wasm' : 'wasm-multithread',
        crossOriginIsolated: proof.runtime.crossOriginIsolated,
        sharedArrayBufferAvailable: proof.sharedArrayBufferAvailable,
        fallbackReason: proof.runtime.configuredThreads === 1
          ? 'crossOriginIsolated=false; production worker configured the single-thread WASM floor; ORT does not report an effective count'
          : null,
      },
      comparability_inputs: {
        fixtureHash: fixture.fixtureSha256,
        groundTruthVersion: manifest.groundTruthVersion,
        normalizationVersion: NORMALIZATION_VERSION,
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
        mainThreadInputSha256: mainInputSha256,
        workerInputSha256: proof.input.sha256,
        inputHashesMatch: hashesMatch,
        cloudProviderCalls: externalRequests.length,
      },
    });

    const artifact = {
      generatedFor: '#1037 production Private-v2 browser-worker single-thread fallback',
      releaseSha,
      limitations: ['Batch worker emits no partial transcript; first_partial_latency_ms is honestly null.'],
      totalJourneyLatencyMs: totalLatencyMs,
      timingMs: {
        modelLoad: proof.runtime.modelLoadTimeMs,
        modelReadyIncludingWarmup: proof.dropIn.modelReadyLatencyMs,
        decode: proof.input.latencyMs,
        totalJourney: totalLatencyMs,
      },
      loadedReleaseSha: proof.appRelease,
      runtimeIdentity: {
        transformers: TRANSFORMERS_VERSION,
        onnxruntimeWeb: ONNXRUNTIME_WEB_VERSION,
      },
      requiredModelRequests,
      wasmAssetFiles,
      transcript,
      writeRequests,
      externalRequests,
      localRequestCount: localRequests.length,
      rows: [row],
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    execFileSync('node', ['scripts/validate-stt-evidence.mjs', outPath], { stdio: 'inherit' });
    if (writeRequests.length > 0) throw new Error(`unexpected local write requests: ${writeRequests.join(', ')}`);
    console.log(`[private-v2-worker] accepted artifact: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[private-v2-worker] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
