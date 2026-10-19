import { describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { configuredAssetDigest, createAdapter } from '../../../scripts/model-evaluator/adapters/candidate-browser';

describe('#1565 candidate asset binding', () => {
  it.each([
    ['v4:base:q4', 'wasm'], ['v4:base:q4', 'webgpu'],
    ['v4:distil:q4', 'wasm'], ['v4:distil:q4', 'webgpu'],
  ] as const)('passes declared %s/%s through the browser callback', async (candidateId, backend) => {
    const modelId = candidateId === 'v4:base:q4' ? 'onnx-community/whisper-base.en' : 'onnx-community/distil-small.en';
    // Hardware capability is present even for the WASM arms; no browser/model is launched.
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({
      info: { vendor: 'test-vendor', architecture: 'hardware', device: 'test-device' },
    }) } });
    const initialize = vi.fn(async () => ({
      candidateId,
      runtime: { modelId, backend },
      workerAcquisition: null,
    }));
    window.__MODEL_EVALUATOR__ = { initialize, decodePcmBase64: vi.fn(), dispose: vi.fn() };
    const context = { newCDPSession: async () => ({ send: vi.fn() }), on: vi.fn() };
    const page = {
      context: () => context, setDefaultTimeout: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
      evaluate: async (fn: (argument: unknown) => unknown, argument: unknown) => fn(argument),
    };
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue({
      newPage: async () => page, close: vi.fn(),
    } as never);
    const adapter = createAdapter({
      baseUrl: 'http://unused.invalid', repositoryRoot: process.cwd(), headless: true, expectedGpuVendor: 'test-vendor',
      options: { candidateId },
      expected: {
        engine: 'private-v4', modelId, revision: null,
        assetDigest: 'unused', runtime: '@huggingface/transformers@4.3.0', backend,
      },
    });
    try {
      expect((await adapter.initialize()).backend).toBe(backend);
      expect(initialize).toHaveBeenCalledWith(candidateId, backend);
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
      expected: { engine: 'private-v4', modelId: 'unused', revision: null, assetDigest: 'unused', runtime: 'unused', backend },
    })).toThrow('supported declared backend');
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
});
