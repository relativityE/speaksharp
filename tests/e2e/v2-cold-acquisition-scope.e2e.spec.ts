import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const ROOT = process.cwd();
const ASSETS_DIR = join(ROOT, 'frontend', 'dist', 'assets');
const WORKER_FILE = readdirSync(ASSETS_DIR).find((file) => /^transformers-js\.worker-.*\.js$/.test(file));
if (!WORKER_FILE) throw new Error('built v2 worker asset is missing');

const MODEL_FILES = (JSON.parse(readFileSync(
    join(ROOT, 'frontend', 'src', 'services', 'transcription', 'selfHostedAssetPins.json'), 'utf8',
)) as { files: Array<{ path: string }> }).files;
const PIPELINE_MODEL_PATHS = [
    'config.json',
    'generation_config.json',
    'onnx/decoder_model_merged_quantized.onnx',
    'onnx/encoder_model_quantized.onnx',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
];

type Receipt = {
    completeness: string;
    reasonCode: string | null;
    outOfScopeCount: number | null;
    assetCount: number | null;
    networkBytes: number | null;
    downloadMs: number | null;
    diagnosticAssetMask?: boolean[];
};

async function loadV2Worker(
    page: import('@playwright/test').Page,
    prefixes: string[],
    expectedComponentGroups: Array<{
        prefixes: string[];
        minimumUniqueCount: number;
        expectedResourceUrls?: string[];
    }>,
    diagnosticAssetUrls: string[],
): Promise<Receipt> {
    const workerUrl = `/assets/${WORKER_FILE}`;
    return page.evaluate(async ({ workerUrl, prefixes, expectedComponentGroups, diagnosticAssetUrls }) => {
        const worker = new Worker(workerUrl, { type: 'module' });
        const receipt = await new Promise<Receipt>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error('v2 worker load timed out')), 120_000);
            worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
                const message = event.data;
                if (message.type === 'loaded') {
                    window.clearTimeout(timeout);
                    resolve({
                        ...(message.acquisition as Receipt),
                        diagnosticAssetMask: message.diagnosticAssetMask as boolean[] | undefined,
                    });
                } else if (message.type === 'error') {
                    window.clearTimeout(timeout);
                    reject(new Error(`v2 worker failed during init (${String(message.errorName ?? 'unknown')})`));
                }
            };
            worker.postMessage({
                id: 1,
                type: 'init',
                isE2E: false,
                model: {
                    key: 'whisper-base.en',
                    localId: 'whisper-base.en',
                    remoteId: 'Xenova/whisper-base.en',
                },
                assetPrefixes: prefixes,
                expectedComponentGroups,
                diagnosticAssetUrls,
                attempt: { token: crypto.randomUUID(), candidateId: 'v2:base.en' },
            });
        });
        worker.terminate();
        return receipt;
    }, { workerUrl, prefixes, expectedComponentGroups, diagnosticAssetUrls });
}

test('real v2 worker observation changes from one unmatched runtime request to complete setup transfer', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    test.skip(!baseURL, 'Playwright server must expose the test build');
    // This isolated worker test has no programmatic login or route state to preserve; loading the
    // local origin is required so the module worker and self-hosted model resolve same-origin.
    // eslint-disable-next-line no-restricted-syntax
    await page.goto('/');
    const origin = new URL(baseURL!).origin;
    const modelPrefix = `${origin}/models/whisper-base.en/`;
    const runtimePrefix = `${origin}/assets/`;
    const diagnosticAssetUrls = MODEL_FILES.map(({ path }) => `${modelPrefix}${path}`);
    const expectedModelUrls = PIPELINE_MODEL_PATHS.map((path) => `${modelPrefix}${path}`);

    // RED control reproduces the deployed scope: only pinned model-directory assets are declared.
    const oldScope = await loadV2Worker(page, [modelPrefix], [], diagnosticAssetUrls);
    expect(oldScope.completeness).toBe('partial');
    expect(oldScope.reasonCode).toBe('requests_outside_scope');
    expect(oldScope.outOfScopeCount).toBe(1);
    await page.evaluate(async () => {
        await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    });

    // GREEN measures the same first pipeline with the separately declared model and runtime groups.
    const completeScope = await loadV2Worker(page, [modelPrefix, runtimePrefix], [
        { prefixes: [modelPrefix], minimumUniqueCount: PIPELINE_MODEL_PATHS.length, expectedResourceUrls: expectedModelUrls },
        { prefixes: [runtimePrefix], minimumUniqueCount: 1 },
    ], diagnosticAssetUrls);
    console.log('content-free v2 acquisition receipts', JSON.stringify({
        modelOnly: {
            completeness: oldScope.completeness,
            reasonCode: oldScope.reasonCode,
            outOfScopeCount: oldScope.outOfScopeCount,
            assetCount: oldScope.assetCount,
            networkBytes: oldScope.networkBytes,
            downloadMs: oldScope.downloadMs,
            pinnedFileRequestMask: oldScope.diagnosticAssetMask,
        },
        modelAndRuntime: {
            completeness: completeScope.completeness,
            reasonCode: completeScope.reasonCode,
            outOfScopeCount: completeScope.outOfScopeCount,
            assetCount: completeScope.assetCount,
            networkBytes: completeScope.networkBytes,
            downloadMs: completeScope.downloadMs,
            pinnedFileRequestMask: completeScope.diagnosticAssetMask,
        },
    }));
    expect(completeScope.completeness, JSON.stringify({
        reasonCode: completeScope.reasonCode,
        outOfScopeCount: completeScope.outOfScopeCount,
        assetCount: completeScope.assetCount,
        pinnedFileRequestMask: completeScope.diagnosticAssetMask,
    })).toBe('complete');
    expect(completeScope.reasonCode).toBeNull();
    expect(completeScope.outOfScopeCount).toBe(0);
    expect(oldScope.diagnosticAssetMask).toEqual([
        false, true, true, false, false, true, true, true, false, true, true, false,
    ]);
    expect(completeScope.diagnosticAssetMask).toEqual(oldScope.diagnosticAssetMask);
    expect(completeScope.assetCount).toBe(PIPELINE_MODEL_PATHS.length + 1);
    expect(completeScope.networkBytes).toBeGreaterThan(0);
    expect(completeScope.downloadMs).toBeGreaterThan(0);
});
