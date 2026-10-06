import { chromium, type Browser, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdapterContext, ModelAdapter } from '../adapter';
import type { ModelIdentity } from '../../../tests/evidence/modelEvaluator';

type CandidateId = 'v4:base:q4' | 'v4:distil:q4' | 'moonshine:streaming-medium';
const v4Files = [
  'config.json', 'generation_config.json', 'preprocessor_config.json',
  'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
];

export async function configuredAssetDigest(root: string, candidateId: CandidateId, modelId: string): Promise<string> {
  const source = candidateId === 'moonshine:streaming-medium'
    ? 'frontend/src/services/transcription/moonshineAssetPins.json'
    : 'tests/fixtures/hf-asset-pins.json';
  const pins = JSON.parse(await readFile(join(root, source), 'utf8')) as {
    assets: Record<string, string | { sha256: string }>;
  };
  const keys = candidateId === 'moonshine:streaming-medium'
    ? Object.keys(pins.assets).filter((key) => key.includes(`${modelId}/`))
    : v4Files.map((file) => `${modelId}/resolve/main/${file}`);
  if (keys.length !== 7) throw new Error('expected seven committed model asset pins');
  const hash = createHash('sha256');
  for (const key of keys.sort()) {
    const value = pins.assets[key];
    const digest = typeof value === 'string' ? value : value?.sha256;
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`missing/invalid pin: ${key}`);
    hash.update(`${key}:${digest}\n`);
  }
  return hash.digest('hex');
}

type BrowserRuntime = {
  candidateId: CandidateId | null;
  runtime: unknown;
};

declare global {
  interface Window {
    __MODEL_EVALUATOR__?: {
      initialize: (id: CandidateId) => Promise<BrowserRuntime>;
      decodePcmBase64: (base64: string) => Promise<{ transcript: string; inputSha256: string }>;
      dispose: () => Promise<void>;
    };
  }
}

/** Model-only browser adapter for v4 and selected Moonshine; the page is local and internal-only. */
export function createAdapter(context: AdapterContext): ModelAdapter {
  const candidateId = context.options.candidateId as CandidateId | undefined;
  if (!candidateId || !['v4:base:q4', 'v4:distil:q4', 'moonshine:streaming-medium'].includes(candidateId)) {
    throw new Error('candidate-browser needs a registered candidateId adapter option');
  }
  let browser: Browser | null = null;
  let page: Page | null = null;
  let pending: { transcript: string; inputSha256: string } | null = null;
  return {
    async initialize(): Promise<ModelIdentity> {
      const packageName = candidateId === 'moonshine:streaming-medium'
        ? '@moonshine-ai/moonshine-wasm' : '@huggingface/transformers';
      const installed = JSON.parse(await readFile(join(context.repositoryRoot, 'node_modules', packageName, 'package.json'), 'utf8')) as {
        version: string;
      };
      const runtime = `${packageName}@${installed.version}`;
      if (runtime !== context.expected.runtime) {
        throw new Error(`PREREQUISITE_RUNTIME_VERSION_MISMATCH: expected ${context.expected.runtime}, installed ${runtime}`);
      }
      const digest = await configuredAssetDigest(context.repositoryRoot, candidateId, context.expected.modelId);
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      page.setDefaultTimeout(180_000);
      if (candidateId === 'moonshine:streaming-medium') {
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
      const state = await page.evaluate((id) => window.__MODEL_EVALUATOR__!.initialize(id), candidateId) as BrowserRuntime;
      if (state.candidateId !== candidateId || !state.runtime) {
        throw new Error('browser candidate did not publish runtime identity');
      }
      if (candidateId === 'moonshine:streaming-medium') {
        const metadata = state.runtime as {
          configuredModel?: { model?: string; revision?: string | null; pinDigest?: string | null };
          observedExecution?: { initSucceeded?: boolean; backend?: string };
        };
        if (!metadata.observedExecution?.initSucceeded || metadata.observedExecution.backend !== 'wasm') {
          throw new Error('Moonshine did not report successful WASM initialization');
        }
        // Moonshine does not introspect model ID/revision. These are pinned config facts, paired with
        // observed WASM initialization and an actual decode; the report must not call them runtime facts.
        return {
          engine: 'moonshine-streaming',
          modelId: metadata.configuredModel?.model ?? '',
          revision: metadata.configuredModel?.revision ?? null,
          assetDigest: digest,
          runtime,
          backend: 'wasm',
        };
      }
      const v4 = state.runtime as {
        modelId?: string; backend?: string; fallbackOccurred?: boolean; dtype?: Record<string, string>;
      };
      if (v4.fallbackOccurred) throw new Error('v4 runtime reported backend fallback');
      if (!v4.modelId || !v4.backend) throw new Error('v4 worker did not publish model/backend');
      return {
        engine: 'private-v4', modelId: v4.modelId, revision: null,
        assetDigest: digest, runtime, backend: v4.backend,
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
    async dispose() {
      try { await page?.evaluate(() => window.__MODEL_EVALUATOR__?.dispose()); }
      finally { await browser?.close(); browser = null; page = null; pending = null; }
    },
  };
}
