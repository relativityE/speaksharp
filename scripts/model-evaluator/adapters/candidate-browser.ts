import { chromium, type Browser, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AdapterContext, ModelAdapter } from '../adapter';
import type { ModelIdentity } from '../../../tests/evidence/modelEvaluator';
import { AssetTransferRecorder } from '../asset-transfer';
import { CANDIDATES, type CandidateId } from '../../../frontend/src/services/transcription/candidateRegistry';
import type { PrivateRuntimeEvidence } from '../../../frontend/src/contracts/IPrivateSTTEngine';

export async function configuredAssetDigest(root: string, candidateId: CandidateId, modelId: string): Promise<string> {
  const candidate = CANDIDATES[candidateId];
  if (!candidate || candidate.model.id !== modelId) throw new Error('Candidate/model identity mismatch');
  const source = candidate.assets.pinSource;
  if (!source) throw new Error('Descriptor has no asset inventory source');
  if (candidate.assets.provenance === 'self_hosted') {
    const directory = join(root, source);
    const files: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) files.push(child);
        else throw new Error(`Non-file model asset: ${child}`);
      }
    };
    await walk(directory);
    if (!files.length || files.length !== candidate.assets.componentCount) {
      throw new Error('Self-hosted asset count differs from descriptor');
    }
    const hash = createHash('sha256');
    let totalBytes = 0;
    for (const path of files.sort()) {
      const bytes = await readFile(path);
      totalBytes += bytes.length;
      hash.update(`${relative(directory, path).split('\\').join('/')}:${createHash('sha256').update(bytes).digest('hex')}\n`);
    }
    const digest = hash.digest('hex');
    if (digest !== candidate.assets.pinDigest ||
        (candidate.assets.totalBytes != null && totalBytes !== candidate.assets.totalBytes)) {
      throw new Error('Self-hosted asset bytes differ from descriptor');
    }
    return digest;
  }
  const pins = JSON.parse(await readFile(join(root, source), 'utf8')) as {
    assets: Record<string, string | { sha256: string }>;
    files?: Array<{ path: string; bytes: number; sha256: string; url?: string }>;
  };
  if (candidate.assets.files?.length) {
    const files = candidate.assets.files;
    if (!pins.files || pins.files.length !== files.length || files.length !== candidate.assets.componentCount ||
        new Set(files.map(file => file.path)).size !== files.length ||
        new Set(files.map(file => file.url)).size !== files.length ||
        new Set(pins.files.map(file => file.path)).size !== pins.files.length) {
      throw new Error('Explicit asset inventory differs from descriptor');
    }
    const hash = createHash('sha256');
    let totalBytes = 0;
    for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
      const pin = pins.files.find(entry => entry.path === file.path);
      if (!pin || pin.url !== file.url || pin.bytes !== file.bytes || pin.sha256 !== file.sha256 ||
          !(file.url?.startsWith('https://') || (file.url && /^\/models\/[A-Za-z0-9_./-]+$/.test(file.url) &&
            !file.url.split('/').includes('..'))) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
          !Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
        throw new Error(`Explicit asset pin differs from descriptor: ${file.path}`);
      }
      if (file.url!.startsWith('/models/')) {
        const bytes = await readFile(join(root, 'frontend/public', file.url!));
        if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
          throw new Error(`Local runtime bytes differ from descriptor: ${file.path}`);
        }
      }
      totalBytes += file.bytes;
      hash.update(`${file.path}:${file.sha256}\n`);
    }
    const digest = hash.digest('hex');
    if (digest !== candidate.assets.pinDigest || totalBytes !== candidate.assets.totalBytes) {
      throw new Error('Explicit asset digest/bytes differ from descriptor');
    }
    // Configured pins only: actual downloaded bytes are verified by the shared engine loader.
    return digest;
  }
  const keys = candidate.assets.pinKeys ? [...candidate.assets.pinKeys]
    : candidate.assets.pinKeyPrefix
      ? Object.keys(pins.assets).filter((key) => key.startsWith(candidate.assets.pinKeyPrefix!)) : [];
  if (!keys.length || new Set(keys).size !== keys.length || keys.length !== candidate.assets.componentCount) {
    throw new Error('Asset inventory differs from the candidate descriptor');
  }
  const hash = createHash('sha256');
  for (const key of keys.sort()) {
    const value = pins.assets[key];
    const digest = typeof value === 'string' ? value : value?.sha256;
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`missing/invalid pin: ${key}`);
    hash.update(`${key}:${digest}\n`);
  }
  const digest = hash.digest('hex');
  if (digest !== candidate.assets.pinDigest) throw new Error('Asset digest differs from the candidate descriptor');
  return digest;
}

type BrowserRuntime = {
  candidateId: CandidateId | null;
  runtime: PrivateRuntimeEvidence | null;
  workerAcquisition: unknown;
};

declare global {
  interface Window {
    __MODEL_EVALUATOR__?: {
      initialize: (id: CandidateId, backend: 'wasm' | 'webgpu', consentToDownload?: boolean) => Promise<BrowserRuntime>;
      decodePcmBase64: (base64: string) => Promise<{ transcript: string; inputSha256: string }>;
      dispose: () => Promise<void>;
    };
  }
}

