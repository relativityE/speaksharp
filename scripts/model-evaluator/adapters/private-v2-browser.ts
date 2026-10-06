import { chromium, type Browser, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AdapterContext, ModelAdapter } from '../adapter';
import type { ModelIdentity } from '../../../tests/evidence/modelEvaluator';
import { AssetTransferRecorder } from '../asset-transfer';

const require = createRequire(import.meta.url);

async function assetDigest(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`non-file model asset: ${path}`);
    }
  };
  await walk(root);
  if (!files.length) throw new Error('empty v2 model asset directory');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = await readFile(file);
    hash.update(`${relative(root, file)}:${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return hash.digest('hex');
}

/** Real shipping v2 worker through the existing PCM drop-in, without microphone timing. */
export function createAdapter(context: AdapterContext): ModelAdapter {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let pending: { transcript: string; inputSha256: string } | null = null;
  const transfer = new AssetTransferRecorder();
  return {
    async initialize(): Promise<ModelIdentity> {
      const source = join(context.repositoryRoot, 'frontend/public/models/whisper-base.en');
      const digest = await assetDigest(source);
      const installed = require('@xenova/transformers/package.json') as { version: string };
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      page.setDefaultTimeout(180_000);
      await transfer.attach(page);
      const base = new URL(context.baseUrl);
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== base.origin) await route.abort('blockedbyclient');
        else await route.continue();
      });
      await page.goto(new URL('/private-dropin.html?privateWorkerEvidence=1', base).toString());
      await page.waitForFunction(() => Boolean(window.__PRIVATE_DROPIN__));
      await page.evaluate(() => (window as unknown as { __PRIVATE_DROPIN__: { initModel: () => Promise<void> } })
        .__PRIVATE_DROPIN__.initModel());
      const runtime = await page.evaluate(() => (window as unknown as {
        __PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__?: { model: string; device: string | null };
      }).__PRIVATE_V2_WORKER_RUNTIME_EVIDENCE__ ?? null);
      if (!runtime || !runtime.device?.startsWith('wasm-')) {
        throw new Error('v2 worker did not report a WASM execution identity');
      }
      return {
        engine: 'private-v2',
        modelId: `Xenova/${runtime.model}`,
        revision: null,
        assetDigest: digest,
        runtime: `@xenova/transformers@${installed.version}`,
        backend: 'wasm',
      };
    },
    async decode(pcm16k: Float32Array): Promise<void> {
      if (!page || pending) throw new Error('v2 browser adapter is unavailable or has an unfinalized take');
      const bytes = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
      const transcript = await page.evaluate((base64) => window.__PRIVATE_DROPIN__!.transcribePcmBase64(base64),
        bytes.toString('base64'));
      const worker = await page.evaluate(() => window.__PRIVATE_V2_WORKER_INPUT_EVIDENCE__ ?? null);
      if (!worker) throw new Error('v2 worker supplied no input-hash evidence');
      pending = { transcript, inputSha256: worker.sha256 };
    },
    async finalize() {
      if (!pending) throw new Error('no pending v2 decode');
      const result = pending;
      pending = null;
      return result;
    },
    assetTransfer: () => transfer.snapshot(),
    async dispose() {
      await browser?.close();
      browser = null; page = null; pending = null;
    },
  };
}
