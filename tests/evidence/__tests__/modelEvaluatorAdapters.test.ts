import { describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { configuredAssetDigest, createAdapter } from '../../../scripts/model-evaluator/adapters/candidate-browser';
import { sha256 } from '../../../scripts/model-evaluator/source-binding';
import graniteManifest from '../fixtures/model-evaluator/candidate-granite-turboctc.json';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';

const fixtureSource = {
  head: 'a'.repeat(40), tree: 'b'.repeat(40), lockSha256: 'c'.repeat(64), worktreeSha256: 'd'.repeat(64),
  files: [{ path: 'frontend/src/benchmark/model-evaluator-local.ts', sha256: sha256('source fixture') }],
};

describe('#1565 candidate asset binding', () => {
  it.each([
    ['v4:base:q4', 'wasm', true], ['v4:base:q4', 'webgpu', true],
    ['v4:distil:q4', 'wasm', true], ['v4:distil:q4', 'webgpu', true],
    ['v4:base:q4', 'wasm', false],
    ['granite:turboctc-q4f16', 'webgpu', false],
  ] as const)('passes declared %s/%s and preserves introspection availability %s', async (candidateId, backend, introspected) => {
    const modelId = candidateId === 'granite:turboctc-q4f16' ? 'ibm-granite/granite-speech-5.0-470m-turboctc'
      : candidateId === 'v4:base:q4' ? 'onnx-community/whisper-base.en' : 'onnx-community/distil-small.en';
    vi.stubGlobal('__APP_RELEASE__', fixtureSource.head);
    // Hardware capability is present even for the WASM arms; no browser/model is launched.
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({
      info: { vendor: 'test-vendor', architecture: 'hardware', device: 'test-device' },
    }) } });
    const initialize = vi.fn(async () => ({
      candidateId,
      runtime: { initSucceeded: true, fallbackOccurred: false, modelId: introspected ? modelId : null, backend },
      workerAcquisition: null,
    }));
    window.__MODEL_EVALUATOR__ = { initialize, decodePcmBase64: vi.fn(), dispose: vi.fn() };
    const context = { newCDPSession: async () => ({ send: vi.fn() }), on: vi.fn() };
    const page = {
      context: () => context, setDefaultTimeout: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
      request: { get: vi.fn(async () => ({ ok: () => true, text: async () => 'export default "source fixture";' })) },
      evaluate: async (fn: (argument: unknown) => unknown, argument: unknown) => fn(argument),
    };
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue({
      newPage: async () => page, close: vi.fn(), version: () => 'test-installed-chrome',
    } as never);
    const adapter = createAdapter({
      baseUrl: 'http://unused.invalid', repositoryRoot: process.cwd(), headless: true, expectedGpuVendor: 'test-vendor',
      options: { candidateId, consentToDownload: true },
      source: fixtureSource,
      expected: {
        engine: candidateId === 'granite:turboctc-q4f16' ? 'granite-ctc' : 'private-v4', modelId, revision: null,
        assetDigest: 'unused', runtime: candidateId === 'granite:turboctc-q4f16' ? 'onnxruntime-web@1.26.0' : '@huggingface/transformers@4.3.0', backend,
      },
    });
    try {
      expect((await adapter.initialize()).backend).toBe(backend);
      expect(initialize).toHaveBeenCalledWith(candidateId, backend, true);
      expect(launch).toHaveBeenCalledWith({ channel: 'chrome', headless: true, chromiumSandbox: true });
      expect(await adapter.executionEvidence?.()).toMatchObject({
        browser: { channel: 'chrome', version: 'test-installed-chrome', isolatedContext: true },
        runtimeObservation: { initSucceeded: true, fallbackOccurred: false, modelId: introspected ? modelId : null, backend },
        servingSource: { release: fixtureSource.head, verifiedSourceFiles: 1 },
      });
    } finally {
      await adapter.dispose();
      launch.mockRestore();
      delete window.__MODEL_EVALUATOR__;
      vi.unstubAllGlobals();
    }
  });

  it.each(['cpu', 'cuda', '', 'WASM'])('rejects unsupported backend %s before browser initialization', (backend) => {
    expect(() => createAdapter({
      baseUrl: 'http://unused.invalid', repositoryRoot: process.cwd(), headless: true, expectedGpuVendor: null,
      options: { candidateId: 'v4:base:q4' },
      source: fixtureSource,
      expected: { engine: 'private-v4', modelId: 'unused', revision: null, assetDigest: 'unused', runtime: 'unused', backend },
    })).toThrow('supported declared backend');
  });

  it('keeps Granite evaluation on the actual app WebGPU descriptor and refuses its historical WASM arm', () => {
    expect(graniteManifest.identity.backend).toBe(CANDIDATES['granite:turboctc-q4f16'].model.device);
    expect(() => createAdapter({ source: fixtureSource, baseUrl: 'http://unused.invalid',
      repositoryRoot: process.cwd(), headless: false, expectedGpuVendor: 'apple',
      options: graniteManifest.adapterOptions, expected: { ...graniteManifest.identity, backend: 'wasm' },
    })).toThrow('Granite product backend mismatch');
  });

  it('binds each selected model and decoder precision to its committed asset pins', async () => {
    const root = process.cwd();
    expect(await configuredAssetDigest(root, 'v4:base:q4', 'onnx-community/whisper-base.en'))
      .toBe('19e79a9e383779a6763c9e766ccd4e3067d5481d6468164c4b86147ddb356644');
    expect(await configuredAssetDigest(root, 'v4:distil:q4', 'onnx-community/distil-small.en'))
      .toBe('b5e113f824bd8db270210d4c90ac779d2914c705bc692a9376b7cb89dbde042e');
    expect(await configuredAssetDigest(root, 'moonshine:streaming-medium', 'medium-streaming-en'))
      .toBe('898305d7768356a7f56002a4b2c4e55dd0534a6fd1ae11b0aadc0d11d2a27891');
  });

  it.each(['stale_release', 'wrong_source_bytes'] as const)('refuses %s before acquiring any model', async fault => {
    vi.stubGlobal('__APP_RELEASE__', fault === 'stale_release' ? 'e'.repeat(40) : fixtureSource.head);
    const initialize = vi.fn();
    window.__MODEL_EVALUATOR__ = { initialize, decodePcmBase64: vi.fn(), dispose: vi.fn() };
    const page = {
      context: () => ({ newCDPSession: async () => ({ send: vi.fn() }), on: vi.fn() }),
      setDefaultTimeout: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
      request: { get: async () => ({ ok: () => true, text: async () => 'export default "stale source";' }) },
      evaluate: async (fn: (argument: unknown) => unknown, argument: unknown) => fn(argument),
    };
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue({
      newPage: async () => page, close: vi.fn(), version: () => 'test-installed-chrome',
    } as never);
    const adapter = createAdapter({
      source: fixtureSource, baseUrl: 'http://unused.invalid', repositoryRoot: process.cwd(),
      headless: true, expectedGpuVendor: null, options: { candidateId: 'v4:base:q4' },
      expected: { engine: 'private-v4', modelId: 'onnx-community/whisper-base.en', revision: null,
        assetDigest: 'unused', runtime: '@huggingface/transformers@4.3.0', backend: 'wasm' },
    });
    try {
      await expect(adapter.initialize()).rejects.toThrow(fault === 'stale_release' ? 'served_release' : 'served_source_mismatch');
      expect(initialize).not.toHaveBeenCalled();
    } finally { await adapter.dispose(); launch.mockRestore(); vi.unstubAllGlobals(); delete window.__MODEL_EVALUATOR__; }
  });
});