/** Model-only browser adapter using the product facade; the page is local and internal-only. */
export function createAdapter(context: AdapterContext): ModelAdapter {
  const candidateId = context.options.candidateId as CandidateId | undefined;
  if (!candidateId || !Object.prototype.hasOwnProperty.call(CANDIDATES, candidateId)) {
    throw new Error('candidate-browser needs a registered candidateId adapter option');
  }
  const candidate = CANDIDATES[candidateId];
  if (!candidate.browser.ok) {
    throw new Error(`PREREQUISITE_CANDIDATE_UNAVAILABLE: ${candidate.browser.reason}`);
  }
  const backend = context.expected.backend;
  if ((backend !== 'wasm' && backend !== 'webgpu') ||
      (candidate.model.device === 'wasm' && backend !== 'wasm')) {
    throw new Error('candidate-browser needs a supported declared backend');
  }
  let browser: Browser | null = null;
  let page: Page | null = null;
  let pending: { transcript: string; inputSha256: string } | null = null;
  let acquisition: unknown | null = null;
  let gpuAdapter: { vendor: string; architecture: string; device: string } | null = null;
  const transfer = new AssetTransferRecorder();
  return {
    async initialize(): Promise<ModelIdentity> {
      const packageName = candidate.runtime.package;
      // Pinned browser code is verified by the shared loader, not an unrelated node_modules copy.
      // This version remains configured provenance; init/backend evidence is checked separately below.
      const installed = candidate.runtime.distribution === 'pinned-assets' ? { version: candidate.runtime.version }
        : JSON.parse(await readFile(join(context.repositoryRoot, 'node_modules', packageName, 'package.json'), 'utf8')) as {
        version: string;
      };
      const runtime = `${packageName}@${installed.version}`;
      if (runtime !== context.expected.runtime) {
        throw new Error(`PREREQUISITE_RUNTIME_VERSION_MISMATCH: expected ${context.expected.runtime}, installed ${runtime}`);
      }
      const digest = await configuredAssetDigest(context.repositoryRoot, candidateId, context.expected.modelId);
      browser = await chromium.launch({ headless: context.headless, chromiumSandbox: true });
      page = await browser.newPage();
      page.setDefaultTimeout(180_000);
      await transfer.attach(page);
      if (candidate.engine === 'moonshine-streaming') {
        // Vite prebundles the package JS but does not copy its adjacent Emscripten binary. Without
        // this local-only route, `/node_modules/.vite/deps/moonshine.wasm` returns index.html ("<!do")
        // and the model is blamed for a harness packaging failure.
        const wasm = await readFile(join(context.repositoryRoot,
          'node_modules/@moonshine-ai/moonshine-wasm/dist/moonshine.wasm'));
        await page.route('**/moonshine.wasm', (route) => route.fulfill({
          status: 200, contentType: 'application/wasm', body: wasm,
        }));
      }
      await page.goto(new URL('/model-evaluator.local.html', context.baseUrl).toString());
      await page.waitForFunction(() => Boolean(window.__MODEL_EVALUATOR__));
      if (context.expected.backend === 'webgpu') {
        gpuAdapter = await page.evaluate(async () => {
          const gpu = (navigator as Navigator & { gpu?: {
            requestAdapter(): Promise<{ info: { vendor: string; architecture: string; device: string } } | null>;
          } }).gpu;
          const adapter = await gpu?.requestAdapter();
          return adapter ? {
            vendor: adapter.info.vendor,
            architecture: adapter.info.architecture,
            device: adapter.info.device,
          } : null;
        });
        if (!gpuAdapter || gpuAdapter.vendor.toLowerCase() !== context.expectedGpuVendor?.toLowerCase() ||
            /swiftshader|software/i.test(`${gpuAdapter.vendor} ${gpuAdapter.architecture} ${gpuAdapter.device}`)) {
          throw new Error('real WebGPU adapter unavailable or differs from device manifest');
        }
      }
      const state = await page.evaluate(({ id, backend, consentToDownload }) =>
        window.__MODEL_EVALUATOR__!.initialize(id, backend, consentToDownload),
        { id: candidateId, backend, consentToDownload: context.options.consentToDownload === true } as const) as BrowserRuntime;
      acquisition = state.workerAcquisition ?? null;
      if (acquisition &&
          (acquisition as { candidateId?: string }).candidateId !== candidateId) {
        throw new Error('Worker acquisition named a different candidate');
      }
      if (state.candidateId !== candidateId || !state.runtime) {
        throw new Error('browser candidate did not publish runtime identity');
      }
      const observed = state.runtime;
      if (!observed.initSucceeded || observed.backend !== backend || observed.fallbackOccurred) {
        throw new Error('Runtime did not initialize on the requested backend without fallback');
      }
      if (observed.modelId !== null && observed.modelId !== candidate.model.id) {
        throw new Error('Runtime model differs from the frozen descriptor');
      }
      // Historical report tokens describe runtime families, never individual model choices.
      const reportEngine = {
        'transformers-js': 'private-v2', 'transformers-js-v4': 'private-v4',
        'moonshine-streaming': 'moonshine-streaming',
        'granite-ctc': 'granite-ctc',
        'parakeet-tdt': 'parakeet-tdt',
      }[candidate.engine];
      // Model/revision remain configured provenance when the runtime cannot introspect them.
      return {
        engine: reportEngine, modelId: candidate.model.id, revision: candidate.model.revision,
        assetDigest: digest, runtime, backend: observed.backend,
      };
    },
    async decode(pcm16k: Float32Array): Promise<void> {
      if (!page || pending) throw new Error('candidate browser is unavailable or has an unfinalized take');
      const bytes = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
      pending = await page.evaluate((base64) => window.__MODEL_EVALUATOR__!.decodePcmBase64(base64),
        bytes.toString('base64'));
    },
    async finalize() {
      if (!pending) throw new Error('no pending candidate decode');
      const result = pending;
      pending = null;
      return result;
    },
    assetTransfer: () => transfer.snapshot(),
    async workerAcquisition() { return acquisition; },
    async deviceEvidence() { return gpuAdapter; },
    async dispose() {
      try { await page?.evaluate(() => window.__MODEL_EVALUATOR__?.dispose()); }
      finally { await browser?.close(); browser = null; page = null; pending = null; }
    },
  };
}
