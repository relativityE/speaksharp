#!/usr/bin/env node
/** #1565 model-only corpus lane. This command neither selects a production model nor runs a product journey. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { compareModelArms, type CorpusClip, type EvaluatorPolicy, type ModelArm, type ModelIdentity } from '../../tests/evidence/modelEvaluator';
import { decodeWav16kMono } from './wav';
import type { AdapterFactory, ModelAdapter } from './adapter';
import type { AssetTransfer } from './asset-transfer';
import { countFillerWords } from '../../frontend/src/utils/fillerWordUtils';

type ArmManifest = {
  version: 1; identity: ModelIdentity; adapterModule: string;
  adapterOptions?: Record<string, unknown>;
};
type CorpusManifest = { version: 1; clips: Array<CorpusClip & { path: string; wavSha256: string }> };
type DeviceManifest = { version: 1; baseUrl: string; label: string; backend: string };

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return process.argv[index + 1];
};
const root = process.cwd();
async function readManifest<T>(name: string): Promise<{ value: T; path: string; sha256: string }> {
  const path = resolve(arg(name));
  const bytes = await readFile(path);
  const value = JSON.parse(bytes.toString('utf8')) as T;
  if (!value || (value as { version?: number }).version !== 1) throw new Error(`${name} manifest version must be 1`);
  return { value, path, sha256: sha(bytes) };
}

async function loadAdapter(manifest: ArmManifest, baseUrl: string): Promise<ModelAdapter> {
  if (!manifest.adapterModule.startsWith('./') && !manifest.adapterModule.startsWith('../')) {
    throw new Error('adapterModule must be a local relative path');
  }
  const modulePath = resolve(root, manifest.adapterModule);
  if (!modulePath.startsWith(`${root}/`)) throw new Error('adapterModule escapes repository root');
  const imported = await import(pathToFileURL(modulePath).href) as { createAdapter?: AdapterFactory };
  if (typeof imported.createAdapter !== 'function') throw new Error('adapter module has no createAdapter');
  return imported.createAdapter({
    baseUrl, expected: manifest.identity, repositoryRoot: root,
    options: manifest.adapterOptions ?? {},
  });
}

async function main(): Promise<void> {
  const baselineManifest = await readManifest<ArmManifest>('baseline');
  const candidateManifest = await readManifest<ArmManifest>('candidate');
  const corpusManifest = await readManifest<CorpusManifest>('corpus');
  const deviceManifest = await readManifest<DeviceManifest>('device');
  const policyPath = process.argv.includes('--policy') ? resolve(arg('policy')) : null;
  const policyBytes = policyPath ? await readFile(policyPath) : null;
  const policy = policyBytes ? JSON.parse(policyBytes.toString('utf8')) as EvaluatorPolicy : null;
  const out = resolve(arg('out'));
  if (baselineManifest.value.identity.backend !== deviceManifest.value.backend ||
      candidateManifest.value.identity.backend !== deviceManifest.value.backend) {
    throw new Error('device backend differs from an arm manifest');
  }
  const clips = corpusManifest.value.clips;
  if (!Array.isArray(clips) || !clips.length) throw new Error('empty corpus manifest');
  const prepared = await Promise.all(clips.map(async (clip) => {
    if (isAbsolute(clip.path)) throw new Error(`absolute clip path: ${clip.id}`);
    const filePath = resolve(dirname(corpusManifest.path), clip.path);
    if (!filePath.startsWith(`${root}/`)) throw new Error(`clip escapes repository root: ${clip.id}`);
    const bytes = await readFile(filePath);
    if (sha(bytes) !== clip.wavSha256) throw new Error(`WAV digest mismatch: ${clip.id}`);
    const pcm = decodeWav16kMono(bytes);
    const pcmHash = sha(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    if (pcmHash !== clip.sha256) throw new Error(`PCM digest mismatch: ${clip.id}`);
    return { ...clip, pcm };
  }));

  const baseline: ModelArm = { manifest: baselineManifest.value.identity, observed: null, results: [] };
  const candidate: ModelArm = { manifest: candidateManifest.value.identity, observed: null, results: [] };
  const adapters: [ModelAdapter, ModelAdapter] = [
    await loadAdapter(baselineManifest.value, deviceManifest.value.baseUrl),
    await loadAdapter(candidateManifest.value, deviceManifest.value.baseUrl),
  ];
  const arms = [baseline, candidate] as const;
  const failures: string[] = [];
  const adapterInitializeMs: { baseline: number | null; candidate: number | null } = {
    baseline: null, candidate: null,
  };
  const assetTransfers: [AssetTransfer | null, AssetTransfer | null] = [null, null];
  const workerAcquisitions: [unknown | null, unknown | null] = [null, null];
  try {
    for (let armIndex = 0; armIndex < 2; armIndex += 1) {
      const started = performance.now();
      try {
        arms[armIndex].observed = await adapters[armIndex].initialize();
        adapterInitializeMs[armIndex ? 'candidate' : 'baseline'] = performance.now() - started;
      }
      catch (error) {
        adapterInitializeMs[armIndex ? 'candidate' : 'baseline'] = performance.now() - started;
        failures.push(`${armIndex ? 'candidate' : 'baseline'}_init:${String(error)}`);
      }
    }
    const trials = Math.max(2, Number.isInteger(policy?.minTrials) ? policy!.minTrials : 2);
    for (let trial = 0; trial < trials; trial += 1) {
      for (const clip of prepared) {
        // AB, then BA: the arms see the exact same Float32 bytes and clip boundaries.
        const order = trial % 2 ? [1, 0] : [0, 1];
        for (const armIndex of order) {
          const arm = arms[armIndex];
          let transcript: string | null = null;
          let inputSha256 = '';
          let error: string | undefined;
          let finalLatencyMs: number | null = null;
          if (arm.observed !== null) {
            try {
              const started = performance.now();
              await adapters[armIndex].decode(clip.pcm.slice());
              const result = await adapters[armIndex].finalize();
              finalLatencyMs = performance.now() - started;
              transcript = result.transcript;
              inputSha256 = result.inputSha256;
            } catch (caught) { error = String(caught); }
          } else error = 'adapter_initialization_failed';
          const expectedFillers = countFillerWords(clip.reference);
          const detectedFillers = transcript === null ? null : countFillerWords(transcript);
          const fillerDetection = detectedFillers === null ? null : {
            referenceCount: expectedFillers.total.count,
            detectedCount: detectedFillers.total.count,
            detectedByKey: Object.fromEntries(Object.entries(detectedFillers)
              .filter(([key, value]) => key !== 'total' && value.count > 0)
              .map(([key, value]) => [key, value.count])),
          };
          const audioDurationMs = clip.pcm.length / 16;
          arm.results.push({
            clipId: clip.id, trial, transcript, inputSha256, finalLatencyMs,
            audioDurationMs,
            realTimeFactor: finalLatencyMs === null ? null : finalLatencyMs / audioDurationMs,
            fillerDetection, error,
          });
        }
      }
    }
  } finally {
    for (let index = 0; index < adapters.length; index += 1) {
      try { assetTransfers[index] = await adapters[index].assetTransfer?.() ?? null; }
      catch (error) { failures.push(`${index ? 'candidate' : 'baseline'}_asset_transfer:${String(error)}`); }
      try { workerAcquisitions[index] = await adapters[index].workerAcquisition?.() ?? null; }
      catch (error) { failures.push(`${index ? 'candidate' : 'baseline'}_worker_acquisition:${String(error)}`); }
    }
    await Promise.allSettled(adapters.map((adapter) => adapter.dispose()));
  }
  const comparison = compareModelArms(clips, baseline, candidate, policy);
  const runtimePrerequisiteMissing = failures.some((failure) =>
    failure.includes('PREREQUISITE_RUNTIME_VERSION_MISMATCH'));
  const acceptance = runtimePrerequisiteMissing
    ? { verdict: 'HOLD' as const, reasons: ['runtime_prerequisite_unavailable', 'product_path_and_required_metrics_not_run'] }
    : comparison.verdict === 'FAIL'
    ? { verdict: 'FAIL' as const, reasons: comparison.reasons }
    : { verdict: 'HOLD' as const, reasons: [...comparison.reasons, 'product_path_and_required_metrics_not_run'] };
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    lane: 'model_only_corpus',
    productPath: 'NOT_RUN',
    device: deviceManifest.value,
    inputManifestSha256: {
      baseline: baselineManifest.sha256, candidate: candidateManifest.sha256,
      corpus: corpusManifest.sha256, device: deviceManifest.sha256,
      policy: policyBytes ? sha(policyBytes) : null,
    },
    inputFailures: failures,
    adapterInitializeMs,
    modelAssetTransfer: { baseline: assetTransfers[0], candidate: assetTransfers[1] },
    workerAcquisition: { baseline: workerAcquisitions[0], candidate: workerAcquisitions[1] },
    baseline, candidate, comparison,
    acceptance,
    identityLimitations: [baseline, candidate].map((arm, index) => arm.manifest.engine === 'moonshine-streaming'
      ? `${index ? 'candidate' : 'baseline'}: Moonshine model/revision come from verified configured pins; runtime exposes no introspected model identity. Init, decode and WASM backend are observed.`
      : null).filter(Boolean),
    unsupportedMetrics: [
      'first_useful_partial', 'cold_model_load_isolated', 'persistent_cache_size',
      'browser_worker_memory', 'product_start_stop_next_take', 'focus_keyword_coverage',
    ],
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ out, verdict: acceptance.verdict, reasons: acceptance.reasons }));
  process.exitCode = acceptance.verdict === 'FAIL' ? 1 : 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
